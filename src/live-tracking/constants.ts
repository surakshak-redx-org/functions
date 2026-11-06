/** Collection holding live-location sessions (written by the app). */
export const SESSIONS_COLLECTION = 'liveLocationSessions';
export const POINTS_SUBCOLLECTION = 'points';
export const USERS_COLLECTION = 'users';

/** A share token is 128 random bits as lowercase hex. */
export const SHARE_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/**
 * No fix for this long means contact is lost. The app's slowest tracking
 * profile reports about once a minute, so five minutes avoids false alarms.
 */
export const LOST_CONTACT_SECONDS = 300;

/** Newest route-trail points returned to the viewer. */
export const TRAIL_MAX_POINTS = 500;

/** Rate limits for the public endpoint (the page polls about every 5 s). */
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_PER_IP = 30;
export const RATE_LIMIT_PER_TOKEN = 20;
export const RATE_LIMIT_MAX_TRACKED_KEYS = 5_000;

/** Concurrent instances for the public endpoint, capping cost from abuse. */
export const LIVE_TRACK_MAX_INSTANCES = 5;

/**
 * Origins allowed to call `liveTrack` from a browser. CORS is not the access
 * control here (the token is), but it stops other sites embedding the API.
 * Add Vercel preview origins here if previews need to work.
 */
export const ALLOWED_ORIGINS: string[] = [
  'https://landing-surakshak.vercel.app',
  'https://surakshak.app',
  'http://localhost:3000',
];

/** Sessions handled per scheduled run; the rest are picked up next run. */
export const SCHEDULER_BATCH_LIMIT = 200;

/** Trail points are deleted this long after a session expires. */
export const POINTS_RETENTION_HOURS = 24;
/** Only sessions expired within this window are swept, so old ones are not rescanned forever. */
export const POINTS_SWEEP_WINDOW_DAYS = 7;
export const MS_PER_SECOND = 1000;
export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** HTTP status codes used by the public endpoint. */
export const HTTP_OK = 200;
export const HTTP_NOT_FOUND = 404;
export const HTTP_METHOD_NOT_ALLOWED = 405;
export const HTTP_GONE = 410;
export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_INTERNAL_ERROR = 500;

/** Seconds a rate-limited client is told to wait; equals the limiter window. */
export const RETRY_AFTER_SECONDS = RATE_LIMIT_WINDOW_MS / MS_PER_SECOND;

/** Hex chars of the token's SHA-256 kept for log correlation (never the token). */
export const TOKEN_LOG_HASH_LENGTH = 12;

/** Cron and time zone for the nightly trail-point cleanup (03:00 IST). */
export const CLEANUP_SCHEDULE = '0 3 * * *';
export const CLEANUP_TIME_ZONE = 'Asia/Kolkata';
