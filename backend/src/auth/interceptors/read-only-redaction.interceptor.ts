import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';

export const MASKED_EMAIL = 'adresse masquée';

// Tickets, commentaires, pièces jointes, actifs et documents incluent l'email
// de leurs auteurs : plutôt que de bloquer ces lectures, indispensables à la
// démonstration, un compte en lecture seule les reçoit avec les emails des
// autres utilisateurs remplacés (le sien reste visible).
@Injectable()
export class ReadOnlyRedactionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- même cas que roles.guard.ts : le cast est requis par `nest build`, voir le commentaire là-bas.
    const user = request.user as
      { isReadOnly?: boolean; email?: string } | undefined;
    if (!user?.isReadOnly) {
      return next.handle();
    }
    return next
      .handle()
      .pipe(map((body: unknown) => redactEmails(body, user.email)));
  }
}

// Ne parcourt que les tableaux et objets littéraux (réponses Prisma) : Date,
// Buffer, StreamableFile, Decimal… sont renvoyés tels quels.
export function redactEmails(value: unknown, ownEmail?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactEmails(item, ownEmail));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [
      key,
      key === 'email' && typeof field === 'string' && field !== ownEmail
        ? MASKED_EMAIL
        : redactEmails(field, ownEmail),
    ]),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
