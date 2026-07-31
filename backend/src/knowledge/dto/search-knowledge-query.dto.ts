import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SearchKnowledgeQueryDto {
  @ApiProperty({
    description: 'Termes de recherche en langage naturel',
    example: 'imprimante réseau ne répond plus',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  q: string;
}
