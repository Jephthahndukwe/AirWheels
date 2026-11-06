-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('ADMIN', 'DRIVER');

-- CreateEnum
CREATE TYPE "ChallengePurpose" AS ENUM ('DRIVER_ACTIVATION', 'DRIVER_NEW_DEVICE');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterEnum
ALTER TYPE "DriverStatus" ADD VALUE 'ONBOARDING';

-- AlterTable
ALTER TABLE "AirlineCredential" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "expiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "revokedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "activatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "address" TEXT,
ADD COLUMN     "idNumber" TEXT,
ADD COLUMN     "idType" TEXT,
ADD COLUMN     "licenceNumber" TEXT,
ADD COLUMN     "pinFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinLockedUntil" TIMESTAMPTZ(3),
ADD COLUMN     "referees" JSONB,
ADD COLUMN     "suspendedAt" TIMESTAMPTZ(3),
ADD COLUMN     "suspendedReason" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "AdminProfile" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "invitedById" UUID,
ADD COLUMN     "lastTotpStep" INTEGER,
ADD COLUMN     "lockedUntil" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "DriverInvite" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sentById" UUID;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "uploadedAt" TIMESTAMPTZ(3),
ADD COLUMN     "uploadedById" UUID;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorLabel" TEXT;

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "deviceId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "kind" "SessionKind" NOT NULL,
    "identifier" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "deviceId" TEXT,
    "time" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminInvite" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pendingTotpSecret" TEXT,
    "invitedById" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" UUID NOT NULL,
    "purpose" "ChallengePurpose" NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" UUID,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsAlert" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "bookingId" UUID,
    "legId" UUID,
    "driverId" UUID,
    "data" JSONB,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OpsAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "LoginEvent_userId_time_idx" ON "LoginEvent"("userId", "time");

-- CreateIndex
CREATE UNIQUE INDEX "AdminInvite_tokenHash_key" ON "AdminInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminInvite_email_idx" ON "AdminInvite"("email");

-- CreateIndex
CREATE INDEX "AuthChallenge_phone_purpose_idx" ON "AuthChallenge"("phone", "purpose");

-- CreateIndex
CREATE INDEX "OpsAlert_status_createdAt_idx" ON "OpsAlert"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OpsAlert_legId_idx" ON "OpsAlert"("legId");

-- CreateIndex
CREATE INDEX "AuditLog_time_idx" ON "AuditLog"("time");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

