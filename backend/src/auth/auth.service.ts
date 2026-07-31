import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const REFRESH_TOKEN_BYTES = 64;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshTokenTtlMs(): number {
    const days = Number(
      this.configService.get<string>('REFRESH_TOKEN_EXPIRES_IN_DAYS', '30'),
    );
    return days * 24 * 60 * 60 * 1000;
  }

  // docs/08-schema-base-de-donnees.md refresh_tokens: le token brut n'est
  // jamais stocke, seul son hash SHA-256 l'est (comme un identifiant de
  // session opaque a haute entropie, pas un mot de passe a proteger contre
  // le brute-force — un hash rapide suffit).
  private async issueRefreshToken(userId: string): Promise<string> {
    const rawToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + this.refreshTokenTtlMs()),
      },
    });

    return rawToken;
  }

  private async issueTokenPair(user: {
    id: string;
    email: string;
    role: string;
  }) {
    const payload = { sub: user.id, email: user.email, role: user.role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.issueRefreshToken(user.id),
    ]);

    return { accessToken, refreshToken };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash || !user.isActive) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const tokens = await this.issueTokenPair(user);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    };
  }

  // Rotation: le refresh token presente est toujours revoque, qu'il soit
  // valide (rotation normale) ou deja invalide (aucun effet). Un nouveau
  // couple access/refresh token est emis uniquement si la validation reussit.
  async refresh(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !stored ||
      stored.revoked ||
      stored.expiresAt < new Date() ||
      !stored.user.isActive
    ) {
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });

    return this.issueTokenPair(stored.user);
  }

  // Revoque uniquement le refresh token fourni, appartenant a l'utilisateur
  // authentifie — les autres sessions/appareils restent actifs. Idempotent :
  // un token deja revoque, expire ou inconnu ne produit pas d'erreur, pour
  // que la deconnexion cote client reussisse toujours.
  async logout(userId: string, rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, userId },
      data: { revoked: true },
    });
  }

  // docs/08-schema-base-de-donnees.md §7: "Sessions / refresh_tokens
  // expirés — Purge automatique périodique (job planifié)". Safe to delete
  // outright rather than archive: refresh() rejects a purged token exactly
  // like a revoked-but-still-present one ("Refresh token invalide ou
  // expiré"), so purging doesn't change the outcome of a reuse attempt —
  // it only stops the table from growing unbounded.
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purgeExpiredRefreshTokens(): Promise<void> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { OR: [{ revoked: true }, { expiresAt: { lt: new Date() } }] },
    });

    if (count > 0) {
      this.logger.log(`Purged ${count} expired/revoked refresh token(s)`);
    }
  }
}
