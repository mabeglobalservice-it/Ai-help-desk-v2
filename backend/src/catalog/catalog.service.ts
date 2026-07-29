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
}
