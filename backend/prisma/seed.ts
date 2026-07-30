import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Categories: cf. docs/docs/05-user-stories.md, US-12
const categories = ['Réseau', 'Matériel', 'Logiciel', 'Accès'];

// Priorities: cf. docs/docs/06-cas-utilisation.md, section "Gérer les SLA"
const priorities = [
  { name: 'Faible', level: 1, slaResolutionHours: 72 },
  { name: 'Moyenne', level: 2, slaResolutionHours: 24 },
  { name: 'Urgente', level: 3, slaResolutionHours: 4 },
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
    const created = await prisma.priority.upsert({
      where: { name: priority.name },
      update: {},
      create: { name: priority.name, level: priority.level },
    });

    await prisma.slaPolicy.upsert({
      where: { priorityId: created.id },
      update: { resolutionHours: priority.slaResolutionHours },
      create: {
        priorityId: created.id,
        resolutionHours: priority.slaResolutionHours,
      },
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
