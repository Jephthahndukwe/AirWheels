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

interface SessionResolver {
  resolve(token: string): Promise<Principal | null>;
}

/**
 * WebSocket gateway (PRD 20). Clients join rooms:
 *  - `booking:<id>` for the tracking page (booking.updated, leg.updated, driver.location)
 *  - `driver:<id>` for the driver app (job.offer, job.cancelled, session.revoked). Needs that driver's session.
 *  - `ops` for the admin dashboard (alert.created, flight.updated). Needs a staff session.
 * Join with `{ room, token }`. Tracking-token checks for booking rooms come with the tracking page in M3.
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
  async join(@MessageBody() body: string | { room?: string; token?: string }, @ConnectedSocket() client: Socket) {
    const room = typeof body === 'string' ? body : body?.room;
    const token = typeof body === 'string' ? undefined : body?.token;
    if (!room || !/^(booking|driver):[0-9a-f-]{36}$|^ops$/.test(room)) return { error: 'invalid room' };

    if (room === 'ops' || room.startsWith('driver:')) {
      const p = token ? await (await this.sessions()).resolve(token) : null;
      const ok = room === 'ops' ? p?.kind === 'admin' : p?.kind === 'driver' && room === `driver:${p.driverId}`;
      if (!ok) return { error: 'unauthorised' };
    }
    void client.join(room);
    return { joined: room };
  }

  emit(room: string, event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }
}

@Global()
@Module({ providers: [RealtimeGateway], exports: [RealtimeGateway] })
export class RealtimeModule {}
