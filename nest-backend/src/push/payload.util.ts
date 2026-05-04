import { User } from '../users/user.entity';
import { PushNotificationPayload } from './push.service';

export interface NewMailEnvelope {
  uid: number;
  from: string;
  fromName: string;
  subject: string;
}

/**
 * Build the push payload for a new-mail event, honouring the user's privacy
 * preference (`pushPayloadMode`). Shared between the IDLE watcher and the
 * fallback poller so both produce identical notifications.
 */
export function buildNewMailPayload(
  user: User,
  accountId: string,
  msg: NewMailEnvelope,
  folder = 'INBOX',
): PushNotificationPayload {
  const mode = user.pushPayloadMode ?? 'subject';
  const senderLabel = msg.fromName?.trim() || msg.from || 'Expediteur inconnu';

  let title: string;
  let body: string;

  if (mode === 'generic') {
    title = 'Nouveau message';
    body = 'Boite de reception';
  } else if (mode === 'sender-only') {
    title = `Nouveau message — ${senderLabel}`;
    body = '';
  } else {
    title = `Nouveau message — ${senderLabel}`;
    body = msg.subject?.trim() || '(Sans objet)';
  }

  const targetUrl = `/email/${encodeURIComponent(folder)}/${msg.uid}`;

  return {
    title,
    body,
    tag: `kyma-mail-${accountId}-${msg.uid}`,
    data: {
      // The Angular Service Worker reads `onActionClick.default` to decide
      // what to do when the user taps the notification. Without this, clicks
      // do nothing when the app is closed (the SwPush subscription in the
      // running app never gets a chance to react).
      // `focusLastFocusedOrOpen` focuses an existing tab (route then handled
      // client-side by the SwPush click subscription, which calls
      // router.navigateByUrl) or opens a new tab directly at the target URL.
      onActionClick: {
        default: { operation: 'focusLastFocusedOrOpen', url: targetUrl },
      },
      url: targetUrl,
      accountId,
      uid: msg.uid,
      folder,
    },
  };
}
