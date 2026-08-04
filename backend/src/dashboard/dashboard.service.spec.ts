import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { SlaService } from '../sla/sla.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: {
    ticket: {
      count: jest.Mock;
      findMany: jest.Mock;
      groupBy: jest.Mock;
    };
    ticketCategory: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let slaService: { checkAndNotifyBreaches: jest.Mock };

  beforeEach(async () => {
    prisma = {
      ticket: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      ticketCategory: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    slaService = {
      checkAndNotifyBreaches: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prisma },
        { provide: SlaService, useValue: slaService },
      ],
    }).compile();

    service = module.get(DashboardService);
  });

  // docs/11-documentation-api.md §11 (GET /analytics/sla-compliance),
  // docs/12-maquettes-ui-ux.md §4.5 ("SLA respecté : 96%")
  describe('slaComplianceRate', () => {
    it('is null when no resolved ticket in the period had an SLA target', async () => {
      prisma.ticket.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-01-01'),
          resolvedAt: new Date('2026-01-02'),
          slaDueAt: null,
        },
      ]);

      const stats = await service.getStats({});

      expect(stats.slaComplianceRate).toBeNull();
    });

    it('excludes tickets without an SLA target from the rate, counting only those with one', async () => {
      prisma.ticket.findMany.mockResolvedValue([
        // no SLA target: excluded from both numerator and denominator
        {
          createdAt: new Date('2026-01-01'),
          resolvedAt: new Date('2026-01-05'),
          slaDueAt: null,
        },
        // resolved before the SLA deadline: compliant
        {
          createdAt: new Date('2026-01-01T00:00:00Z'),
          resolvedAt: new Date('2026-01-01T10:00:00Z'),
          slaDueAt: new Date('2026-01-01T12:00:00Z'),
        },
        // resolved after the SLA deadline: breached
        {
          createdAt: new Date('2026-01-02T00:00:00Z'),
          resolvedAt: new Date('2026-01-02T14:00:00Z'),
          slaDueAt: new Date('2026-01-02T12:00:00Z'),
        },
      ]);

      const stats = await service.getStats({});

      expect(stats.slaComplianceRate).toBe(50);
    });

    it('treats resolution exactly at the deadline as compliant', async () => {
      const dueAt = new Date('2026-01-01T12:00:00Z');
      prisma.ticket.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-01-01T00:00:00Z'),
          resolvedAt: dueAt,
          slaDueAt: dueAt,
        },
      ]);

      const stats = await service.getStats({});

      expect(stats.slaComplianceRate).toBe(100);
    });
  });

  // docs/02-brd.md BR-07, §7 "Critères de succès". `findMany` is mocked
  // per-call here (routed on `where.status`) since the real service issues
  // two independent findMany calls — one for resolved tickets (SLA
  // compliance), one for AI-assisted tickets (this metric) — and a single
  // shared mock would conflate the two fixtures.
  describe('aiCorrectionRate', () => {
    function mockAiAssistedTickets(tickets: unknown[]) {
      prisma.ticket.findMany.mockImplementation((args: any) => {
        if (args?.where?.status === 'RESOLVED') return Promise.resolve([]);
        return Promise.resolve(tickets);
      });
    }

    it('is null when no ticket in the period came from the AI-assisted flow', async () => {
      mockAiAssistedTickets([]);

      const stats = await service.getStats({});

      expect(stats.aiCorrectionRate).toBeNull();
    });

    it('counts a ticket as corrected when the final category differs from the AI suggestion', async () => {
      mockAiAssistedTickets([
        {
          categoryId: 'cat-materiel',
          priorityId: 'prio-moyenne',
          aiSuggestedCategoryId: 'cat-logiciel',
          aiSuggestedPriorityId: 'prio-moyenne',
        },
      ]);

      const stats = await service.getStats({});

      expect(stats.aiCorrectionRate).toBe(100);
    });

    it('counts a ticket as corrected when only the final priority differs from the AI suggestion', async () => {
      mockAiAssistedTickets([
        {
          categoryId: 'cat-materiel',
          priorityId: 'prio-urgente',
          aiSuggestedCategoryId: 'cat-materiel',
          aiSuggestedPriorityId: 'prio-moyenne',
        },
      ]);

      const stats = await service.getStats({});

      expect(stats.aiCorrectionRate).toBe(100);
    });

    it('does not count a ticket as corrected when category and priority both match the suggestion', async () => {
      mockAiAssistedTickets([
        {
          categoryId: 'cat-materiel',
          priorityId: 'prio-moyenne',
          aiSuggestedCategoryId: 'cat-materiel',
          aiSuggestedPriorityId: 'prio-moyenne',
        },
      ]);

      const stats = await service.getStats({});

      expect(stats.aiCorrectionRate).toBe(0);
    });

    it('computes a mixed rate across several AI-assisted tickets', async () => {
      mockAiAssistedTickets([
        {
          categoryId: 'cat-materiel',
          priorityId: 'prio-moyenne',
          aiSuggestedCategoryId: 'cat-materiel',
          aiSuggestedPriorityId: 'prio-moyenne',
        },
        {
          categoryId: 'cat-logiciel',
          priorityId: 'prio-moyenne',
          aiSuggestedCategoryId: 'cat-materiel',
          aiSuggestedPriorityId: 'prio-moyenne',
        },
      ]);

      const stats = await service.getStats({});

      expect(stats.aiCorrectionRate).toBe(50);
    });
  });
});
