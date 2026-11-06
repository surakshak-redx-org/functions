import { createHash } from 'node:crypto';

import { logger } from 'firebase-functions';

import type { LiveLocationPoint, LiveLocationSession } from '../types';
import { db } from '../utils/firebase';

import { buildTrackResponse, firstNameOf } from './buildResponse';
import {
  HTTP_GONE,
  HTTP_INTERNAL_ERROR,
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_TOO_MANY_REQUESTS,
  POINTS_SUBCOLLECTION,
  RATE_LIMIT_PER_IP,
  RATE_LIMIT_PER_TOKEN,
  RATE_LIMIT_WINDOW_MS,
  RETRY_AFTER_SECONDS,
  SESSIONS_COLLECTION,
  SHARE_TOKEN_PATTERN,
  TOKEN_LOG_HASH_LENGTH,
  TRAIL_MAX_POINTS,
  USERS_COLLECTION,
} from './constants';
import { deriveTrackState } from './deriveState';
import { createRateLimiter } from './rateLimiter';

/** The slice of an Express request this handler reads. */
export interface LiveTrackRequest {
  method: string;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}

/** The slice of an Express response this handler writes. */
export interface LiveTrackReply {
  setHeader: (name: string, value: string) => unknown;
  status: (code: number) => LiveTrackReply;
  json: (body: unknown) => unknown;
}

// Instance-local; see createRateLimiter for the trade-off.
const ipLimiter = createRateLimiter(RATE_LIMIT_PER_IP, RATE_LIMIT_WINDOW_MS);
const tokenLimiter = createRateLimiter(RATE_LIMIT_PER_TOKEN, RATE_LIMIT_WINDOW_MS);

/** Short, irreversible token fingerprint that is safe to log. */
function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, TOKEN_LOG_HASH_LENGTH);
}

/**
 * Client address for rate limiting. The LAST `X-Forwarded-For` entry is the
 * one Google's front end appended; earlier entries are client-supplied and
 * spoofable.
 */
function clientKey(req: LiveTrackRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  const last = raw?.split(',').pop()?.trim();
  return last !== undefined && last.length > 0 ? last : (req.ip ?? 'unknown');
}

/** Loads the newest trail points, returned oldest-first. */
async function loadTrail(
  sessionRef: FirebaseFirestore.DocumentReference,
): Promise<LiveLocationPoint[]> {
  const snapshot = await sessionRef
    .collection(POINTS_SUBCOLLECTION)
    .orderBy('recordedAt', 'desc')
    .limit(TRAIL_MAX_POINTS)
    .get();
  return snapshot.docs.map((doc) => doc.data() as LiveLocationPoint).reverse();
}

/** Resolves the sender's first name, or null when unknown. */
async function loadFirstName(userId: unknown): Promise<string | null> {
  if (typeof userId !== 'string' || userId.length === 0) return null;
  const snapshot = await db.collection(USERS_COLLECTION).doc(userId).get();
  const data = snapshot.data() as { name?: unknown } | undefined;
  return firstNameOf(data?.name);
}

/**
 * Public, read-only, token-gated read of a live-location session.
 *
 * `GET ?t=<token>`. The body is built only by `buildTrackResponse`, which
 * allow-lists fields; this function never serialises a session document.
 * Unknown, malformed and revoked tokens are indistinguishable (404).
 *
 * @param req - Minimal request shape.
 * @param res - Minimal response shape.
 */
export async function handleLiveTrack(req: LiveTrackRequest, res: LiveTrackReply): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(HTTP_METHOD_NOT_ALLOWED).json({ error: 'method_not_allowed' });
    return;
  }

  const nowMs = Date.now();
  const rateLimited = (): void => {
    res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
    res.status(HTTP_TOO_MANY_REQUESTS).json({ error: 'rate_limited' });
  };

  if (!ipLimiter.allow(clientKey(req), nowMs)) {
    rateLimited();
    return;
  }

  const token = req.query.t;
  if (typeof token !== 'string' || !SHARE_TOKEN_PATTERN.test(token)) {
    res.status(HTTP_NOT_FOUND).json({ error: 'not_found' });
    return;
  }

  if (!tokenLimiter.allow(token, nowMs)) {
    rateLimited();
    return;
  }

  const fingerprint = tokenFingerprint(token);
  try {
    const found = await db
      .collection(SESSIONS_COLLECTION)
      .where('shareToken', '==', token)
      .limit(1)
      .get();
    const doc = found.docs[0];
    if (doc === undefined) {
      res.status(HTTP_NOT_FOUND).json({ error: 'not_found' });
      return;
    }

    const session = doc.data() as LiveLocationSession;
    const state = deriveTrackState(session, nowMs);
    if (state === 'ended') {
      res.status(HTTP_GONE).json({ state: 'ended' });
      return;
    }

    const [name, points] = await Promise.all([
      loadFirstName(session.userId),
      state === 'arrived' ? Promise.resolve([]) : loadTrail(doc.ref),
    ]);
    res.status(HTTP_OK).json(buildTrackResponse(session, state, name, points));
  } catch (error: unknown) {
    logger.error('liveTrack: request failed', { tokenHash: fingerprint, error });
    res.status(HTTP_INTERNAL_ERROR).json({ error: 'internal' });
  }
}
