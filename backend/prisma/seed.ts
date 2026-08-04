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

// CI types: cf. docs/docs/08-schema-base-de-donnees.md, section 4.3
const ciTypes = [
  'Poste de travail',
  'Serveur',
  'Application',
  'Base de données',
  'Équipement réseau',
  'Licence',
  'Service métier',
];

// docs/09-architecture-agents-ia.md §3, docs/11-documentation-api.md §6 :
// registre des agents IA, activés par défaut.
const aiAgents = [
  {
    name: 'DIAGNOSTIC',
    description:
      "Analyse la description d'un ticket pour suggérer titre, catégorie et priorité.",
  },
  {
    name: 'DOCUMENTATION',
    description:
      "Propose un article de base de connaissances à partir d'un ticket résolu.",
  },
  {
    name: 'AUTOMATION',
    description:
      "Prépare une suggestion de script d'automatisation à partir du contexte d'un ticket.",
  },
  {
    name: 'SUPERVISOR',
    description:
      'Analyse les tendances de pannes par modèle de CI pour le superviseur (US-27).',
  },
  {
    name: 'INVENTORY',
    description:
      "Répond aux questions sur les actifs (garantie, licence, historique) — lecture seule.",
  },
  {
    name: 'HELPDESK',
    description:
      "Dialogue conversationnel avec l'employé (docs/09 §3.2) : pose des questions de clarification, propose une cause probable et des étapes de résolution avant la création d'un ticket.",
  },
  {
    name: 'TECHNICIAN',
    description:
      "Assiste uniquement les techniciens (docs/09 §3.3) : explique une panne, une commande ou un script à partir du contexte du ticket, de l'historique CMDB de l'actif et de la base documentaire — suggère un script à titre indicatif, ne l'exécute jamais.",
  },
] as const;

// docs/11-documentation-api.md §6 : un seul fournisseur actif à la fois.
const aiProviders = [
  { provider: 'CLAUDE', isActive: true },
  { provider: 'OPENAI', isActive: false },
  { provider: 'AZURE_OPENAI', isActive: false },
] as const;

// docs/11-documentation-api.md §12 (GET/PATCH /admin/integrations) :
// activées par défaut — les webhooks/clés réels restent lus depuis les
// variables d'environnement, seule l'activation est stockée ici.
const integrations = [
  { name: 'TEAMS', isEnabled: true },
  { name: 'SLACK', isEnabled: true },
  { name: 'EMAIL', isEnabled: true },
] as const;

async function main() {
  for (const name of categories) {
    await prisma.ticketCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  for (const name of ciTypes) {
    await prisma.ciType.upsert({
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

  for (const agent of aiAgents) {
    await prisma.aiAgent.upsert({
      where: { name: agent.name },
      update: { description: agent.description },
      create: agent,
    });
  }

  for (const providerConfig of aiProviders) {
    await prisma.aiProviderConfig.upsert({
      where: { provider: providerConfig.provider },
      update: {},
      create: providerConfig,
    });
  }

  for (const integration of integrations) {
    await prisma.integrationConfig.upsert({
      where: { name: integration.name },
      update: {},
      create: integration,
    });
  }

  await prisma.systemSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
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
