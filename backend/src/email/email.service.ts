import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { NotificationType } from '../../generated/prisma/client';

const FROM_ADDRESS = 'onboarding@resend.dev';

const SUBJECT_BY_TYPE: Record<NotificationType, string> = {
  TICKET_ASSIGNED: 'Ticket assigné',
  NEW_COMMENT: 'Nouveau commentaire',
  STATUS_CHANGED: 'Statut modifié',
  SLA_BREACHED: 'SLA dépassé',
};

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

  async sendNotificationEmail(
    input: SendNotificationEmailInput,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY absente : email de notification ignoré');
      return;
    }

    try {
      const { error } = await this.resend.emails.send({
        from: FROM_ADDRESS,
        to: input.to,
        subject: `AI Help Desk — ${SUBJECT_BY_TYPE[input.type]}`,
        html: this.buildHtml(input),
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

  private buildHtml({
    displayName,
    message,
    ticketUrl,
  }: SendNotificationEmailInput): string {
    return `
      <div style="font-family: -apple-system, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2933;">
        <p>Bonjour ${displayName},</p>
        <p>${message}</p>
        ${
          ticketUrl
            ? `<p><a href="${ticketUrl}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Voir le ticket</a></p>`
            : ''
        }
        <p style="color:#8a97a3;font-size:12px;margin-top:32px;">AI Help Desk — notification automatique, merci de ne pas répondre à cet email.</p>
      </div>
    `;
  }
}
