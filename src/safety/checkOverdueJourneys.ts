import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import type { SafeJourneySession } from '../types';
import { db, FieldValue } from '../utils/firebase';
import { sendOneSignalPush } from '../utils/onesignal';

const ONESIGNAL_APP_ID = defineString('ONESIGNAL_APP_ID');
const ONESIGNAL_REST_API_KEY = defineSecret('ONESIGNAL_REST_API_KEY');

/** Upper bound on journeys handled per run; the rest are picked up next minute. */
const BATCH_LIMIT = 100;

const OVERDUE_TITLE = 'Safe Journey: are you safe?';
const OVERDUE_BODY =
  'Your expected arrival time has passed. Open Surakshak now to check in — your emergency contacts will be alerted.';

/**
 * Finds active Safe Journeys past their `expectedArrivalAt` and pushes the
 * user once per journey.
 *
 * The overdue SMS to contacts is sent from the phone's own SIM by the app
 * (there is no server SMS gateway), so it can only go out while the app is
 * running. This push is the backstop for a backgrounded or killed app: it
 * gets the user to reopen Surakshak, at which point the app's journey
 * monitor sends the SMS. `overdueNotifiedAt` keeps it to one push per
 * journey; a failed push is left unmarked and retried on the next run.
 *
 * Needs a composite index on `safeJourneySessions` (status ASC,
 * expectedArrivalAt ASC).
 */
export const checkOverdueJourneys = onSchedule(
  { schedule: 'every 1 minutes', secrets: [ONESIGNAL_REST_API_KEY] },
  async (): Promise<void> => {
    const snapshot = await db
      .collection('safeJourneySessions')
      .where('status', '==', 'active')
      .where('expectedArrivalAt', '<=', Timestamp.now())
      .limit(BATCH_LIMIT)
      .get();

    const pending = snapshot.docs.filter(
      (doc) => (doc.data() as SafeJourneySession).overdueNotifiedAt === undefined,
    );
    if (pending.length === 0) return;

    logger.info('checkOverdueJourneys: overdue journeys found', { count: pending.length });

    await Promise.all(
      pending.map(async (doc) => {
        const session = doc.data() as SafeJourneySession;
        if (typeof session.userId !== 'string' || session.userId.length === 0) {
          logger.warn('checkOverdueJourneys: journey has no userId', { sessionId: doc.id });
          return;
        }

        try {
          const notificationId = await sendOneSignalPush({
            appId: ONESIGNAL_APP_ID.value(),
            apiKey: ONESIGNAL_REST_API_KEY.value(),
            externalIds: [session.userId],
            title: OVERDUE_TITLE,
            body: OVERDUE_BODY,
            data: { type: 'safe_journey', sessionId: doc.id },
          });
          await doc.ref.update({ overdueNotifiedAt: FieldValue.serverTimestamp() });
          logger.info('checkOverdueJourneys: overdue push sent', {
            sessionId: doc.id,
            userId: session.userId,
            notificationId,
          });
        } catch (error: unknown) {
          logger.error('checkOverdueJourneys: overdue push failed', {
            sessionId: doc.id,
            userId: session.userId,
            error,
          });
        }
      }),
    );
  },
);
