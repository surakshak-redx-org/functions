import type { Timestamp } from 'firebase-admin/firestore';

import type { LiveLocationPoint, LiveLocationSession, LiveTrackResponse } from '../types';

function iso(timestamp: Timestamp): string {
  return timestamp.toDate().toISOString();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** First whitespace-separated word of a display name, or null if there is none. */
export function firstNameOf(fullName: unknown): string | null {
  if (typeof fullName !== 'string') return null;
  const first = fullName.trim().split(/\s+/)[0];
  return first === undefined || first.length === 0 ? null : first;
}

/**
 * Builds the public payload by ALLOW-LISTING fields one by one. Never spread
 * the session document: `userId`, `deviceId`, `sharedWithUserIds` and the
 * token must not reach a public response, now or when new fields are added to
 * the document later.
 */
export function buildTrackResponse(
  session: LiveLocationSession,
  state: LiveTrackResponse['state'],
  name: string | null,
  points: LiveLocationPoint[],
): LiveTrackResponse {
  const response: LiveTrackResponse = {
    state,
    name,
    startedAt: iso(session.startedAt),
    expiresAt: iso(session.expiresAt),
    trail: [],
  };

  if (state === 'arrived') {
    // The sender is safe: stop exposing where they are.
    if (session.destination !== undefined) {
      response.destination = {
        name: session.destination.name,
        lat: session.destination.latitude,
        lng: session.destination.longitude,
      };
    }
    return response;
  }

  response.position = {
    lat: session.latitude,
    lng: session.longitude,
    at: iso(session.lastFixAt ?? session.startedAt),
  };

  response.trail = points.flatMap((point) =>
    point.recordedAt === undefined
      ? []
      : [{ lat: point.latitude, lng: point.longitude, t: iso(point.recordedAt) }],
  );

  if (isFiniteNumber(session.batteryLevel)) {
    response.battery = { level: session.batteryLevel, charging: session.isCharging === true };
  }
  if (isFiniteNumber(session.speed)) response.speedMps = session.speed;
  if (isFiniteNumber(session.heading)) response.heading = session.heading;
  if (isFiniteNumber(session.accuracy)) response.accuracyM = session.accuracy;

  if (session.destination !== undefined) {
    response.destination = {
      name: session.destination.name,
      lat: session.destination.latitude,
      lng: session.destination.longitude,
    };
  }
  if (session.eta !== undefined) {
    response.eta = { minutes: session.eta.minutes, computedAt: iso(session.eta.computedAt) };
  }

  return response;
}
