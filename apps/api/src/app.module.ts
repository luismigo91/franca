import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from './config/config.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { FlowsModule } from './flows/flows.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, FlowsModule, ConversationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
