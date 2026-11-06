import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db } from '../utils/firebase';

import {
  CLEANUP_SCHEDULE,
  CLEANUP_TIME_ZONE,
  MS_PER_DAY,
  MS_PER_HOUR,
  POINTS_RETENTION_HOURS,
  POINTS_SWEEP_WINDOW_DAYS,
  POINTS_SUBCOLLECTION,
  SESSIONS_COLLECTION,
} from './constants';

/**
 * Daily at 03:00 IST: deletes the route-trail `points` of sessions that
 * expired between `POINTS_SWEEP_WINDOW_DAYS` and `POINTS_RETENTION_HOURS`
 * ago. The session document itself is kept for support and audit.
 *
 * The bounded window stops the job rescanning old sessions forever. A
 * session whose delete fails is retried by the next runs while it remains in
 * the window. Uses a single-field range on `expiresAt` (automatic index).
 */
export const cleanupLiveTracking = onSchedule(
  { schedule: CLEANUP_SCHEDULE, timeZone: CLEANUP_TIME_ZONE },
  async (): Promise<void> => {
    const nowMs = Date.now();
    const newest = Timestamp.fromMillis(nowMs - POINTS_RETENTION_HOURS * MS_PER_HOUR);
    const oldest = Timestamp.fromMillis(nowMs - POINTS_SWEEP_WINDOW_DAYS * MS_PER_DAY);

    const expired = await db
      .collection(SESSIONS_COLLECTION)
      .where('expiresAt', '>=', oldest)
      .where('expiresAt', '<=', newest)
      .select()
      .get();

    let cleaned = 0;
    for (const doc of expired.docs) {
      try {
        await db.recursiveDelete(doc.ref.collection(POINTS_SUBCOLLECTION));
        cleaned += 1;
      } catch (error: unknown) {
        logger.error('cleanupLiveTracking: failed to delete points', {
          sessionId: doc.id,
          error,
        });
      }
    }

    logger.info('cleanupLiveTracking: done', { sessions: expired.size, cleaned });
  },
);
