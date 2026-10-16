import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { FlowsService, type FlowValidationResponse } from './flows.service.js';

@Controller('flows')
export class FlowsController {
  constructor(private readonly flowsService: FlowsService) {}

  /** Valida un flujo contra la spec sin guardarlo. Siempre 200: el resultado va en `valid`. */
  @Post('validate')
  @HttpCode(200)
  validate(@Body() flow: unknown): FlowValidationResponse {
    return this.flowsService.validate(flow);
  }
}
