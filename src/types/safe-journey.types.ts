import type { Timestamp } from 'firebase-admin/firestore';

/** Mirrors `safeJourneySessions/{sessionId}` from the app repo. */
export type SafeJourneyStatus = 'active' | 'arrived' | 'alert_sent' | 'cancelled';

export interface SafeJourneySession {
  userId: string;
  destinationName: string;
  destinationLatitude: number;
  destinationLongitude: number;
  etaMinutes: number;
  sharedWithUserIds: string[];
  startedAt: Timestamp;
  expectedArrivalAt: Timestamp;
  status: SafeJourneyStatus;
  /** Set by `checkOverdueJourneys` once the overdue push has gone out. */
  overdueNotifiedAt?: Timestamp;
}
