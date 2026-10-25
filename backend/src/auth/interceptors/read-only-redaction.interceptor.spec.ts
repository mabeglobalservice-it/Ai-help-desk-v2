import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import {
  MASKED_EMAIL,
  ReadOnlyRedactionInterceptor,
  redactEmails,
} from './read-only-redaction.interceptor';

describe('redactEmails', () => {
  it('masks nested emails of other users but keeps the requester own email', () => {
    const createdAt = new Date('2026-10-01T10:00:00Z');
    const body = [
      {
        id: 't1',
        createdAt,
        employee: { id: 'u1', email: 'someone@corp.example' },
        comments: [{ author: { email: 'demo@demo.example' } }],
      },
    ];

    expect(redactEmails(body, 'demo@demo.example')).toEqual([
      {
        id: 't1',
        createdAt,
        employee: { id: 'u1', email: MASKED_EMAIL },
        comments: [{ author: { email: 'demo@demo.example' } }],
      },
    ]);
  });

  it('returns non-plain values (Date, Buffer) unchanged', () => {
    const buffer = Buffer.from('pdf');
    expect(redactEmails(buffer)).toBe(buffer);
  });
});

describe('ReadOnlyRedactionInterceptor', () => {
  const interceptor = new ReadOnlyRedactionInterceptor();
  const run = (user: object | undefined, body: unknown) =>
    lastValueFrom(
      interceptor.intercept(
        {
          switchToHttp: () => ({ getRequest: () => ({ user }) }),
        } as unknown as ExecutionContext,
        { handle: () => of(body) } as CallHandler,
      ),
    );

  it('leaves responses untouched for regular users', async () => {
    const body = { email: 'someone@corp.example' };
    await expect(run({ isReadOnly: false }, body)).resolves.toBe(body);
  });

  it('masks emails for read-only accounts', async () => {
    await expect(
      run(
        { isReadOnly: true, email: 'demo@demo.example' },
        { email: 'someone@corp.example' },
      ),
    ).resolves.toEqual({ email: MASKED_EMAIL });
  });
});
