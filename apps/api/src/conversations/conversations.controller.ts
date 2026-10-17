import { Controller, Delete, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { etagOf } from '../flows/if-match.js';
import type { Page } from '../flows/flow-resources.js';
import { JsonBody } from '../http/json-body.js';
import type { ConversationResource, ConversationSummary, TranscriptItem } from './conversation-resources.js';
import { ConversationsService, type AdvanceResponse } from './conversations.service.js';

/** Las rutas de una conversación; las de `:conversationId/…` van tras las de la colección. */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  /** Crea la conversación y ejecuta el motor hasta la primera parada: 201 con `Location` y `ETag`. */
  @Post()
  async create(@JsonBody() body: unknown, @Res({ passthrough: true }) response: Response): Promise<AdvanceResponse> {
    const result = await this.conversations.create(body);
    response.setHeader('Location', `/conversations/${result.conversation.id}`);
    response.setHeader('ETag', etagOf(result.conversation.revision));
    return result;
  }

  @Get()
  list(@Query() query: Record<string, unknown>): Promise<Page<ConversationSummary>> {
    return this.conversations.list(query);
  }

  @Get(':conversationId')
  async get(@Param('conversationId') conversationId: string, @Res({ passthrough: true }) response: Response): Promise<ConversationResource> {
    const conversation = await this.conversations.get(conversationId);
    response.setHeader('ETag', etagOf(conversation.revision));
    return conversation;
  }

  /** Envía la entrada del usuario: 200 con el avance y el `ETag` de la revisión nueva. `If-Match` opcional. */
  @Post(':conversationId/inputs')
  @HttpCode(200)
  async sendInput(
    @Param('conversationId') conversationId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @JsonBody() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdvanceResponse> {
    const result = await this.conversations.sendInput(conversationId, body, ifMatch);
    response.setHeader('ETag', etagOf(result.conversation.revision));
    return result;
  }

  @Get(':conversationId/transcript')
  transcript(@Param('conversationId') conversationId: string, @Query() query: Record<string, unknown>): Promise<Page<TranscriptItem>> {
    return this.conversations.transcript(conversationId, query);
  }

  /** Borrado definitivo: 204. `If-Match` se ignora. */
  @Delete(':conversationId')
  @HttpCode(204)
  async remove(@Param('conversationId') conversationId: string): Promise<void> {
    await this.conversations.remove(conversationId);
  }
}
