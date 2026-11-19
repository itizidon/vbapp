import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { S3VideoStorage } from "../src/training/storage";
describe("private S3/R2 adapter authorization", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });
  it("fails closed when storage is not configured", async () => {
    delete process.env.TRAINING_STORAGE_ENABLED;
    await expect(
      new S3VideoStorage().upload("training/test", "video/mp4", 10),
    ).rejects.toThrow("not configured");
  });
  it("signs exact object, MIME, length and conditional write without network calls", async () => {
    Object.assign(process.env, {
      TRAINING_STORAGE_ENABLED: "true",
      TRAINING_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      TRAINING_S3_BUCKET: "private-training",
      TRAINING_S3_ACCESS_KEY_ID: "fixture-id",
      TRAINING_S3_SECRET_ACCESS_KEY: "fixture-secret",
    });
    const out = await new S3VideoStorage().upload(
      "training/players/opaque/original",
      "video/mp4",
      128,
    );
    const url = new URL(out.url);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "if-none-match",
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-length",
    );
    expect(out.headers).toEqual({
      "content-type": "video/mp4",
      "content-length": "128",
      "if-none-match": "*",
    });
    expect(out.url).not.toContain("fixture-secret");
  });
  it("deletes the stored object version rather than just adding a delete marker", async () => {
    Object.assign(process.env, {
      TRAINING_STORAGE_ENABLED: "true",
      TRAINING_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      TRAINING_S3_BUCKET: "private-training",
      TRAINING_S3_ACCESS_KEY_ID: "fixture-id",
      TRAINING_S3_SECRET_ACCESS_KEY: "fixture-secret",
    });
    const send = jest
      .spyOn(S3Client.prototype, "send")
      .mockImplementation((async (command: any) =>
        command instanceof DeleteObjectCommand
          ? {}
          : { VersionId: "immutable-version" }) as any);
    await new S3VideoStorage().delete("training/players/opaque/original");
    expect((send.mock.calls[1][0] as DeleteObjectCommand).input.VersionId).toBe(
      "immutable-version",
    );
  });
});
