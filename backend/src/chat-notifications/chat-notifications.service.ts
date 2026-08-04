import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationName } from '../../generated/prisma/client';

interface SendChatNotificationInput {
  message: string;
  ticketUrl?: string;
}

// docs/02-brd.md BR-12, docs/03-cahier-des-charges-v2.md §2 ("Notifications :
// Email, Microsoft Teams, Slack/WhatsApp") : diffusion des notifications
// vers un canal Teams et/ou Slack, en plus de l'email et du temps réel.
//
// Implémenté via de simples webhooks entrants (Incoming Webhook / Workflow
// URL) plutôt que Microsoft Graph : ça ne nécessite ni app registration
// Azure AD ni OAuth2 (contrairement au SSO Entra ID, volontairement hors
// périmètre), et c'est le mécanisme d'intégration standard pour poster dans
// un canal côté Teams comme côté Slack. Limite assumée : un webhook entrant
// cible un canal fixe, pas un utilisateur précis — toutes les notifications
// atterrissent donc dans le même canal partagé (ex. "Support IT"), pas en
// message direct par destinataire.
@Injectable()
export class ChatNotificationsService {
  private readonly logger = new Logger(ChatNotificationsService.name);
  private readonly teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL || null;
  private readonly slackWebhookUrl = process.env.SLACK_WEBHOOK_URL || null;

  constructor(private readonly prisma: PrismaService) {}

  async sendNotification(input: SendChatNotificationInput): Promise<void> {
    await Promise.all([this.postToTeams(input), this.postToSlack(input)]);
  }

  // docs/11-documentation-api.md §12 (GET/PATCH /admin/integrations) :
  // absence de ligne = activé par défaut (comportement historique avant
  // l'ajout de ce toggle), seul un enregistrement isEnabled=false le
  // désactive explicitement.
  private async isIntegrationEnabled(name: IntegrationName): Promise<boolean> {
    const config = await this.prisma.integrationConfig.findUnique({
      where: { name },
    });
    return config?.isEnabled ?? true;
  }

  private async postToTeams(input: SendChatNotificationInput): Promise<void> {
    if (!this.teamsWebhookUrl) return;
    if (!(await this.isIntegrationEnabled(IntegrationName.TEAMS))) return;

    try {
      const response = await fetch(this.teamsWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          summary: 'AI Help Desk',
          text: this.buildText(
            input,
            `[Voir le ticket](${input.ticketUrl ?? ''})`,
          ),
        }),
      });
      if (!response.ok) {
        this.logger.error(
          `Échec de l'envoi de la notification Teams : ${response.status} ${await response.text()}`,
        );
      }
    } catch (error) {
      this.logger.error("Échec de l'envoi de la notification Teams", error);
    }
  }

  private async postToSlack(input: SendChatNotificationInput): Promise<void> {
    if (!this.slackWebhookUrl) return;
    if (!(await this.isIntegrationEnabled(IntegrationName.SLACK))) return;

    try {
      const response = await fetch(this.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: this.buildText(
            input,
            `<${input.ticketUrl ?? ''}|Voir le ticket>`,
          ),
        }),
      });
      if (!response.ok) {
        this.logger.error(
          `Échec de l'envoi de la notification Slack : ${response.status} ${await response.text()}`,
        );
      }
    } catch (error) {
      this.logger.error("Échec de l'envoi de la notification Slack", error);
    }
  }

  private buildText(
    input: SendChatNotificationInput,
    linkMarkup: string,
  ): string {
    return input.ticketUrl
      ? `${input.message}\n\n${linkMarkup}`
      : input.message;
  }
}
