import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiAgentsService } from './ai-agents.service';
import { AiAgentsController } from './ai-agents.controller';

@Module({
  controllers: [AiAgentsController],
  providers: [AiService, AiAgentsService],
  exports: [AiService],
})
export class AiModule {}
