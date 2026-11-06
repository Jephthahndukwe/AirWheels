-- CreateEnum
CREATE TYPE "BookingStepStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PricingRuleType" ADD VALUE 'TAX';
ALTER TYPE "PricingRuleType" ADD VALUE 'ROUNDING';
ALTER TYPE "PricingRuleType" ADD VALUE 'COST_MODEL';

-- AlterTable
ALTER TABLE "TransferBooking" ADD COLUMN     "payTokenHash" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "channel" "BookingChannel" NOT NULL DEFAULT 'WIDGET';

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "authorizationUrl" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "gatewayFeeKobo" INTEGER,
ADD COLUMN     "paidAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "completedAt" TIMESTAMPTZ(3),
ADD COLUMN     "gatewayRefundId" TEXT,
ADD COLUMN     "issuedByRole" TEXT;

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bookingId" UUID,
    "memo" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingStep" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "step" TEXT NOT NULL,
    "status" "BookingStepStatus" NOT NULL DEFAULT 'RUNNING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BookingStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" UUID NOT NULL,
    "gateway" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reference" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "result" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "settled" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "mismatches" JSONB NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_reference_key" ON "LedgerTransaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "BookingStep_bookingId_step_key" ON "BookingStep"("bookingId", "step");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_eventKey_key" ON "PaymentWebhookEvent"("eventKey");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_reference_idx" ON "PaymentWebhookEvent"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_gatewayRefundId_key" ON "Refund"("gatewayRefundId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingStep" ADD CONSTRAINT "BookingStep_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransferBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

