import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddFeedbackDto {
  @ApiProperty({
    description: 'True si la réponse de l’Agent Diagnostic a été utile',
  })
  @IsBoolean()
  wasHelpful: boolean;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
