import { EmailService } from './email.service';

// docs/11-documentation-api.md §12 (GET/PATCH /admin/integrations,
// GET/PATCH /admin/settings). Resend itself isn't mocked here (no network
// call is made unless RESEND_API_KEY is set — which these tests never do)
// so these exercise only the guard clauses, not the actual send.
describe('EmailService', () => {
  let prisma: {
    integrationConfig: { findUnique: jest.Mock };
    systemSettings: { findUnique: jest.Mock };
  };
  const originalEnv = { ...process.env };

  function buildService(): EmailService {
    return new EmailService(prisma as any);
  }

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    prisma = {
      integrationConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      systemSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does nothing when RESEND_API_KEY is absent, without querying the integration toggle', async () => {
    const service = buildService();

    await service.sendNotificationEmail({
      to: 'employee@test.com',
      displayName: 'Employee',
      type: 'TICKET_ASSIGNED',
      message: 'Un ticket vous a été assigné',
    });

    expect(prisma.integrationConfig.findUnique).not.toHaveBeenCalled();
  });
});
