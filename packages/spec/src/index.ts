export * from './types.js';
export {
  schema,
  targets,
  validateFlow,
  type FlowIssue,
  type FlowValidationResult,
  type Target,
} from './validate.js';
export { exceedsFlowDepth, MAX_FLOW_DEPTH } from './depth.js';
export { MAX_FLOW_ISSUES } from './issues.js';
export {
  capWarnings,
  FLOW_WARNING_CODES,
  MAX_FLOW_WARNINGS,
  type FlowWarning,
  type FlowWarningCode,
} from './warnings.js';

export const SPEC_VERSION = '0.1';
