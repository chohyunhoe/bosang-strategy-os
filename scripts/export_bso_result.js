'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { buildBsoResultPackage } = require('../integrations/n8n/lk-bso-result.cjs');

function exportBsoResult(sourcePath, destinationPath) {
  if (!sourcePath || !destinationPath || path.resolve(sourcePath) === path.resolve(destinationPath)) throw Error('DISTINCT_INPUT_OUTPUT_REQUIRED');
  if (fs.statSync(sourcePath).size > 2 * 1024 * 1024) throw Error('INPUT_LIMIT_2MB');
  let row = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  if (Array.isArray(row)) { if (row.length !== 1) throw Error('SELECT_ONE_QUEUE_RESULT'); row = row[0]; }
  if (row?.json) row = row.json;
  const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
  const result = buildBsoResultPackage(row, sha);
  fs.writeFileSync(destinationPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { status: 'EXPORTED_FOR_HUMAN_REVIEW', job_id: result.bso_receipt.job_id, output_sha256: result.bso_receipt.output_sha256, external_model_calls: 0 };
}
if (require.main === module) console.log(JSON.stringify(exportBsoResult(...process.argv.slice(2))));
module.exports = { exportBsoResult };
