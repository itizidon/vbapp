import { CpuVideoWorker } from "../src/training/motion-worker";
import * as runtime from "../src/training/motion-runtime";
describe("video deletion during extraction artifact upload", () => {
  afterEach(() => jest.restoreAllMocks());
  it("removes a late artifact PUT without reviving deleted metadata", async () => {
    let deleted = false;
    const source = {
      id: "source",
      userId: "owner",
      storageKey: "training/players/owner/source/original",
      status: "VALIDATION_PENDING",
      deletedAt: null,
      mimeType: "video/mp4",
      fileSizeBytes: 128n,
    };
    const sourceRead = jest.fn(async () => ({
      ...source,
      deletedAt: deleted ? new Date() : null,
    }));
    const tx = {
      $executeRaw: jest.fn(async () => 0),
      drillVideoSubmission: { findUniqueOrThrow: sourceRead },
      videoPoseArtifact: {
        create: jest.fn(async ({ data }: any) => data),
        update: jest.fn(),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const db = {
      ...tx,
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      videoWorkerHeartbeat: {
        findUnique: jest.fn(async () => ({
          versions: { model: "fixture" },
          expiresAt: new Date(Date.now() + 60000),
        })),
      },
      videoPoseArtifact: {
        ...tx.videoPoseArtifact,
        findFirst: jest.fn(async () => null),
      },
    };
    const storage = {
      download: jest.fn(async () => {}),
      putArtifact: jest.fn(async () => {
        deleted = true;
      }),
      delete: jest.fn(async () => {}),
    };
    jest
      .spyOn(runtime, "pythonMotion")
      .mockImplementation(async (request: any) =>
        request.command === "probe"
          ? { bytes: 128, mimeType: "video/mp4", sourceHash: "fixture" }
          : {
              quality: { errorCode: null },
              modelVersion: "fixture",
              extractionVersion: "fixture",
              featureVersion: "fixture",
              samplingFps: 10,
              metadata: {},
            },
      );
    const worker = new CpuVideoWorker(db as never, storage as never);
    await expect(
      worker.extract(
        {
          id: "job",
          type: "EXTRACT_PLAYER_POSE",
          submissionId: "source",
          leaseToken: "lease",
        },
        "/tmp",
      ),
    ).rejects.toThrow("SOURCE_DELETED");
    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringMatching(
        /^training\/players\/owner\/source\/poses\/.+\.json$/,
      ),
    );
    expect(tx.videoPoseArtifact.update).not.toHaveBeenCalled();
    expect(db.videoPoseArtifact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "DELETED" } }),
      }),
    );
  });
});
