import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type DriverStatus, type PowerType, type VehicleClass } from '@prisma/client';
import { KYC, type KycAdapter, SMS, type SmsAdapter } from '../../adapters/interfaces';
import { numericCode } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { hashSecret } from '../../common/auth/passwords';
import { AuditService } from '../audit/audit.service';
import { isDevelopment } from '../auth/admin-auth.service';
import { normalisePhone } from '../auth/driver-auth.service';
import { SessionsService } from '../auth/sessions.service';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { MediaService } from '../media/media.module';

export interface Referee {
  name: string;
  phone: string;
  relationship: string;
}

/** What is still missing before ops can send the invite (PRD 5.2 steps 1 to 4). */
export interface OnboardingChecklist {
  details: boolean;
  documents: { required: string[]; missing: string[] };
  kyc: boolean;
  vehicle: boolean;
  training: { items: string[]; missing: string[] };
  readyToInvite: boolean;
}

export function onboardingChecklist(input: {
  hasDetails: boolean;
  uploadedTypes: string[];
  requiredDocs: string[];
  kycPassed: boolean;
  hasVehicle: boolean;
  training: Record<string, boolean>;
  trainingItems: string[];
}): OnboardingChecklist {
  const missingDocs = input.requiredDocs.filter((t) => !input.uploadedTypes.includes(t));
  const missingTraining = input.trainingItems.filter((i) => input.training[i] !== true);
  return {
    details: input.hasDetails,
    documents: { required: input.requiredDocs, missing: missingDocs },
    kyc: input.kycPassed,
    vehicle: input.hasVehicle,
    training: { items: input.trainingItems, missing: missingTraining },
    readyToInvite: input.hasDetails && missingDocs.length === 0 && input.kycPassed && input.hasVehicle && missingTraining.length === 0,
  };
}

