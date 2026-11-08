-- DropIndex
DROP INDEX "ChangeCode_bookingId_idx";

-- AlterTable
ALTER TABLE "ChangeCode" ADD COLUMN     "grantExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "grantHash" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "buttons" JSONB,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMPTZ(3),
ADD COLUMN     "fallbackForId" UUID,
ADD COLUMN     "kind" TEXT,
ADD COLUMN     "legId" UUID,
ADD COLUMN     "preview" TEXT,
ADD COLUMN     "readAt" TIMESTAMPTZ(3),
ADD COLUMN     "sentAt" TIMESTAMPTZ(3),
ADD COLUMN     "templateVersion" INTEGER;

-- CreateTable
CREATE TABLE "ConversationWindow" (
    "phone" TEXT NOT NULL,
    "lastInboundAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConversationWindow_pkey" PRIMARY KEY ("phone")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChangeCode_grantHash_key" ON "ChangeCode"("grantHash");

-- CreateIndex
CREATE INDEX "ChangeCode_bookingId_createdAt_idx" ON "ChangeCode"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_providerMessageId_key" ON "Notification"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_recipient_time_idx" ON "Notification"("recipient", "time");

-- CreateIndex
CREATE INDEX "Notification_channel_status_sentAt_idx" ON "Notification"("channel", "status", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_legId_key" ON "Rating"("legId");

