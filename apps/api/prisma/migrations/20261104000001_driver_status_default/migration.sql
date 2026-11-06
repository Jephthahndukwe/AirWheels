-- Separate migration: Postgres cannot use a new enum value in the transaction that added it.
ALTER TABLE "DriverProfile" ALTER COLUMN "status" SET DEFAULT 'ONBOARDING';
