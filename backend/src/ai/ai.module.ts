import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { AiService } from './ai.service';
import { AiAgentsService } from './ai-agents.service';
import { AiAgentsController } from './ai-agents.controller';

@Module({
  imports: [RealtimeModule],
  controllers: [AiAgentsController],
  providers: [AiService, AiAgentsService],
  exports: [AiService],
})
export class AiModule {}
