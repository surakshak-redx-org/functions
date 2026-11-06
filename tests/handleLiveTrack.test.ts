// --- Mocks ---------------------------------------------------------------------

const sessionsGetMock = jest.fn();
const sessionsWhereMock = jest.fn();
const userGetMock = jest.fn();
const pointsGetMock = jest.fn();
const pointsCollectionMock = jest.fn();
const collectionMock = jest.fn();

jest.mock('../src/utils/firebase', () => ({
  db: { collection: (name: string) => collectionMock(name) },
}));

import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

import { MS_PER_SECOND, RATE_LIMIT_PER_IP } from '../src/live-tracking/constants';
import {
  handleLiveTrack,
  type LiveTrackReply,
  type LiveTrackRequest,
} from '../src/live-tracking/handleLiveTrack';

// --- Helpers -------------------------------------------------------------------

const TOKEN = 'abcdef0123456789abcdef0123456789';
let ipCounter = 0;

interface Captured {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
}

function call(
  overrides: { method?: string; query?: Record<string, unknown>; ip?: string } = {},
): Promise<Captured> & { captured: Captured } {
  ipCounter += 1;
  const captured: Captured = { headers: {} };
  const req: LiveTrackRequest = {
    method: overrides.method ?? 'GET',
    query: overrides.query ?? { t: TOKEN },
    headers: { 'x-forwarded-for': overrides.ip ?? `10.0.0.${ipCounter}` },
  };
  const res: LiveTrackReply = {
    setHeader: (name, value) => {
      captured.headers[name] = value;
    },
    status: (code) => {
      captured.statusCode = code;
      return res;
    },
    json: (body) => {
      captured.body = body;
    },
  };
  const promise = handleLiveTrack(req, res).then(() => captured);
  return Object.assign(promise, { captured });
}

function ts(offsetSeconds: number): Timestamp {
  return Timestamp.fromMillis(Date.now() + offsetSeconds * MS_PER_SECOND);
}

function sessionData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: 'secret-user',
    deviceId: 'secret-device',
    sharedWithUserIds: ['secret-contact'],
    locationUrl: 'https://maps.example/secret',
    shareToken: TOKEN,
    latitude: 19.076,
    longitude: 72.8777,
    startedAt: ts(-600),
    expiresAt: ts(3600),
    isActive: true,
    status: 'active',
    lastFixAt: ts(-5),
    ...overrides,
  };
}

function givenSession(data: Record<string, unknown> | null): void {
  sessionsGetMock.mockResolvedValue({
    docs:
      data === null
        ? []
        : [{ id: 's1', data: () => data, ref: { collection: pointsCollectionMock } }],
  });
}

// --- Tests ---------------------------------------------------------------------

