import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @ApiOperation({ summary: 'Lister les catégories de ticket' })
  @Get('ticket-categories')
  findAllTicketCategories() {
    return this.catalogService.findAllTicketCategories();
  }

  @ApiOperation({ summary: 'Lister les priorités' })
  @Get('priorities')
  findAllPriorities() {
    return this.catalogService.findAllPriorities();
  }
}
