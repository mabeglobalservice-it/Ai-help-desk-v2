import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class AiDiagnoseDto {
  @ApiProperty({
    example:
      "Mon ordinateur n'arrive plus à se connecter au wifi depuis ce matin.",
    description:
      "Description en langage naturel du problème rencontré par l'employé",
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(2000)
  description: string;
}
