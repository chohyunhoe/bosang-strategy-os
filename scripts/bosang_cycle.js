#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const actualQaReportPath = path.join(repoRoot, 'parser', 'output', 'layer1_actual_qa_report.json');

const STATUS = Object.freeze({
  PASS: 'PASS',
  PASS_WITH_WARNINGS: 'PASS_WITH_WARNINGS',
  NEEDS_ATTENTION: 'NEEDS_ATTENTION',
  FAIL: 'FAIL',
  SKIPPED: 'SKIPPED',
});

const generatedArtifactPatterns = [
  /^node_modules(?:\/|$)/,
  /^parser\/fixtures\/pdf\/.*\.pdf$/i,
  /^parser\/output\/.*actual.*\.json$/,
  /^parser\/output\/debug_actual_text_sample\.txt$/,
  /^parser\/output\/layer1_actual_qa_report\.(?:json|md)$/,
];

function runCommand(label, command, args, options = {}) {
  console.log(`\n--- ${label} ---`);
  console.log(`$ ${[command, ...args].join(' ')}`);

  const result = childProcess.spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    ...options,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error.message);

  const exitCode = typeof result.status === 'number' ? result.status : 1;
  console.log(`${label}: ${exitCode === 0 ? 'PASS' : 'FAIL'} (exit ${exitCode})`);

  return {
    label,
    command: [command, ...args].join(' '),
    exitCode,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : '',
  };
}

