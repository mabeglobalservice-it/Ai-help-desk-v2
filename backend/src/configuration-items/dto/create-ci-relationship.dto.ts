import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsEnum } from 'class-validator';
import { RelationshipType } from '../../../generated/prisma/client';

export class CreateCiRelationshipDto {
  @ApiProperty({
    format: 'uuid',
    description: "Le Configuration Item dépendant (l'enfant de la relation)",
  })
  @IsUUID()
  childCiId: string;

  @ApiProperty({ enum: RelationshipType })
  @IsEnum(RelationshipType)
  relationshipType: RelationshipType;
}
