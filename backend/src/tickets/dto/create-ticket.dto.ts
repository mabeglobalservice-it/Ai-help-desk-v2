import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTicketDto {
  @IsUUID()
  employeeId: string;

  @IsUUID()
  categoryId: string;

  @IsUUID()
  priorityId: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsUUID()
  technicianId?: string;

  @IsOptional()
  @IsUUID()
  ciId?: string;
}
