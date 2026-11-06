// --- Mocks ---------------------------------------------------------------------

const collectionMock = jest.fn();
const recursiveDeleteMock = jest.fn();
const whereMock = jest.fn();
const getMock = jest.fn();

jest.mock('../src/utils/firebase', () => ({
  db: {
    collection: (name: string) => collectionMock(name),
    recursiveDelete: (...args: unknown[]) => recursiveDeleteMock(...args),
  },
}));

import { Timestamp } from 'firebase-admin/firestore';

import { cleanupLiveTracking } from '../src/live-tracking/cleanupLiveTracking';
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  POINTS_RETENTION_HOURS,
  POINTS_SWEEP_WINDOW_DAYS,
} from '../src/live-tracking/constants';

// --- Helpers -------------------------------------------------------------------

function fakeDoc(id: string): { id: string; ref: { collection: jest.Mock } } {
  return { id, ref: { collection: jest.fn((name: string) => ({ session: id, name })) } };
}

async function run(): Promise<void> {
  await cleanupLiveTracking.run({ scheduleTime: new Date().toISOString() } as never);
}

// --- Tests ---------------------------------------------------------------------

describe('cleanupLiveTracking', () => {
  beforeEach(() => {
    const chain = { where: whereMock, select: jest.fn(), get: getMock };
    whereMock.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    collectionMock.mockReturnValue(chain);
    recursiveDeleteMock.mockResolvedValue(undefined);
  });

  it('queries only the bounded expiry window', async () => {
    getMock.mockResolvedValue({ docs: [], size: 0 });
    const before = Date.now();

    await run();

    expect(collectionMock).toHaveBeenCalledWith('liveLocationSessions');
    const lower = whereMock.mock.calls.find(([, op]) => op === '>=') as [string, string, Timestamp];
    const upper = whereMock.mock.calls.find(([, op]) => op === '<=') as [string, string, Timestamp];
    expect(lower[0]).toBe('expiresAt');
    expect(upper[0]).toBe('expiresAt');
    const slack = 5000;
    expect(
      Math.abs(lower[2].toMillis() - (before - POINTS_SWEEP_WINDOW_DAYS * MS_PER_DAY)),
    ).toBeLessThan(slack);
    expect(
      Math.abs(upper[2].toMillis() - (before - POINTS_RETENTION_HOURS * MS_PER_HOUR)),
    ).toBeLessThan(slack);
    expect(recursiveDeleteMock).not.toHaveBeenCalled();
  });

  it("recursively deletes each matched session's points", async () => {
    const docs = [fakeDoc('a'), fakeDoc('b')];
    getMock.mockResolvedValue({ docs, size: 2 });

    await run();

    expect(recursiveDeleteMock).toHaveBeenCalledTimes(2);
    expect(recursiveDeleteMock).toHaveBeenCalledWith({ session: 'a', name: 'points' });
    expect(recursiveDeleteMock).toHaveBeenCalledWith({ session: 'b', name: 'points' });
  });

  it('keeps going when one session fails to clean', async () => {
    getMock.mockResolvedValue({ docs: [fakeDoc('a'), fakeDoc('b')], size: 2 });
    recursiveDeleteMock.mockRejectedValueOnce(new Error('boom'));

    await run();

    expect(recursiveDeleteMock).toHaveBeenCalledTimes(2);
  });
});
