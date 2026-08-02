import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  findAllTicketCategories() {
    return this.prisma.ticketCategory.findMany({ orderBy: { name: 'asc' } });
  }

  findAllPriorities() {
    return this.prisma.priority.findMany({ orderBy: { level: 'asc' } });
  }

  findAllDepartments() {
    return this.prisma.department.findMany({ orderBy: { name: 'asc' } });
  }

  findAllCiTypes() {
    return this.prisma.ciType.findMany({ orderBy: { name: 'asc' } });
  }

  // US-24 : suggestions pour le fabricant/modèle d'un CI (créés à la volée
  // par nom depuis le formulaire de CI, cf. ConfigurationItemsService).
  findAllManufacturers() {
    return this.prisma.manufacturer.findMany({ orderBy: { name: 'asc' } });
  }

  findModelsByManufacturer(manufacturerId?: string) {
    if (!manufacturerId) return Promise.resolve([]);
    return this.prisma.model.findMany({
      where: { manufacturerId },
      orderBy: { name: 'asc' },
    });
  }
}
