import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { KnowledgeArticleStatus } from '../../../generated/prisma/client';

export class DecideKnowledgeArticleDto {
  @ApiProperty({
    enum: [KnowledgeArticleStatus.APPROVED, KnowledgeArticleStatus.REJECTED],
  })
  @IsEnum(KnowledgeArticleStatus)
  decision: KnowledgeArticleStatus;
}
