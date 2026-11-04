import { Injectable, Module } from '@nestjs/common';

/**
 * Support module boundary. Support notes, traveller history by phone, emergency alerts (PRD 17.1).
 * Owns its own tables and talks to other modules through services and domain events.
 * Implementation lands in M3 (PRD 24).
 */
@Injectable()
export class SupportService {}

@Module({ providers: [SupportService], exports: [SupportService] })
export class SupportModule {}
