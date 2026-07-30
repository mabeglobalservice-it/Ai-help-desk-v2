import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { Role } from '../../../generated/prisma/client';

// Not extending PartialType(CreateUserDto): teamId here also accepts `null`
// to clear the assigned team, which conflicts with TS's structural check
// against the base DTO's `string | undefined` type.
export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'nathalie@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    minLength: 8,
    description: 'Sera hashé avec bcrypt avant stockage',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({ example: 'Nathalie Tremblay' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  displayName?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  // IsOptional treats both null and undefined as "skip validation", so null
  // passes through to the service to clear the assigned team.
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: "Passer null pour retirer l'équipe assignée",
  })
  @IsOptional()
  @IsUUID()
  teamId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
