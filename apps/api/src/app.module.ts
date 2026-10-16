import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { FlowsModule } from './flows/flows.module.js';

@Module({
  imports: [FlowsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
