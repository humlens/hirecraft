-- CreateEnum
CREATE TYPE "PortalStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PortalTheme" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "status" "PortalStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "suspendedReason" TEXT;

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "portalRoleId" TEXT;

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "portalRoleId" TEXT;

-- CreateTable
CREATE TABLE "PortalProfile" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "description" TEXT,
    "website" TEXT,
    "contactEmail" TEXT,
    "logoKey" TEXT,
    "industry" TEXT,
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalBranding" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL DEFAULT '#3346D3',
    "theme" "PortalTheme" NOT NULL DEFAULT 'SYSTEM',
    "heroTitle" TEXT,
    "heroSubtitle" TEXT,
    "aboutHtml" TEXT,
    "privacyPolicyHtml" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalBranding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalRole" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseRole" "Role" NOT NULL DEFAULT 'MEMBER',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isOwnerRole" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalRolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "PortalRolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalProfile_teamId_key" ON "PortalProfile"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalBranding_teamId_key" ON "PortalBranding"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "PortalRole_teamId_idx" ON "PortalRole"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalRole_teamId_key_key" ON "PortalRole"("teamId", "key");

-- CreateIndex
CREATE INDEX "PortalRolePermission_permissionId_idx" ON "PortalRolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "TeamMember_portalRoleId_idx" ON "TeamMember"("portalRoleId");

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_portalRoleId_fkey" FOREIGN KEY ("portalRoleId") REFERENCES "PortalRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_portalRoleId_fkey" FOREIGN KEY ("portalRoleId") REFERENCES "PortalRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalProfile" ADD CONSTRAINT "PortalProfile_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalBranding" ADD CONSTRAINT "PortalBranding_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalRole" ADD CONSTRAINT "PortalRole_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalRolePermission" ADD CONSTRAINT "PortalRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "PortalRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalRolePermission" ADD CONSTRAINT "PortalRolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- System role templates (teamId IS NULL) must be unique by key. A plain
-- UNIQUE(teamId, key) does not enforce this because NULLs are distinct.
CREATE UNIQUE INDEX "PortalRole_system_key_unique" ON "PortalRole"("key") WHERE "teamId" IS NULL;
