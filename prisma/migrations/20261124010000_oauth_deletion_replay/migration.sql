ALTER TABLE "AuthProviderDeletion" ADD COLUMN "requestHash" TEXT;
CREATE UNIQUE INDEX "AuthProviderDeletion_requestHash_key" ON "AuthProviderDeletion"("requestHash");
