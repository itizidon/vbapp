import { deploymentPreflight } from "../src/auth/clerk/deploy-preflight";
function database(
  legacy: boolean,
  clerk: boolean,
  migrations: boolean,
  failed: string[] = [],
) {
  const $queryRaw = jest
    .fn()
    .mockResolvedValueOnce([{ legacy, clerk, migrations }])
    .mockResolvedValueOnce(failed.map((name) => ({ name })));
  return { $queryRaw };
}
it("blocks ordinary deploys before attempting a legacy-account reset", async () => {
  await expect(
    deploymentPreflight(database(true, false, true) as never),
  ).rejects.toThrow("backup-gated procedure");
});
it("directs empty databases through the same reviewed bootstrap and cutover", async () => {
  const db = database(false, false, false);
  await expect(deploymentPreflight(db as never)).rejects.toThrow(
    "Initial Clerk cutover",
  );
  expect(db.$queryRaw).toHaveBeenCalledTimes(1);
});
it("permits ordinary deployments after the completed Clerk cutover", async () => {
  await expect(
    deploymentPreflight(database(false, true, true) as never),
  ).resolves.toBeUndefined();
});
it("blocks even a seemingly complete schema when a failed cutover is recorded", async () => {
  await expect(
    deploymentPreflight(
      database(false, true, true, [
        "20261126000000_clerk_identity_cutover",
      ]) as never,
    ),
  ).rejects.toThrow("Do not mark the cutover applied");
});
it("does not hide unrelated failed migrations behind the cutover instructions", async () => {
  await expect(
    deploymentPreflight(
      database(false, true, true, ["future_migration"]) as never,
    ),
  ).rejects.toThrow("failed migration is recorded");
});
