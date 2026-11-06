import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { DriverStatus } from '@prisma/client';
import { z } from 'zod';
import {
  AdminRead,
  AdminWrite,
  type AuthedRequest,
  Roles,
  SuperAdminOnly,
  requireAdmin,
  requireDriver,
} from '../../common/auth/roles';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { DOCUMENT_TYPES, MediaModule, MediaService } from '../media/media.module';
import { DriversService } from './drivers.service';

const Referee = z.object({ name: z.string().min(1).max(120), phone: z.string().min(7).max(20), relationship: z.string().min(1).max(60) });
const DriverDetails = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  phone: z.string().min(7).max(20),
  licenceNumber: z.string().min(3).max(40),
  idType: z.enum(['NIN', 'DRIVERS_LICENSE']),
  idNumber: z.string().min(5).max(40),
  address: z.string().max(300).optional(),
  referees: z.array(Referee).max(3).default([]),
});
const DriverUpdate = DriverDetails.omit({ phone: true }).partial();
const DocumentUpload = z.object({
  type: z.enum(DOCUMENT_TYPES),
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(3).max(100),
  expiresAt: z.coerce.date().optional(),
});
const Training = z.object({ items: z.record(z.boolean()) });
const AssignVehicle = z.object({ vehicleId: z.string().uuid() });
const Reason = z.object({ reason: z.string().min(3).max(500) });
const Vehicle = z.object({
  plate: z.string().min(3).max(20),
  brand: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  colour: z.string().min(1).max(40),
  class: z.enum(['SEDAN', 'SUV', 'VAN']),
  seats: z.number().int().min(1).max(15),
  bagCapacity: z.number().int().min(0).max(20),
  powerType: z.enum(['ELECTRIC', 'HYBRID', 'PETROL']),
  partnerId: z.string().uuid().optional(),
});
const Duty = z.object({ onDuty: z.boolean() });

const STATUSES: DriverStatus[] = ['ONBOARDING', 'INVITED', 'ACTIVATED', 'ACTIVE', 'SUSPENDED'];

/** Driver onboarding entirely from the admin (ADM-01, ADM-02). */
@ApiTags('admin')
@Controller({ path: 'admin/drivers', version: '1' })
export class AdminDriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly media: MediaService,
  ) {}

  @Get()
  @AdminRead()
  list(@Query('status') status?: string, @Query('q') q?: string) {
    return this.drivers.list({ status: STATUSES.find((s) => s === status), search: q?.trim() || undefined });
  }

  @Get(':id')
  @AdminRead()
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.drivers.detail(id);
  }

  @Post()
  @AdminWrite()
  @ApiZodBody(DriverDetails)
  create(@Req() req: AuthedRequest, @Body(new ZodPipe(DriverDetails)) body: z.infer<typeof DriverDetails>) {
    return this.drivers.create({ ...body, createdByAdminId: requireAdmin(req).userId });
  }

  @Patch(':id')
  @AdminWrite()
  @ApiZodBody(DriverUpdate)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(DriverUpdate)) body: z.infer<typeof DriverUpdate>) {
    return this.drivers.updateDetails(id, body);
  }

  @Post(':id/documents')
  @AdminWrite()
  @ApiZodBody(DocumentUpload)
  upload(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(DocumentUpload)) body: z.infer<typeof DocumentUpload>) {
    return this.drivers.requestDocumentUpload(id, body, requireAdmin(req).userId);
  }

  @Post(':id/kyc')
  @HttpCode(200)
  @AdminWrite()
  kyc(@Param('id', ParseUUIDPipe) id: string) {
    return this.drivers.runKyc(id);
  }

  @Put(':id/training')
  @AdminWrite()
  @ApiZodBody(Training)
  training(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Training)) body: z.infer<typeof Training>) {
    return this.drivers.setTraining(id, body.items);
  }

  @Put(':id/vehicle')
  @AdminWrite()
  @ApiZodBody(AssignVehicle)
  vehicle(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(AssignVehicle)) body: z.infer<typeof AssignVehicle>) {
    return this.drivers.assignVehicle(id, body.vehicleId);
  }

  @Post(':id/invite')
  @HttpCode(200)
  @AdminWrite()
  invite(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.drivers.sendInvite(id, requireAdmin(req).userId);
  }

  @Post(':id/invite/revoke')
  @HttpCode(200)
  @AdminWrite()
  revokeInvite(@Param('id', ParseUUIDPipe) id: string) {
    return this.drivers.revokeInvites(id);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @AdminWrite()
  @ApiZodBody(Reason)
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Reason)) body: z.infer<typeof Reason>) {
    return this.drivers.suspend(id, body.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @SuperAdminOnly()
  @ApiZodBody(Reason)
  reactivate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Reason)) body: z.infer<typeof Reason>) {
    return this.drivers.reactivate(id, body.reason);
  }
}

/** Documents are private: confirm after upload, view through a 5-minute signed link (audited). */
@ApiTags('admin')
@Controller({ path: 'admin/documents', version: '1' })
export class AdminDocumentsController {
  constructor(private readonly media: MediaService) {}

  @Post(':id/confirm')
  @HttpCode(200)
  @AdminWrite()
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.confirmUpload(id);
  }

  /** POST because every view is recorded in the audit log. */
  @Post(':id/view')
  @HttpCode(200)
  @AdminWrite()
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.downloadUrl(id);
  }
}

@ApiTags('admin')
@Controller({ path: 'admin/vehicles', version: '1' })
export class AdminVehiclesController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  @AdminRead()
  list() {
    return this.drivers.listVehicles();
  }

  @Get('partners')
  @AdminRead()
  partners() {
    return this.drivers.listPartners();
  }

  @Post()
  @AdminWrite()
  @ApiZodBody(Vehicle)
  create(@Body(new ZodPipe(Vehicle)) body: z.infer<typeof Vehicle>) {
    return this.drivers.createVehicle(body);
  }
}

/** The signed-in driver's own record (driver app). */
@ApiTags('driver')
@Roles('DRIVER')
@Controller({ path: 'driver', version: '1' })
export class DriverSelfController {
  constructor(private readonly drivers: DriversService) {}

  @Get('me')
  me(@Req() req: AuthedRequest) {
    return this.drivers.me(requireDriver(req).driverId);
  }

  @Post('duty')
  @HttpCode(200)
  @ApiZodBody(Duty)
  duty(@Req() req: AuthedRequest, @Body(new ZodPipe(Duty)) body: z.infer<typeof Duty>) {
    return this.drivers.setDuty(requireDriver(req).driverId, body.onDuty);
  }
}

@Module({
  imports: [MediaModule],
  controllers: [AdminDriversController, AdminDocumentsController, AdminVehiclesController, DriverSelfController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
