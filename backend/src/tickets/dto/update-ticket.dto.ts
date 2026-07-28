import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { TicketStatus } from '../../../generated/prisma/client';
import { CreateTicketDto } from './create-ticket.dto';

export class UpdateTicketDto extends PartialType(OmitType(CreateTicketDto, ['employeeId'] as const)) {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;
}
