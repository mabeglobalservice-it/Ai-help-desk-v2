import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  Role,
  TicketStatus,
  Criticality,
} from '../generated/prisma/client';
import { chunkText } from '../src/knowledge/rag/chunking.util';
import { embedWithProvider } from '../src/knowledge/rag/embedding.util';

// Données de démonstration (comptes, équipes, actifs, tickets, base de
// connaissances) pour une base de production vide — distinct de seed.ts,
// qui ne contient que les données de référence indispensables. Toutes les
// données sont fictives et reconnaissables : comptes en @demo.example
// (domaine réservé, RFC 2606), numéros d'inventaire en DEMO-.
//
// Prérequis : `npm run prisma:seed` (catégories, priorités, types de CI) et
// `npm run create-admin` (l'Admin est l'auteur des documents internes).
//
// Idempotent : chaque entité est retrouvée par une clé stable avant d'être
// créée, et les tickets ne sont créés que si aucun ticket de démonstration
// n'existe déjà. Relancer le script ne crée donc pas de doublons et ne
// modifie aucune donnée réelle (seuls les comptes @demo.example sont
// touchés). L'indexation RAG reprend exactement le format de
// KnowledgeService (indexResolvedTicket, indexApprovedArticle,
// indexDocumentContent) : définir VOYAGE_API_KEY comme en production, sinon
// les vecteurs ne seront pas comparables à ceux de l'application.
const SALT_ROUNDS = 10;
const DEMO_DOMAIN = 'demo.example';

const departments = ['Finance', 'Ressources humaines', 'Ventes'];

const locations = [
  { name: 'Siège social (démo)', address: 'Adresse fictive — démonstration' },
  {
    name: 'Bureau régional (démo)',
    address: 'Adresse fictive — démonstration',
  },
];

// Une équipe par catégorie, pour l'assignation automatique par spécialité
// (TicketsService.findLeastLoadedTechnician).
const teams = [
  { name: 'Équipe Réseau', category: 'Réseau' },
  { name: 'Équipe Postes de travail', category: 'Matériel' },
  { name: 'Équipe Applications', category: 'Logiciel' },
  { name: 'Équipe Accès et identités', category: 'Accès' },
];

type DemoUser = {
  key: string;
  displayName: string;
  role: Role;
  team?: string;
  department?: string;
  specialties?: string[];
  canApproveAutomations?: boolean;
};

const users: DemoUser[] = [
  {
    key: 'superviseur',
    displayName: 'Sophie Tremblay (démo)',
    role: Role.SUPERVISOR,
  },
  {
    key: 'tech.reseau',
    displayName: 'Marc Gagnon (démo)',
    role: Role.TECHNICIAN,
    team: 'Équipe Réseau',
    specialties: ['Réseau'],
    canApproveAutomations: true,
  },
  {
    key: 'tech.postes',
    displayName: 'Julie Roy (démo)',
    role: Role.TECHNICIAN,
    team: 'Équipe Postes de travail',
    specialties: ['Matériel'],
  },
  {
    key: 'tech.applications',
    displayName: 'Karim Benali (démo)',
    role: Role.TECHNICIAN,
    team: 'Équipe Applications',
    specialties: ['Logiciel'],
  },
  {
    key: 'tech.acces',
    displayName: 'Émilie Côté (démo)',
    role: Role.TECHNICIAN,
    team: 'Équipe Accès et identités',
    specialties: ['Accès', 'Logiciel'],
  },
  {
    key: 'employe.finance',
    displayName: 'Luc Bouchard (démo)',
    role: Role.EMPLOYEE,
    department: 'Finance',
  },
  {
    key: 'employe.rh',
    displayName: 'Nadia Pelletier (démo)',
    role: Role.EMPLOYEE,
    department: 'Ressources humaines',
  },
  {
    key: 'employe.ventes',
    displayName: 'Thomas Lavoie (démo)',
    role: Role.EMPLOYEE,
    department: 'Ventes',
  },
  {
    key: 'employe.ventes2',
    displayName: 'Camille Morin (démo)',
    role: Role.EMPLOYEE,
    department: 'Ventes',
  },
];

