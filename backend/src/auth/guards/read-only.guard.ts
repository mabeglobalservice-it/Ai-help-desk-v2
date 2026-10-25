import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  READ_ONLY_ACCESS_KEY,
  type ReadOnlyAccess,
} from '../decorators/read-only.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const READ_ONLY_FORBIDDEN_MESSAGE =
  'Compte de démonstration en lecture seule : action non autorisée';

// Compte de démonstration (User.isReadOnly) : les lectures passent, sauf
// celles marquées @DenyReadOnly() ; les écritures sont refusées, sauf celles
// marquées @AllowReadOnly(). Appelé par JwtAuthGuard juste après
// l'authentification — un APP_GUARD global s'exécuterait avant JwtAuthGuard
// et ne verrait pas encore req.user.
@Injectable()
export class ReadOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- même cas que roles.guard.ts : le cast est requis par `nest build`, voir le commentaire là-bas.
    const user = request.user as { isReadOnly?: boolean } | undefined;
    if (!user?.isReadOnly) {
      return true;
    }

    const access = this.reflector.getAllAndOverride<ReadOnlyAccess>(
      READ_ONLY_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (access === 'deny') {
      throw new ForbiddenException(READ_ONLY_FORBIDDEN_MESSAGE);
    }
    if (SAFE_METHODS.has(request.method) || access === 'allow') {
      return true;
    }
    throw new ForbiddenException(READ_ONLY_FORBIDDEN_MESSAGE);
  }
}