describe('handleLiveTrack', () => {
  beforeEach(() => {
    const sessionsChain = { where: sessionsWhereMock, limit: jest.fn(), get: sessionsGetMock };
    sessionsWhereMock.mockReturnValue(sessionsChain);
    sessionsChain.limit.mockReturnValue(sessionsChain);

    collectionMock.mockImplementation((name: string) =>
      name === 'users' ? { doc: () => ({ get: userGetMock }) } : sessionsChain,
    );

    const pointsChain = { orderBy: jest.fn(), limit: jest.fn(), get: pointsGetMock };
    pointsChain.orderBy.mockReturnValue(pointsChain);
    pointsChain.limit.mockReturnValue(pointsChain);
    pointsCollectionMock.mockReturnValue(pointsChain);

    userGetMock.mockResolvedValue({ data: () => ({ name: 'Asha Verma' }) });
    pointsGetMock.mockResolvedValue({
      docs: [
        { data: () => ({ latitude: 3, longitude: 4, recordedAt: ts(-10) }) },
        { data: () => ({ latitude: 1, longitude: 2, recordedAt: ts(-20) }) },
      ],
    });
    givenSession(sessionData());
  });

  it('rejects non-GET with 405', async () => {
    const result = await call({ method: 'POST' });
    expect(result.statusCode).toBe(405);
    expect(collectionMock).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'short', 'A'.repeat(32), `${TOKEN}0`, ['x']])(
    'returns 404 for a malformed token (%p) without touching Firestore',
    async (t) => {
      const result = await call({ query: { t } });
      expect(result.statusCode).toBe(404);
      expect(result.body).toEqual({ error: 'not_found' });
      expect(collectionMock).not.toHaveBeenCalled();
    },
  );

  it('returns the same 404 for an unknown token', async () => {
    givenSession(null);
    const result = await call();
    expect(result.statusCode).toBe(404);
    expect(result.body).toEqual({ error: 'not_found' });
    expect(sessionsWhereMock).toHaveBeenCalledWith('shareToken', '==', TOKEN);
  });

  it('returns 410 with no coordinates for an ended session', async () => {
    givenSession(sessionData({ isActive: false }));
    const result = await call();
    expect(result.statusCode).toBe(410);
    expect(result.body).toEqual({ state: 'ended' });
    expect(pointsGetMock).not.toHaveBeenCalled();
  });

  it('returns 200 with position, first name and oldest-first trail', async () => {
    const result = await call();
    expect(result.statusCode).toBe(200);
    const body = result.body as {
      state: string;
      name: string;
      position: { lat: number };
      trail: { lat: number }[];
    };
    expect(body.state).toBe('active');
    expect(body.name).toBe('Asha');
    expect(body.position.lat).toBe(19.076);
    expect(body.trail.map((p) => p.lat)).toEqual([1, 3]);

    const json = JSON.stringify(result.body);
    for (const secret of ['secret-user', 'secret-device', 'secret-contact', 'secret', TOKEN]) {
      expect(json).not.toContain(secret);
    }
  });

  it('returns arrived without position or a trail read', async () => {
    givenSession(sessionData({ status: 'arrived' }));
    const result = await call();
    expect(result.statusCode).toBe(200);
    expect((result.body as { position?: unknown }).position).toBeUndefined();
    expect(pointsGetMock).not.toHaveBeenCalled();
  });

  it('uses a null name when the user has none', async () => {
    userGetMock.mockResolvedValue({ data: () => undefined });
    const result = await call();
    expect((result.body as { name: unknown }).name).toBeNull();
  });

  it('sets hardening headers on every response', async () => {
    for (const result of [
      await call(),
      await call({ method: 'POST' }),
      await call({ query: { t: 'bad' } }),
    ]) {
      expect(result.headers['Cache-Control']).toBe('no-store');
      expect(result.headers['X-Robots-Tag']).toBe('noindex, nofollow');
      expect(result.headers['X-Content-Type-Options']).toBe('nosniff');
    }
  });

  it('returns 429 with Retry-After once an IP is over its limit', async () => {
    const ip = '192.0.2.99';
    for (let i = 0; i < RATE_LIMIT_PER_IP; i += 1) {
      await call({ ip, query: { t: 'bad' } });
    }
    const result = await call({ ip, query: { t: 'bad' } });
    expect(result.statusCode).toBe(429);
    expect(result.body).toEqual({ error: 'rate_limited' });
    expect(result.headers['Retry-After']).toBe('60');
  });

  it('returns 429 once a token is over its per-token limit across IPs', async () => {
    const other = 'fedcba9876543210fedcba9876543210';
    givenSession(sessionData({ shareToken: other }));
    let last: Captured | undefined;
    for (let i = 0; i < 21; i += 1) {
      last = await call({ query: { t: other } });
    }
    expect(last?.statusCode).toBe(429);
  });

  it('returns 500 and never logs the raw token when Firestore fails', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    sessionsGetMock.mockRejectedValue(new Error('firestore down'));

    const result = await call({ query: { t: '0123456789abcdef0123456789abcdef' } });

    expect(result.statusCode).toBe(500);
    expect(result.body).toEqual({ error: 'internal' });
    expect(errorSpy).toHaveBeenCalled();
    const logged = JSON.stringify([
      ...errorSpy.mock.calls,
      ...infoSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]);
    expect(logged).not.toContain('0123456789abcdef0123456789abcdef');
    expect(logged).toContain('tokenHash');
  });
});
