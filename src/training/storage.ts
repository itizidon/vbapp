import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
export type StoredVideo = { bytes: number; mimeType: string; etag?: string };
export interface VideoStorage {
  upload(
    key: string,
    mimeType: string,
    bytes: number,
  ): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }>;
  head(key: string): Promise<StoredVideo>;
  playback(key: string): Promise<{ url: string; expiresAt: Date }>;
  delete(key: string): Promise<void>;
}
export function trainingLimit(
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const value =
    process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new ServiceUnavailableException("Invalid training storage limits");
  return value;
}
@Injectable()
export class S3VideoStorage implements VideoStorage {
  private settings() {
    if (process.env.TRAINING_STORAGE_ENABLED !== "true")
      throw new ServiceUnavailableException(
        "Private video storage is not configured",
      );
    const {
      TRAINING_S3_ENDPOINT: endpoint,
      TRAINING_S3_BUCKET: bucket,
      TRAINING_S3_ACCESS_KEY_ID: accessKeyId,
      TRAINING_S3_SECRET_ACCESS_KEY: secretAccessKey,
    } = process.env;
    if (
      !bucket ||
      !accessKeyId ||
      !secretAccessKey ||
      !endpoint ||
      !(
        new URL(endpoint).protocol === "https:" ||
        (process.env.NODE_ENV !== "production" &&
          process.env.TRAINING_S3_ALLOW_LOCAL_HTTP === "true" &&
          ["localhost", "127.0.0.1"].includes(new URL(endpoint).hostname))
      )
    )
      throw new ServiceUnavailableException(
        "Private video storage configuration is incomplete",
      );
    return {
      bucket,
      client: new S3Client({
        endpoint,
        region: process.env.TRAINING_S3_REGION ?? "auto",
        forcePathStyle: process.env.TRAINING_S3_FORCE_PATH_STYLE === "true",
        credentials: { accessKeyId, secretAccessKey },
        requestChecksumCalculation: "WHEN_REQUIRED",
      }),
    };
  }
  async download(
    key: string,
    destination: string,
    maxBytes = 100 * 1024 * 1024,
  ) {
    const { bucket, client } = this.settings();
    const { createWriteStream } = await import("node:fs");
    const { Transform } = await import("node:stream");
    const { pipeline } = await import("node:stream/promises");
    try {
      const object = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(45000) },
      );
      if (!object.Body || (object.ContentLength ?? Infinity) > maxBytes)
        throw new Error("Object exceeds limit");
      let total = 0;
      await pipeline(
        object.Body as any,
        new Transform({
          transform(chunk, _enc, callback) {
            total += chunk.length;
            callback(
              total > maxBytes ? new Error("Object exceeds limit") : null,
              chunk,
            );
          },
        }),
        createWriteStream(destination, { mode: 0o600, flags: "wx" }),
        { signal: AbortSignal.timeout(45000) },
      );
    } finally {
      client.destroy();
    }
  }
  async putArtifact(key: string, file: string) {
    const { bucket, client } = this.settings();
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(file);
    if (body.length > 32 * 1024 * 1024)
      throw new Error("Artifact exceeds limit");
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: "application/json",
          IfNoneMatch: "*",
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
    } finally {
      client.destroy();
    }
  }
  async upload(key: string, mimeType: string, bytes: number) {
    const { bucket, client } = this.settings();
    const ttl = trainingLimit("TRAINING_UPLOAD_URL_SECONDS", 180, 30, 900);
    const headers = {
      "content-type": mimeType,
      "content-length": String(bytes),
      "if-none-match": "*",
    };
    try {
      return {
        url: await getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: mimeType,
            ContentLength: bytes,
            IfNoneMatch: "*",
          }),
          { expiresIn: ttl, signableHeaders: new Set(Object.keys(headers)) },
        ),
        headers,
        expiresAt: new Date(Date.now() + ttl * 1000),
      };
    } catch {
      throw new ServiceUnavailableException("Unable to authorize video upload");
    } finally {
      client.destroy();
    }
  }
  async head(key: string) {
    const { bucket, client } = this.settings();
    try {
      const object = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return {
        bytes: object.ContentLength ?? -1,
        mimeType: object.ContentType ?? "",
        etag: object.ETag,
      };
    } catch {
      throw new ServiceUnavailableException("Uploaded object is unavailable");
    } finally {
      client.destroy();
    }
  }
  async playback(key: string) {
    const { bucket, client } = this.settings();
    const ttl = trainingLimit("TRAINING_PLAYBACK_URL_SECONDS", 120, 15, 300);
    try {
      return {
        url: await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ResponseContentDisposition: "inline",
          }),
          { expiresIn: ttl },
        ),
        expiresAt: new Date(Date.now() + ttl * 1000),
      };
    } catch {
      throw new ServiceUnavailableException("Unable to authorize playback");
    } finally {
      client.destroy();
    }
  }
  async delete(key: string) {
    const { bucket, client } = this.settings();
    try {
      let current;
      try {
        current = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
      } catch (e: any) {
        if (e?.$metadata?.httpStatusCode === 404) return;
        throw e;
      }
      // Keys are create-only. Delete the actual current version, not merely a versioned-bucket delete marker.
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(current.VersionId ? { VersionId: current.VersionId } : {}),
        }),
      );
    } catch {
      throw new ServiceUnavailableException(
        "Video cleanup temporarily unavailable",
      );
    } finally {
      client.destroy();
    }
  }
}
