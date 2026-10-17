import { Injectable } from '@nestjs/common';
import { capWarnings, type FlowIssue, type FlowWarning } from '@franca/spec';
import { inspectFlowBody } from './flow-body.js';

export interface FlowValidationResponse {
  valid: boolean;
  issues: FlowIssue[];
  warnings: FlowWarning[];
}

@Injectable()
export class FlowsService {
  /**
   * Valida un flujo sin guardarlo ni tocar la base de datos.
   *
   * @param flow El valor que dio `JSON.parse` del cuerpo.
   * @returns El veredicto sobre la forma JSON del cuerpo, con los avisos recortados para mostrar.
   */
  validate(flow: unknown): FlowValidationResponse {
    const { verdict } = inspectFlowBody(flow);
    return { valid: verdict.valid, issues: verdict.issues, warnings: capWarnings(verdict.warnings) };
  }
}
