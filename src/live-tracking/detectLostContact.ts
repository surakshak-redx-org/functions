import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db, FieldValue } from '../utils/firebase';

import {
  LOST_CONTACT_SECONDS,
  MS_PER_SECOND,
  SCHEDULER_BATCH_LIMIT,
  SESSIONS_COLLECTION,
} from './constants';

/**
 * Keeps the stored `status` of live-location sessions in step with reality.
 *
 * - Step A: active sessions with no fix for `LOST_CONTACT_SECONDS` become
 *   `lost_contact` (already-expired ones are skipped).
 * - Step B (self-heal): `lost_contact` sessions with a fresh fix go back to
 *   `active`, because the app does not reset `status` itself yet.
 *
 * The public endpoint derives state from `lastFixAt` at read time, so this
 * job only keeps the stored field accurate for other consumers.
 *
 * Step A reads newest-stale first so expired-but-never-stopped sessions
 * (oldest) cannot fill the batch and starve live ones.
 *
 * NO ESCALATION: this does not SMS or push anyone. A session stores only
 * local contact ids, not phone numbers, so there is nothing to message. The
 * escalation channel (SMS vs push, and whether the app should upload contact
 * numbers) is an open product decision; see the functions spec, section 2.
 *
 * Needs a composite index on `liveLocationSessions`: isActive ASC,
 * status ASC, lastFixAt ASC.
 */
export const detectLostContact = onSchedule(
  { schedule: 'every 1 minutes' },
  async (): Promise<void> => {
    const now = Timestamp.now();
    const cutoff = Timestamp.fromMillis(now.toMillis() - LOST_CONTACT_SECONDS * MS_PER_SECOND);
    const sessions = db.collection(SESSIONS_COLLECTION);

    const [stale, recovered] = await Promise.all([
      sessions
        .where('isActive', '==', true)
        .where('status', '==', 'active')
        .where('lastFixAt', '<', cutoff)
        .orderBy('lastFixAt', 'desc')
        .limit(SCHEDULER_BATCH_LIMIT)
        .get(),
      sessions
        .where('isActive', '==', true)
        .where('status', '==', 'lost_contact')
        .where('lastFixAt', '>=', cutoff)
        .limit(SCHEDULER_BATCH_LIMIT)
        .get(),
    ]);

    const toLose = stale.docs.filter((doc) => {
      const expiresAt: unknown = doc.get('expiresAt');
      return expiresAt instanceof Timestamp && expiresAt.toMillis() > now.toMillis();
    });
    if (toLose.length === 0 && recovered.docs.length === 0) return;

    const batch = db.batch();
    for (const doc of toLose) {
      batch.update(doc.ref, {
        status: 'lost_contact',
        lostContactAt: FieldValue.serverTimestamp(),
      });
    }
    for (const doc of recovered.docs) {
      batch.update(doc.ref, { status: 'active' });
    }
    await batch.commit();

    logger.info('detectLostContact: statuses updated', {
      lostContact: toLose.length,
      recovered: recovered.docs.length,
    });
  },
);
