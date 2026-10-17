import { Controller, HttpCode, Post } from '@nestjs/common';
import { JsonBody } from '../http/json-body.js';
import { FlowsService, type FlowValidationResponse } from './flows.service.js';

@Controller('flows')
export class FlowsController {
  constructor(private readonly flowsService: FlowsService) {}

  /** Valida un flujo contra la spec sin guardarlo. Siempre 200 con el veredicto: no necesita la base de datos. */
  @Post('validate')
  @HttpCode(200)
  validate(@JsonBody() flow: unknown): FlowValidationResponse {
    return this.flowsService.validate(flow);
  }
}