const configurationItems = [
  {
    inventoryNumber: 'DEMO-PC-001',
    name: 'Portable Luc Bouchard',
    type: 'Poste de travail',
    criticality: Criticality.MEDIUM,
  },
  {
    inventoryNumber: 'DEMO-PC-002',
    name: 'Portable Nadia Pelletier',
    type: 'Poste de travail',
    criticality: Criticality.MEDIUM,
  },
  {
    inventoryNumber: 'DEMO-PC-003',
    name: 'Portable Thomas Lavoie',
    type: 'Poste de travail',
    criticality: Criticality.LOW,
  },
  {
    inventoryNumber: 'DEMO-SRV-001',
    name: 'Serveur de fichiers',
    type: 'Serveur',
    criticality: Criticality.HIGH,
  },
  {
    inventoryNumber: 'DEMO-NET-001',
    name: 'Borne Wi-Fi étage 2',
    type: 'Équipement réseau',
    criticality: Criticality.MEDIUM,
  },
  {
    inventoryNumber: 'DEMO-APP-001',
    name: 'ERP Finance',
    type: 'Application',
    criticality: Criticality.CRITICAL,
  },
];

type DemoTicket = {
  title: string;
  summary: string;
  category: string;
  priority: string;
  employee: string;
  technician?: string;
  ci?: string;
  status: TicketStatus;
  createdDaysAgo: number;
  // Délai de résolution en heures (tickets RESOLVED uniquement).
  resolvedAfterHours?: number;
  resolutionNote?: string;
  rating?: number;
  comment?: { author: string; content: string };
};

