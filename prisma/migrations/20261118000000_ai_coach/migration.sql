BEGIN;
-- CreateTable
CREATE TABLE "AiCoachConversation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sportId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCoachConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCoachTurn" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "clientRequestId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "response" JSONB,
    "sourceRevision" INTEGER,
    "sourceAsOf" TEXT,
    "model" TEXT,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "toolTrace" JSONB NOT NULL DEFAULT '[]',
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiCoachTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCoachUsage" (
    "userId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "reservedTokens" INTEGER NOT NULL DEFAULT 0,
    "spentTokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiCoachUsage_pkey" PRIMARY KEY ("userId","day")
);

-- CreateIndex
CREATE INDEX "AiCoachConversation_userId_updatedAt_id_idx" ON "AiCoachConversation"("userId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "AiCoachConversation_expiresAt_idx" ON "AiCoachConversation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiCoachConversation_userId_id_key" ON "AiCoachConversation"("userId", "id");

-- CreateIndex
CREATE INDEX "AiCoachTurn_conversationId_startedAt_id_idx" ON "AiCoachTurn"("conversationId", "startedAt", "id");

-- CreateIndex
CREATE INDEX "AiCoachTurn_userId_startedAt_idx" ON "AiCoachTurn"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiCoachTurn_userId_clientRequestId_key" ON "AiCoachTurn"("userId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "AiCoachConversation" ADD CONSTRAINT "AiCoachConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachConversation" ADD CONSTRAINT "AiCoachConversation_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachTurn" ADD CONSTRAINT "AiCoachTurn_userId_conversationId_fkey" FOREIGN KEY ("userId", "conversationId") REFERENCES "AiCoachConversation"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachTurn" ADD CONSTRAINT "AiCoachTurn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachUsage" ADD CONSTRAINT "AiCoachUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "AiCoachTurn" ADD CHECK (status IN ('PENDING','COMPLETED','FALLBACK','FAILED'));
ALTER TABLE "AiCoachTurn" ADD CHECK (char_length(question) BETWEEN 1 AND 2000);
ALTER TABLE "AiCoachUsage" ADD CHECK (requests>=0 AND "reservedTokens">=0 AND "spentTokens">=0);
COMMIT;
