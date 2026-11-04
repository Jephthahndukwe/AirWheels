import { Injectable, Module } from '@nestjs/common';

/**
 * Media module boundary. Private driver documents in object storage with signed URLs (PRD 19.1).
 * Owns its own tables and talks to other modules through services and domain events.
 * Implementation lands in M1 (PRD 24).
 */
@Injectable()
export class MediaService {}

@Module({ providers: [MediaService], exports: [MediaService] })
export class MediaModule {}
