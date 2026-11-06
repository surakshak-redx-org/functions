import { sendOneSignalPush } from '../src/utils/onesignal';

const fetchMock = jest.fn();

describe('sendOneSignalPush', () => {
  beforeEach(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const push = {
    appId: 'app-id',
    apiKey: 'rest-key',
    externalIds: ['user-1'],
    title: 'Title',
    body: 'Body',
    data: { type: 'safe_journey' },
  };

  it('targets the external id with the REST key and returns the notification id', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'n1' }),
    });

    await expect(sendOneSignalPush(push)).resolves.toBe('n1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api.onesignal.com/notifications');
    expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'Key rest-key' }));
    expect(JSON.parse(init.body as string)).toEqual(
      expect.objectContaining({
        app_id: 'app-id',
        include_aliases: { external_id: ['user-1'] },
        headings: { en: 'Title' },
        contents: { en: 'Body' },
        data: { type: 'safe_journey' },
      }),
    );
  });

  it('throws when OneSignal reports errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ errors: ['All included players are not subscribed'] }),
    });

    await expect(sendOneSignalPush(push)).rejects.toThrow('OneSignal push failed');
  });

  it('throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) });

    await expect(sendOneSignalPush(push)).rejects.toThrow('(401)');
  });
});
