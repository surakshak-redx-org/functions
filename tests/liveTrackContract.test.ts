import { Timestamp } from 'firebase-admin/firestore';

import { buildTrackResponse } from '../src/live-tracking/buildResponse';
import type { LiveLocationSession, LiveTrackResponse } from '../src/types';

// Strict validator for the 200 body the landing page accepts. A body that
// fails here would make the page show "Reconnecting", so every shape the
// builder can produce must pass, and unknown keys are rejected.

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const isIso = (v: unknown): boolean =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;

function exactKeys(obj: Obj, required: string[], optional: string[]): string[] {
  const errors: string[] = [];
  for (const key of required) if (!(key in obj)) errors.push(`missing ${key}`);
  for (const key of Object.keys(obj)) {
    if (!required.includes(key) && !optional.includes(key)) errors.push(`unexpected ${key}`);
  }
  return errors;
}

function validateTrackBody(body: unknown): string[] {
  if (!isObj(body)) return ['body is not an object'];
  const errors = exactKeys(
    body,
    ['state', 'name', 'startedAt', 'expiresAt', 'trail'],
    ['position', 'battery', 'speedMps', 'heading', 'accuracyM', 'destination', 'eta'],
  );

  if (!['active', 'lost_contact', 'arrived'].includes(body.state as string)) {
    errors.push('bad state');
  }
  if (body.name !== null && typeof body.name !== 'string') errors.push('bad name');
  if (!isIso(body.startedAt)) errors.push('bad startedAt');
  if (!isIso(body.expiresAt)) errors.push('bad expiresAt');

  if (!Array.isArray(body.trail)) {
    errors.push('trail is not an array');
  } else {
    body.trail.forEach((p: unknown, i: number) => {
      if (!isObj(p) || exactKeys(p, ['lat', 'lng', 't'], []).length > 0) {
        errors.push(`bad trail[${i}] shape`);
      } else if (!isNum(p.lat) || !isNum(p.lng) || !isIso(p.t)) {
        errors.push(`bad trail[${i}] values`);
      }
    });
  }

  if (body.state === 'arrived' && ('position' in body || (body.trail as unknown[]).length > 0)) {
    errors.push('arrived must not expose position or trail');
  }
  if (body.state !== 'arrived' && !('position' in body)) errors.push('missing position');

  if ('position' in body) {
    const p = body.position;
    if (!isObj(p) || exactKeys(p, ['lat', 'lng', 'at'], []).length > 0) {
      errors.push('bad position shape');
    } else if (!isNum(p.lat) || !isNum(p.lng) || !isIso(p.at)) {
      errors.push('bad position values');
    }
  }
  if ('battery' in body) {
    const b = body.battery;
    if (
      !isObj(b) ||
      exactKeys(b, ['level', 'charging'], []).length > 0 ||
      !isNum(b.level) ||
      typeof b.charging !== 'boolean'
    ) {
      errors.push('bad battery');
    }
  }
  for (const key of ['speedMps', 'heading', 'accuracyM']) {
    if (key in body && !isNum(body[key])) errors.push(`bad ${key}`);
  }
  if ('destination' in body) {
    const d = body.destination;
    if (
      !isObj(d) ||
      exactKeys(d, ['name', 'lat', 'lng'], []).length > 0 ||
      typeof d.name !== 'string' ||
      !isNum(d.lat) ||
      !isNum(d.lng)
    ) {
      errors.push('bad destination');
    }
  }
  if ('eta' in body) {
    const e = body.eta;
    if (
      !isObj(e) ||
      exactKeys(e, ['minutes', 'computedAt'], []).length > 0 ||
      !isNum(e.minutes) ||
      !isIso(e.computedAt)
    ) {
      errors.push('bad eta');
    }
  }
  return errors;
}

// --- Fixtures ------------------------------------------------------------------

const NOW = Date.UTC(2026, 10, 6, 10, 0, 0);
const ts = (offsetSeconds: number): Timestamp => Timestamp.fromMillis(NOW + offsetSeconds * 1000);

const base: LiveLocationSession = {
  userId: 'u',
  latitude: 19.076,
  longitude: 72.8777,
  locationUrl: 'x',
  sharedWithUserIds: [],
  startedAt: ts(-600),
  expiresAt: ts(3600),
  isActive: true,
  status: 'active',
  lastFixAt: ts(-5),
};
const full: LiveLocationSession = {
  ...base,
  batteryLevel: 0.62,
  isCharging: false,
  speed: 1.4,
  heading: 90,
  accuracy: 12,
  destination: { name: 'Home', latitude: 5, longitude: 6 },
  eta: { minutes: 14, computedAt: ts(-5) },
};
const points = [
  { latitude: 1, longitude: 2, recordedAt: ts(-60) },
  { latitude: 3, longitude: 4, recordedAt: ts(-30) },
];

// --- Tests ---------------------------------------------------------------------

describe('liveTrack response contract', () => {
  const cases: [string, LiveTrackResponse][] = [
    ['active, minimal', buildTrackResponse(base, 'active', null, [])],
    ['active, full', buildTrackResponse(full, 'active', 'Asha', points)],
    ['lost_contact, full', buildTrackResponse(full, 'lost_contact', 'Asha', points)],
    ['arrived, with destination', buildTrackResponse(full, 'arrived', 'Asha', points)],
    ['arrived, minimal', buildTrackResponse(base, 'arrived', null, [])],
    ['no lastFixAt', buildTrackResponse({ ...base, lastFixAt: undefined }, 'active', null, [])],
  ];

  it.each(cases)('every shape the builder produces is valid: %s', (_name, body) => {
    expect(validateTrackBody(JSON.parse(JSON.stringify(body)))).toEqual([]);
  });

  it('the validator rejects bad bodies (guards the guard)', () => {
    const good = JSON.parse(JSON.stringify(cases[1]?.[1])) as Obj;
    expect(validateTrackBody({ ...good, extra: 1 })).toContain('unexpected extra');
    expect(validateTrackBody({ ...good, state: 'ended' })).toContain('bad state');
    expect(validateTrackBody({ ...good, startedAt: 'yesterday' })).toContain('bad startedAt');
    expect(validateTrackBody({ ...good, position: { lat: 'x', lng: 1, at: 'y' } })).toContain(
      'bad position values',
    );
    expect(validateTrackBody({ ...good, state: 'arrived' })).toContain(
      'arrived must not expose position or trail',
    );
    expect(validateTrackBody(null)).toContain('body is not an object');
  });
});
