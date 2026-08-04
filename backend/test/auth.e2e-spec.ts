import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../generated/prisma/client';

// docs/07 §9 : le refresh token voyage exclusivement via un cookie httpOnly
// scope a /auth, jamais dans le corps JSON ni lisible par du JS cote client.
function extractRefreshTokenCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as
    string[] | undefined;
  const raw = setCookie?.find((c) => c.startsWith('refreshToken='));
  if (!raw) throw new Error('refreshToken cookie not set');
  return raw;
}

// Critical-path e2e coverage for auth: real HTTP round-trip through the
// JwtAuthGuard/RolesGuard/ThrottlerGuard stack registered on AppModule,
// which unit tests on AuthService alone can't exercise.
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const activeEmail = 'e2e-active-employee@test.com';
  const inactiveEmail = 'e2e-inactive-employee@test.com';
  const password = 'CorrectHorseBattery1!';

  let activeUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    const passwordHash = await bcrypt.hash(password, 10);

    const activeUser = await prisma.user.create({
      data: {
        email: activeEmail,
        passwordHash,
        displayName: 'E2E Active Employee',
        role: Role.EMPLOYEE,
        isActive: true,
      },
    });
    activeUserId = activeUser.id;

    await prisma.user.create({
      data: {
        email: inactiveEmail,
        passwordHash,
        displayName: 'E2E Inactive Employee',
        role: Role.EMPLOYEE,
        isActive: false,
      },
    });
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: [activeEmail, inactiveEmail] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [activeEmail, inactiveEmail] } },
    });
    // @nestjs/schedule never stops its registered cron jobs on app.close()
    // (SLA breach check, refresh-token purge) — their timers otherwise keep
    // the process alive past teardown, which can make Jest force-exit a
    // worker mid-test and corrupt shared DB state for whichever e2e file
    // was running at the time.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) {
      await job.stop();
    }
    await app.close();
  });

  it('rejects a login with the wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: activeEmail, password: 'wrong-password' })
      .expect(401);
  });

  it('rejects a login for a deactivated account', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: inactiveEmail, password })
      .expect(401);
  });

  let accessToken: string;
  let refreshTokenCookie: string;

  it('logs in successfully, returns an access token and sets an httpOnly refresh cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: activeEmail, password })
      .expect(200);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.user).toEqual(
      expect.objectContaining({ id: activeUserId, email: activeEmail }),
    );

    refreshTokenCookie = extractRefreshTokenCookie(res);
    expect(refreshTokenCookie).toContain('HttpOnly');
    expect(refreshTokenCookie).toContain('Path=/auth');

    accessToken = res.body.accessToken;
  });

  it('rejects /auth/me without a bearer token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('returns the current user for /auth/me with a valid bearer token', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({ userId: activeUserId, role: Role.EMPLOYEE }),
    );
  });

  it('rejects /auth/refresh without a refresh cookie', async () => {
    await request(app.getHttpServer()).post('/auth/refresh').expect(401);
  });

  let rotatedRefreshTokenCookie: string;

  it('rotates the refresh token cookie on /auth/refresh', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', refreshTokenCookie)
      .expect(200);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toBeUndefined();

    rotatedRefreshTokenCookie = extractRefreshTokenCookie(res);
    expect(rotatedRefreshTokenCookie).not.toBe(refreshTokenCookie);
  });

  it('rejects reusing a refresh token that was already rotated', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', refreshTokenCookie)
      .expect(401);
  });

  it('revokes the refresh token on logout, after which it can no longer be used', async () => {
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', rotatedRefreshTokenCookie)
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', rotatedRefreshTokenCookie)
      .expect(401);
  });
});
