-- Candidate-triggered code runs (IDE "Run", 2026-10): one row per Run click,
-- filled by the CODE_RUN worker with the candidate's own output. No truth.
CREATE TABLE "code_runs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionQuestionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "argsUsed" JSONB,
    "exitCode" INTEGER,
    "durationMs" INTEGER,
    "stdout" TEXT NOT NULL DEFAULT '',
    "stderr" TEXT NOT NULL DEFAULT '',
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "code_runs_sessionId_createdAt_idx" ON "code_runs"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "code_runs_sessionQuestionId_createdAt_idx" ON "code_runs"("sessionQuestionId", "createdAt");

-- AddForeignKey
ALTER TABLE "code_runs" ADD CONSTRAINT "code_runs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "test_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_runs" ADD CONSTRAINT "code_runs_sessionQuestionId_fkey" FOREIGN KEY ("sessionQuestionId") REFERENCES "session_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
