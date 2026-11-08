import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window rate limits in Redis (ACC-09), shared by every API instance.
 * Limits per bucket live in config (`rateLimits`), so ops can tune them without a release.
 * If Redis is unreachable the request is allowed and a warning logged: availability of the
 * airline checkout matters more, and sign-in still has per-account lockouts in Postgres.
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly log = new Logger(RateLimitService.name);
  private redis: Redis | null = null;

  constructor(private readonly config: ConfigStore) {}

  private client(): Redis {
    if (!this.redis) {
      this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        lazyConnect: false,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.redis.on('error', () => undefined);
    }
    return this.redis;
  }

  async hit(
    bucket: string,
    id: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number; limit: number; remaining: number }> {
    const rules = await this.config.get<Record<string, RateLimitRule>>(CONFIG.rateLimits);
    const rule = rules[bucket];
    if (!rule) {
      // A missing bucket must not take a page down: allow, and say so loudly so ops add it.
      this.log.error(
        { bucket },
        `No rate limit configured for bucket "${bucket}" (config key ${CONFIG.rateLimits}); allowing`,
      );
      return { allowed: true, retryAfterSeconds: 0, limit: 0, remaining: 0 };
    }
    const window = Math.floor(Date.now() / 1000 / rule.windowSeconds);
    const key = `rl:${bucket}:${id}:${window}`;
    try {
      const r = this.client();
      const count = await r.incr(key);
      if (count === 1) await r.expire(key, rule.windowSeconds + 1);
      const retryAfterSeconds =
        rule.windowSeconds - (Math.floor(Date.now() / 1000) % rule.windowSeconds);
      return {
        allowed: count <= rule.limit,
        retryAfterSeconds,
        limit: rule.limit,
        remaining: Math.max(0, rule.limit - count),
      };
    } catch (err) {
      this.log.warn(
        { bucket, err: (err as Error).message },
        'Rate limit store unavailable; allowing request',
      );
      return { allowed: true, retryAfterSeconds: 0, limit: rule.limit, remaining: rule.limit };
    }
  }

  async onModuleDestroy() {
    this.redis?.disconnect();
  }
}
