-- Pickup code versioning (reissue) and wrong-attempt limit per leg.
ALTER TABLE "RideLeg" ADD COLUMN "pickupCodeVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "pickupCodeFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pickupCodeLockedAt" TIMESTAMPTZ(3);
