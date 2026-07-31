import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateSlaPolicyDto {
  @ApiProperty({
    minimum: 1,
    example: 24,
    description: 'Délai de résolution attendu, en heures',
  })
  @IsInt()
  @Min(1)
  resolutionHours: number;
}
