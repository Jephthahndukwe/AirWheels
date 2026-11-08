import { Global, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { Principal } from '../common/auth/roles';
import { sha256 } from '../common/crypto';

interface SessionResolver {
  resolve(token: string): Promise<Principal | null>;
}

/**
 * WebSocket gateway (PRD 20). Clients join rooms:
 *  - `booking:<id>` for the tracking page (booking.updated, leg.updated, driver.location)
 *  - `driver:<id>` for the driver app (job.offer, job.cancelled, session.revoked). Needs that driver's session.
 *  - `ops` for the admin dashboard (alert.created, flight.updated). Needs a staff session.
 * Join with `{ room, token }`. A booking room needs that booking's tracking token (or a staff session),
 * so a traveller only ever hears about their own booking (PRD 2.2).
 */
@WebSocketGateway({ namespace: '/rt', cors: { origin: true } })
export class RealtimeGateway {
  @WebSocketServer() server!: Server;

  constructor(private readonly moduleRef: ModuleRef) {}

  private async sessions(): Promise<SessionResolver> {
    // Loaded lazily: SessionsService itself emits through this gateway (avoids a circular import).
    const { SessionsService } = await import('../modules/auth/sessions.service');
    return this.moduleRef.get(SessionsService, { strict: false });
  }

  @SubscribeMessage('join')
  async join(
    @MessageBody() body: string | { room?: string; token?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = typeof body === 'string' ? body : body?.room;
    const token = typeof body === 'string' ? undefined : body?.token;
    if (!room || !/^(booking|driver):[0-9a-f-]{36}$|^ops$/.test(room))
      return { error: 'invalid room' };

    if (room.startsWith('booking:')) {
      const bookingId = room.slice('booking:'.length);
      const ok =
        !!token &&
        ((await this.trackingTokenOpens(token, bookingId)) ||
          (await (await this.sessions()).resolve(token))?.kind === 'admin');
      if (!ok) return { error: 'unauthorised' };
    } else {
      const p = token ? await (await this.sessions()).resolve(token) : null;
      const ok =
        room === 'ops'
          ? p?.kind === 'admin'
          : p?.kind === 'driver' && room === `driver:${p.driverId}`;
      if (!ok) return { error: 'unauthorised' };
    }
    void client.join(room);
    return { joined: room };
  }

  private async trackingTokenOpens(token: string, bookingId: string) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return false;
    const { PrismaService } = await import('../common/prisma.service');
    const prisma = this.moduleRef.get(PrismaService, { strict: false });
    const row = await prisma.trackingToken.findUnique({ where: { tokenHash: sha256(token) } });
    return row?.bookingId === bookingId;
  }

  emit(room: string, event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }
}

@Global()
@Module({ providers: [RealtimeGateway], exports: [RealtimeGateway] })
export class RealtimeModule {}