// Répartis sur les 30 derniers jours pour alimenter le tableau de bord
// (période par défaut : 30 jours) et ses tendances.
const tickets: DemoTicket[] = [
  {
    title: 'Wi-Fi instable au 2e étage',
    summary:
      'La connexion Wi-Fi coupe plusieurs fois par heure dans la salle de réunion du 2e étage.',
    category: 'Réseau',
    priority: 'Moyenne',
    employee: 'employe.ventes',
    technician: 'tech.reseau',
    ci: 'DEMO-NET-001',
    status: TicketStatus.RESOLVED,
    createdDaysAgo: 27,
    resolvedAfterHours: 6,
    resolutionNote:
      'Canal de la borne changé (interférences avec un réseau voisin) et micrologiciel mis à jour.',
    rating: 5,
  },
  {
    title: 'Impossible de se connecter au VPN',
    summary:
      "Le client VPN affiche « échec d'authentification » depuis ce matin, en télétravail.",
    category: 'Accès',
    priority: 'Urgente',
    employee: 'employe.finance',
    technician: 'tech.acces',
    status: TicketStatus.RESOLVED,
    createdDaysAgo: 24,
    resolvedAfterHours: 2,
    resolutionNote:
      'Mot de passe expiré : réinitialisation, puis reconnexion du client VPN.',
    rating: 4,
  },
  {
    title: "L'ERP Finance est très lent",
    summary:
      "Les écrans de saisie des factures mettent plus de 30 secondes à s'ouvrir.",
    category: 'Logiciel',
    priority: 'Urgente',
    employee: 'employe.finance',
    technician: 'tech.applications',
    ci: 'DEMO-APP-001',
    status: TicketStatus.RESOLVED,
    createdDaysAgo: 21,
    resolvedAfterHours: 5,
    resolutionNote:
      "Index de base de données reconstruits pendant la nuit ; temps d'ouverture revenu sous 2 secondes.",
    rating: 4,
  },
  {
    title: 'Écran du portable qui scintille',
    summary: "L'écran scintille quand on incline le couvercle.",
    category: 'Matériel',
    priority: 'Faible',
    employee: 'employe.rh',
    technician: 'tech.postes',
    ci: 'DEMO-PC-002',
    status: TicketStatus.RESOLVED,
    createdDaysAgo: 19,
    resolvedAfterHours: 40,
    resolutionNote: "Nappe d'écran remplacée sous garantie.",
    rating: 5,
  },
  {
    title: 'Accès au dossier partagé RH refusé',
    summary:
      "Nouvelle arrivée dans l'équipe RH, pas d'accès au dossier partagé « Recrutement ».",
    category: 'Accès',
    priority: 'Moyenne',
    employee: 'employe.rh',
    technician: 'tech.acces',
    ci: 'DEMO-SRV-001',
    status: TicketStatus.RESOLVED,
    createdDaysAgo: 15,
    resolvedAfterHours: 3,
    resolutionNote:
      'Ajout au groupe de sécurité « RH-Recrutement » après accord de la responsable.',
    rating: 5,
  },
  {
    title: 'Outlook ne synchronise plus le calendrier',
    summary:
      "Les rendez-vous créés sur le téléphone n'apparaissent pas dans Outlook.",
    category: 'Logiciel',
    priority: 'Faible',
    employee: 'employe.ventes2',
    technician: 'tech.applications',
    status: TicketStatus.RESOLVED,
    createdDaysAgo: 12,
    resolvedAfterHours: 20,
    resolutionNote: 'Profil Outlook recréé ; synchronisation rétablie.',
    rating: 3,
  },
  {
    title: 'Imprimante du 1er étage hors ligne',
    summary:
      "L'imprimante apparaît « hors ligne » pour tout le service des ventes.",
    category: 'Réseau',
    priority: 'Moyenne',
    employee: 'employe.ventes',
    technician: 'tech.reseau',
    status: TicketStatus.RESOLVED,
    createdDaysAgo: 8,
    resolvedAfterHours: 4,
    resolutionNote: "Bail DHCP expiré : adresse IP réservée pour l'imprimante.",
    rating: 4,
  },
  {
    title: 'Batterie du portable qui se décharge vite',
    summary: "La batterie tient moins d'une heure depuis la semaine dernière.",
    category: 'Matériel',
    priority: 'Faible',
    employee: 'employe.ventes',
    technician: 'tech.postes',
    ci: 'DEMO-PC-003',
    status: TicketStatus.IN_PROGRESS,
    createdDaysAgo: 5,
    comment: {
      author: 'tech.postes',
      content:
        'Diagnostic batterie lancé : capacité à 41 %. Remplacement commandé.',
    },
  },
  {
    title: "Erreur à l'export PDF des rapports ERP",
    summary:
      "L'export PDF des rapports mensuels échoue avec le message « Erreur 500 ».",
    category: 'Logiciel',
    priority: 'Moyenne',
    employee: 'employe.finance',
    technician: 'tech.applications',
    ci: 'DEMO-APP-001',
    status: TicketStatus.IN_PROGRESS,
    createdDaysAgo: 2,
    comment: {
      author: 'tech.applications',
      content:
        "Reproduit en test. Le service d'impression du serveur ERP est en cause, analyse en cours.",
    },
  },
  {
    title: 'Serveur de fichiers inaccessible',
    summary: 'Aucun employé ne peut ouvrir les lecteurs réseau depuis 8 h.',
    category: 'Réseau',
    priority: 'Urgente',
    employee: 'employe.rh',
    technician: 'tech.reseau',
    ci: 'DEMO-SRV-001',
    status: TicketStatus.ESCALATED,
    createdDaysAgo: 1,
    comment: {
      author: 'tech.reseau',
      content:
        'Panne disque probable sur le serveur. Escaladé au superviseur pour intervention du fournisseur.',
    },
  },
  {
    title: 'Demande de second écran',
    summary: "Besoin d'un second écran pour le poste de travail au bureau.",
    category: 'Matériel',
    priority: 'Faible',
    employee: 'employe.ventes2',
    status: TicketStatus.NEW,
    createdDaysAgo: 1,
  },
  {
    title: 'Compte bloqué après plusieurs tentatives',
    summary: 'Le compte est verrouillé après des erreurs de mot de passe.',
    category: 'Accès',
    priority: 'Moyenne',
    employee: 'employe.ventes',
    technician: 'tech.acces',
    status: TicketStatus.NEW,
    createdDaysAgo: 0,
  },
];

