import { ChatNotificationsService } from './chat-notifications.service';

// docs/02-brd.md BR-12 : notifications Teams/Slack via webhooks entrants.
describe('ChatNotificationsService', () => {
  const originalEnv = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('sends nothing when neither webhook is configured', async () => {
    delete process.env.TEAMS_WEBHOOK_URL;
    delete process.env.SLACK_WEBHOOK_URL;
    const service = new ChatNotificationsService();

    await service.sendNotification({ message: 'Ticket assigné' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a MessageCard to the configured Teams webhook', async () => {
    process.env.TEAMS_WEBHOOK_URL = 'https://teams.example.com/webhook';
    delete process.env.SLACK_WEBHOOK_URL;
    const service = new ChatNotificationsService();

    await service.sendNotification({
      message: 'Ticket assigné',
      ticketUrl: 'https://app.example.com/tickets/1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://teams.example.com/webhook');
    const body = JSON.parse(options.body);
    expect(body['@type']).toBe('MessageCard');
    expect(body.text).toContain('Ticket assigné');
    expect(body.text).toContain('https://app.example.com/tickets/1');
  });

  it('posts a text payload to the configured Slack webhook', async () => {
    delete process.env.TEAMS_WEBHOOK_URL;
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/xyz';
    const service = new ChatNotificationsService();

    await service.sendNotification({ message: 'SLA dépassé' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/services/xyz');
    const body = JSON.parse(options.body);
    expect(body.text).toBe('SLA dépassé');
  });

  it('does not throw when the webhook call fails', async () => {
    process.env.TEAMS_WEBHOOK_URL = 'https://teams.example.com/webhook';
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/xyz';
    fetchMock.mockRejectedValue(new Error('network down'));
    const service = new ChatNotificationsService();

    await expect(
      service.sendNotification({ message: 'Ticket assigné' }),
    ).resolves.toBeUndefined();
  });

  it('logs but does not throw when the webhook responds with a non-2xx status', async () => {
    process.env.TEAMS_WEBHOOK_URL = 'https://teams.example.com/webhook';
    delete process.env.SLACK_WEBHOOK_URL;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('bad request'),
    });
    const service = new ChatNotificationsService();

    await expect(
      service.sendNotification({ message: 'Ticket assigné' }),
    ).resolves.toBeUndefined();
  });
});
