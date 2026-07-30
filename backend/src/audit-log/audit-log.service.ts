import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActorType, Prisma } from '../../generated/prisma/client';
import { FindAuditLogsQueryDto } from './dto/find-audit-logs-query.dto';

export interface RecordAuditLogInput {
  actorId?: string | null;
  actorType?: ActorType;
  action: string;
  targetType: string;
  targetId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  reason?: string;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  // docs/06-cas-utilisation.md RM-02 / UC-031: toute action administrative
  // (creation/modification de compte, de role, d'equipe) est journalisee
  // avec l'identite de l'acteur, l'horodatage et l'etat avant/apres.
  // Best-effort: un echec de journalisation ne doit jamais faire echouer
  // l'action administrative elle-meme.
  async record(input: RecordAuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: input.actorId ?? null,
          actorType: input.actorType ?? ActorType.USER,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          beforeState: (input.beforeState ?? undefined) as
            Prisma.InputJsonValue | undefined,
          afterState: (input.afterState ?? undefined) as
            Prisma.InputJsonValue | undefined,
          reason: input.reason,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record audit log for action ${input.action}`,
        error,
      );
    }
  }

  // actorId has no FK relation (entries must survive actor deletion and
  // allow non-user actors per ActorType), so actor display names are
  // resolved with a separate best-effort lookup rather than an `include`.
  async findAll(query: FindAuditLogsQueryDto) {
    const entries = await this.prisma.auditLog.findMany({
      where: {
        actorId: query.actorId,
        targetType: query.targetType,
        targetId: query.targetId,
        createdAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const actorIds = [
      ...new Set(
        entries
          .map((entry) => entry.actorId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, displayName: true, email: true },
    });
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));

    return entries.map((entry) => ({
      ...entry,
      actor: entry.actorId ? (actorById.get(entry.actorId) ?? null) : null,
    }));
  }
}
