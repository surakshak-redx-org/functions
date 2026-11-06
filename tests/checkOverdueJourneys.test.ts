// --- Mocks ---------------------------------------------------------------------

const getMock = jest.fn();
const whereMock = jest.fn();
const limitMock = jest.fn();
const collectionMock = jest.fn();
const serverTimestampSentinel = { __serverTimestamp__: true };

jest.mock('../src/utils/firebase', () => ({
  db: { collection: (name: string) => collectionMock(name) },
  FieldValue: { serverTimestamp: jest.fn(() => serverTimestampSentinel) },
}));

const pushMock = jest.fn();
jest.mock('../src/utils/onesignal', () => ({
  sendOneSignalPush: (...args: unknown[]) => pushMock(...args),
}));

jest.mock('firebase-functions/params', () => ({
  defineString: jest.fn(() => ({ value: () => 'app-id' })),
  defineSecret: jest.fn(() => ({ value: () => 'rest-key' })),
}));

import { checkOverdueJourneys } from '../src/safety/checkOverdueJourneys';

// --- Helpers -------------------------------------------------------------------

interface FakeDoc {
  id: string;
  data: () => Record<string, unknown>;
  ref: { update: jest.Mock };
}

function journeyDoc(id: string, overrides: Record<string, unknown> = {}): FakeDoc {
  return {
    id,
    data: () => ({ userId: `user-${id}`, status: 'active', ...overrides }),
    ref: { update: jest.fn(() => Promise.resolve()) },
  };
}

function givenOverdue(docs: FakeDoc[]): void {
  getMock.mockResolvedValue({ docs });
}

async function run(): Promise<void> {
  // Scheduled functions aren't supported by firebase-functions-test's `wrap`;
  // `run` invokes the handler directly.
  await checkOverdueJourneys.run({ scheduleTime: new Date().toISOString() } as never);
}

// --- Tests ---------------------------------------------------------------------

describe('checkOverdueJourneys', () => {
  beforeEach(() => {
    const queryChain = { where: whereMock, limit: limitMock, get: getMock };
    whereMock.mockReturnValue(queryChain);
    limitMock.mockReturnValue(queryChain);
    collectionMock.mockReturnValue(queryChain);
    pushMock.mockResolvedValue('notif-1');
  });

  it('queries active journeys past their expected arrival', async () => {
    givenOverdue([]);
    await run();

    expect(collectionMock).toHaveBeenCalledWith('safeJourneySessions');
    expect(whereMock).toHaveBeenCalledWith('status', '==', 'active');
    expect(whereMock).toHaveBeenCalledWith('expectedArrivalAt', '<=', expect.anything());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('pushes the user once and marks the journey notified', async () => {
    const doc = journeyDoc('j1');
    givenOverdue([doc]);

    await run();

    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app-id',
        apiKey: 'rest-key',
        externalIds: ['user-j1'],
        data: { type: 'safe_journey', sessionId: 'j1' },
      }),
    );
    expect(doc.ref.update).toHaveBeenCalledWith({ overdueNotifiedAt: serverTimestampSentinel });
  });

  it('skips journeys that were already notified', async () => {
    givenOverdue([journeyDoc('j1', { overdueNotifiedAt: { seconds: 1 } })]);

    await run();

    expect(pushMock).not.toHaveBeenCalled();
  });

  it('leaves a journey unmarked when the push fails so the next run retries', async () => {
    const failing = journeyDoc('j1');
    const ok = journeyDoc('j2');
    givenOverdue([failing, ok]);
    pushMock.mockRejectedValueOnce(new Error('OneSignal down'));

    await run();

    expect(failing.ref.update).not.toHaveBeenCalled();
    expect(ok.ref.update).toHaveBeenCalled();
  });

  it('ignores a journey without a userId', async () => {
    givenOverdue([journeyDoc('j1', { userId: '' })]);

    await run();

    expect(pushMock).not.toHaveBeenCalled();
  });
});
