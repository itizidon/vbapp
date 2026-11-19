import { PrismaClient } from "@prisma/client";
import { options, target } from "../feedback-processing/maintenance";
import { PrismaService } from "../prisma/prisma.service";
import { TrainingAccess } from "./access";
import { TrainingLibraryService } from "./library.service";
import { TrainingVideoService } from "./video.service";
import { TrainingVideoJobs } from "./jobs.service";
import { S3VideoStorage } from "./storage";
import { seedTraining } from "./seed";
import { sweepTrainingVideos } from "./maintenance";
export async function main(args = process.argv.slice(2)) {
  const o = options(args);
  if (!["seed", "maintenance"].includes(o.command))
    throw new Error("Use seed or maintenance");
  const selected = target(o, process.env);
  console.log(
    JSON.stringify({
      target: {
        host: selected.host,
        port: selected.port,
        database: selected.database,
      },
      command: o.command,
      execute: o.execute && !o.dryRun,
    }),
  );
  if (!o.execute || o.dryRun) return;
  const db = new PrismaClient() as PrismaService;
  try {
    if (o.command === "seed") {
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(selected.host) ||
        process.env.APP_ENV === "production" ||
        process.env.NODE_ENV === "production"
      )
        throw new Error("Training examples are local development only");
      const actor = process.env.TRAINING_SEED_EDITOR_ID;
      if (!actor)
        throw new Error(
          "Set TRAINING_SEED_EDITOR_ID to an existing authorized editor",
        );
      console.log(JSON.stringify(await seedTraining(db, actor)));
    } else {
      const access = new TrainingAccess(db),
        lib = new TrainingLibraryService(db, access),
        storage = new S3VideoStorage(),
        videos = new TrainingVideoService(db, access, lib, storage),
        jobs = new TrainingVideoJobs(db, storage);
      console.log(
        JSON.stringify(
          await sweepTrainingVideos(
            db,
            videos,
            jobs,
            Math.min(o.batchSize, 100),
          ),
        ),
      );
    }
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      "Training command failed; verify selected environment, migrations, authorization and storage configuration.",
    );
    process.exitCode = 1;
  });
