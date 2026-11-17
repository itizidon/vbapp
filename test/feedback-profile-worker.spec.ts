import { FeedbackProfileWorker } from "../src/feedback-analysis/profile-worker";
import * as profiles from "../src/feedback-processing/profiles";
import { PrismaService } from "../src/prisma/prisma.service";

describe("automatic SQL profile rebuilds", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("drains queued profiles without an extraction worker and stops on shutdown", async () => {
    const rebuild = jest
      .spyOn(profiles, "rebuildProfiles")
      .mockResolvedValue(1);
    const db = {} as PrismaService;
    const worker = new FeedbackProfileWorker(db);
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(5000);
    expect(rebuild).toHaveBeenCalledWith(db, 20);
    await worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(10000);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it("does not overlap slow batches and recovers from database errors", async () => {
    let finish!: (n: number) => void;
    const rebuild = jest
      .spyOn(profiles, "rebuildProfiles")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(0);
    const worker = new FeedbackProfileWorker({} as PrismaService);
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(15000);
    expect(rebuild).toHaveBeenCalledTimes(1);
    finish(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(rebuild).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
  });
});
