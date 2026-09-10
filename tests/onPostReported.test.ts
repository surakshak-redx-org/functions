import functionsTest from 'firebase-functions-test';

const testEnv = functionsTest();

// --- Mock the Admin SDK wrapper -------------------------------------------------

const getMock = jest.fn();
const batchUpdateMock = jest.fn();
const batchCommitMock = jest.fn().mockResolvedValue(undefined);
const sendEachForMulticastMock = jest.fn();
const deleteSentinel = { __delete__: true };

jest.mock('../src/utils/firebase', () => ({
  db: {
    collection: jest.fn(() => ({ get: getMock })),
    batch: jest.fn(() => ({ update: batchUpdateMock, commit: batchCommitMock })),
  },
  messaging: {
    sendEachForMulticast: (...args: unknown[]) => sendEachForMulticastMock(...args),
  },
  FieldValue: {
    delete: jest.fn(() => deleteSentinel),
  },
}));

import { onPostReported } from '../src/moderation/onPostReported';

// --- Helpers -----------------------------------------------------------------

const BASE_POST = {
  id: 'post1',
  authorId: 'u1',
  authorName: 'Asha',
  authorPhotoUrl: '',
  content: 'hello',
  type: 'text' as const,
  isAnonymous: false,
  locationUrl: null,
  imageUrl: null,
  city: 'Pune',
  state: 'Maharashtra',
  reportCount: 3,
  isHidden: false,
};

function makeAdminSnap(admins: Array<{ id: string; fcmToken?: string }>): {
  forEach: (cb: (doc: unknown) => void) => void;
} {
  return {
    forEach(cb) {
      for (const a of admins) {
        cb({
          ref: { id: a.id, path: `admins/${a.id}` },
          data: () => ({ uid: a.id, email: `${a.id}@x.com`, role: 'admin', fcmToken: a.fcmToken }),
        });
      }
    },
  };
}

function runUpdate(
  beforeOverrides: Partial<typeof BASE_POST>,
  afterOverrides: Partial<typeof BASE_POST>,
): Promise<unknown> {
  const before = testEnv.firestore.makeDocumentSnapshot(
    { ...BASE_POST, ...beforeOverrides },
    'community/post1',
  );
  const after = testEnv.firestore.makeDocumentSnapshot(
    { ...BASE_POST, ...afterOverrides },
    'community/post1',
  );
  const change = testEnv.makeChange(before, after);
  const wrapped = testEnv.wrap(onPostReported);
  return wrapped({ data: change, params: { postId: 'post1' } } as never);
}

afterAll(() => testEnv.cleanup());

// --- Tests -----------------------------------------------------------------

describe('onPostReported', () => {
  it('does nothing when isHidden did not change', async () => {
    await runUpdate({ isHidden: false }, { isHidden: false, reportCount: 2 });
    await runUpdate({ isHidden: true }, { isHidden: true, reportCount: 5 });

    expect(getMock).not.toHaveBeenCalled();
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it('notifies admins with valid tokens when a post is hidden', async () => {
    getMock.mockResolvedValueOnce(
      makeAdminSnap([
        { id: 'a1', fcmToken: 'tok-1' },
        { id: 'a2' }, // no token — skipped
      ]),
    );
    sendEachForMulticastMock.mockResolvedValueOnce({
      responses: [{ success: true }],
      successCount: 1,
      failureCount: 0,
    });

    await runUpdate({ isHidden: false }, { isHidden: true, reportCount: 3 });

    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
    const payload = sendEachForMulticastMock.mock.calls[0][0];
    expect(payload.tokens).toEqual(['tok-1']);
    expect(payload.data).toMatchObject({ type: 'post_hidden', postId: 'post1', city: 'Pune' });
    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it('sends nothing when there are no admin tokens', async () => {
    getMock.mockResolvedValueOnce(makeAdminSnap([{ id: 'a1' }, { id: 'a2' }]));

    await runUpdate({ isHidden: false }, { isHidden: true });

    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it('clears a dead FCM token reported by the send response', async () => {
    getMock.mockResolvedValue(makeAdminSnap([{ id: 'a1', fcmToken: 'dead-tok' }]));
    sendEachForMulticastMock.mockResolvedValueOnce({
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
      successCount: 0,
      failureCount: 1,
    });

    await runUpdate({ isHidden: false }, { isHidden: true });

    expect(batchUpdateMock).toHaveBeenCalledTimes(1);
    expect(batchUpdateMock.mock.calls[0][1]).toEqual({ fcmToken: deleteSentinel });
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });
});
