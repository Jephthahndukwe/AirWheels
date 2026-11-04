import { Global, Module } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/**
 * WebSocket gateway (PRD 20). Clients join rooms:
 *  - `booking:<id>` for the tracking page (booking.updated, leg.updated, driver.location)
 *  - `driver:<id>` for the driver app (job.offer, job.cancelled)
 *  - `ops` for the admin dashboard (alert.created, flight.updated)
 * Room joins are authenticated per client type in M1/M3; this milestone wires the transport.
 */
@WebSocketGateway({ namespace: '/rt', cors: { origin: true } })
export class RealtimeGateway {
  @WebSocketServer() server!: Server;

  @SubscribeMessage('join')
  join(@MessageBody() room: string, @ConnectedSocket() client: Socket) {
    if (/^(booking|driver):[0-9a-f-]{36}$|^ops$/.test(room)) {
      void client.join(room);
      return { joined: room };
    }
    return { error: 'invalid room' };
  }

  emit(room: string, event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }
}

@Global()
@Module({ providers: [RealtimeGateway], exports: [RealtimeGateway] })
export class RealtimeModule {}
