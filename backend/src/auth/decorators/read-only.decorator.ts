import { SetMetadata } from '@nestjs/common';

// Compte en lecture seule (User.isReadOnly) — voir guards/read-only.guard.ts.
export const READ_ONLY_ACCESS_KEY = 'readOnlyAccess';

export type ReadOnlyAccess = 'allow' | 'deny';

// Route d'écriture autorisée malgré tout (ex. diagnostic IA, déconnexion).
export const AllowReadOnly = () =>
  SetMetadata(READ_ONLY_ACCESS_KEY, 'allow' satisfies ReadOnlyAccess);

// Lecture refusée car elle expose des données sensibles (emails réels,
// journal d'audit, configuration système, fournisseurs d'IA).
export const DenyReadOnly = () =>
  SetMetadata(READ_ONLY_ACCESS_KEY, 'deny' satisfies ReadOnlyAccess);
