-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('VERIFICATIONS_WRITE');

-- CreateTable
CREATE TABLE "PermissionGrant" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "PermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PermissionGrant_orgId_permission_idx" ON "PermissionGrant"("orgId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionGrant_orgId_userId_permission_key" ON "PermissionGrant"("orgId", "userId", "permission");

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