type DemoArticle = {
  ticketTitle: string;
  title: string;
  content: string;
  approved: boolean;
};

// Les articles approuvés alimentent la base de connaissances (niveau 2 du
// RAG) ; le dernier reste PROPOSED pour la page « Articles proposés ».
const articles: DemoArticle[] = [
  {
    ticketTitle: 'Impossible de se connecter au VPN',
    title: "VPN : échec d'authentification",
    content:
      "Symptôme : le client VPN refuse la connexion avec « échec d'authentification ».\n\n" +
      'Cause fréquente : mot de passe du compte expiré.\n\n' +
      "Résolution :\n1. Vérifier la date d'expiration du mot de passe dans l'annuaire.\n" +
      "2. Réinitialiser le mot de passe et demander à l'employé de le changer.\n" +
      '3. Supprimer les identifiants enregistrés dans le client VPN, puis se reconnecter.',
    approved: true,
  },
  {
    ticketTitle: 'Imprimante du 1er étage hors ligne',
    title: 'Imprimante réseau « hors ligne »',
    content:
      'Symptôme : une imprimante réseau apparaît hors ligne pour tout un service.\n\n' +
      "Cause fréquente : l'imprimante a changé d'adresse IP (bail DHCP expiré).\n\n" +
      "Résolution :\n1. Relever l'adresse IP actuelle sur le panneau de l'imprimante.\n" +
      "2. Créer une réservation DHCP pour son adresse MAC.\n3. Vérifier le port d'impression sur le serveur.",
    approved: true,
  },
  {
    ticketTitle: 'Accès au dossier partagé RH refusé',
    title: 'Donner accès à un dossier partagé',
    content:
      'Les accès aux dossiers partagés passent toujours par un groupe de sécurité, jamais par un droit individuel.\n\n' +
      "1. Obtenir l'accord écrit du responsable du dossier.\n2. Ajouter l'employé au groupe correspondant.\n" +
      '3. Lui demander de fermer puis rouvrir sa session.',
    approved: true,
  },
  {
    ticketTitle: 'Wi-Fi instable au 2e étage',
    title: 'Wi-Fi qui coupe dans une zone précise',
    content:
      'Symptôme : coupures Wi-Fi répétées dans une seule pièce.\n\n' +
      'Pistes : interférences avec un réseau voisin (changer de canal), micrologiciel de la borne obsolète.',
    approved: false,
  },
];

const internalDocuments = [
  {
    title: "Procédure d'accueil d'un nouvel employé (démo)",
    content:
      "Avant l'arrivée : créer le compte, l'ajouter aux groupes de son service, préparer le poste de travail.\n\n" +
      "Le premier jour : remettre le portable, faire changer le mot de passe initial, configurer l'authentification multifacteur.\n\n" +
      'Sous une semaine : vérifier les accès aux applications métier avec le responsable.',
  },
  {
    title: 'Politique de mots de passe (démo)',
    content:
      'Longueur minimale : 12 caractères. Expiration : 90 jours. Verrouillage après 5 tentatives échouées pendant 15 minutes.\n\n' +
      "Un technicien ne demande jamais le mot de passe d'un employé : il le réinitialise et l'employé le change à la connexion suivante.",
  },
];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const HOUR = 60 * 60 * 1000;
const email = (key: string) => `${key}@${DEMO_DOMAIN}`;

