import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

// Not extending PartialType(CreateTeamDto): categoryId here also accepts
// `null` to clear the team's category, which conflicts with TS's structural
// check against the base DTO's `string | undefined` type.
export class UpdateTeamDto {
  @ApiPropertyOptional({ example: 'Réseau & Infrastructure' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // IsOptional treats both null and undefined as "skip validation", so null
  // passes through to the service to clear the association.
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Passer null pour retirer la catégorie associée',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;
}
