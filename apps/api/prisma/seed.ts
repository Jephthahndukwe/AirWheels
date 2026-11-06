import { PrismaClient, type VehicleClass } from '@prisma/client';
import { encrypt } from '../src/common/crypto';
import { haversineKm } from '../src/adapters/fakes';
import {
  airport,
  configDefaults,
  corridors,
  driverSeeds,
  pickupPoints,
  placeholderFareKobo,
} from './seed-data';

const prisma = new PrismaClient();
const EPOCH = new Date('2026-01-01T00:00:00Z');

async function main() {
  // Seed data is for local development and CI only. Staff accounts are never seeded: the first
  // super admin comes from `pnpm admin:create-super`.
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database.');
  const secret = process.env.MOCK_AIRLINE_SECRET;
  if (!secret) throw new Error('MOCK_AIRLINE_SECRET is empty. Run `pnpm setup:env` first.');

  // Config store
  for (const c of configDefaults) {
    await prisma.configEntry.upsert({
      where: { key_version: { key: c.key, version: 1 } },
      update: {},
      create: { key: c.key, value: c.value as object, version: 1, description: c.description },
    });
  }

  // Launch airline (mock)
  const code = process.env.MOCK_AIRLINE_CODE ?? 'MOCK';
  const airline = await prisma.airline.upsert({
    where: { code },
    update: {},
    create: {
      code,
      name: 'Mock Air',
      serviceBrandName: 'Mock Air Transfers',
      quoteExpiryMinutes: 30,
      revenueShareBps: 1000,
      settlementTerms: { schedule: 'WEEKLY' },
    },
  });
  const keyId = process.env.MOCK_AIRLINE_KEY_ID ?? 'mock-key-1';
  await prisma.airlineCredential.upsert({
    where: { keyId },
    update: { secretEncrypted: encrypt(secret), status: 'ACTIVE' },
    create: { airlineId: airline.id, keyId, secretEncrypted: encrypt(secret), allowedIps: [] },
  });
  if ((await prisma.airlineTheme.count({ where: { airlineId: airline.id } })) === 0) {
    await prisma.airlineTheme.create({
      data: {
        airlineId: airline.id,
        colours: { primary: '#1D3E8A', primaryForeground: '#FFFFFF' },
        wording: { title: 'Add airport transfer?', subtitle: 'A vetted driver at your door and at arrivals.' },
      },
    });
  }

  // Airport, pickup points, zones, corridors
  const ap = await prisma.airport.upsert({
    where: { iata_terminal: { iata: airport.iata, terminal: airport.terminal } },
    update: {},
    create: airport,
  });
  if ((await prisma.pickupPoint.count({ where: { airportId: ap.id } })) === 0) {
    await prisma.pickupPoint.createMany({ data: pickupPoints.map((p) => ({ ...p, airportId: ap.id })) });
  }

  for (const c of corridors) {
    const corridor = await prisma.corridor.upsert({
      where: { airportId_name: { airportId: ap.id, name: c.name } },
      update: {},
      create: { airportId: ap.id, name: c.name },
    });
    for (const [i, a] of c.areas.entries()) {
      const zone = await prisma.zone.upsert({
        where: { code: a.code },
        update: {},
        create: { airportId: ap.id, code: a.code, name: a.name, centerLat: a.lat, centerLng: a.lng },
      });
      await prisma.corridorArea.upsert({
        where: { corridorId_order: { corridorId: corridor.id, order: i + 1 } },
        update: {},
        create: { corridorId: corridor.id, zoneId: zone.id, order: i + 1 },
      });

      const km = haversineKm(a, airport);
      const fares = Object.fromEntries(
        (['SEDAN', 'SUV', 'VAN'] as const).map((vc) => [vc, placeholderFareKobo(km, vc)]),
      );
      await upsertRule('ZONE_FARE', a.code, { ...fares, placeholder: true });
    }
  }

  // Plans, shared share, margin floor (PRD 12)
  await upsertRule('PLAN', 'STANDARD', { multiplierBps: 10_000 });
  await upsertRule('PLAN', 'FLEX', { multiplierBps: 11_500 });
  await upsertRule('SHARED_SHARE', 'default', { bps: 6_000 });
  await upsertRule('REVENUE_SHARE', code, { bps: 1_000 });

  // Car partners, vehicles, drivers
  const partners = new Map<string, string>();
  for (const d of driverSeeds) {
    const brand = d.vehicle.brand;
    if (!partners.has(brand)) {
      const existing = await prisma.carPartner.findFirst({ where: { brand } });
      const p = existing ?? (await prisma.carPartner.create({ data: { name: `${brand} Nigeria (pilot)`, brand } }));
      partners.set(brand, p.id);
    }
    const vehicle = await prisma.vehicle.upsert({
      where: { plate: d.vehicle.plate },
      update: {},
      create: {
        plate: d.vehicle.plate,
        brand,
        model: d.vehicle.model,
        colour: d.vehicle.colour,
        class: d.vehicle.class as VehicleClass,
        seats: d.vehicle.seats,
        bagCapacity: d.vehicle.bags,
        powerType: d.vehicle.power,
        partnerId: partners.get(brand),
      },
    });
    const user = await prisma.user.upsert({
      where: { phone: d.phone },
      update: {},
      create: { phone: d.phone, phoneVerified: true },
    });
    const driver = await prisma.driverProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        firstName: d.firstName,
        lastName: d.lastName,
        status: 'ACTIVE',
        kycProvider: 'fake',
        kycResult: { passed: true, seeded: true },
        kycVerifiedAt: new Date(),
        trainingChecklist: { airportRules: true, pickupCodes: true, customerCare: true },
      },
    });
    if ((await prisma.vehicleAssignment.count({ where: { driverId: driver.id, to: null } })) === 0) {
      await prisma.vehicleAssignment.create({ data: { vehicleId: vehicle.id, driverId: driver.id, from: new Date() } });
    }
  }

  const counts = {
    airlines: await prisma.airline.count(),
    drivers: await prisma.driverProfile.count(),
    vehicles: await prisma.vehicle.count(),
    corridors: await prisma.corridor.count(),
    zones: await prisma.zone.count(),
    config: await prisma.configEntry.count(),
  };
  console.log('Seeded', counts);
}

async function upsertRule(type: 'ZONE_FARE' | 'PLAN' | 'SHARED_SHARE' | 'REVENUE_SHARE', key: string, values: object) {
  const existing = await prisma.pricingRule.findFirst({ where: { type, key, version: 1 } });
  if (!existing) {
    await prisma.pricingRule.create({ data: { type, key, values, version: 1, effectiveFrom: EPOCH } });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