// Heure fixe (10 h) pour des tickets créés aux heures de bureau.
function daysAgo(days: number): Date {
  const date = new Date(Date.now() - days * 24 * HOUR);
  date.setHours(10, 0, 0, 0);
  return date.getTime() > Date.now() ? new Date(Date.now() - HOUR) : date;
}

async function main() {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error(
      'DEMO_PASSWORD doit être définie (au moins 8 caractères) : mot de passe commun des comptes de démonstration.',
    );
  }

  const admin = await prisma.user.findFirst({
    where: { role: Role.ADMIN },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) {
    throw new Error(
      "Aucun compte Admin : lancez d'abord `npm run create-admin`.",
    );
  }

  const categoryRows = await prisma.ticketCategory.findMany();
  const priorityRows = await prisma.priority.findMany({
    include: { slaPolicy: true },
  });
  const ciTypeRows = await prisma.ciType.findMany();
  if (
    categoryRows.length === 0 ||
    priorityRows.length === 0 ||
    ciTypeRows.length === 0
  ) {
    throw new Error(
      "Données de référence absentes : lancez d'abord `npm run prisma:seed`.",
    );
  }
  const categoryId = (name: string) => {
    const row = categoryRows.find((c) => c.name === name);
    if (!row) throw new Error(`Catégorie introuvable : ${name}`);
    return row.id;
  };
  const priorityOf = (name: string) => {
    const row = priorityRows.find((p) => p.name === name);
    if (!row) throw new Error(`Priorité introuvable : ${name}`);
    return row;
  };
  const ciTypeId = (name: string) => {
    const row = ciTypeRows.find((t) => t.name === name);
    if (!row) throw new Error(`Type de CI introuvable : ${name}`);
    return row.id;
  };

  const departmentIds = new Map<string, string>();
  for (const name of departments) {
    const row = await prisma.department.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    departmentIds.set(name, row.id);
  }

  const locationIds: string[] = [];
  for (const location of locations) {
    const row = await prisma.location.upsert({
      where: { name: location.name },
      update: {},
      create: location,
    });
    locationIds.push(row.id);
  }

  const teamIds = new Map<string, string>();
  for (const team of teams) {
    const row = await prisma.team.upsert({
      where: { name: team.name },
      update: {},
      create: { name: team.name, categoryId: categoryId(team.category) },
    });
    teamIds.set(team.name, row.id);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const userIds = new Map<string, string>();
  for (const user of users) {
    // update: {} — un compte de démo existant (mot de passe changé, rôle
    // ajusté par l'Admin) n'est jamais réécrit.
    const row = await prisma.user.upsert({
      where: { email: email(user.key) },
      update: {},
      create: {
        email: email(user.key),
        passwordHash,
        displayName: user.displayName,
        role: user.role,
        teamId: user.team ? teamIds.get(user.team) : undefined,
        departmentId: user.department
          ? departmentIds.get(user.department)
          : undefined,
        canApproveAutomations: user.canApproveAutomations ?? false,
      },
    });
    userIds.set(user.key, row.id);
    for (const specialty of user.specialties ?? []) {
      await prisma.technicianSpecialty.upsert({
        where: {
          userId_categoryId: {
            userId: row.id,
            categoryId: categoryId(specialty),
          },
        },
        update: {},
        create: { userId: row.id, categoryId: categoryId(specialty) },
      });
    }
  }
  const userId = (key: string) => {
    const id = userIds.get(key);
    if (!id) throw new Error(`Utilisateur de démo introuvable : ${key}`);
    return id;
  };

  const ciIds = new Map<string, string>();
  for (const [index, ci] of configurationItems.entries()) {
    const row = await prisma.configurationItem.upsert({
      where: { inventoryNumber: ci.inventoryNumber },
      update: {},
      create: {
        inventoryNumber: ci.inventoryNumber,
        name: ci.name,
        ciTypeId: ciTypeId(ci.type),
        criticality: ci.criticality,
        locationId: locationIds[index % locationIds.length],
      },
    });
    ciIds.set(ci.inventoryNumber, row.id);
  }

  const demoUserIds = [...userIds.values()];
  const existingDemoTickets = await prisma.ticket.count({
    where: { employeeId: { in: demoUserIds } },
  });
  const embeddingProviders = new Set<string>();
  let createdTickets = 0;

  if (existingDemoTickets > 0) {
    console.log(
      `${existingDemoTickets} ticket(s) de démonstration déjà présents : tickets et articles non recréés.`,
    );
  } else {
    const ticketIds = new Map<string, string>();
    // Créés du plus ancien au plus récent : les références suivent le même
    // schéma que TicketsService.generateReference (TCK-année-séquence).
    const ordered = [...tickets].sort(
      (a, b) => b.createdDaysAgo - a.createdDaysAgo,
    );
    for (const ticket of ordered) {
      const priority = priorityOf(ticket.priority);
      const createdAt = daysAgo(ticket.createdDaysAgo);
      const slaHours = priority.slaPolicy?.resolutionHours;
      const resolvedAt =
        ticket.status === TicketStatus.RESOLVED &&
        ticket.resolvedAfterHours !== undefined
          ? new Date(createdAt.getTime() + ticket.resolvedAfterHours * HOUR)
          : null;
      const sequence = String((await prisma.ticket.count()) + 1).padStart(
        4,
        '0',
      );
      const reference = `TCK-${new Date().getFullYear()}-${sequence}`;
      const technicianId = ticket.technician ? userId(ticket.technician) : null;

      const created = await prisma.ticket.create({
        data: {
          reference,
          title: ticket.title,
          summary: ticket.summary,
          employeeId: userId(ticket.employee),
          technicianId,
          categoryId: categoryId(ticket.category),
          priorityId: priority.id,
          ciId: ticket.ci ? ciIds.get(ticket.ci) : undefined,
          status: ticket.status,
          createdAt,
          slaDueAt: slaHours
            ? new Date(createdAt.getTime() + slaHours * HOUR)
            : null,
          resolvedAt,
          resolutionNote: ticket.resolutionNote,
          rating: ticket.rating,
          ratedAt:
            ticket.rating && resolvedAt
              ? new Date(resolvedAt.getTime() + HOUR)
              : undefined,
          // Suggestion IA identique au choix final : ticket issu du flux IA
          // sans correction manuelle (indicateur BR-07 du tableau de bord).
          aiSuggestedCategoryId: categoryId(ticket.category),
          aiSuggestedPriorityId: priority.id,
        },
      });
      ticketIds.set(ticket.title, created.id);
      createdTickets += 1;

      const history: {
        fromStatus: TicketStatus | null;
        toStatus: TicketStatus;
        changedById: string | null;
        changedAt: Date;
      }[] = [
        {
          fromStatus: null,
          toStatus: TicketStatus.NEW,
          changedById: userId(ticket.employee),
          changedAt: createdAt,
        },
      ];
      if (ticket.status !== TicketStatus.NEW && technicianId) {
        history.push({
          fromStatus: TicketStatus.NEW,
          toStatus: TicketStatus.IN_PROGRESS,
          changedById: technicianId,
          changedAt: new Date(createdAt.getTime() + 0.5 * HOUR),
        });
      }
      if (ticket.status === TicketStatus.RESOLVED && resolvedAt) {
        history.push({
          fromStatus: TicketStatus.IN_PROGRESS,
          toStatus: TicketStatus.RESOLVED,
          changedById: technicianId,
          changedAt: resolvedAt,
        });
      }
      if (ticket.status === TicketStatus.ESCALATED) {
        history.push({
          fromStatus: TicketStatus.IN_PROGRESS,
          toStatus: TicketStatus.ESCALATED,
          changedById: technicianId,
          changedAt: new Date(createdAt.getTime() + 2 * HOUR),
        });
      }
      await prisma.ticketStatusHistory.createMany({
        data: history.map((h) => ({ ...h, ticketId: created.id })),
      });

      if (ticket.comment) {
        await prisma.ticketComment.create({
          data: {
            ticketId: created.id,
            authorId: userId(ticket.comment.author),
            content: ticket.comment.content,
            createdAt: new Date(createdAt.getTime() + HOUR),
          },
        });
      }

      // Niveau 3 du RAG, même contenu que KnowledgeService.indexResolvedTicket.
      if (ticket.status === TicketStatus.RESOLVED) {
        const content = [created.title, created.summary, created.resolutionNote]
          .filter(Boolean)
          .join('\n\n');
        const { vector, provider } = await embedWithProvider(content);
        embeddingProviders.add(provider);
        await prisma.documentChunk.create({
          data: {
            ticketId: created.id,
            knowledgeLevel: 3,
            sourceLabel: reference,
            content,
            embedding: vector,
            embeddingProvider: provider,
          },
        });
      }
    }

    const supervisorId = userId('superviseur');
    for (const article of articles) {
      const ticketId = ticketIds.get(article.ticketTitle);
      if (!ticketId)
        throw new Error(
          `Ticket source introuvable pour l'article : ${article.title}`,
        );
      const created = await prisma.knowledgeArticle.create({
        data: {
          ticketId,
          title: article.title,
          content: article.content,
          status: article.approved ? 'APPROVED' : 'PROPOSED',
          approvedById: article.approved ? supervisorId : undefined,
          decidedAt: article.approved ? daysAgo(3) : undefined,
        },
      });
      // Niveau 2 du RAG, même contenu que KnowledgeService.indexApprovedArticle.
      if (article.approved) {
        const content = `${created.title}\n\n${created.content}`;
        const { vector, provider } = await embedWithProvider(content);
        embeddingProviders.add(provider);
        await prisma.documentChunk.create({
          data: {
            knowledgeArticleId: created.id,
            knowledgeLevel: 2,
            sourceLabel: created.title,
            content,
            embedding: vector,
            embeddingProvider: provider,
          },
        });
      }
    }
  }

  let createdDocuments = 0;
  for (const doc of internalDocuments) {
    const existing = await prisma.knowledgeDocument.findFirst({
      where: { title: doc.title },
    });
    if (existing) continue;
    const created = await prisma.knowledgeDocument.create({
      data: {
        title: doc.title,
        content: doc.content,
        knowledgeLevel: 2,
        uploadedById: admin.id,
      },
    });
    createdDocuments += 1;
    // Même découpage que KnowledgeService.indexDocumentContent.
    const chunks = chunkText(`${doc.title}\n\n${doc.content}`);
    for (const [position, chunkContent] of chunks.entries()) {
      const { vector, provider } = await embedWithProvider(chunkContent);
      embeddingProviders.add(provider);
      await prisma.documentChunk.create({
        data: {
          documentId: created.id,
          knowledgeLevel: 2,
          ownerId: null,
          sourceLabel: doc.title,
          content: chunkContent,
          position,
          embedding: vector,
          embeddingProvider: provider,
        },
      });
    }
  }

  console.log('Données de démonstration prêtes :');
  console.log(
    `- ${departments.length} services, ${locations.length} sites, ${teams.length} équipes, ${configurationItems.length} actifs`,
  );
  console.log(
    `- ${users.length} comptes @${DEMO_DOMAIN} (1 superviseur, 4 techniciens, 4 employés)`,
  );
  console.log(
    `- ${createdTickets} ticket(s) créé(s), ${createdDocuments} document(s) interne(s) créé(s)`,
  );
  if (embeddingProviders.size > 0) {
    console.log(`- Indexation RAG : ${[...embeddingProviders].join(', ')}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
