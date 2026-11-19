-- Per-feature model tier overrides (fast / standard / best)
ALTER TABLE "AIProviderConfig" ADD COLUMN "tierByFeature" JSONB NOT NULL DEFAULT '{}';
