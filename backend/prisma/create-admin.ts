import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '../generated/prisma/client';

// docs/06-cas-utilisation.md UC-031 (gestion des utilisateurs), README
// section "Déploiement (Render)" : sur une base neuve, POST /users exige
// déjà un ADMIN authentifié (RolesGuard) — aucun premier compte n'est donc
// créable depuis l'application elle-même. Ce script est le seul moyen de
// bootstrap : il lit ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_DISPLAY_NAME dans
// l'environnement et crée un unique compte ADMIN réel, avec le même hachage
// (bcrypt, SALT_ROUNDS=10) que UsersService.create() — voir
// src/users/users.service.ts.
//
// Idempotent par construction : si un ADMIN existe déjà en base (quel que
// soit son email), le script s'arrête sans rien créer ni modifier. Il ne
// peut donc jamais écraser un admin existant par erreur, y compris si on le
// relance après un redéploiement ou par erreur avec des variables
// différentes.
const SALT_ROUNDS = 10;

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_DISPLAY_NAME || 'Administrateur';

  if (!email || !password) {
    throw new Error(
      'ADMIN_EMAIL et ADMIN_PASSWORD doivent être définies dans l\'environnement pour créer le premier compte Admin.',
    );
  }
  // Même règle que CreateUserDto (src/users/dto/create-user.dto.ts) —
  // évite de créer un admin avec un mot de passe trivial par erreur de copier-coller.
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD doit contenir au moins 8 caractères.');
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const existingAdminCount = await prisma.user.count({
      where: { role: Role.ADMIN },
    });
    if (existingAdminCount > 0) {
      console.log(
        `Un compte Admin existe déjà (${existingAdminCount}) — aucune action effectuée. ` +
          'Pour créer un utilisateur supplémentaire, connectez-vous en tant qu\'Admin et utilisez POST /users.',
      );
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const admin = await prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        role: Role.ADMIN,
        isActive: true,
      },
    });
    console.log(`Compte Admin créé : ${admin.email} (id ${admin.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
