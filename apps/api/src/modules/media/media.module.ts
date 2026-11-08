import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Put,
  Query,
  Req,
  StreamableFile,
  Header,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { STORAGE, type StorageAdapter } from '../../adapters/interfaces';
import { checkStorageSignature, localStoragePath } from '../../adapters/fakes';
import { PrismaService } from '../../common/prisma.service';
import { Public } from '../../common/auth/roles';
import { fakeProvidersAllowed } from '../../common/env';
import { AuditService } from '../audit/audit.service';

export const DOCUMENT_TYPES = [
  'LICENCE',
  'ID',
  'PHOTO',
  'REFEREE',
  'INSURANCE',
  'ROADWORTHINESS',
  'OTHER',
] as const;
export const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Private driver and vehicle documents (PRD 19.1): signed short-lived URLs, every view audited. */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE) private readonly storage: StorageAdapter,
  ) {}

  async requestUpload(input: {
    ownerType: 'DRIVER' | 'VEHICLE';
    ownerId: string;
    type: string;
    fileName: string;
    contentType: string;
    expiresAt?: Date;
    uploadedById: string;
  }) {
    if (!ALLOWED_CONTENT_TYPES.includes(input.contentType)) {
      throw new BadRequestException({ code: 'FILE_TYPE', message: 'Upload a PDF, JPEG or PNG.' });
    }
    const ext =
      input.contentType === 'application/pdf'
        ? 'pdf'
        : input.contentType === 'image/png'
          ? 'png'
          : 'jpg';
    const storageKey = `${input.ownerType.toLowerCase()}s/${input.ownerId}/${input.type.toLowerCase()}-${randomUUID()}.${ext}`;
    const doc = await this.prisma.document.create({
      data: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        type: input.type,
        storageKey,
        fileName: input.fileName.slice(0, 200),
        contentType: input.contentType,
        expiresAt: input.expiresAt,
        uploadedById: input.uploadedById,
      },
    });
    return {
      documentId: doc.id,
      uploadUrl: await this.storage.signedUploadUrl(storageKey, input.contentType),
      maxBytes: MAX_DOCUMENT_BYTES,
    };
  }

  /** Called after the browser uploads: checks the file is really in storage. */
  async confirmUpload(documentId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc)
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'No such document.' });
    const found = await this.storage.exists(doc.storageKey);
    if (!found)
      throw new BadRequestException({
        code: 'UPLOAD_MISSING',
        message: 'The file did not reach storage. Upload again.',
      });
    const updated = await this.prisma.document.update({
      where: { id: doc.id },
      data: { uploadedAt: new Date() },
    });
    await this.audit.record({
      action: 'document.upload',
      entity: 'Document',
      entityId: doc.id,
      after: {
        ownerType: doc.ownerType,
        ownerId: doc.ownerId,
        type: doc.type,
        fileName: doc.fileName,
        sizeBytes: found.sizeBytes,
      },
    });
    return updated;
  }

  async downloadUrl(documentId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc?.uploadedAt)
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'No such document.' });
    await this.audit.record({
      action: 'document.view',
      entity: 'Document',
      entityId: doc.id,
      after: { type: doc.type, ownerId: doc.ownerId },
    });
    return {
      url: await this.storage.signedDownloadUrl(doc.storageKey, 300),
      expiresInSeconds: 300,
    };
  }

  listFor(ownerType: 'DRIVER' | 'VEHICLE', ownerId: string) {
    return this.prisma.document.findMany({
      where: { ownerType, ownerId, uploadedAt: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        fileName: true,
        contentType: true,
        expiresAt: true,
        uploadedAt: true,
      },
    });
  }
}

/**
 * Development-only stand-in for S3 signed URLs. The signature in the URL is the access check,
 * so the route is @Public. Disabled in production, where real object storage is used.
 */
@ApiExcludeController()
@Controller({ path: 'fake-storage', version: '1' })
export class FakeStorageController {
  private guard() {
    // Development shortcut (ACC-12): off everywhere except development and the test runner.
    if (!fakeProvidersAllowed()) throw new NotFoundException();
  }

  @Put()
  @HttpCode(200)
  @Public()
  async put(@Req() req: Request, @Query() q: Record<string, string>) {
    this.guard();
    const contentType = (req.header('content-type') ?? '').split(';')[0]!.trim();
    if (
      q.op !== 'put' ||
      !checkStorageSignature('put', q.key ?? '', q.exp ?? '', q.sig ?? '', contentType)
    ) {
      throw new ForbiddenException({
        code: 'SIGNATURE_INVALID',
        message: 'Upload link is not valid or has expired.',
      });
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_DOCUMENT_BYTES)
        throw new BadRequestException({
          code: 'FILE_TOO_LARGE',
          message: 'Files must be 10 MB or smaller.',
        });
      chunks.push(chunk);
    }
    const path = localStoragePath(q.key!);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.concat(chunks));
    return { ok: true, sizeBytes: size };
  }

  @Get()
  @Public()
  @Header('Cache-Control', 'private, no-store')
  get(@Query() q: Record<string, string>) {
    this.guard();
    if (q.op !== 'get' || !checkStorageSignature('get', q.key ?? '', q.exp ?? '', q.sig ?? '')) {
      throw new ForbiddenException({
        code: 'SIGNATURE_INVALID',
        message: 'Download link is not valid or has expired.',
      });
    }
    const path = localStoragePath(q.key!);
    if (!existsSync(path)) throw new NotFoundException();
    const type = path.endsWith('.pdf')
      ? 'application/pdf'
      : path.endsWith('.png')
        ? 'image/png'
        : 'image/jpeg';
    return new StreamableFile(createReadStream(path), { type });
  }
}

@Module({
  controllers: [FakeStorageController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
