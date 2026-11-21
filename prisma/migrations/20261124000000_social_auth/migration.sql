-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'FACEBOOK');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "UserAuthProvider" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "providerEmail" TEXT,
    "providerEmailVerified" BOOLEAN,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAuthProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthTransaction" (
    "id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "mode" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "bindingHash" TEXT NOT NULL,
    "sessionHash" TEXT,
    "actorId" UUID,
    "returnTo" TEXT NOT NULL,
    "verifierCiphertext" TEXT,
    "nonceHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "providerUserId" TEXT,
    "providerEmail" TEXT,
    "providerEmailVerified" BOOLEAN,
    "verifiedEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthEmailChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "transactionId" UUID,
    "purpose" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthEmailChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthProviderDeletion" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthProviderDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAuthProvider_userId_idx" ON "UserAuthProvider"("userId");

-- CreateIndex
CREATE INDEX "UserAuthProvider_provider_idx" ON "UserAuthProvider"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "UserAuthProvider_provider_providerUserId_key" ON "UserAuthProvider"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAuthProvider_userId_provider_key" ON "UserAuthProvider"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthTransaction_stateHash_key" ON "OAuthTransaction"("stateHash");

-- CreateIndex
CREATE INDEX "OAuthTransaction_expiresAt_idx" ON "OAuthTransaction"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthEmailChallenge_email_purpose_createdAt_idx" ON "AuthEmailChallenge"("email", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "AuthEmailChallenge_transactionId_idx" ON "AuthEmailChallenge"("transactionId");

-- CreateIndex
CREATE INDEX "AuthEmailChallenge_expiresAt_idx" ON "AuthEmailChallenge"("expiresAt");

-- AddForeignKey
ALTER TABLE "UserAuthProvider" ADD CONSTRAINT "UserAuthProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthEmailChallenge" ADD CONSTRAINT "AuthEmailChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "OAuthTransaction" ADD CONSTRAINT "oauth_mode" CHECK (mode IN ('login','link','reauth'));
ALTER TABLE "OAuthTransaction" ADD CONSTRAINT "oauth_status" CHECK (status IN ('STARTED','EXCHANGING','IDENTIFIED','EMAIL_VERIFIED','DONE','FAILED'));
ALTER TABLE "OAuthTransaction" ADD CONSTRAINT "oauth_binding" CHECK (length("bindingHash")=64 AND length("stateHash")=64);
ALTER TABLE "AuthEmailChallenge" ADD CONSTRAINT "auth_email_attempts" CHECK (attempts BETWEEN 0 AND 5);
ALTER TABLE "AuthEmailChallenge" ADD CONSTRAINT "auth_email_purpose" CHECK (purpose IN ('SIGNUP','VERIFY_ACCOUNT','PASSWORD_RESET'));
