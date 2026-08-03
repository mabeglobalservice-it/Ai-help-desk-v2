import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

// docs/06-cas-utilisation.md UC-015 : même point d'entrée qu'un diagnostic
// standard (description en langage naturel), avant toute création de
// ticket.
export class ProposeAutoResolutionDto {
  @ApiProperty({
    example: "L'imprimante réseau du 3e étage ne répond plus depuis ce matin.",
    description: 'Description en langage naturel du problème rencontré',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(2000)
  description: string;
}
