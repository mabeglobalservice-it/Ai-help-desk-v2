import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminModule } from './admin/admin.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthModule } from './auth/auth.module';
import { AutomationModule } from './automation/automation.module';
import { CatalogModule } from './catalog/catalog.module';
import { CommentsModule } from './comments/comments.module';
import { ConfigurationItemsModule } from './configuration-items/configuration-items.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { HealthModule } from './health/health.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TeamsModule } from './teams/teams.module';
import { TicketsModule } from './tickets/tickets.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // docs/14-plan-deploiement-cloud.md §8 : logs structures (JSON en
    // production, capture par les logs Render — pas de Grafana/Prometheus/
    // Azure Monitor, hors perimetre du tier gratuit Render actuel). Pas de
    // transport pino-pretty (thread-stream) pendant les tests : chaque
    // fichier e2e demarre/ferme sa propre instance Nest, et un worker
    // thread par instance aurait pu reintroduire le type de handle non
    // ferme deja chasse dans ce projet (voir jest-e2e.json/AutomationRun).
    LoggerModule.forRoot({
      pinoHttp: {
        level:
          process.env.NODE_ENV === 'test'
            ? 'silent'
            : (process.env.LOG_LEVEL ?? 'info'),
        autoLogging: process.env.NODE_ENV !== 'test',
        transport:
          process.env.NODE_ENV === 'production' ||
          process.env.NODE_ENV === 'test'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { colorize: true, singleLine: true },
              },
        // Un token Bearer ou un cookie de refresh token dans les logs
        // serait une fuite de secret exploitable — jamais consignes, meme
        // en clair partiel.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
      },
    }),
    // docs/11-documentation-api.md §14: rate limiting, en priorité sur
    // /auth/* et /tickets/ai-diagnose (cout IA) — voir les overrides
    // @Throttle sur ces routes. Cette config globale sert de filet de
    // securite par defaut pour toutes les autres routes.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    PrismaModule,
    TicketsModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    CommentsModule,
    ConfigurationItemsModule,
    AttachmentsModule,
    NotificationsModule,
    DashboardModule,
    TeamsModule,
    AuditLogModule,
    RealtimeModule,
    KnowledgeModule,
    AutomationModule,
    DiagnosticsModule,
    AdminModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
