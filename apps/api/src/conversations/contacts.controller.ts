import { Controller, Delete, HttpCode, Param } from '@nestjs/common';
import { ConversationsService } from './conversations.service.js';

/** Supresión de un contacto: sus valores guardados y todas sus conversaciones. */
@Controller('contacts')
export class ContactsController {
  constructor(private readonly conversations: ConversationsService) {}

  /** 204 existan o no datos del contacto. */
  @Delete(':contactId')
  @HttpCode(204)
  async remove(@Param('contactId') contactId: string): Promise<void> {
    await this.conversations.removeContact(contactId);
  }
}
