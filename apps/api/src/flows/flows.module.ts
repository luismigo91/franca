import { Module } from '@nestjs/common';
import { FlowsController } from './flows.controller.js';
import { FlowsService } from './flows.service.js';

@Module({
  controllers: [FlowsController],
  providers: [FlowsService],
})
export class FlowsModule {}
