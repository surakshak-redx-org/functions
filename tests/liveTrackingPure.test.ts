import { Timestamp } from 'firebase-admin/firestore';

import { buildTrackResponse, firstNameOf } from '../src/live-tracking/buildResponse';
import { LOST_CONTACT_SECONDS, MS_PER_SECOND } from '../src/live-tracking/constants';
import { deriveTrackState } from '../src/live-tracking/deriveState';
import { createRateLimiter } from '../src/live-tracking/rateLimiter';
import type { LiveLocationSession } from '../src/types';

const NOW = Date.UTC(2026, 10, 6, 10, 0, 0);
const ts = (offsetSeconds: number): Timestamp =>
  Timestamp.fromMillis(NOW + offsetSeconds * MS_PER_SECOND);

function session(overrides: Partial<LiveLocationSession> = {}): LiveLocationSession {
  return {
    userId: 'secret-user',
    deviceId: 'secret-device',
    latitude: 19.076,
    longitude: 72.8777,
    locationUrl: 'https://maps.example/secret-url',
    sharedWithUserIds: ['secret-contact'],
    startedAt: ts(-3600),
    expiresAt: ts(3600),
    isActive: true,
    shareToken: 'a'.repeat(32),
    status: 'active',
    lastFixAt: ts(-10),
    ...overrides,
  };
}

describe('deriveTrackState', () => {
  it('is active with a fresh fix', () => {
    expect(deriveTrackState(session(), NOW)).toBe('active');
  });

  it('is lost_contact when the fix is stale', () => {
    const stale = session({ lastFixAt: ts(-(LOST_CONTACT_SECONDS + 1)) });
    expect(deriveTrackState(stale, NOW)).toBe('lost_contact');
  });

  it('lets a fresh fix beat a stored lost_contact', () => {
    expect(deriveTrackState(session({ status: 'lost_contact' }), NOW)).toBe('active');
  });

  it('is arrived when status is arrived', () => {
    expect(deriveTrackState(session({ status: 'arrived' }), NOW)).toBe('arrived');
  });

  it('is ended when isActive is false', () => {
    expect(deriveTrackState(session({ isActive: false }), NOW)).toBe('ended');
  });

  it('is ended when status is ended', () => {
    expect(deriveTrackState(session({ status: 'ended' }), NOW)).toBe('ended');
  });

  it('is ended once expired, even if arrived', () => {
    expect(deriveTrackState(session({ expiresAt: ts(-1) }), NOW)).toBe('ended');
    expect(deriveTrackState(session({ expiresAt: ts(-1), status: 'arrived' }), NOW)).toBe('ended');
  });

  it('falls back to startedAt when lastFixAt is missing', () => {
    const noFix = session({ lastFixAt: undefined, startedAt: ts(-(LOST_CONTACT_SECONDS + 60)) });
    expect(deriveTrackState(noFix, NOW)).toBe('lost_contact');
    expect(deriveTrackState(session({ lastFixAt: undefined, startedAt: ts(-30) }), NOW)).toBe(
      'active',
    );
  });
});

describe('firstNameOf', () => {
  it('returns the first word', () => {
    expect(firstNameOf('  Asha Verma ')).toBe('Asha');
  });

  it('returns null for missing or blank names', () => {
    expect(firstNameOf(undefined)).toBeNull();
    expect(firstNameOf('   ')).toBeNull();
    expect(firstNameOf(42)).toBeNull();
  });
});

describe('buildTrackResponse', () => {
  const points = [
    { latitude: 1, longitude: 2, recordedAt: ts(-60) },
    { latitude: 3, longitude: 4, recordedAt: ts(-30) },
  ];
  const full = session({
    batteryLevel: 0.62,
    isCharging: true,
    speed: 1.4,
    heading: 90,
    accuracy: 12,
    destination: { name: 'Home', latitude: 5, longitude: 6 },
    eta: { minutes: 14, computedAt: ts(-5) },
  });
  const FORBIDDEN = [
    'secret-user',
    'secret-device',
    'secret-contact',
    'secret-url',
    'a'.repeat(32),
  ];
  const FORBIDDEN_KEYS = ['userId', 'deviceId', 'sharedWithUserIds', 'locationUrl', 'shareToken'];

  it.each(['active', 'lost_contact', 'arrived'] as const)(
    'never leaks private fields (%s)',
    (state) => {
      const json = JSON.stringify(buildTrackResponse(full, state, 'Asha', points));
      for (const value of [...FORBIDDEN, ...FORBIDDEN_KEYS]) {
        expect(json).not.toContain(value);
      }
    },
  );

  it('returns position, oldest-first trail and optional fields when present', () => {
    const body = buildTrackResponse(full, 'active', 'Asha', points);
    expect(body.position).toEqual({
      lat: 19.076,
      lng: 72.8777,
      at: ts(-10).toDate().toISOString(),
    });
    expect(body.trail.map((p) => p.lat)).toEqual([1, 3]);
    expect(body.battery).toEqual({ level: 0.62, charging: true });
    expect(body.speedMps).toBe(1.4);
    expect(body.heading).toBe(90);
    expect(body.accuracyM).toBe(12);
    expect(body.destination).toEqual({ name: 'Home', lat: 5, lng: 6 });
    expect(body.eta?.minutes).toBe(14);
  });

  it('has no position or trail when arrived', () => {
    const body = buildTrackResponse(full, 'arrived', 'Asha', points);
    expect(body.position).toBeUndefined();
    expect(body.trail).toEqual([]);
    expect(body.destination?.name).toBe('Home');
  });

  it('omits optional fields that are absent or not finite numbers', () => {
    const body = buildTrackResponse(
      session({ batteryLevel: Number.NaN, speed: Number.POSITIVE_INFINITY }),
      'active',
      null,
      [],
    );
    expect(body.battery).toBeUndefined();
    expect(body.speedMps).toBeUndefined();
    expect(body.heading).toBeUndefined();
    expect(body.accuracyM).toBeUndefined();
    expect(body.destination).toBeUndefined();
    expect(body.eta).toBeUndefined();
    expect(body.name).toBeNull();
  });

  it('skips trail points without recordedAt', () => {
    const body = buildTrackResponse(session(), 'active', null, [{ latitude: 1, longitude: 2 }]);
    expect(body.trail).toEqual([]);
  });
});

describe('createRateLimiter', () => {
  it('blocks after the limit within the window', () => {
    const limiter = createRateLimiter(2, 1000);
    expect(limiter.allow('k', 0)).toBe(true);
    expect(limiter.allow('k', 1)).toBe(true);
    expect(limiter.allow('k', 2)).toBe(false);
    expect(limiter.allow('other', 2)).toBe(true);
  });

  it('allows again once hits leave the window', () => {
    const limiter = createRateLimiter(1, 1000);
    expect(limiter.allow('k', 0)).toBe(true);
    expect(limiter.allow('k', 500)).toBe(false);
    expect(limiter.allow('k', 1001)).toBe(true);
  });

  it('caps memory by evicting the oldest key, not everyone', () => {
    const limiter = createRateLimiter(1, 10_000, 2);
    limiter.allow('a', 0);
    limiter.allow('b', 1);
    limiter.allow('c', 2); // evicts 'a'
    expect(limiter.allow('b', 3)).toBe(false); // survivor still limited
    expect(limiter.allow('a', 4)).toBe(true); // evicted key starts fresh
  });
});
