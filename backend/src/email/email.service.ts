import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';
import {
  IntegrationName,
  NotificationType,
} from '../../generated/prisma/client';
import { NOTIFICATION_TEMPLATES } from '../notifications/notification-templates';

const FROM_ADDRESS = 'onboarding@resend.dev';
const DEFAULT_ORGANIZATION_NAME = 'AI Help Desk';

interface SendNotificationEmailInput {
  to: string;
  displayName: string;
  type: NotificationType;
  message: string;
  ticketUrl?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

  constructor(private readonly prisma: PrismaService) {}

  async sendNotificationEmail(
    input: SendNotificationEmailInput,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY absente : email de notification ignoré');
      return;
    }

    // docs/11-documentation-api.md §12 (GET/PATCH /admin/integrations) :
    // absence de ligne = activé par défaut.
    const integrationConfig = await this.prisma.integrationConfig.findUnique({
      where: { name: IntegrationName.EMAIL },
    });
    if (integrationConfig?.isEnabled === false) {
      this.logger.warn(
        "Intégration Email désactivée par l'Admin : envoi ignoré",
      );
      return;
    }

    const organizationName = await this.getOrganizationName();

    try {
      const { error } = await this.resend.emails.send({
        from: FROM_ADDRESS,
        to: input.to,
        subject: `${organizationName} — ${NOTIFICATION_TEMPLATES[input.type].emailSubject}`,
        html: this.buildHtml(input, organizationName),
      });

      // The Resend SDK reports API-level failures (invalid recipient, quota, ...)
      // via this `error` field rather than throwing.
      if (error) {
        this.logger.error(
          `Échec de l'envoi de l'email de notification à ${input.to} : ${error.message}`,
        );
      }
    } catch (error) {
      // best-effort: a failed email shouldn't break the notification flow that triggered it
      this.logger.error(
        `Échec de l'envoi de l'email de notification à ${input.to}`,
        error,
      );
    }
  }

  // docs/11-documentation-api.md §12 (GET/PATCH /admin/settings) : nom
  // d'organisation utilisé pour le branding des emails de notification.
  // Repli sur la valeur par défaut si la table n'a pas encore été seedée
  // (ex. base fraîchement déployée avant tout `prisma db seed`).
  private async getOrganizationName(): Promise<string> {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { id: 'singleton' },
    });
    return settings?.organizationName ?? DEFAULT_ORGANIZATION_NAME;
  }

  private buildHtml(
    { displayName, message, ticketUrl }: SendNotificationEmailInput,
    organizationName: string,
  ): string {
    return `
      <div style="font-family: -apple-system, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2933;">
        <p>Bonjour ${displayName},</p>
        <p>${message}</p>
        ${
          ticketUrl
            ? `<p><a href="${ticketUrl}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Voir le ticket</a></p>`
            : ''
        }
        <p style="color:#8a97a3;font-size:12px;margin-top:32px;">${organizationName} — notification automatique, merci de ne pas répondre à cet email.</p>
      </div>
    `;
  }
}
