import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

// docs/09-architecture-agents-ia.md §3.3 (Agent Technicien).
export class TechnicianAssistDto {
  @ApiProperty({
    example:
      'Comment vider le cache DNS sur ce poste avant de réinstaller le pilote réseau ?',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(2000)
  question: string;
}
