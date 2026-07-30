import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

interface SocketJwtPayload {
  sub: string;
  role: string;
}

interface AuthenticatedSocketData {
  userId: string;
  role: string;
}

// docs/11-documentation-api.md §13: evenements temps reel (notification.new,
// ticket.statusChanged, ticket.assigned, ticket.created). Chaque socket
// authentifie rejoint une room par utilisateur (mises a jour ciblees, ex.
// notifications) et une room par role (diffusions, ex. nouveau ticket a
// tous les superviseurs).
@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL ?? 'http://localhost:3002' },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        throw new Error('missing token');
      }

      const payload =
        await this.jwtService.verifyAsync<SocketJwtPayload>(token);
      const data = client.data as AuthenticatedSocketData;
      data.userId = payload.sub;
      data.role = payload.role;

      await client.join(`user:${payload.sub}`);
      await client.join(`role:${payload.role}`);
    } catch (error) {
      this.logger.warn(
        `Rejecting unauthenticated socket connection: ${(error as Error).message}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // no-op: Socket.IO removes the client from its rooms automatically
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;

    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);

    return undefined;
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  emitToRole(role: string, event: string, payload: unknown) {
    this.server.to(`role:${role}`).emit(event, payload);
  }
}
