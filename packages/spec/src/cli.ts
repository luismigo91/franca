#!/usr/bin/env node
/** Uso: franca-validate flujo.json [otro.json ...] */
import { readFileSync } from 'node:fs';
import { validateFlow, type FlowIssue } from './validate.js';

const LAYER = { shape: 'forma', semantic: 'semántica' } as const;

function format(issue: FlowIssue): string {
  const where = issue.nodeId ? `${issue.path} (${issue.nodeId})` : issue.path || '/';
  return `${LAYER[issue.layer]}: ${where}: ${issue.message}`;
}

let failed = false;
for (const file of process.argv.slice(2)) {
  let issues: FlowIssue[];
  try {
    issues = validateFlow(JSON.parse(readFileSync(file, 'utf8'))).issues;
  } catch (err) {
    issues = [{ layer: 'shape', path: '', message: `no se pudo leer como JSON: ${(err as Error).message}` }];
  }
  console.log(`${issues.length ? 'FALLO' : 'OK   '} ${file}`);
  for (const issue of issues) console.log(`      - ${format(issue)}`);
  failed ||= issues.length > 0;
}
process.exit(failed ? 1 : 0);
