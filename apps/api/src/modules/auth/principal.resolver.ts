import { Injectable } from '@nestjs/common';
import { PARTNER_HEADERS } from '@airwheels/types';
import { verifyPartnerSignature } from '@airwheels/types/signing';
import { BlockList, isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { decrypt } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { type AuthedRequest, type Principal, clientIp } from '../../common/auth/roles';
import { SessionsService } from './sessions.service';

/** True when `ip` matches one of the allow-list entries (single addresses or CIDR ranges). */
export function ipAllowed(ip: string | undefined, allowList: string[]): boolean {
  if (allowList.length === 0) return true;
  if (!ip) return false;
  const normalised = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const family = isIP(normalised);
  if (!family) return false;
  const list = new BlockList();
  for (const entry of allowList) {
    const [addr, bits] = entry.split('/');
    const fam = isIP(addr ?? '');
    if (!fam) continue;
    const type = fam === 6 ? 'ipv6' : 'ipv4';
    if (bits !== undefined) list.addSubnet(addr!, Number(bits), type);
    else list.addAddress(addr!, type);
  }
  return list.check(normalised, family === 6 ? 'ipv6' : 'ipv4');
}

/** Valid allow-list entry: an IPv4/IPv6 address or CIDR range. */
export function validIpEntry(entry: string): boolean {
  const [addr, bits, extra] = entry.split('/');
  if (extra !== undefined) return false;
  const fam = isIP(addr ?? '');
  if (!fam) return false;
  if (bits === undefined) return true;
  const n = Number(bits);
  return /^\d+$/.test(bits) && n >= 0 && n <= (fam === 6 ? 128 : 32);
}

/**
 * Works out who is calling. Three kinds of credential:
 *  - `Authorization: Bearer <session token>` for admins and drivers
 *  - `Authorization: Bearer <SYSTEM_API_TOKEN>` for internal jobs (role SYSTEM)
 *  - signed partner headers for airline systems (ACC-08)
 * Returns null when there is no valid credential.
 */
@Injectable()
export class PrincipalResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
  ) {}

  async resolve(req: AuthedRequest): Promise<Principal | null> {
    if (req.header(PARTNER_HEADERS.keyId)) return this.partner(req);
    const auth = req.header('authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.slice(7).trim();
    if (this.isSystemToken(token)) return { kind: 'system', role: 'SYSTEM' };
    return this.sessions.resolve(token);
  }

  private isSystemToken(token: string): boolean {
    const expected = process.env.SYSTEM_API_TOKEN;
    if (!expected || expected.length < 32 || token.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  }

  private async partner(req: AuthedRequest): Promise<Principal | null> {
    const keyId = req.header(PARTNER_HEADERS.keyId);
    const timestamp = req.header(PARTNER_HEADERS.timestamp);
    const signature = req.header(PARTNER_HEADERS.signature);
    if (!keyId || !timestamp || !signature) return null;
    const credential = await this.prisma.airlineCredential.findUnique({
      where: { keyId },
      include: { airline: true },
    });
    if (!credential || credential.status !== 'ACTIVE' || credential.airline.status !== 'ACTIVE')
      return null;
    if (credential.expiresAt && credential.expiresAt <= new Date()) return null;
    if (!ipAllowed(clientIp(req), credential.allowedIps)) return null;
    const body = req.rawBody?.toString('utf8') ?? '';
    const valid = verifyPartnerSignature(
      decrypt(credential.secretEncrypted),
      timestamp,
      req.method,
      req.originalUrl.split('?')[0] ?? '',
      body,
      signature,
    );
    if (!valid) return null;
    req.airline = credential.airline;
    return { kind: 'partner', role: 'PARTNER', airline: credential.airline, keyId };
  }
}
