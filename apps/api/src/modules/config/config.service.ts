import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

const TTL_MS = 30_000;

/**
 * Runtime configuration store (PRD 1.1, 4.4). Every value the PRD marks as an assumption
 * (buffers, cut-offs, timings, thresholds) is read from here, never hard-coded.
 * Values are versioned: the highest version of a key is current. Ops edits them in the admin.
 */
@Injectable()
export class ConfigStore {
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
    const row = await this.prisma.configEntry.findFirst({
      where: { key },
      orderBy: { version: 'desc' },
    });
    if (!row)
      throw new NotFoundException(
        `Config key "${key}" is missing. Run the seed or add it in the admin.`,
      );
    this.cache.set(key, { value: row.value, at: Date.now() });
    return row.value as T;
  }

  /** Writes a new version. Callers in the admin record the audit entry with before and after. */
  async set(key: string, value: unknown, updatedById?: string) {
    const latest = await this.prisma.configEntry.findFirst({
      where: { key },
      orderBy: { version: 'desc' },
    });
    const entry = await this.prisma.configEntry.create({
      data: {
        key,
        value: value as object,
        version: (latest?.version ?? 0) + 1,
        description: latest?.description,
        updatedById,
      },
    });
    this.cache.delete(key);
    return entry;
  }

  async list() {
    const rows = await this.prisma.configEntry.findMany({
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r);
    return [...latest.values()];
  }
}
