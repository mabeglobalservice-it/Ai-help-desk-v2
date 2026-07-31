import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../../generated/prisma/client';

jest.mock('bcrypt', () => ({ compare: jest.fn() }));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock };
    refreshToken: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let jwtService: { signAsync: jest.Mock };

  const activeUser = {
    id: 'user-1',
    email: 'employee@test.com',
    displayName: 'Test Employee',
    role: Role.EMPLOYEE,
    passwordHash: 'hashed',
    isActive: true,
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('30') },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    jest.clearAllMocks();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  describe('login', () => {
    it('rejects an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login('nobody@test.com', 'whatever'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a user with no password set (SSO-only account)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        passwordHash: null,
      });

      await expect(service.login(activeUser.email, 'whatever')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an inactive user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        isActive: false,
      });

      await expect(service.login(activeUser.email, 'whatever')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(activeUser.email, 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns tokens and the safe user profile on success', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);

      const result = await service.login(activeUser.email, 'correct');

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(typeof result.refreshToken).toBe('string');
      expect(result.user).toEqual({
        id: activeUser.id,
        email: activeUser.email,
        displayName: activeUser.displayName,
        role: activeUser.role,
      });
      // the raw password hash must never leak into the response
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: activeUser.id }),
        }),
      );
    });
  });

  describe('refresh', () => {
    const storedToken = {
      id: 'rt-1',
      revoked: false,
      expiresAt: new Date(Date.now() + 60_000),
      user: activeUser,
    };

    it('rejects an unknown token', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(service.refresh('bogus')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an already-revoked token', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        ...storedToken,
        revoked: true,
      });

      await expect(service.refresh('used-already')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired token', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        ...storedToken,
        expiresAt: new Date(Date.now() - 1_000),
      });

      await expect(service.refresh('expired')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token belonging to a now-inactive user', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        ...storedToken,
        user: { ...activeUser, isActive: false },
      });

      await expect(service.refresh('valid-but-deactivated')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rotates the token: revokes the presented one and issues a fresh pair', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(storedToken);

      const result = await service.refresh('valid-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revoked: true },
      });
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(typeof result.refreshToken).toBe('string');
    });
  });

  describe('logout', () => {
    it('revokes only the matching token for that user, and never throws', async () => {
      await expect(
        service.logout('user-1', 'some-token'),
      ).resolves.toBeUndefined();

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: expect.any(String), userId: 'user-1' },
        data: { revoked: true },
      });
    });
  });

  // docs/08-schema-base-de-donnees.md §7: purge automatique des sessions/
  // refresh_tokens expirés
  describe('purgeExpiredRefreshTokens', () => {
    it('deletes tokens that are revoked or past their expiry', async () => {
      await service.purgeExpiredRefreshTokens();

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [{ revoked: true }, { expiresAt: { lt: expect.any(Date) } }],
        },
      });
    });

    it('never throws, even if nothing needed purging', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.purgeExpiredRefreshTokens(),
      ).resolves.toBeUndefined();
    });
  });
});
