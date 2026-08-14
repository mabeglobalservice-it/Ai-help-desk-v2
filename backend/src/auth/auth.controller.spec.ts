import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// docs/14-plan-deploiement-cloud.md §2 : en production (Render), frontend
// et backend sont deux sous-domaines *.onrender.com distincts — des "sites"
// différents au sens moderne (Public Suffix List), contrairement au dev
// local où les deux tournent sur localhost. Le cookie refreshToken doit
// donc avoir des attributs SameSite/Secure différents selon l'environnement
// pour continuer à être envoyé sur les appels credentialed cross-site vers
// /auth/refresh, sans quoi le rafraîchissement du token échoue
// silencieusement en production (voir setRefreshTokenCookie).
describe('AuthController — attributs du cookie refreshToken', () => {
  let controller: AuthController;
  let authService: { login: jest.Mock };
  let res: { cookie: jest.Mock };
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    authService = {
      login: jest.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-1' },
      }),
    };
    res = { cookie: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('30') },
        },
      ],
    }).compile();

    controller = module.get(AuthController);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('uses SameSite=lax and Secure=false in development (same-site localhost)', async () => {
    process.env.NODE_ENV = 'development';

    await controller.login({ email: 'a@test.com', password: 'x' }, res as any);

    expect(res.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'refresh-token',
      expect.objectContaining({ sameSite: 'lax', secure: false }),
    );
  });

  it('uses SameSite=none and Secure=true in production (cross-site *.onrender.com)', async () => {
    process.env.NODE_ENV = 'production';

    await controller.login({ email: 'a@test.com', password: 'x' }, res as any);

    expect(res.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'refresh-token',
      expect.objectContaining({ sameSite: 'none', secure: true }),
    );
  });
});
