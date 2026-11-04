import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Airline } from '@prisma/client';
import { PARTNER_HEADERS } from '@airwheels/types';
import { verifyPartnerSignature } from '@airwheels/types/signing';
import type { Request } from 'express';
import { decrypt } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';

export type PartnerRequest = Request & { airline: Airline; rawBody?: Buffer };

/**
 * Authenticates airline systems (ACC-08): key id, timestamped HMAC signature over the raw body,
 * credential status and optional IP allow-list. Attaches the airline to the request,
 * so each airline only ever sees its own bookings.
 */
@Injectable()
export class PartnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PartnerRequest>();
    const keyId = req.header(PARTNER_HEADERS.keyId);
    const timestamp = req.header(PARTNER_HEADERS.timestamp);
    const signature = req.header(PARTNER_HEADERS.signature);
    if (!keyId || !timestamp || !signature) throw this.denied();

    const credential = await this.prisma.airlineCredential.findUnique({
      where: { keyId },
      include: { airline: true },
    });
    if (!credential || credential.status !== 'ACTIVE' || credential.airline.status !== 'ACTIVE') {
      throw this.denied();
    }
    if (credential.allowedIps.length > 0 && !credential.allowedIps.includes(req.ip ?? '')) {
      throw this.denied();
    }

    const body = req.rawBody?.toString('utf8') ?? '';
    const valid = verifyPartnerSignature(
      decrypt(credential.secretEncrypted),
      timestamp,
      req.method,
      req.originalUrl.split('?')[0] ?? '',
      body,
      signature,
    );
    if (!valid) throw this.denied();

    req.airline = credential.airline;
    return true;
  }

  private denied() {
    return new UnauthorizedException({ code: 'PARTNER_AUTH_FAILED', message: 'Partner authentication failed.' });
  }
}