/** Allowed status moves (5.2). Suspension and reactivation have their own rules below. */
const INVITABLE: DriverStatus[] = ['ONBOARDING', 'INVITED', 'ACTIVATED'];

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigStore,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
    private readonly media: MediaService,
    @Inject(KYC) private readonly kyc: KycAdapter,
    @Inject(SMS) private readonly sms: SmsAdapter,
  ) {}

  private async load(id: string) {
    const d = await this.prisma.driverProfile.findUnique({
      where: { id },
      include: {
        user: { select: { phone: true, phoneVerified: true } },
        vehicleAssignments: { where: { to: null }, include: { vehicle: true } },
      },
    });
    if (!d) throw new NotFoundException({ code: 'DRIVER_NOT_FOUND', message: 'No such driver.' });
    return d;
  }

  async list(q: { status?: DriverStatus; search?: string }) {
    const rows = await this.prisma.driverProfile.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? {
              OR: [
                { firstName: { contains: q.search, mode: 'insensitive' } },
                { lastName: { contains: q.search, mode: 'insensitive' } },
                { user: { phone: { contains: q.search } } },
              ],
            }
          : {}),
      },
      include: { user: { select: { phone: true } }, vehicleAssignments: { where: { to: null }, include: { vehicle: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((d) => ({
      id: d.id,
      firstName: d.firstName,
      lastName: d.lastName,
      phone: d.user.phone,
      status: d.status,
      onDuty: d.onDuty,
      kycPassed: !!d.kycVerifiedAt,
      vehicle: d.vehicleAssignments[0]?.vehicle.plate ?? null,
      createdAt: d.createdAt,
    }));
  }

  async detail(id: string) {
    const d = await this.load(id);
    const [documents, invites, activeSessions, checklist] = await Promise.all([
      this.media.listFor('DRIVER', id),
      this.prisma.driverInvite.findMany({
        where: { driverId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, phone: true, expiresAt: true, usedAt: true, revokedAt: true, createdAt: true },
      }),
      this.prisma.session.count({ where: { userId: d.userId, revokedAt: null, expiresAt: { gt: new Date() } } }),
      this.checklist(id),
    ]);
    const { pinHash: _p, ...safe } = d;
    void _p;
    return {
      ...safe,
      phone: d.user.phone,
      vehicle: d.vehicleAssignments[0]?.vehicle ?? null,
      hasPin: !!d.pinHash,
      documents,
      invites,
      activeSessions,
      checklist,
    };
  }

  async checklist(id: string): Promise<OnboardingChecklist> {
    const d = await this.load(id);
    const docs = await this.media.listFor('DRIVER', id);
    return onboardingChecklist({
      hasDetails: !!(d.firstName && d.lastName && d.user.phone && d.licenceNumber && d.idType && d.idNumber),
      uploadedTypes: docs.map((x) => x.type),
      requiredDocs: await this.config.get<string[]>(CONFIG.driverRequiredDocuments),
      kycPassed: !!d.kycVerifiedAt && (d.kycResult as { passed?: boolean } | null)?.passed === true,
      hasVehicle: d.vehicleAssignments.length > 0,
      training: (d.trainingChecklist as Record<string, boolean> | null) ?? {},
      trainingItems: await this.config.get<string[]>(CONFIG.driverTrainingChecklist),
    });
  }

  async create(input: {
    firstName: string;
    lastName: string;
    phone: string;
    licenceNumber: string;
    idType: 'NIN' | 'DRIVERS_LICENSE';
    idNumber: string;
    address?: string;
    referees: Referee[];
    createdByAdminId: string;
  }) {
    const phone = normalisePhone(input.phone);
    if (!phone) throw new BadRequestException({ code: 'PHONE_INVALID', message: 'Enter a valid mobile number.' });
    try {
      const d = await this.prisma.driverProfile.create({
        data: {
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          licenceNumber: input.licenceNumber.trim(),
          idType: input.idType,
          idNumber: input.idNumber.trim(),
          address: input.address,
          referees: input.referees as unknown as Prisma.InputJsonValue,
          createdByAdminId: input.createdByAdminId,
          status: 'ONBOARDING',
          user: { create: { phone } },
        },
      });
      await this.audit.record({
        action: 'driver.create',
        entity: 'DriverProfile',
        entityId: d.id,
        after: { firstName: d.firstName, lastName: d.lastName, phone, licenceNumber: d.licenceNumber, idType: d.idType },
      });
      return d;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ code: 'PHONE_TAKEN', message: 'Another account already uses this phone number.' });
      }
      throw e;
    }
  }

  async updateDetails(id: string, input: Partial<{ firstName: string; lastName: string; licenceNumber: string; idType: string; idNumber: string; address: string; referees: Referee[] }>) {
    const before = await this.load(id);
    const after = await this.prisma.driverProfile.update({
      where: { id },
      data: { ...input, referees: input.referees as unknown as Prisma.InputJsonValue | undefined },
    });
    const pick = (x: typeof after) => ({ firstName: x.firstName, lastName: x.lastName, licenceNumber: x.licenceNumber, idType: x.idType, idNumber: x.idNumber, address: x.address, referees: x.referees });
    await this.audit.record({ action: 'driver.update', entity: 'DriverProfile', entityId: id, before: pick(before), after: pick(after) });
    return after;
  }

  async runKyc(id: string) {
    const d = await this.load(id);
    if (!d.idType || !d.idNumber) throw new BadRequestException({ code: 'ID_MISSING', message: 'Add the ID type and number first.' });
    const r = await this.kyc.verifyDriver({
      firstName: d.firstName,
      lastName: d.lastName,
      idType: d.idType as 'NIN' | 'DRIVERS_LICENSE',
      idNumber: d.idNumber,
    });
    const result = { passed: r.passed, reference: r.reference, checkedAt: new Date().toISOString(), raw: r.raw };
    await this.prisma.driverProfile.update({
      where: { id },
      data: {
        kycProvider: process.env.KYC_PROVIDER || 'fake',
        kycResult: result as Prisma.InputJsonValue,
        kycVerifiedAt: r.passed ? new Date() : null,
      },
    });
    await this.audit.record({
      action: 'driver.kyc',
      entity: 'DriverProfile',
      entityId: id,
      before: { kycResult: d.kycResult },
      after: { kycResult: { passed: r.passed, reference: r.reference } },
    });
    return { passed: r.passed, reference: r.reference };
  }

  async setTraining(id: string, items: Record<string, boolean>) {
    const known = await this.config.get<string[]>(CONFIG.driverTrainingChecklist);
    const unknown = Object.keys(items).filter((k) => !known.includes(k));
    if (unknown.length) throw new BadRequestException({ code: 'TRAINING_ITEM_UNKNOWN', message: `Unknown items: ${unknown.join(', ')}` });
    const before = await this.load(id);
    const merged = { ...((before.trainingChecklist as Record<string, boolean> | null) ?? {}), ...items };
    await this.prisma.driverProfile.update({ where: { id }, data: { trainingChecklist: merged } });
    await this.audit.record({ action: 'driver.training', entity: 'DriverProfile', entityId: id, before: { training: before.trainingChecklist }, after: { training: merged } });
    return { training: merged };
  }

  async assignVehicle(id: string, vehicleId: string) {
    const d = await this.load(id);
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle?.active) throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND', message: 'No such active vehicle.' });
    const now = new Date();
    const previous = d.vehicleAssignments[0]?.vehicle.plate ?? null;
    await this.prisma.$transaction([
      // A driver has one vehicle at a time, and a vehicle one driver at a time.
      this.prisma.vehicleAssignment.updateMany({ where: { driverId: id, to: null }, data: { to: now } }),
      this.prisma.vehicleAssignment.updateMany({ where: { vehicleId, to: null }, data: { to: now } }),
      this.prisma.vehicleAssignment.create({ data: { driverId: id, vehicleId, from: now } }),
    ]);
    await this.audit.record({ action: 'driver.vehicle_assign', entity: 'DriverProfile', entityId: id, before: { vehicle: previous }, after: { vehicle: vehicle.plate } });
    return { ok: true };
  }

  async requestDocumentUpload(id: string, input: { type: string; fileName: string; contentType: string; expiresAt?: Date }, adminUserId: string) {
    await this.load(id);
    return this.media.requestUpload({ ownerType: 'DRIVER', ownerId: id, ...input, uploadedById: adminUserId });
  }

  /** Sends (or resends) the invite: single-use code bound to the phone, configurable expiry (ACC-05). */
  async sendInvite(id: string, adminUserId: string) {
    const d = await this.load(id);
    if (!INVITABLE.includes(d.status)) {
      throw new BadRequestException({ code: 'INVITE_NOT_ALLOWED', message: `A driver who is ${d.status.toLowerCase()} cannot be invited.` });
    }
    const checklist = await this.checklist(id);
    if (!checklist.readyToInvite) {
      throw new BadRequestException({ code: 'ONBOARDING_INCOMPLETE', message: 'Finish documents, KYC, vehicle and training before inviting.', checklist });
    }
    const phone = d.user.phone!;
    const code = numericCode(6);
    const hours = await this.config.get<number>(CONFIG.driverInviteExpiryHours);
    const expiresAt = new Date(Date.now() + hours * 3_600_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.driverInvite.updateMany({ where: { driverId: id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.driverInvite.create({ data: { driverId: id, phone, codeHash: await hashSecret(code), expiresAt, sentById: adminUserId } });
      // Resending after activation started sends the driver back to the start of activation.
      await tx.driverProfile.update({ where: { id }, data: { status: 'INVITED' } });
    });
    const link = `airwheels-driver://activate?phone=${encodeURIComponent(phone)}`;
    await this.sms.send(
      phone,
      `Airwheels: ${d.firstName}, you are invited to drive with us. Install the Airwheels Driver app, tap Activate (or open ${link}) and enter code ${code}. Expires in ${hours} hours.`,
    );
    await this.audit.record({ action: 'driver.invite', entity: 'DriverProfile', entityId: id, before: { status: d.status }, after: { status: 'INVITED', expiresAt } });
    return { expiresAt, ...(isDevelopment() ? { devCode: code } : {}) };
  }

  async revokeInvites(id: string) {
    const d = await this.load(id);
    const r = await this.prisma.driverInvite.updateMany({ where: { driverId: id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ action: 'driver.invite_revoke', entity: 'DriverProfile', entityId: id, after: { revoked: r.count, status: d.status } });
    return { revoked: r.count };
  }

  /** Suspension ends every session at once and blocks jobs and duty (5.2). */
  async suspend(id: string, reason: string) {
    const d = await this.load(id);
    if (d.status === 'SUSPENDED') return { ok: true, sessionsEnded: 0 };
    await this.prisma.$transaction([
      this.prisma.driverProfile.update({
        where: { id },
        data: { status: 'SUSPENDED', onDuty: false, suspendedAt: new Date(), suspendedReason: reason },
      }),
      this.prisma.driverInvite.updateMany({ where: { driverId: id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    const ended = await this.sessions.revokeAllForUser(d.userId, 'suspended', { driverId: id });
    await this.audit.record({
      action: 'driver.suspend',
      entity: 'DriverProfile',
      entityId: id,
      before: { status: d.status, onDuty: d.onDuty },
      after: { status: 'SUSPENDED', onDuty: false, reason, sessionsEnded: ended },
    });
    return { ok: true, sessionsEnded: ended };
  }

  /** Super admins only (PRD 2.2). Back to Active if the driver had finished activation. */
  async reactivate(id: string, reason: string) {
    const d = await this.load(id);
    if (d.status !== 'SUSPENDED') throw new BadRequestException({ code: 'NOT_SUSPENDED', message: 'This driver is not suspended.' });
    const status: DriverStatus = d.activatedAt && d.pinHash ? 'ACTIVE' : 'ONBOARDING';
    await this.prisma.driverProfile.update({ where: { id }, data: { status, suspendedAt: null, suspendedReason: null } });
    await this.audit.record({ action: 'driver.reactivate', entity: 'DriverProfile', entityId: id, before: { status: d.status, reason: d.suspendedReason }, after: { status, reason } });
    return { status };
  }

  // ---------- vehicles and car partners ----------

  listVehicles() {
    return this.prisma.vehicle.findMany({
      orderBy: { createdAt: 'desc' },
      include: { partner: true, assignments: { where: { to: null }, include: { driver: { select: { id: true, firstName: true, lastName: true } } } } },
    });
  }

  listPartners() {
    return this.prisma.carPartner.findMany({ orderBy: { name: 'asc' } });
  }

  async createVehicle(input: {
    plate: string;
    brand: string;
    model: string;
    colour: string;
    class: VehicleClass;
    seats: number;
    bagCapacity: number;
    powerType: PowerType;
    partnerId?: string;
  }) {
    try {
      const v = await this.prisma.vehicle.create({ data: { ...input, plate: input.plate.toUpperCase().replace(/\s+/g, '-') } });
      await this.audit.record({ action: 'vehicle.create', entity: 'Vehicle', entityId: v.id, after: v });
      return v;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ code: 'PLATE_TAKEN', message: 'A vehicle with this plate exists.' });
      }
      throw e;
    }
  }

  // ---------- the driver's own view ----------

  async me(driverId: string) {
    const d = await this.load(driverId);
    return {
      id: d.id,
      firstName: d.firstName,
      lastName: d.lastName,
      phone: d.user.phone,
      status: d.status,
      onDuty: d.onDuty,
      vehicle: d.vehicleAssignments[0]
        ? { plate: d.vehicleAssignments[0].vehicle.plate, brand: d.vehicleAssignments[0].vehicle.brand, model: d.vehicleAssignments[0].vehicle.model, colour: d.vehicleAssignments[0].vehicle.colour }
        : null,
    };
  }

  async setDuty(driverId: string, onDuty: boolean) {
    const d = await this.load(driverId);
    if (d.status !== 'ACTIVE') throw new BadRequestException({ code: 'NOT_ACTIVE', message: 'Only active drivers can go on duty.' });
    await this.prisma.driverProfile.update({ where: { id: driverId }, data: { onDuty } });
    await this.audit.record({ action: onDuty ? 'driver.on_duty' : 'driver.off_duty', entity: 'DriverProfile', entityId: driverId, before: { onDuty: d.onDuty }, after: { onDuty } });
    return { onDuty };
  }
}
