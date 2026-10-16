import { Injectable } from '@nestjs/common';
import { validateFlow, type FlowIssue } from '@franca/spec';

export interface FlowValidationResponse {
  valid: boolean;
  issues: FlowIssue[];
}

@Injectable()
export class FlowsService {
  validate(flow: unknown): FlowValidationResponse {
    const { valid, issues } = validateFlow(flow);
    return { valid, issues };
  }
}
