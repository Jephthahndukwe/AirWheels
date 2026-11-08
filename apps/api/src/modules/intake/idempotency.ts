import { ConflictException, Injectable } from '@nestjs/common';
import { sha256 } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';

/**
 * Idempotency for partner and payment writes (BKG-03). The same key with the same body
 * replays the stored response. The same key with a different body is a conflict.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    scope: string,
    key: string | undefined,
    body: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!key) return fn();
    const requestHash = sha256(JSON.stringify(body ?? null));
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Key was used with a different body.',
        });
      }
      return existing.responseBody as T;
    }
    const result = await fn();
    await this.prisma.idempotencyRecord
      .create({
        data: {
          scope,
          key,
          requestHash,
          responseCode: 200,
          responseBody: JSON.parse(JSON.stringify(result)),
        },
      })
      .catch(() => undefined); // a concurrent duplicate already stored it
    return result;
  }
}
