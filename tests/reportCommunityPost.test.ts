import type { CallableRequest } from 'firebase-functions/v2/https';

interface MockReference {
  path: string;
  collection: (name: string) => MockCollectionReference;
  doc: (id: string) => MockReference;
}

interface MockCollectionReference {
  doc: (id: string) => MockReference;
}

interface MockTransaction {
  get: (ref: MockReference) => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
  create: (ref: MockReference, data: Record<string, unknown>) => void;
  update: (ref: MockReference, data: Record<string, unknown>) => void;
}

const mockPosts = new Map<string, Record<string, unknown>>();
const mockReports = new Map<string, Record<string, unknown>>();
let mockQueue: Promise<void> = Promise.resolve();

function reference(path: string): MockReference {
  return {
    path,
    collection(name: string): MockCollectionReference {
      return { doc: (id: string): MockReference => reference(path + '/' + name + '/' + id) };
    },
    doc: (id: string): MockReference => reference(path + '/' + id),
  };
}

const mockRunTransaction = jest.fn(
  (operation: (transaction: unknown) => Promise<unknown>): Promise<unknown> => {
    const run = mockQueue.then(async () => {
      const writes: Array<() => void> = [];
      const transaction: MockTransaction = {
        async get(
          ref,
        ): Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }> {
          const record =
            ref.path.split('/').length > 2 ? mockReports.get(ref.path) : mockPosts.get(ref.path);
          return { exists: record !== undefined, data: () => record };
        },
        create(ref, data): void {
          writes.push(() => mockReports.set(ref.path, data));
        },
        update(ref, data): void {
          writes.push(() => {
            const existing = mockPosts.get(ref.path) ?? {};
            mockPosts.set(ref.path, { ...existing, ...data });
          });
        },
      };
      const result = await operation(transaction);
      writes.forEach((write) => write());
      return result;
    });
    mockQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  },
);

jest.mock('../src/utils/firebase', () => ({
  db: {
    collection: (name: string): MockCollectionReference => ({
      doc: (id: string): MockReference => reference(name + '/' + id),
    }),
    runTransaction: (...args: unknown[]) => mockRunTransaction(...(args as [never])),
  },
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

import { handleCommunityReport, type ReportResult } from '../src/moderation/reportCommunityPost';

function request(data: unknown, uid = 'reporter-1'): CallableRequest<unknown> {
  return {
    data,
    auth: uid ? { uid, token: {} } : undefined,
  } as CallableRequest<unknown>;
}

async function submit(postId: string, uid = 'reporter-1'): Promise<ReportResult> {
  return handleCommunityReport(request({ postId }, uid));
}

describe('handleCommunityReport', () => {
  beforeEach(() => {
    mockPosts.clear();
    mockReports.clear();
    mockQueue = Promise.resolve();
    mockRunTransaction.mockClear();
  });

  it('accepts the first report and updates the report and post atomically', async () => {
    mockPosts.set('community/post-1', { reportCount: 0, isHidden: false });

    await expect(submit('post-1')).resolves.toEqual({
      accepted: true,
      reportCount: 1,
      isHidden: false,
    });
    expect(mockReports.get('community/post-1/reports/reporter-1')).toMatchObject({
      reporterId: 'reporter-1',
      postId: 'post-1',
      reason: 'inappropriate_content',
      createdAt: 'SERVER_TIMESTAMP',
    });
    expect(mockPosts.get('community/post-1')).toMatchObject({ reportCount: 1, isHidden: false });
  });

  it('makes repeated reports idempotent', async () => {
    mockPosts.set('community/post-1', { reportCount: 0, isHidden: false });

    await submit('post-1');
    await expect(submit('post-1')).resolves.toEqual({
      accepted: false,
      reportCount: 1,
      isHidden: false,
    });
    expect(mockReports.size).toBe(1);
    expect(mockPosts.get('community/post-1')?.reportCount).toBe(1);
  });

  it('does not inflate the count for concurrent submissions by one reporter', async () => {
    mockPosts.set('community/post-1', { reportCount: 0, isHidden: false });

    const results = await Promise.all([submit('post-1'), submit('post-1')]);

    expect(results.filter((result) => result.accepted)).toHaveLength(1);
    expect(mockReports.size).toBe(1);
    expect(mockPosts.get('community/post-1')?.reportCount).toBe(1);
  });

  it('counts two different reporters independently', async () => {
    mockPosts.set('community/post-1', { reportCount: 0, isHidden: false });

    await Promise.all([submit('post-1', 'reporter-1'), submit('post-1', 'reporter-2')]);

    expect(mockReports.size).toBe(2);
    expect(mockPosts.get('community/post-1')?.reportCount).toBe(2);
  });

  it('rejects unauthenticated callers without a transaction', async () => {
    await expect(
      handleCommunityReport({
        data: { postId: 'post-1' },
        auth: undefined,
      } as CallableRequest<unknown>),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('rejects a forged reporter id instead of trusting client identity', async () => {
    mockPosts.set('community/post-1', { reportCount: 0, isHidden: false });

    await expect(
      handleCommunityReport(request({ postId: 'post-1', reporterId: 'victim' }, 'attacker')),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockReports.size).toBe(0);
    expect(mockPosts.get('community/post-1')?.reportCount).toBe(0);
  });

  it('rejects nonexistent posts without creating a report', async () => {
    await expect(submit('missing-post')).rejects.toMatchObject({ code: 'not-found' });
    expect(mockReports.size).toBe(0);
  });

  it('keeps reportCount equal to accepted reports', async () => {
    mockPosts.set('community/post-1', { reportCount: 0, isHidden: false });

    await Promise.all([
      submit('post-1', 'reporter-1'),
      submit('post-1', 'reporter-2'),
      submit('post-1', 'reporter-3'),
    ]);

    const acceptedReports = [...mockReports.keys()].filter((path) =>
      path.startsWith('community/post-1/reports/'),
    );
    expect(mockPosts.get('community/post-1')?.reportCount).toBe(acceptedReports.length);
  });

  it('hides at the existing threshold of three, but not before it', async () => {
    mockPosts.set('community/post-1', { reportCount: 1, isHidden: false });
    await expect(submit('post-1', 'reporter-1')).resolves.toMatchObject({
      reportCount: 2,
      isHidden: false,
    });

    await expect(submit('post-1', 'reporter-2')).resolves.toMatchObject({
      reportCount: 3,
      isHidden: true,
    });
    expect(mockPosts.get('community/post-1')).toMatchObject({ reportCount: 3, isHidden: true });
  });
});
