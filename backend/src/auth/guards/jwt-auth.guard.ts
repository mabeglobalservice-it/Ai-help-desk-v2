import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ReadOnlyGuard } from './read-only.guard';

// Toute route authentifiée passe par ce garde : la restriction des comptes
// en lecture seule y est donc appliquée partout, sans dépendre d'un
// @UseGuards() supplémentaire sur chaque contrôleur.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly readOnlyGuard: ReadOnlyGuard;

  constructor(reflector: Reflector) {
    super();
    this.readOnlyGuard = new ReadOnlyGuard(reflector);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean;
    return authenticated && this.readOnlyGuard.canActivate(context);
  }
}
