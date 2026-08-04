import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const REFRESH_TOKEN_COOKIE = 'refreshToken';
// docs/07 §9 : le refresh token ne doit jamais etre lisible par du JS
// (cookie httpOnly). Le path est restreint au prefixe /auth (sous /api/v1,
// docs/11 §1) pour ne pas etre renvoye sur chaque requete API.
const REFRESH_TOKEN_PATH = '/api/v1/auth';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private refreshTokenMaxAgeMs(): number {
    const days = Number(
      this.configService.get<string>('REFRESH_TOKEN_EXPIRES_IN_DAYS', '30'),
    );
    return days * 24 * 60 * 60 * 1000;
  }

  private setRefreshTokenCookie(res: Response, refreshToken: string): void {
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: REFRESH_TOKEN_PATH,
      maxAge: this.refreshTokenMaxAgeMs(),
    });
  }

  // docs/11-documentation-api.md §14: rate limiting en priorite sur /auth/*
  // — surtout ici, seule route non authentifiee et devinable par bruteforce
  // (email + mot de passe).
  @ApiOperation({ summary: "S'authentifier avec email et mot de passe" })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...result } = await this.authService.login(
      loginDto.email,
      loginDto.password,
    );
    this.setRefreshTokenCookie(res, refreshToken);
    return result;
  }

  @ApiOperation({ summary: "Retourne l'identité de l'utilisateur courant" })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request) {
    return req.user;
  }

  // Refresh tokens are high-entropy (unguessable by brute force), so this
  // is a moderate cap against abuse rather than a strict anti-bruteforce
  // limit like login's.
  @ApiOperation({
    summary:
      'Émet un nouveau JWT à partir du refresh token stocké en cookie httpOnly',
  })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[REFRESH_TOKEN_COOKIE];
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token manquant');
    }
    const { refreshToken: rotated, ...result } =
      await this.authService.refresh(refreshToken);
    this.setRefreshTokenCookie(res, rotated);
    return result;
  }

  @ApiOperation({ summary: 'Révoque le refresh token courant' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const requester = req.user as { userId: string };
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[REFRESH_TOKEN_COOKIE];
    if (refreshToken) {
      await this.authService.logout(requester.userId, refreshToken);
    }
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_TOKEN_PATH });
  }
}
