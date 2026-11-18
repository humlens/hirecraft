-- pgvector is required (use the pgvector/pgvector image or install the extension).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "AIProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'OPENAI_COMPATIBLE');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "embeddedAt" TIMESTAMP(3),
ADD COLUMN     "embedding" vector(1536);

-- AlterTable
ALTER TABLE "CandidateProfile" ADD COLUMN     "embeddedAt" TIMESTAMP(3),
ADD COLUMN     "embedding" vector(1536),
ADD COLUMN     "search" tsvector GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig,
        coalesce("headline", '') || ' ' || coalesce("summary", '') || ' ' || coalesce("location", ''))
) STORED;

-- CreateTable
CREATE TABLE "AIProviderConfig" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "provider" "AIProvider" NOT NULL,
    "baseUrl" TEXT,
    "encryptedApiKey" TEXT,
    "keyHint" TEXT,
    "modelByTier" JSONB NOT NULL DEFAULT '{}',
    "embeddingModel" TEXT,
    "enabledFeatures" JSONB NOT NULL DEFAULT '{}',
    "logRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "monthlyCredits" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "system" TEXT,
    "body" TEXT NOT NULL,
    "schema" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsage" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "userId" TEXT,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptKey" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIRequestLog" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "usageId" TEXT,
    "feature" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParsedField" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParsedField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchAssessment" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "matchedSkills" TEXT[],
    "missingSkills" TEXT[],
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "suggestedQuestions" TEXT[],
    "promptVersion" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AIProviderConfig_teamId_key" ON "AIProviderConfig"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_key_version_key" ON "PromptTemplate"("key", "version");

-- CreateIndex
CREATE INDEX "AIUsage_teamId_createdAt_idx" ON "AIUsage"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "AIUsage_userId_createdAt_idx" ON "AIUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AIRequestLog_expiresAt_idx" ON "AIRequestLog"("expiresAt");

-- CreateIndex
CREATE INDEX "AIRequestLog_teamId_createdAt_idx" ON "AIRequestLog"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "ParsedField_resumeId_idx" ON "ParsedField"("resumeId");

-- CreateIndex
CREATE INDEX "MatchAssessment_teamId_applicationId_createdAt_idx" ON "MatchAssessment"("teamId", "applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ParsedField" ADD CONSTRAINT "ParsedField_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "CandidateResume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchAssessment" ADD CONSTRAINT "MatchAssessment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Full-text and vector indexes
CREATE INDEX "CandidateProfile_search_idx" ON "CandidateProfile" USING GIN ("search");
CREATE INDEX "CandidateProfile_embedding_idx" ON "CandidateProfile" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "Job_embedding_idx" ON "Job" USING hnsw ("embedding" vector_cosine_ops);

-- The platform default config (teamId IS NULL) must be unique: NULLs are distinct in a plain unique index.
CREATE UNIQUE INDEX "AIProviderConfig_platform_unique" ON "AIProviderConfig" ((1)) WHERE "teamId" IS NULL;
