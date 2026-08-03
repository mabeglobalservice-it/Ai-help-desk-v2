import { NotificationType } from '../../generated/prisma/client';

// docs/11-documentation-api.md §10 (GET /notifications/templates),
// docs/08-schema-base-de-donnees.md (domaine Notifications, table
// notification_templates) : un modèle par type d'événement — sujet
// d'email et canaux de diffusion. Aucun PATCH n'est documenté pour cet
// endpoint : ce registre statique est la source de vérité unique
// (partagée avec EmailService pour le sujet), exposée en lecture seule à
// l'Admin plutôt qu'éditable en base — un vrai CMS de templates n'a
// jamais été demandé par les docs.
export interface NotificationTemplate {
  type: NotificationType;
  emailSubject: string;
  description: string;
  channels: Array<'IN_APP' | 'EMAIL' | 'CHAT'>;
}

export const NOTIFICATION_TEMPLATES: Record<
  NotificationType,
  NotificationTemplate
> = {
  TICKET_ASSIGNED: {
    type: 'TICKET_ASSIGNED',
    emailSubject: 'Ticket assigné',
    description: "Un ticket vient d'être assigné à ce technicien.",
    channels: ['IN_APP', 'EMAIL', 'CHAT'],
  },
  NEW_COMMENT: {
    type: 'NEW_COMMENT',
    emailSubject: 'Nouveau commentaire',
    description: 'Un commentaire a été ajouté sur un ticket suivi.',
    channels: ['IN_APP', 'EMAIL', 'CHAT'],
  },
  STATUS_CHANGED: {
    type: 'STATUS_CHANGED',
    emailSubject: 'Statut modifié',
    description: "Le statut d'un ticket a changé.",
    channels: ['IN_APP', 'EMAIL', 'CHAT'],
  },
  SLA_BREACHED: {
    type: 'SLA_BREACHED',
    emailSubject: 'SLA dépassé',
    description:
      "Le délai de résolution contractuel d'un ticket a été dépassé.",
    channels: ['IN_APP', 'EMAIL', 'CHAT'],
  },
  APPROVAL_REQUESTED: {
    type: 'APPROVAL_REQUESTED',
    emailSubject: 'Approbation requise',
    description:
      "Une action d'automatisation sensible attend une validation humaine (UC-022).",
    channels: ['IN_APP', 'EMAIL', 'CHAT'],
  },
  AUTOMATION_DECIDED: {
    type: 'AUTOMATION_DECIDED',
    emailSubject: 'Décision sur une demande d’automatisation',
    description: "Une action d'automatisation a été approuvée ou rejetée.",
    channels: ['IN_APP', 'EMAIL', 'CHAT'],
  },
};
