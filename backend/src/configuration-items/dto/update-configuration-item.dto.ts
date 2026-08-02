import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateConfigurationItemDto } from './create-configuration-item.dto';

export class UpdateConfigurationItemDto extends PartialType(
  CreateConfigurationItemDto,
) {
  @ApiPropertyOptional({
    description:
      'Retire la garantie enregistrée pour ce CI (ignoré si `warranty` est aussi fourni)',
  })
  @IsOptional()
  @IsBoolean()
  clearWarranty?: boolean;
}
