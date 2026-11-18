-- AlterTable
ALTER TABLE "Team" ADD COLUMN "planKey" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN "planOverride" TEXT,
ADD COLUMN "paymentFailedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlanEntitlement" (
    "plan" TEXT NOT NULL,
    "limits" JSONB NOT NULL,
    "features" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanEntitlement_pkey" PRIMARY KEY ("plan")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalDomain" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "certificateStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetTeamId" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "accountLabel" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "encryptedCredentials" TEXT,
    "connectedById" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_teamId_metric_periodStart_key" ON "UsageCounter"("teamId", "metric", "periodStart");
CREATE INDEX "UsageCounter_teamId_periodStart_idx" ON "UsageCounter"("teamId", "periodStart");
CREATE UNIQUE INDEX "PortalDomain_teamId_hostname_key" ON "PortalDomain"("teamId", "hostname");
CREATE INDEX "PortalDomain_hostname_idx" ON "PortalDomain"("hostname");
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");
CREATE INDEX "PlatformAuditLog_targetTeamId_createdAt_idx" ON "PlatformAuditLog"("targetTeamId", "createdAt");
CREATE UNIQUE INDEX "Integration_teamId_provider_key" ON "Integration"("teamId", "provider");

-- A hostname can be claimed by several portals until one proves DNS ownership;
-- once verified it belongs to exactly one portal.
CREATE UNIQUE INDEX "PortalDomain_verified_hostname_key" ON "PortalDomain"("hostname") WHERE "verifiedAt" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalDomain" ADD CONSTRAINT "PortalDomain_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
