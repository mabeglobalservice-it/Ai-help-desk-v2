import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // docs/11-documentation-api.md §14: rate limiting en priorite sur /auth/*
  // — surtout ici, seule route non authentifiee et devinable par bruteforce
  // (email + mot de passe).
  @ApiOperation({ summary: "S'authentifier avec email et mot de passe" })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.email, loginDto.password);
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
    summary: "Émet un nouveau JWT à partir d'un refresh token valide",
  })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @ApiOperation({ summary: 'Révoque le refresh token courant' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.authService.logout(requester.userId, dto.refreshToken);
  }
}
