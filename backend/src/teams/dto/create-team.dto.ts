import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTeamDto {
  @ApiProperty({ example: 'Réseau & Infrastructure' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Catégorie de ticket associée, utilisée pour la suggestion automatique de technicien',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