function commandOutput(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function readGitContext() {
  const branch = commandOutput('git', ['branch', '--show-current']).stdout || 'UNKNOWN';
  const commit = commandOutput('git', ['rev-parse', '--short', 'HEAD']).stdout || 'UNKNOWN';
  const status = commandOutput('git', ['status', '--short']).stdout;
  return {
    branch,
    commit,
    status: status || 'clean',
    entries: status ? status.split('\n').filter(Boolean) : [],
  };
}

function extractStatusPath(statusLine) {
  const withoutRenameSource = statusLine.includes(' -> ')
    ? statusLine.slice(statusLine.lastIndexOf(' -> ') + 4)
    : statusLine;
  return withoutRenameSource.slice(3).trim();
}

function findVisibleGeneratedArtifacts(statusEntries) {
  return statusEntries
    .map((entry) => ({ entry, filePath: extractStatusPath(entry) }))
    .filter(({ filePath }) => generatedArtifactPatterns.some((pattern) => pattern.test(filePath)));
}

function summarizeDependencyState() {
  const packageLockExists = fs.existsSync(path.join(repoRoot, 'package-lock.json'));
  const nodeModulesExists = fs.existsSync(path.join(repoRoot, 'node_modules'));
  const pdfParseInstalled = fs.existsSync(path.join(repoRoot, 'node_modules', 'pdf-parse', 'package.json'));
  const npmLs = runCommand('Dependency Check', 'npm', ['ls', '--depth=0']);

  let status = STATUS.PASS;
  const notes = [];
  if (!packageLockExists) {
    status = STATUS.NEEDS_ATTENTION;
    notes.push('package-lock.json missing; run npm install and commit lockfile if dependency set changed.');
  }
  if (!nodeModulesExists || !pdfParseInstalled) {
    status = STATUS.NEEDS_ATTENTION;
    notes.push('node_modules/pdf-parse is not installed; run npm install before parser QA.');
  }
  if (npmLs.exitCode !== 0) {
    status = STATUS.NEEDS_ATTENTION;
    notes.push('npm ls reported dependency issues.');
  }

  return { status, notes, command: npmLs };
}

function readActualQaReport() {
  if (!fs.existsSync(actualQaReportPath)) {
    return {
      result: STATUS.NEEDS_ATTENTION,
      report: 'parser/output/layer1_actual_qa_report.json not found',
      warnings: ['Actual QA report was not created.'],
      failures: [],
      checks: {},
      status: {},
    };
  }

  try {
    const report = JSON.parse(fs.readFileSync(actualQaReportPath, 'utf8'));
    return {
      result: report.result || 'UNKNOWN',
      report: path.relative(repoRoot, actualQaReportPath).replace(/\\/g, '/'),
      warnings: Array.isArray(report.warnings) ? report.warnings : [],
      failures: Array.isArray(report.failures) ? report.failures : [],
      checks: report.checks || {},
      status: report.status || {},
      core: report.core || {},
      arrays: report.arrays || {},
    };
  } catch (error) {
    return {
      result: STATUS.FAIL,
      report: 'parser/output/layer1_actual_qa_report.json unreadable',
      warnings: [],
      failures: [error.message],
      checks: {},
      status: {},
    };
  }
}

function normalizeActualQaResult(actualCommand, actualReport) {
  if (actualCommand.exitCode !== 0) return STATUS.FAIL;
  if (actualReport.result === 'PASS') return STATUS.PASS;
  if (actualReport.result === 'PASS_WITH_WARNINGS') return STATUS.PASS_WITH_WARNINGS;
  if (actualReport.result === 'SKIPPED_ACTUAL_PDF_NOT_FOUND') return STATUS.NEEDS_ATTENTION;
  if (actualReport.result === 'FAIL') return STATUS.FAIL;
  return STATUS.NEEDS_ATTENTION;
}

function hasFailedSafetyCheck(actualReport) {
  const checks = actualReport.checks || {};
  return [checks.false_positive, checks.skeleton, checks.safety].some((check) => check && check.status === 'FAIL');
}

function determineResult({ dependencyState, schema, layer1, actualQa, actualReport, staticSite, diffCheck, visibleArtifacts }) {
  const failures = [];
  const needsAttention = [];
  const warnings = [];

  if (schema.exitCode !== 0) failures.push('parser schema compatibility test failed');
  if (layer1.exitCode !== 0) failures.push('parser layer1 fixture test failed');
  if (staticSite.exitCode !== 0) failures.push('static site validation failed');
  if (diffCheck.exitCode !== 0) failures.push('git diff --check failed');
  if (actualQa === STATUS.FAIL || hasFailedSafetyCheck(actualReport)) failures.push('actual QA failed safety/skeleton/false-positive checks');

  if (dependencyState.status === STATUS.NEEDS_ATTENTION) needsAttention.push(...dependencyState.notes);
  if (actualQa === STATUS.NEEDS_ATTENTION) needsAttention.push('actual PDF missing or actual QA skipped');
  if (visibleArtifacts.length > 0) {
    needsAttention.push(`git status shows generated/local artifacts: ${visibleArtifacts.map((item) => item.entry).join('; ')}`);
  }

  if (actualQa === STATUS.PASS_WITH_WARNINGS) warnings.push('actual QA returned PASS_WITH_WARNINGS');

  if (failures.length > 0) return { result: STATUS.FAIL, failures, needsAttention, warnings };
  if (needsAttention.length > 0) return { result: STATUS.NEEDS_ATTENTION, failures, needsAttention, warnings };
  if (warnings.length > 0) return { result: STATUS.PASS_WITH_WARNINGS, failures, needsAttention, warnings };
  return { result: STATUS.PASS, failures, needsAttention, warnings };
}

function statusLabel(commandResult) {
  return commandResult.exitCode === 0 ? 'PASS' : `FAIL (exit ${commandResult.exitCode})`;
}

function recommendedAction(finalState, actualReport) {
  if (finalState.result === STATUS.PASS) return 'Ready to commit or continue feature QA.';
  if (finalState.result === STATUS.PASS_WITH_WARNINGS) return 'Review actual QA warnings and keep skeleton/safety checks unchanged.';
  if (finalState.result === STATUS.NEEDS_ATTENTION) {
    if (actualReport.result === 'SKIPPED_ACTUAL_PDF_NOT_FOUND') {
      return 'Place the local actual PDF at parser/fixtures/pdf/text_pdf_layer1_actual_gyeongil.pdf, keep it untracked, then rerun npm run bosang:cycle.';
    }
    return 'Resolve dependency/artifact attention items, keep local outputs untracked, then rerun npm run bosang:cycle.';
  }
  return 'Fix failing checks above, especially parser safety/skeleton/false-positive failures, then rerun npm run bosang:cycle.';
}

function printSummary({ gitContext, schema, layer1, actualQa, actualReport, staticSite, diffCheck, finalState }) {
  const gitStatusSummary = gitContext.status === 'clean' ? 'clean' : gitContext.status.replace(/\n/g, '; ');
  const reportSummary = [
    actualReport.report,
    `actual_result=${actualReport.result}`,
    `pdf=${actualReport.status && actualReport.status.pdf ? actualReport.status.pdf : 'UNKNOWN'}`,
    `warnings=${actualReport.warnings ? actualReport.warnings.length : 0}`,
    `failures=${actualReport.failures ? actualReport.failures.length : 0}`,
  ].join(' | ');
  console.log('\n=== BOSANG OS CYCLE SUMMARY ===');
  console.log(`Branch: ${gitContext.branch}`);
  console.log(`Commit: ${gitContext.commit}`);
  console.log(`Git Status: ${gitStatusSummary}`);
  console.log(`Schema Test: ${statusLabel(schema)}`);
  console.log(`Parser Layer1 Test: ${statusLabel(layer1)}`);
  console.log(`Actual QA: ${actualQa}`);
  console.log(`Static Site: ${statusLabel(staticSite)}`);
  console.log(`Diff Check: ${statusLabel(diffCheck)}`);
  console.log(`Result: ${finalState.result}`);
  console.log(`Next Recommended Action: ${recommendedAction(finalState, actualReport)}`);
  console.log(`Report: ${reportSummary}`);
  console.log('=== END SUMMARY ===');
}

function main() {
  console.log('Bosang OS Dev/QA Cycle');
  console.log('검토 보조 자동화: Parser Layer 1A, KillerKit skeleton, static site, actual QA 상태를 순차 확인합니다.');

  const gitContext = readGitContext();
  console.log('\n--- Git Context ---');
  console.log(`Branch: ${gitContext.branch}`);
  console.log(`Commit: ${gitContext.commit}`);
  console.log(`Git Status:\n${gitContext.status}`);

  const visibleArtifacts = findVisibleGeneratedArtifacts(gitContext.entries);
  const dependencyState = summarizeDependencyState();
  const schema = runCommand('Schema Test', 'node', ['parser/tests/schema_compat.test.js']);
  const layer1 = runCommand('Parser Layer1 Test', 'node', ['parser/tests/text_pdf_parser_layer1.test.js']);
  const actualCommand = runCommand('Actual PDF QA', 'npm', ['run', 'parser:actual']);
  const actualReport = readActualQaReport();
  const actualQa = normalizeActualQaResult(actualCommand, actualReport);
  const staticSite = runCommand('Static Site Validation', 'node', ['tests/validate_static_site.js']);
  const diffCheck = runCommand('Diff Check', 'git', ['diff', '--check']);
  const finalState = determineResult({
    dependencyState,
    schema,
    layer1,
    actualQa,
    actualReport,
    staticSite,
    diffCheck,
    visibleArtifacts,
  });

  printSummary({
    gitContext,
    schema,
    layer1,
    actualQa,
    actualReport,
    staticSite,
    diffCheck,
    finalState,
  });

  process.exitCode = finalState.result === STATUS.FAIL ? 1 : 0;
}

main();
