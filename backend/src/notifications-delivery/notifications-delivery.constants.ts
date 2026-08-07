export const NOTIFICATIONS_DELIVERY_QUEUE = 'notifications-delivery';

export const EMAIL_JOB_NAME = 'email';
export const CHAT_JOB_NAME = 'chat';

// docs/07-architecture-logicielle.md §"Files d'attente (BullMQ)" : borne le
// temps que le chemin de requête (NotificationsService.create()) attend une
// mise en file avant de considérer Redis indisponible et de basculer sur
// l'envoi synchrone (RM-05). En pratique, avec `enableOfflineQueue: false`
// (voir redis-connection.util.ts), l'échec est quasi immédiat — ce délai
// n'est qu'un filet de sécurité pour ne jamais bloquer la création d'une
// notification.
export const ENQUEUE_TIMEOUT_MS = 1500;
