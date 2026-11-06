// --- Mocks ---------------------------------------------------------------------

const collectionMock = jest.fn();
const batchUpdateMock = jest.fn();
const batchCommitMock = jest.fn();
const serverTimestampSentinel = { __serverTimestamp__: true };

jest.mock('../src/utils/firebase', () => ({
  db: {
    collection: (name: string) => collectionMock(name),
    batch: () => ({ update: batchUpdateMock, commit: batchCommitMock }),
  },
  FieldValue: { serverTimestamp: jest.fn(() => serverTimestampSentinel) },
}));

import { Timestamp } from 'firebase-admin/firestore';

import { detectLostContact } from '../src/live-tracking/detectLostContact';

// --- Helpers -------------------------------------------------------------------

interface FakeDoc {
  ref: { id: string };
  get: (field: string) => unknown;
}

function fakeDoc(id: string, expiresInMs: number): FakeDoc {
  return {
    ref: { id },
    get: (field) => (field === 'expiresAt' ? Timestamp.fromMillis(Date.now() + expiresInMs) : null),
  };
}

interface FakeQuery {
  where: (field: string, op: string, value: unknown) => FakeQuery;
  orderBy: () => FakeQuery;
  limit: () => FakeQuery;
  get: () => Promise<{ docs: FakeDoc[] }>;
}

/** Routes each query to a result set by the `status` it filters on. */
function givenQueries(stale: FakeDoc[], recovered: FakeDoc[]): void {
  collectionMock.mockImplementation(() => {
    const conditions: Record<string, unknown> = {};
    const chain: FakeQuery = {
      where: jest.fn((field: string, _op: string, value: unknown) => {
        conditions[field] = value;
        return chain;
      }),
      orderBy: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      get: jest.fn(() =>
        Promise.resolve({ docs: conditions.status === 'active' ? stale : recovered }),
      ),
    };
    return chain;
  });
}

async function run(): Promise<void> {
  await detectLostContact.run({ scheduleTime: new Date().toISOString() } as never);
}

const HOUR_MS = 3_600_000;

// --- Tests ---------------------------------------------------------------------

describe('detectLostContact', () => {
  beforeEach(() => {
    batchCommitMock.mockResolvedValue(undefined);
  });

  it('marks stale active sessions as lost_contact', async () => {
    const doc = fakeDoc('s1', HOUR_MS);
    givenQueries([doc], []);

    await run();

    expect(collectionMock).toHaveBeenCalledWith('liveLocationSessions');
    expect(batchUpdateMock).toHaveBeenCalledWith(doc.ref, {
      status: 'lost_contact',
      lostContactAt: serverTimestampSentinel,
    });
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });

  it('skips sessions that have already expired', async () => {
    givenQueries([fakeDoc('s1', -HOUR_MS)], []);

    await run();

    expect(batchUpdateMock).not.toHaveBeenCalled();
    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it('self-heals lost_contact sessions that have a fresh fix', async () => {
    const doc = fakeDoc('s2', HOUR_MS);
    givenQueries([], [doc]);

    await run();

    expect(batchUpdateMock).toHaveBeenCalledWith(doc.ref, { status: 'active' });
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is nothing to update', async () => {
    givenQueries([], []);

    await run();

    expect(batchUpdateMock).not.toHaveBeenCalled();
    expect(batchCommitMock).not.toHaveBeenCalled();
  });
});
