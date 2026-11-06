import type { Timestamp } from 'firebase-admin/firestore';

/** Mirrors `liveLocationSessions/{sessionId}` from the app repo. */
export type LiveLocationStatus = 'active' | 'arrived' | 'ended' | 'lost_contact';

export interface LiveLocationSession {
  userId: string;
  deviceId?: string;
  latitude: number;
  longitude: number;
  locationUrl: string;
  /** Local contact ids on the sender's device — meaningless server-side. Never expose. */
  sharedWithUserIds: string[];
  startedAt: Timestamp;
  expiresAt: Timestamp;
  isActive: boolean;
  /** 32 lowercase hex chars. Absent means the link was revoked. */
  shareToken?: string;
  status?: LiveLocationStatus;
  lastFixAt?: Timestamp;
  /** Set by `detectLostContact` when it flips a session to `lost_contact`. */
  lostContactAt?: Timestamp;
  /** Battery level, 0–1. Written by the app from a later release; may be absent. */
  batteryLevel?: number;
  isCharging?: boolean;
  /** Metres per second. */
  speed?: number;
  /** Degrees clockwise from north. */
  heading?: number;
  /** Metres. */
  accuracy?: number;
  destination?: { name: string; latitude: number; longitude: number };
  eta?: { minutes: number; computedAt: Timestamp };
}

/** Mirrors `liveLocationSessions/{sessionId}/points/{pointId}`. */
export interface LiveLocationPoint {
  latitude: number;
  longitude: number;
  recordedAt?: Timestamp;
}

/** What a viewer of the public tracking page is allowed to see. */
export type LiveTrackState = 'active' | 'lost_contact' | 'arrived' | 'ended';

export interface LiveTrackResponse {
  state: Exclude<LiveTrackState, 'ended'>;
  /** Sender's first name, or null when unknown. */
  name: string | null;
  /** Omitted once the sender has arrived. */
  position?: { lat: number; lng: number; at: string };
  startedAt: string;
  expiresAt: string;
  trail: { lat: number; lng: number; t: string }[];
  battery?: { level: number; charging: boolean };
  speedMps?: number;
  heading?: number;
  accuracyM?: number;
  destination?: { name: string; lat: number; lng: number };
  eta?: { minutes: number; computedAt: string };
}
