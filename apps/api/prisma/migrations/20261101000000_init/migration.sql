-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BookingChannel" AS ENUM ('ADDON', 'WIDGET', 'LINK', 'OWN_PAGE', 'OPS');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('STANDARD', 'FLEX');

-- CreateEnum
CREATE TYPE "RideType" AS ENUM ('PRIVATE', 'SHARED');

-- CreateEnum
CREATE TYPE "LegType" AS ENUM ('DEPARTURE', 'ARRIVAL');

-- CreateEnum
CREATE TYPE "VehicleClass" AS ENUM ('SEDAN', 'SUV', 'VAN');

-- CreateEnum
CREATE TYPE "PowerType" AS ENUM ('ELECTRIC', 'HYBRID', 'PETROL');

-- CreateEnum
CREATE TYPE "CollectedBy" AS ENUM ('AIRLINE', 'AIRWHEELS');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('QUOTED', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'PAYMENT_FAILED', 'REJECTED', 'CANCELLING', 'CANCELLED', 'REFUNDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "LegStatus" AS ENUM ('SCHEDULED', 'ASSIGNED', 'DRIVER_CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'PICKED_UP', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "SharedGroupStatus" AS ENUM ('OPEN', 'LOCKED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'DISSOLVED');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('INVITED', 'ACTIVATED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OPS_AGENT', 'SUPER_ADMIN', 'FINANCE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AirlineStatus" AS ENUM ('ACTIVE', 'PAUSED', 'OFFBOARDED');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "FlightSource" AS ENUM ('AIRLINE', 'BACKUP_API', 'OPS', 'DRIVER', 'TRAVELLER');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "FlightStatus" AS ENUM ('SCHEDULED', 'DELAYED', 'DEPARTED', 'LANDED', 'CANCELLED', 'DIVERTED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'DISPUTED');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY');

-- CreateEnum
CREATE TYPE "RefundRoute" AS ENUM ('AIRLINE', 'PAYSTACK');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EarningType" AS ENUM ('TRIP', 'STANDBY', 'BONUS', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'APPROVED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "PricingRuleType" AS ENUM ('ZONE_FARE', 'CEILING', 'SURCHARGE', 'PLAN', 'FEE', 'VEHICLE_CLASS', 'DISCOUNT', 'SHARED_SHARE', 'MARGIN_FLOOR', 'REVENUE_SHARE');

-- CreateEnum
CREATE TYPE "DispatchPlanStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'LOCKED');

-- CreateEnum
CREATE TYPE "OfferResponse" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ActorRole" AS ENUM ('TRAVELLER', 'DRIVER', 'OPS', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL', 'PUSH', 'OPS_CHAT');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "PickupPointType" AS ENUM ('DEPARTURE_DROPOFF', 'ARRIVAL_PICKUP', 'MEETING_POINT');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('TO_AIRPORT', 'FROM_AIRPORT');

-- CreateTable
CREATE TABLE "Airline" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "serviceBrandName" TEXT NOT NULL,
    "status" "AirlineStatus" NOT NULL DEFAULT 'ACTIVE',
    "quoteExpiryMinutes" INTEGER NOT NULL DEFAULT 30,
    "revenueShareBps" INTEGER NOT NULL DEFAULT 0,
    "settlementTerms" JSONB,
    "webhookUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Airline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AirlineCredential" (
    "id" UUID NOT NULL,
    "airlineId" UUID NOT NULL,
    "keyId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "allowedIps" TEXT[],
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "rotatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AirlineCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AirlineTheme" (
    "id" UUID NOT NULL,
    "airlineId" UUID NOT NULL,
    "colours" JSONB NOT NULL,
    "font" TEXT,
    "logoUrl" TEXT,
    "wording" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AirlineTheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" UUID NOT NULL,
    "airlineId" UUID,
    "event" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "body" TEXT NOT NULL,
    "buttons" JSONB,
    "providerName" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "phone" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "passwordHash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "photoUrl" TEXT,
    "status" "DriverStatus" NOT NULL DEFAULT 'INVITED',
    "kycProvider" TEXT,
    "kycResult" JSONB,
    "kycVerifiedAt" TIMESTAMPTZ(3),
    "ratingAvg" DOUBLE PRECISION,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "pinHash" TEXT,
    "deviceId" TEXT,
    "onDuty" BOOLEAN NOT NULL DEFAULT false,
    "startLat" DOUBLE PRECISION,
    "startLng" DOUBLE PRECISION,
    "trainingChecklist" JSONB,
    "bankAccount" JSONB,
    "createdByAdminId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "totpSecret" TEXT,
    "lastLoginAt" TIMESTAMPTZ(3),
    "lastLoginIp" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverInvite" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriverInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarPartner" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "contact" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CarPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "colour" TEXT NOT NULL,
    "class" "VehicleClass" NOT NULL,
    "seats" INTEGER NOT NULL,
    "bagCapacity" INTEGER NOT NULL,
    "powerType" "PowerType" NOT NULL,
    "partnerId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleAssignment" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "from" TIMESTAMPTZ(3) NOT NULL,
    "to" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VehicleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "verifiedBy" UUID,
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferBooking" (
    "id" UUID NOT NULL,
    "airlineId" UUID,
    "channel" "BookingChannel" NOT NULL,
    "airlineBookingReference" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'STANDARD',
    "rideType" "RideType" NOT NULL DEFAULT 'PRIVATE',
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "policyRuleVersion" INTEGER,
    "pricingRuleVersion" INTEGER,
    "quoteId" UUID,
    "quoteSnapshot" JSONB,
    "collectedBy" "CollectedBy" NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "airlineShareKobo" INTEGER NOT NULL DEFAULT 0,
    "passengers" INTEGER NOT NULL,
    "bags" INTEGER NOT NULL,
    "flaggedForOps" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TransferBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Traveller" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "email" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Traveller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingToken" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrackingToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeCode" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChangeCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideLeg" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "type" "LegType" NOT NULL,
    "rideType" "RideType" NOT NULL DEFAULT 'PRIVATE',
    "groupId" UUID,
    "stopNumber" INTEGER,
    "pickupText" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "pickupLandmark" TEXT,
    "dropoffText" TEXT NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "dropoffLandmark" TEXT,
    "pickupPointId" UUID,
    "flightId" UUID,
    "scheduledAt" TIMESTAMPTZ(3),
    "nextActionAt" TIMESTAMPTZ(3),
    "vehicleClass" "VehicleClass" NOT NULL DEFAULT 'SEDAN',
    "status" "LegStatus" NOT NULL DEFAULT 'SCHEDULED',
    "driverId" UUID,
    "vehicleId" UUID,
    "pickupCodeHash" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RideLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingEvent" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actorRole" "ActorRole" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "data" JSONB,
    "time" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseCode" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightRecord" (
    "id" UUID NOT NULL,
    "flightNumber" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "airlineCode" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FlightRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightSnapshot" (
    "id" UUID NOT NULL,
    "flightId" UUID NOT NULL,
    "scheduledDeparture" TIMESTAMPTZ(3),
    "scheduledArrival" TIMESTAMPTZ(3),
    "estimatedDeparture" TIMESTAMPTZ(3),
    "estimatedArrival" TIMESTAMPTZ(3),
    "actualDeparture" TIMESTAMPTZ(3),
    "actualArrival" TIMESTAMPTZ(3),
    "status" "FlightStatus" NOT NULL,
    "terminal" TEXT,
    "source" "FlightSource" NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "rawPayload" JSONB,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FlightSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" UUID NOT NULL,
    "airlineId" UUID,
    "request" JSONB NOT NULL,
    "breakdown" JSONB NOT NULL,
    "totalKobo" INTEGER NOT NULL,
    "marginKobo" INTEGER NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "pricingRuleVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lockedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "gateway" TEXT NOT NULL DEFAULT 'paystack',
    "gatewayReference" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementStatement" (
    "id" UUID NOT NULL,
    "airlineId" UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "lines" JSONB NOT NULL,
    "adjustments" JSONB NOT NULL,
    "totalKobo" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMPTZ(3),
    "paidAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SettlementStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "bookingId" UUID,
    "amountKobo" BIGINT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "reference" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "legId" UUID,
    "amountKobo" INTEGER NOT NULL,
    "route" "RefundRoute" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "issuedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverEarning" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "legId" UUID,
    "amountKobo" INTEGER NOT NULL,
    "type" "EarningType" NOT NULL,
    "payoutId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriverEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" UUID,
    "gatewayReference" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageStatement" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "trips" INTEGER NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UsageStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" UUID NOT NULL,
    "type" "PricingRuleType" NOT NULL,
    "key" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "outcomes" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "overriddenById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigEntry" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "description" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConfigEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchPlan" (
    "id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "legs" JSONB NOT NULL,
    "status" "DispatchPlanStatus" NOT NULL DEFAULT 'PROPOSED',
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DispatchPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchOffer" (
    "id" UUID NOT NULL,
    "legId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "response" "OfferResponse" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DispatchOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationPing" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "legId" UUID,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "time" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" UUID NOT NULL,
    "legId" UUID NOT NULL,
    "fromRole" "ActorRole" NOT NULL,
    "toRole" "ActorRole" NOT NULL,
    "time" TIMESTAMPTZ(3) NOT NULL,
    "durationSeconds" INTEGER,
    "outcome" TEXT NOT NULL,
    "providerReference" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "recipient" TEXT NOT NULL,
    "recipientRole" "ActorRole" NOT NULL,
    "bookingId" UUID,
    "template" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "error" TEXT,
    "time" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravellerReply" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "legId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "buttonOrText" TEXT NOT NULL,
    "mappedIntent" TEXT,
    "providerMessageId" TEXT,
    "time" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TravellerReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportNote" (
    "id" UUID NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupportNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" UUID NOT NULL,
    "legId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" TEXT,
    "actorRole" "ActorRole" NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "time" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Airport" (
    "id" UUID NOT NULL,
    "iata" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "terminal" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Airport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupPoint" (
    "id" UUID NOT NULL,
    "airportId" UUID NOT NULL,
    "type" "PickupPointType" NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "directions" TEXT,
    "activeHours" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PickupPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" UUID NOT NULL,
    "airportId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "polygon" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Corridor" (
    "id" UUID NOT NULL,
    "airportId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "Direction",
    "sharedOn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Corridor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorridorArea" (
    "id" UUID NOT NULL,
    "corridorId" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "polygon" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CorridorArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedGroup" (
    "id" UUID NOT NULL,
    "airportIata" TEXT NOT NULL,
    "terminal" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "date" TEXT NOT NULL,
    "corridorId" UUID NOT NULL,
    "flightNumber" TEXT,
    "status" "SharedGroupStatus" NOT NULL DEFAULT 'OPEN',
    "route" JSONB,
    "driverId" UUID,
    "vehicleId" UUID,
    "lockedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SharedGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupStop" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "legId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "plannedTime" TIMESTAMPTZ(3) NOT NULL,
    "extraMinutes" INTEGER NOT NULL,
    "actualTime" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GroupStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelTime" (
    "id" UUID NOT NULL,
    "fromZone" TEXT NOT NULL,
    "toZone" TEXT NOT NULL,
    "hourOfDay" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "refreshedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TravelTime_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Airline_code_key" ON "Airline"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AirlineCredential_keyId_key" ON "AirlineCredential"("keyId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_airlineId_event_channel_language_version_key" ON "MessageTemplate"("airlineId", "event", "channel", "language", "version");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DriverProfile_userId_key" ON "DriverProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminProfile_userId_key" ON "AdminProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plate_key" ON "Vehicle"("plate");

-- CreateIndex
CREATE INDEX "Document_ownerType_ownerId_idx" ON "Document"("ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferBooking_quoteId_key" ON "TransferBooking"("quoteId");

-- CreateIndex
CREATE INDEX "TransferBooking_status_idx" ON "TransferBooking"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TransferBooking_airlineId_airlineBookingReference_key" ON "TransferBooking"("airlineId", "airlineBookingReference");

-- CreateIndex
CREATE UNIQUE INDEX "Traveller_bookingId_key" ON "Traveller"("bookingId");

-- CreateIndex
CREATE INDEX "Traveller_phone_idx" ON "Traveller"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingToken_bookingId_key" ON "TrackingToken"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingToken_tokenHash_key" ON "TrackingToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ChangeCode_bookingId_idx" ON "ChangeCode"("bookingId");

-- CreateIndex
CREATE INDEX "RideLeg_status_nextActionAt_idx" ON "RideLeg"("status", "nextActionAt");

-- CreateIndex
CREATE INDEX "RideLeg_driverId_idx" ON "RideLeg"("driverId");

-- CreateIndex
CREATE INDEX "BookingEvent_bookingId_time_idx" ON "BookingEvent"("bookingId", "time");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "FlightRecord_flightNumber_date_key" ON "FlightRecord"("flightNumber", "date");

-- CreateIndex
CREATE INDEX "FlightSnapshot_flightId_observedAt_idx" ON "FlightSnapshot"("flightId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_gatewayReference_key" ON "PaymentIntent"("gatewayReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_idempotencyKey_key" ON "PaymentIntent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementStatement_airlineId_periodStart_key" ON "SettlementStatement"("airlineId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");

-- CreateIndex
CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry"("transactionId");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_idx" ON "LedgerEntry"("accountId");

-- CreateIndex
CREATE INDEX "PricingRule_type_key_effectiveFrom_idx" ON "PricingRule"("type", "key", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigEntry_key_version_key" ON "ConfigEntry"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchPlan_date_key" ON "DispatchPlan"("date");

-- CreateIndex
CREATE INDEX "DispatchOffer_legId_idx" ON "DispatchOffer"("legId");

-- CreateIndex
CREATE INDEX "LocationPing_driverId_time_idx" ON "LocationPing"("driverId", "time");

-- CreateIndex
CREATE INDEX "Notification_bookingId_idx" ON "Notification"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "TravellerReply_providerMessageId_key" ON "TravellerReply"("providerMessageId");

-- CreateIndex
CREATE INDEX "SupportNote_subjectType_subjectId_idx" ON "SupportNote"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Airport_iata_terminal_key" ON "Airport"("iata", "terminal");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_code_key" ON "Zone"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Corridor_airportId_name_key" ON "Corridor"("airportId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CorridorArea_corridorId_order_key" ON "CorridorArea"("corridorId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "GroupStop_legId_key" ON "GroupStop"("legId");

-- CreateIndex
CREATE UNIQUE INDEX "TravelTime_fromZone_toZone_hourOfDay_key" ON "TravelTime"("fromZone", "toZone", "hourOfDay");

-- AddForeignKey
ALTER TABLE "AirlineCredential" ADD CONSTRAINT "AirlineCredential_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirlineTheme" ADD CONSTRAINT "AirlineTheme_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminProfile" ADD CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverInvite" ADD CONSTRAINT "DriverInvite_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "CarPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferBooking" ADD CONSTRAINT "TransferBooking_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferBooking" ADD CONSTRAINT "TransferBooking_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Traveller" ADD CONSTRAINT "Traveller_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransferBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingToken" ADD CONSTRAINT "TrackingToken_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransferBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideLeg" ADD CONSTRAINT "RideLeg_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransferBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideLeg" ADD CONSTRAINT "RideLeg_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SharedGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideLeg" ADD CONSTRAINT "RideLeg_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "FlightRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideLeg" ADD CONSTRAINT "RideLeg_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideLeg" ADD CONSTRAINT "RideLeg_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransferBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightSnapshot" ADD CONSTRAINT "FlightSnapshot_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "FlightRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransferBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementStatement" ADD CONSTRAINT "SettlementStatement_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransferBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransferBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_legId_fkey" FOREIGN KEY ("legId") REFERENCES "RideLeg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_legId_fkey" FOREIGN KEY ("legId") REFERENCES "RideLeg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageStatement" ADD CONSTRAINT "UsageStatement_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "CarPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransferBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_legId_fkey" FOREIGN KEY ("legId") REFERENCES "RideLeg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_legId_fkey" FOREIGN KEY ("legId") REFERENCES "RideLeg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_legId_fkey" FOREIGN KEY ("legId") REFERENCES "RideLeg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravellerReply" ADD CONSTRAINT "TravellerReply_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "TransferBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravellerReply" ADD CONSTRAINT "TravellerReply_legId_fkey" FOREIGN KEY ("legId") REFERENCES "RideLeg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_legId_fkey" FOREIGN KEY ("legId") REFERENCES "RideLeg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupPoint" ADD CONSTRAINT "PickupPoint_airportId_fkey" FOREIGN KEY ("airportId") REFERENCES "Airport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_airportId_fkey" FOREIGN KEY ("airportId") REFERENCES "Airport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Corridor" ADD CONSTRAINT "Corridor_airportId_fkey" FOREIGN KEY ("airportId") REFERENCES "Airport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorridorArea" ADD CONSTRAINT "CorridorArea_corridorId_fkey" FOREIGN KEY ("corridorId") REFERENCES "Corridor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorridorArea" ADD CONSTRAINT "CorridorArea_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedGroup" ADD CONSTRAINT "SharedGroup_corridorId_fkey" FOREIGN KEY ("corridorId") REFERENCES "Corridor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedGroup" ADD CONSTRAINT "SharedGroup_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedGroup" ADD CONSTRAINT "SharedGroup_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupStop" ADD CONSTRAINT "GroupStop_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SharedGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupStop" ADD CONSTRAINT "GroupStop_legId_fkey" FOREIGN KEY ("legId") REFERENCES "RideLeg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

