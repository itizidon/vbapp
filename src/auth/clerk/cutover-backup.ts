import type { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { CutoverCheckError, type CutoverPhase } from "./cutover-diagnostics";
const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';
export async function fingerprints(
  db: Pick<PrismaClient, "$queryRawUnsafe">,
  tables: string[],
) {
  const rows: Record<string, { count: number; hash: string }> = {};
  for (const table of tables) {
    const [row] = await db.$queryRawUnsafe<{ count: number; hash: string }[]>(
      `SELECT count(*)::int count,md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) hash FROM ${quote(table)} t`,
    );
    rows[table] = row;
  }
  return rows;
}
export async function createVerifiedBackup(
  db: PrismaClient,
  url: URL,
  directory: string,
  tables: string[],
  options: {
    dockerContainer?: string;
    authorizeCutover?: boolean;
    purpose?: string;
    onPhase?: (phase: CutoverPhase) => void;
  } = {},
) {
  const {
    dockerContainer,
    authorizeCutover = false,
    purpose = "clerk-cutover",
    onPhase,
  } = options;
  const host = url.hostname,
    port = url.port || "5432",
    database = decodeURIComponent(url.pathname.slice(1));
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  let capturedSnapshot!: Awaited<ReturnType<typeof fingerprints>>;
  onPhase?.("backup");
  mkdirSync(resolve(directory), { recursive: true, mode: 0o700 });
  const prefix = join(
      resolve(directory),
      purpose +
        "-" +
        new Date().toISOString().replace(/[:.]/g, "-") +
        "-" +
        randomUUID().slice(0, 8),
    ),
    backup = prefix + ".dump",
    manifest = prefix + ".json";
  if (authorizeCutover)
    await db.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "_ClerkCutoverPermit"(id text PRIMARY KEY,"backupSha256" text NOT NULL,database text NOT NULL,snapshot jsonb NOT NULL,"expiresAt" timestamptz NOT NULL)`,
    );
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
      await tx.$executeRawUnsafe(
        "LOCK TABLE " + tables.map(quote).join(",") + " IN EXCLUSIVE MODE",
      );
      const snapshot = await fingerprints(tx, tables),
        fd = openSync(backup, "wx", 0o600);
      capturedSnapshot = snapshot;
      const password = decodeURIComponent(url.password),
        env = { ...process.env, PGPASSWORD: password };
      try {
        const container = dockerContainer;
        if (container) {
          if (!local)
            throw new CutoverCheckError("Container backup is local-only");
          const inspected = JSON.parse(
            execFileSync("docker", ["inspect", container], {
              encoding: "utf8",
            }),
          )[0];
          if (
            !inspected.NetworkSettings?.Ports?.["5432/tcp"]?.some(
              (p: { HostPort: string }) => p.HostPort === port,
            )
          )
            throw new CutoverCheckError(
              "Backup container does not match the selected database port",
            );
          execFileSync(
            "docker",
            [
              "exec",
              "--env",
              "PGPASSWORD",
              container,
              "pg_dump",
              "-U",
              decodeURIComponent(url.username),
              "-d",
              database,
              "-Fc",
            ],
            { env, stdio: ["ignore", fd, "pipe"] },
          );
        } else {
          const connection = new URL(url);
          connection.password = "";
          execFileSync("pg_dump", ["--dbname", connection.toString(), "-Fc"], {
            env,
            stdio: ["ignore", fd, "pipe"],
          });
        }
      } finally {
        closeSync(fd);
      }
      onPhase?.("backup-validation");
      if (
        statSync(backup).size < 100 ||
        readFileSync(backup).subarray(0, 5).toString() !== "PGDMP"
      )
        throw new CutoverCheckError("PostgreSQL backup validation failed");
      // Validate the archive directory with PostgreSQL itself before issuing the destructive permit.
      const container = dockerContainer;
      const listing = container
        ? execFileSync(
            "docker",
            ["exec", "-i", container, "pg_restore", "--list"],
            {
              input: readFileSync(backup),
              encoding: "utf8",
              maxBuffer: 64 * 1024 * 1024,
            },
          )
        : execFileSync("pg_restore", ["--list", backup], {
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
          });
      if (!listing.includes("TABLE DATA"))
        throw new CutoverCheckError(
          "Backup archive has no restorable table data",
        );
      const sha256 = createHash("sha256")
        .update(readFileSync(backup))
        .digest("hex");
      writeFileSync(
        manifest,
        JSON.stringify(
          {
            version: 1,
            purpose,
            target: { host, port, database },
            backup,
            sha256,
            snapshot,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        { mode: 0o600, flag: "wx" },
      );
      if (authorizeCutover)
        await tx.$executeRaw`INSERT INTO "_ClerkCutoverPermit"(id,"backupSha256",database,snapshot,"expiresAt") VALUES('clerk-fresh-start',${sha256},current_database(),${JSON.stringify(snapshot)}::jsonb,now()+interval '15 minutes') ON CONFLICT(id) DO UPDATE SET "backupSha256"=excluded."backupSha256",snapshot=excluded.snapshot,"expiresAt"=excluded."expiresAt"`;
    },
    { timeout: 600000, maxWait: 10000 },
  );
  return { backup, manifest, snapshot: capturedSnapshot };
}
