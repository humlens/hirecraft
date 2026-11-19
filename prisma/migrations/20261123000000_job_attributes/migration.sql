-- Structured extra facts about a job (healthcare: shift, licence, certifications)
ALTER TABLE "Job" ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}';
