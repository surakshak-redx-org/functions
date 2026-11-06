/**
 * The app registers pushes with OneSignal only (`OneSignal.login(userId)`),
 * never with FCM directly — so a server push has to go through OneSignal's
 * REST API, targeting the user by that same external id.
 */
const ONESIGNAL_NOTIFICATIONS_URL = 'https://api.onesignal.com/notifications?c=push';

export interface OneSignalPush {
  appId: string;
  apiKey: string;
  externalIds: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface OneSignalResponse {
  id?: string;
  errors?: unknown;
}

/**
 * Sends one push to the given external ids.
 *
 * @returns OneSignal's notification id.
 * @throws when OneSignal rejects the request.
 */
export async function sendOneSignalPush(push: OneSignalPush): Promise<string> {
  const response = await fetch(ONESIGNAL_NOTIFICATIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${push.apiKey}`,
    },
    body: JSON.stringify({
      app_id: push.appId,
      target_channel: 'push',
      include_aliases: { external_id: push.externalIds },
      headings: { en: push.title },
      contents: { en: push.body },
      data: push.data ?? {},
      priority: 10,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as OneSignalResponse;
  if (!response.ok || payload.errors !== undefined || payload.id === undefined) {
    throw new Error(
      `OneSignal push failed (${response.status}): ${JSON.stringify(payload.errors ?? payload)}`,
    );
  }
  return payload.id;
}
