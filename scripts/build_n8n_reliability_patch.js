'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { reviewPassed, validateQueueInput, buildQueueResult } = require('../integrations/n8n/lk-execution-contract.cjs');
const { buildBsoResultPackage } = require('../integrations/n8n/lk-bso-result.cjs');

function patchWorkflow(kind, source) {
  const workflow = JSON.parse(JSON.stringify(source));
  const names = kind === 'router' ? ['Review Decision', 'Repair Decision'] : kind === 'worker' ? ['Validate LK Queue Input', 'Return LK Queue Result'] : null;
  if (!names || !Array.isArray(workflow.nodes)) throw Error('UNSUPPORTED_WORKFLOW');
  for (const name of names) {
    const matches = workflow.nodes.filter((node) => node.name === name);
    if (matches.length !== 1 || matches[0].type !== 'n8n-nodes-base.code' || typeof matches[0].parameters?.jsCode !== 'string') throw Error('EXPECTED_CODE_NODE_REQUIRED: ' + name);
    const node = matches[0];
    if (kind === 'router') {
      const code = node.parameters.jsCode;
      const start = code.indexOf('function reviewOK('), end = code.indexOf('\nfunction answerEnvelope', start);
      if (start < 0 || end < 0) throw Error('REVIEW_CODE_SHAPE_CHANGED');
      node.parameters.jsCode = code.slice(0, start) + reviewPassed.toString().replace('function reviewPassed', 'function reviewOK') + code.slice(end);
    } else if (name === 'Validate LK Queue Input') {
      node.parameters.jsCode = validateQueueInput.toString() + "\nconst j=$input.first().json;const sha=v=>require('crypto').createHash('sha256').update(v,'utf8').digest('hex');\nreturn [{json:{...validateQueueInput(j,sha),worker_execution_id:String($execution.id)}}];";
    } else {
      node.parameters.jsCode = buildQueueResult.toString() + '\n' + buildBsoResultPackage.toString() + "\nconst r=$input.first().json,j=$('Validate LK Queue Input').first(0).json;const sha=v=>require('crypto').createHash('sha256').update(v,'utf8').digest('hex');\nconst result=buildQueueResult(r,j,$execution.id,sha);if(result.bso_receipt){try{result.bso_result=buildBsoResultPackage(result,sha)}catch(e){result.bso_export_error=e.message}}return [{json:result}];";
    }
  }
  return workflow;
}

if (require.main === module) {
  const [kind, sourcePath, outputPath] = process.argv.slice(2);
  if (!kind || !sourcePath || !outputPath || path.resolve(sourcePath) === path.resolve(outputPath)) throw Error('Usage: node scripts/build_n8n_reliability_patch.js router|worker SOURCE.json NEW_OUTPUT.json');
  const original = fs.readFileSync(sourcePath, 'utf8');
  const patched = JSON.stringify(patchWorkflow(kind, JSON.parse(original)), null, 2) + '\n';
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, patched, { flag: 'wx', mode: 0o600 });
  const hash = (text) => createHash('sha256').update(text).digest('hex');
  console.log(JSON.stringify({ status: 'PATCH_WRITTEN_NOT_DEPLOYED', kind, original_sha256: hash(original), patched_sha256: hash(patched) }));
}
module.exports = { patchWorkflow };
