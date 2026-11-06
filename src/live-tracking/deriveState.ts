import type { LiveLocationSession, LiveTrackState } from '../types';

import { LOST_CONTACT_SECONDS, MS_PER_SECOND } from './constants';

/**
 * Works out what a viewer should see, from the session and the current time.
 *
 * Expiry and a stopped session win over everything, including `arrived`: once
 * the link is dead no one sees anything about the sender. Beyond that only
 * `arrived` comes from stored state. `lost_contact` is derived from how old
 * the latest fix is rather than read from `status`: a fresh fix therefore
 * always beats a stale stored `lost_contact`, so the page recovers on its own
 * even if nothing has reset `status` yet.
 *
 * @param session - The live-location session document.
 * @param nowMs - Current time in epoch milliseconds.
 * @returns The state to present to the viewer.
 */
export function deriveTrackState(session: LiveLocationSession, nowMs: number): LiveTrackState {
  if (session.expiresAt.toMillis() <= nowMs) return 'ended';
  if (session.status === 'arrived') return 'arrived';
  if (!session.isActive || session.status === 'ended') return 'ended';

  const lastFixMs = (session.lastFixAt ?? session.startedAt).toMillis();
  return nowMs - lastFixMs > LOST_CONTACT_SECONDS * MS_PER_SECOND ? 'lost_contact' : 'active';
}
