import { Module } from '@nestjs/common';
import { CLOCK, systemClock } from './clock.js';
import { FlowsController } from './flows.controller.js';
import { FlowsRepository } from './flows.repository.js';
import { FlowsService } from './flows.service.js';

@Module({
  controllers: [FlowsController],
  providers: [FlowsService, FlowsRepository, { provide: CLOCK, useValue: systemClock }],
})
export class FlowsModule {}
