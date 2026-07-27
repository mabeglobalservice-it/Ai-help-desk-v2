import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Categories: cf. docs/docs/05-user-stories.md, US-12
const categories = ['Réseau', 'Matériel', 'Logiciel', 'Accès'];

// Priorities: cf. docs/docs/06-cas-utilisation.md, section "Gérer les SLA"
const priorities = [
  { name: 'Faible', level: 1 },
  { name: 'Moyenne', level: 2 },
  { name: 'Urgente', level: 3 },
];

async function main() {
  for (const name of categories) {
    await prisma.ticketCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  for (const priority of priorities) {
    await prisma.priority.upsert({
      where: { name: priority.name },
      update: {},
      create: priority,
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
