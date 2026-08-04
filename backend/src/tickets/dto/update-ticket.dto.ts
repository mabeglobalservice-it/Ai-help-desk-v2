import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TicketStatus } from '../../../generated/prisma/client';
import { CreateTicketDto } from './create-ticket.dto';

export class UpdateTicketDto extends PartialType(CreateTicketDto) {
  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  // docs/06-cas-utilisation.md UC-013: requise en V2 pour clôturer un
  // ticket (statut RESOLVED) — appliqué dans TicketsService.update() plutôt
  // qu'ici, car la note déjà enregistrée peut suffire si ce PATCH ne fait
  // que modifier un autre champ d'un ticket déjà résolu.
  @ApiPropertyOptional({
    maxLength: 2000,
    description:
      'Note de résolution ajoutée par le technicien en clôturant le ticket',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNote?: string;
}
