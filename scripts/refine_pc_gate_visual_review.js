'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const root = path.resolve(__dirname, '..');
const resultBase = path.join(root, 'pc-gate-results');
const latestPath = path.join(resultBase, 'LATEST.txt');

const CHECKS = [
  ['desktop', '데스크톱 화면 정렬'],
  ['mobile_width', '모바일 폭·잘림'],
  ['map_preview', '합성 지도 레이아웃 표시'],
  ['numeric_table', '수치표 가독성·정렬'],
  ['individual_factor_details', '개별요인 세부내역'],
  ['result_alignment', '최종 결과 영역 정렬'],
];

const CRITICAL_CHECKS = new Set([
  'desktop',
  'mobile_width',
  'numeric_table',
  'individual_factor_details',
  'result_alignment',
]);

const CHOICES = {
  P: 'PASS',
  PASS: 'PASS',
  W: 'PASS_WITH_WARNINGS',
  PASS_WITH_WARNINGS: 'PASS_WITH_WARNINGS',
  F: 'FAIL',
  FAIL: 'FAIL',
};

function latestRecordPath() {
  if (!fs.existsSync(latestPath)) throw new Error('pc-gate-results/LATEST.txt가 없습니다. 먼저 PC 게이트를 실행하세요.');
  const runId = fs.readFileSync(latestPath, 'utf8').trim();
  if (!runId) throw new Error('LATEST.txt에 실행 ID가 없습니다.');
  const recordPath = path.join(resultBase, runId, 'PC_GATE_RESULT.json');
  if (!fs.existsSync(recordPath)) throw new Error(`PC_GATE_RESULT.json을 찾지 못했습니다: ${recordPath}`);
  return recordPath;
}

function normalizeAnswer(answer) {
  return CHOICES[String(answer || '').trim().toUpperCase()] || null;
}

function visualStatus(key, decision) {
  if (key === 'map_preview') {
    if (decision === 'PASS') return 'USER_REVIEWED_PASS_SYNTHETIC_LAYOUT_ONLY';
    if (decision === 'PASS_WITH_WARNINGS') return 'USER_REVIEWED_PASS_WITH_WARNINGS_SYNTHETIC_LAYOUT_ONLY';
    return 'USER_REVIEWED_FAIL_SYNTHETIC_LAYOUT_ONLY';
  }
  return `USER_REVIEWED_${decision}`;
}

function deriveFinalDecision(record, decisions) {
  const hardBlocks = Array.isArray(record.hard_block_reasons) ? record.hard_block_reasons.filter(Boolean) : [];
  if (hardBlocks.length > 0) return 'FAIL';
  if ([...CRITICAL_CHECKS].some((key) => decisions[key] === 'FAIL')) return 'FAIL';
  if (Object.values(decisions).some((value) => value === 'PASS_WITH_WARNINGS')) return 'PASS_WITH_WARNINGS';
  if (decisions.map_preview === 'FAIL') return 'PASS_WITH_WARNINGS';
  return 'PASS';
}

async function main() {
  const recordPath = latestRecordPath();
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const decisions = {};

  console.log('\n[PC 게이트 항목별 육안판정]');
  console.log('각 항목을 P(PASS) / W(PASS_WITH_WARNINGS) / F(FAIL)로 독립 판정합니다.');
  console.log('합성 지도 항목은 실제 공간정확도가 아니라 레이아웃·합성표시만 검수합니다.\n');

  const ask = (key, label) => new Promise((resolve) => {
    const prompt = () => rl.question(`${label} [P/W/F]: `, (answer) => {
      const normalized = normalizeAnswer(answer);
      if (!normalized) {
        console.log('P, W, F 중 하나를 입력하세요.');
        prompt();
        return;
      }
      decisions[key] = normalized;
      resolve();
    });
    prompt();
  });

  for (const [key, label] of CHECKS) await ask(key, label);
  rl.close();

  record.visual_checks = record.visual_checks || {};
  for (const [key] of CHECKS) record.visual_checks[key] = visualStatus(key, decisions[key]);
  record.final_decision = deriveFinalDecision(record, decisions);
  record.decided_at = new Date().toISOString();
  record.gate_version = 'pc-gate/0.9-review-refinement';
  record.visual_review_decisions = decisions;
  record.notes = Array.isArray(record.notes) ? record.notes : [];
  record.notes = record.notes.filter((note) => !String(note).includes('단일 입력으로 기록'));
  record.notes.push('시각 검수 6개 항목을 독립적으로 판정했습니다. 단일 판정을 전 항목에 복제하지 않습니다.');
  record.notes.push('map_preview는 SYNTHETIC_QA_LAYOUT_ONLY 범위이며 실제 지적·항공 공간정확도 판정과 분리됩니다.');

  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(`\n[${record.final_decision}] 항목별 판정 저장 완료`);
  console.log(recordPath);
  process.exitCode = record.final_decision === 'FAIL' ? 1 : 0;
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exitCode = 1;
});
