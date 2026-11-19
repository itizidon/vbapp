import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { createHash } from "node:crypto";
export const motionHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function pythonMotion(request: unknown): Promise<any> {
  const python = process.env.VIDEO_PYTHON ?? resolve(".venv-video/bin/python");
  return new Promise((yes, no) => {
    const child = spawn(python, [resolve("video-worker/pipeline.py")], {
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MPLCONFIGDIR: "/tmp/bvbtips-matplotlib",
        OPENBLAS_NUM_THREADS: "1",
        OMP_NUM_THREADS: "1",
      },
    });
    let out = "",
      err = "";
    const timeout = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
      no(new Error("PROCESSING_TIMEOUT"));
    }, 150000);
    child.stdout.on("data", (b) => {
      out += b;
      if (out.length > 4 * 1024 * 1024) {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {}
      }
    });
    child.stderr.on("data", (b) => {
      if (err.length < 1024) err += b;
    });
    child.on("error", () => {
      clearTimeout(timeout);
      no(new Error("VIDEO_RUNTIME_UNAVAILABLE"));
    });
    child.on("close", () => {
      clearTimeout(timeout);
      try {
        const r = JSON.parse(out);
        if (!r.ok) throw new Error(r.errorCode);
        yes(r.value);
      } catch (e) {
        no(
          e instanceof Error && /^[A-Z_]+$/.test(e.message)
            ? e
            : new Error("VIDEO_PROCESSING_FAILED"),
        );
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
@Injectable()
export class MotionRuntime {
  constructor(private db: PrismaService) {}
  async status() {
    const row = await this.db.videoWorkerHeartbeat.findUnique({
      where: { id: "cpu-pose-v1" },
    });
    return {
      available: !!row && row.expiresAt > new Date(),
      versions: row?.versions ?? null,
      expiresAt: row?.expiresAt ?? null,
    };
  }
  async heartbeat(versions: any) {
    await this.db.videoWorkerHeartbeat.upsert({
      where: { id: "cpu-pose-v1" },
      create: {
        id: "cpu-pose-v1",
        versions,
        expiresAt: new Date(Date.now() + 45000),
      },
      update: { versions, expiresAt: new Date(Date.now() + 45000) },
    });
  }
}
