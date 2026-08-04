import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: {
    systemSettings: { upsert: jest.Mock; update: jest.Mock };
    integrationConfig: { findMany: jest.Mock; upsert: jest.Mock };
    aiProviderConfig: { findFirst: jest.Mock };
  };
  let auditLogService: { record: jest.Mock };
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    prisma = {
      systemSettings: { upsert: jest.fn(), update: jest.fn() },
      integrationConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
      aiProviderConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // docs/11-documentation-api.md §12 (GET/PATCH /admin/settings).
  describe('getSettings / updateSettings', () => {
    it('upserts the singleton row when reading settings', async () => {
      prisma.systemSettings.upsert.mockResolvedValue({
        id: 'singleton',
        organizationName: 'AI Help Desk',
        maxClarifyingTurns: 3,
      });

      const result = await service.getSettings();

      expect(prisma.systemSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'singleton' } }),
      );
      expect(result.organizationName).toBe('AI Help Desk');
    });

    it('records an audit log entry with the before/after state on update', async () => {
      prisma.systemSettings.upsert.mockResolvedValue({
        id: 'singleton',
        organizationName: 'AI Help Desk',
        maxClarifyingTurns: 3,
      });
      prisma.systemSettings.update.mockResolvedValue({
        id: 'singleton',
        organizationName: 'Acme Corp',
        maxClarifyingTurns: 5,
      });

      const result = await service.updateSettings(
        { organizationName: 'Acme Corp', maxClarifyingTurns: 5 },
        'admin-1',
      );

      expect(result.organizationName).toBe('Acme Corp');
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-1',
          action: 'SYSTEM_SETTINGS_UPDATED',
          targetType: 'SystemSettings',
          beforeState: {
            organizationName: 'AI Help Desk',
            maxClarifyingTurns: 3,
          },
          afterState: { organizationName: 'Acme Corp', maxClarifyingTurns: 5 },
        }),
      );
    });
  });

  // docs/11-documentation-api.md §12 (GET /admin/integrations).
  describe('getIntegrations', () => {
    it('reports Microsoft Graph and Intune as not implemented', async () => {
      const result = await service.getIntegrations();

      const graph = result.find((i) => i.name === 'MICROSOFT_GRAPH');
      const intune = result.find((i) => i.name === 'INTUNE');
      expect(graph).toEqual(
        expect.objectContaining({ configured: false, enabled: false }),
      );
      expect(intune).toEqual(
        expect.objectContaining({ configured: false, enabled: false }),
      );
    });

    it('reports Teams/Slack/Email as configured based on env vars, enabled by default with no DB row', async () => {
      process.env.TEAMS_WEBHOOK_URL = 'https://teams.example.com/webhook';
      delete process.env.SLACK_WEBHOOK_URL;
      process.env.RESEND_API_KEY = 'fake-key';

      const result = await service.getIntegrations();

      const teams = result.find((i) => i.name === 'TEAMS');
      const slack = result.find((i) => i.name === 'SLACK');
      const email = result.find((i) => i.name === 'EMAIL');
      expect(teams).toEqual(
        expect.objectContaining({ configured: true, enabled: true }),
      );
      expect(slack).toEqual(
        expect.objectContaining({ configured: false, enabled: true }),
      );
      expect(email).toEqual(
        expect.objectContaining({ configured: true, enabled: true }),
      );
    });

    it('reflects a disabled integration from the DB even if the env var is configured', async () => {
      process.env.TEAMS_WEBHOOK_URL = 'https://teams.example.com/webhook';
      prisma.integrationConfig.findMany.mockResolvedValue([
        { name: 'TEAMS', isEnabled: false },
      ]);

      const result = await service.getIntegrations();

      const teams = result.find((i) => i.name === 'TEAMS');
      expect(teams).toEqual(
        expect.objectContaining({ configured: true, enabled: false }),
      );
    });

    it('reflects the active AI provider from AiProviderConfig', async () => {
      process.env.ANTHROPIC_API_KEY = 'fake-key';
      prisma.aiProviderConfig.findFirst.mockResolvedValue({
        provider: 'CLAUDE',
        isActive: true,
      });

      const result = await service.getIntegrations();

      const ai = result.find((i) => i.name === 'IA');
      expect(ai).toEqual(
        expect.objectContaining({ configured: true, enabled: true }),
      );
      expect(ai?.label).toContain('CLAUDE');
    });
  });

  describe('setIntegrationEnabled', () => {
    it('rejects an integration name outside TEAMS/SLACK/EMAIL', async () => {
      await expect(
        service.setIntegrationEnabled('MICROSOFT_GRAPH', true, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.integrationConfig.upsert).not.toHaveBeenCalled();
    });

    it('upserts the toggle and records an audit log entry', async () => {
      prisma.integrationConfig.upsert.mockResolvedValue({
        name: 'TEAMS',
        isEnabled: false,
      });

      const result = await service.setIntegrationEnabled(
        'TEAMS',
        false,
        'admin-1',
      );

      expect(prisma.integrationConfig.upsert).toHaveBeenCalledWith({
        where: { name: 'TEAMS' },
        update: { isEnabled: false },
        create: { name: 'TEAMS', isEnabled: false },
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-1',
          action: 'INTEGRATION_TOGGLED',
          targetType: 'IntegrationConfig',
          targetId: 'TEAMS',
          afterState: { isEnabled: false },
        }),
      );
      expect(result.isEnabled).toBe(false);
    });
  });
});
