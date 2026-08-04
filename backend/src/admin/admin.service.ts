import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { IntegrationName } from '../../generated/prisma/client';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';

const SETTINGS_ID = 'singleton';

// docs/11-documentation-api.md §12 (Module Administration), docs/06-cas-
// utilisation.md UC-030 : ce module ne couvre que ce qui existe réellement
// dans ce projet — Teams/Slack/Email (webhooks/clé API lus depuis les
// variables d'environnement, seule l'activation est stockée en base) et le
// fournisseur IA (déjà administré via /ai/providers, simplement reflété
// ici). Microsoft Graph et Intune (docs/03 §3.4/§3.5) ne sont pas
// implémentés dans ce projet : GET /admin/integrations le déclare
// honnêtement plutôt que de simuler un statut.
const TOGGLEABLE_INTEGRATIONS = Object.values(IntegrationName);

export interface IntegrationStatus {
  name: string;
  label: string;
  configured: boolean;
  enabled: boolean;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // Table singleton : upsert plutôt que findUnique pour que le premier
  // appel fonctionne même sur une base qui n'a pas encore tourné le seed
  // (ex. après un déploiement frais avant tout `prisma db seed`).
  getSettings() {
    return this.prisma.systemSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
  }

  async updateSettings(dto: UpdateSystemSettingsDto, actorId: string) {
    const before = await this.getSettings();
    const updated = await this.prisma.systemSettings.update({
      where: { id: SETTINGS_ID },
      data: {
        organizationName: dto.organizationName,
        maxClarifyingTurns: dto.maxClarifyingTurns,
      },
    });

    await this.auditLogService.record({
      actorId,
      action: 'SYSTEM_SETTINGS_UPDATED',
      targetType: 'SystemSettings',
      targetId: SETTINGS_ID,
      beforeState: {
        organizationName: before.organizationName,
        maxClarifyingTurns: before.maxClarifyingTurns,
      },
      afterState: {
        organizationName: updated.organizationName,
        maxClarifyingTurns: updated.maxClarifyingTurns,
      },
    });

    return updated;
  }

  async getIntegrations(): Promise<IntegrationStatus[]> {
    const [toggles, activeProvider] = await Promise.all([
      this.prisma.integrationConfig.findMany(),
      this.prisma.aiProviderConfig.findFirst({ where: { isActive: true } }),
    ]);
    const toggleByName = new Map(toggles.map((t) => [t.name, t]));

    const wired: IntegrationStatus[] = [
      {
        name: IntegrationName.TEAMS,
        label: 'Microsoft Teams (webhook entrant)',
        configured: !!process.env.TEAMS_WEBHOOK_URL,
        enabled: toggleByName.get(IntegrationName.TEAMS)?.isEnabled ?? true,
      },
      {
        name: IntegrationName.SLACK,
        label: 'Slack (webhook entrant)',
        configured: !!process.env.SLACK_WEBHOOK_URL,
        enabled: toggleByName.get(IntegrationName.SLACK)?.isEnabled ?? true,
      },
      {
        name: IntegrationName.EMAIL,
        label: 'Email (Resend)',
        configured: !!process.env.RESEND_API_KEY,
        enabled: toggleByName.get(IntegrationName.EMAIL)?.isEnabled ?? true,
      },
    ];

    const ai: IntegrationStatus = {
      name: 'IA',
      label: `Fournisseur IA actif : ${activeProvider?.provider ?? 'aucun'}`,
      configured: !!process.env.ANTHROPIC_API_KEY,
      enabled: activeProvider?.isActive ?? false,
    };

    // docs/03-cahier-des-charges-v2.md §3.4/§3.5 : aucune intégration
    // Microsoft Graph ni Intune n'existe dans ce projet — déclaré tel quel
    // plutôt que simulé (voir aussi UC-022 : l'exécution des scripts
    // d'automatisation reste une simulation volontaire, faute de backend
    // Graph/AD réel).
    const notImplemented: IntegrationStatus[] = [
      {
        name: 'MICROSOFT_GRAPH',
        label: 'Microsoft Graph (non implémenté)',
        configured: false,
        enabled: false,
      },
      {
        name: 'INTUNE',
        label: 'Intune (non implémenté)',
        configured: false,
        enabled: false,
      },
    ];

    return [...wired, ai, ...notImplemented];
  }

  async setIntegrationEnabled(
    name: string,
    isEnabled: boolean,
    actorId: string,
  ) {
    if (!TOGGLEABLE_INTEGRATIONS.includes(name as IntegrationName)) {
      throw new BadRequestException(
        `L'intégration "${name}" ne peut pas être configurée via cet endpoint (valeurs possibles : ${TOGGLEABLE_INTEGRATIONS.join(', ')})`,
      );
    }
    const integrationName = name as IntegrationName;

    const updated = await this.prisma.integrationConfig.upsert({
      where: { name: integrationName },
      update: { isEnabled },
      create: { name: integrationName, isEnabled },
    });

    await this.auditLogService.record({
      actorId,
      action: 'INTEGRATION_TOGGLED',
      targetType: 'IntegrationConfig',
      targetId: integrationName,
      afterState: { isEnabled },
    });

    return updated;
  }
}
