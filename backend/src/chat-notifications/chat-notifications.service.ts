import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationName } from '../../generated/prisma/client';

export interface SendChatNotificationInput {
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
  private readonly teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL || null;
  private readonly slackWebhookUrl = process.env.SLACK_WEBHOOK_URL || null;

  constructor(private readonly prisma: PrismaService) {}

  // Ne rend jamais silencieusement un échec réel d'envoi : cette méthode est
  // appelée à la fois comme job BullMQ (src/notifications-delivery/, où une
  // exception déclenche le retry avec backoff) et comme repli synchrone si
  // Redis est indisponible (où l'appelant l'entoure lui-même d'un try/catch).
  // Teams et Slack restent tentés indépendamment (Promise.allSettled) — un
  // canal en échec ne doit pas empêcher l'autre d'être notifié — mais si l'un
  // des deux échoue réellement, l'erreur est propagée pour que le mécanisme
  // de retry (ou le log de repli) s'applique. Les no-op intentionnels (pas de
  // webhook configuré, intégration désactivée par l'Admin) ne sont PAS des
  // échecs et ne lèvent jamais.
  async sendNotification(input: SendChatNotificationInput): Promise<void> {
    const results = await Promise.allSettled([
      this.postToTeams(input),
      this.postToSlack(input),
    ]);

    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failures.length > 0) {
      throw new Error(
        `Échec de l'envoi de la notification chat sur ${failures.length}/2 canal(aux) : ${failures
          .map((failure) =>
            failure.reason instanceof Error
              ? failure.reason.message
              : String(failure.reason),
          )
          .join('; ')}`,
      );
    }
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
      throw new Error(
        `Échec de l'envoi de la notification Teams : ${response.status} ${await response.text()}`,
      );
    }
  }

  private async postToSlack(input: SendChatNotificationInput): Promise<void> {
    if (!this.slackWebhookUrl) return;
    if (!(await this.isIntegrationEnabled(IntegrationName.SLACK))) return;

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
      throw new Error(
        `Échec de l'envoi de la notification Slack : ${response.status} ${await response.text()}`,
      );
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
