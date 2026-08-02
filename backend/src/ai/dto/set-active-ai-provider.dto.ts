import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { AiProviderName } from '../../../generated/prisma/client';

export class SetActiveAiProviderDto {
  @ApiProperty({ enum: AiProviderName })
  @IsEnum(AiProviderName)
  provider: AiProviderName;
}
