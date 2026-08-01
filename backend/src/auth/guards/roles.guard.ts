import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Role } from '../../../generated/prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- ESLint's type-aware pass (tsconfig.json, includes test/*.spec.ts) resolves request.user more loosely than `nest build` (tsconfig.build.json, excludes them), so it flags this cast as redundant and strips it on --fix, which then fails the real build.
    const user = request.user as { role?: Role } | undefined;

    return !!user?.role && requiredRoles.includes(user.role);
  }
}
