import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { Role } from '../../../generated/prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'nathalie@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    minLength: 8,
    description: 'Sera hashé avec bcrypt avant stockage',
  })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Nathalie Tremblay' })
  @IsString()
  @IsNotEmpty()
  displayName: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role: Role;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  teamId?: string;
}
