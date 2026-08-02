import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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

  @ApiOperation({ summary: 'Lister les départements' })
  @Get('departments')
  findAllDepartments() {
    return this.catalogService.findAllDepartments();
  }

  @ApiOperation({ summary: 'Lister les types de Configuration Item (CMDB)' })
  @Get('ci-types')
  findAllCiTypes() {
    return this.catalogService.findAllCiTypes();
  }

  @ApiOperation({
    summary: 'Lister les fabricants connus (suggestions pour un CI)',
  })
  @Get('manufacturers')
  findAllManufacturers() {
    return this.catalogService.findAllManufacturers();
  }

  @ApiOperation({
    summary:
      "Lister les modèles connus d'un fabricant (suggestions pour un CI)",
  })
  @Get('models')
  findModelsByManufacturer(@Query('manufacturerId') manufacturerId?: string) {
    return this.catalogService.findModelsByManufacturer(manufacturerId);
  }
}
