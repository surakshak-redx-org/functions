import { logger } from 'firebase-functions';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

import type { AdminUser } from '../types/admin.types';
import type { CommunityPost } from '../types/community.types';
import { db, messaging, FieldValue } from '../utils/firebase';

/**
 * Report count at which the app auto-hides a community post. Kept here only for
 * logging / notification copy — the trigger keys off the `isHidden` transition,
 * not this number (see below).
 *
 * Mirrors `APP_CONFIG.COMMUNITY_REPORT_HIDE_THRESHOLD` in the app repo.
 */
const REPORT_THRESHOLD = 3;

/** FCM error codes that mean a stored token is dead and should be removed. */
const DEAD_TOKEN_CODES = new Set<string>([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

/**
 * Fires when a `community/{postId}` document is updated.
 *
 * When a post transitions from visible to hidden (`isHidden` false -> true), it
 * has just been auto-hidden by the app after reaching
 * {@link REPORT_THRESHOLD} reports (see `reportPost()` in the app repo's
 * `src/services/firebase/community.service.ts`). We notify every admin so the
 * post can be reviewed and either restored or permanently removed.
 *
 * We key off the `isHidden` transition rather than `reportCount` crossing the
 * threshold because the app's `reportPost()` is not transactional: under
 * concurrent reports `reportCount` can already be at or past the threshold on
 * the write that finally flips `isHidden`, so a `reportCount`-crossing check
 * would miss real hides. The `false -> true` transition is exact and fires
 * once — a later (e.g. 4th) report has `isHidden` already `true` on both sides.
 *
 * Recipients come from Firestore `admins/{uid}` (owned by the Phase 9 admin
 * dashboard). Until that collection exists this function runs, logs, and sends
 * nothing.
 */
export const onPostReported = onDocumentUpdated(
  'community/{postId}',
  async (event): Promise<void> => {
    const postId = event.params.postId;

    if (!event.data) {
      logger.warn('onPostReported: update event carried no data', { postId });
      return;
    }

    const before = event.data.before.data() as CommunityPost;
    const after = event.data.after.data() as CommunityPost;

    const justHidden = before.isHidden === false && after.isHidden === true;
    if (!justHidden) {
      return;
    }

    logger.info('Post hidden — notifying admins', {
      postId,
      reportCount: after.reportCount,
      threshold: REPORT_THRESHOLD,
      city: after.city,
      state: after.state,
    });

    try {
      const adminSnap = await db.collection('admins').get();

      const tokens: string[] = [];
      adminSnap.forEach((doc) => {
        const adminUser = doc.data() as AdminUser;
        if (typeof adminUser.fcmToken === 'string' && adminUser.fcmToken.length > 0) {
          tokens.push(adminUser.fcmToken);
        }
      });

      if (tokens.length === 0) {
        logger.info('No admin FCM tokens found — skipping notification', { postId });
        return;
      }

      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: '🚨 Post Hidden — Review Required',
          body: `A post in ${after.city} was hidden after ${after.reportCount} reports.`,
        },
        data: {
          type: 'post_hidden',
          postId,
          city: after.city,
          reportCount: String(after.reportCount),
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'admin_alerts',
            priority: 'max',
          },
        },
      });

      logger.info('Admin notifications sent', {
        postId,
        successCount: response.successCount,
        failureCount: response.failureCount,
      });

      const deadTokens = new Set<string>();
      response.responses.forEach((resp, idx) => {
        const token = tokens[idx];
        if (
          !resp.success &&
          token !== undefined &&
          resp.error &&
          DEAD_TOKEN_CODES.has(resp.error.code)
        ) {
          deadTokens.add(token);
        }
      });

      if (deadTokens.size === 0) {
        return;
      }

      logger.warn('Removing dead FCM tokens', {
        postId,
        count: deadTokens.size,
      });

      const batch = db.batch();
      adminSnap.forEach((doc) => {
        const adminUser = doc.data() as AdminUser;
        if (typeof adminUser.fcmToken === 'string' && deadTokens.has(adminUser.fcmToken)) {
          batch.update(doc.ref, { fcmToken: FieldValue.delete() });
        }
      });
      await batch.commit();
    } catch (error) {
      logger.error('onPostReported failed', { postId, error });
      throw error;
    }
  },
);
