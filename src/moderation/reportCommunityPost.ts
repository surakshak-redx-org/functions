import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../utils/firebase';
import { COMMUNITY_REPORT_HIDE_THRESHOLD } from './reportThreshold';

export interface ReportResult {
  accepted: boolean;
  reportCount: number;
  isHidden: boolean;
}

function parsePostId(data: unknown): string {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new HttpsError('invalid-argument', 'A postId is required.');
  }

  const input = data as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'postId')) {
    throw new HttpsError('invalid-argument', 'Only postId may be provided.');
  }

  if (typeof input.postId !== 'string') {
    throw new HttpsError('invalid-argument', 'A postId is required.');
  }

  const postId = input.postId.trim();
  if (postId.length === 0 || postId.includes('/') || postId.length > 1500) {
    throw new HttpsError('invalid-argument', 'The postId is invalid.');
  }
  return postId;
}

/** Callable implementation is exported separately to test the auth boundary. */
export async function handleCommunityReport(
  request: CallableRequest<unknown>,
): Promise<ReportResult> {
  const reporterId = request.auth?.uid;
  if (!reporterId) {
    throw new HttpsError('unauthenticated', 'Sign in to report a community post.');
  }

  const postId = parsePostId(request.data);
  const postRef = db.collection('community').doc(postId);
  const reportRef = postRef.collection('reports').doc(reporterId);

  return db.runTransaction(async (transaction): Promise<ReportResult> => {
    const postSnapshot = await transaction.get(postRef);
    if (!postSnapshot.exists) {
      throw new HttpsError('not-found', 'The community post does not exist.');
    }

    const reportSnapshot = await transaction.get(reportRef);
    const rawPost: unknown = postSnapshot.data();
    const post =
      typeof rawPost === 'object' && rawPost !== null
        ? (rawPost as Record<string, unknown>)
        : undefined;
    const storedCount = post?.reportCount ?? 0;
    if (
      typeof storedCount !== 'number' ||
      !Number.isSafeInteger(storedCount) ||
      storedCount < 0 ||
      storedCount >= Number.MAX_SAFE_INTEGER
    ) {
      throw new HttpsError('failed-precondition', 'The community post report count is invalid.');
    }
    const reportCount = storedCount;

    if (reportSnapshot.exists) {
      return {
        accepted: false,
        reportCount,
        isHidden: post?.isHidden === true,
      };
    }

    const nextReportCount = reportCount + 1;
    const isHidden = post?.isHidden === true || nextReportCount >= COMMUNITY_REPORT_HIDE_THRESHOLD;

    transaction.create(reportRef, {
      reporterId,
      postId,
      reason: 'inappropriate_content',
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(postRef, {
      reportCount: nextReportCount,
      isHidden,
    });

    return { accepted: true, reportCount: nextReportCount, isHidden };
  });
}

export const reportCommunityPost = onCall(handleCommunityReport);
