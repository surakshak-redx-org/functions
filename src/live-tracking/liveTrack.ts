import { onRequest } from 'firebase-functions/v2/https';

import { ALLOWED_ORIGINS, LIVE_TRACK_MAX_INSTANCES } from './constants';
import { handleLiveTrack } from './handleLiveTrack';

/**
 * Public HTTPS endpoint behind the live-tracking SMS link:
 * `GET /liveTrack?t=<token>`. Firestore stays owner-only; this is the only
 * public read path. See `handleLiveTrack` for behaviour.
 */
export const liveTrack = onRequest(
  { cors: ALLOWED_ORIGINS, invoker: 'public', maxInstances: LIVE_TRACK_MAX_INSTANCES },
  handleLiveTrack,
);
