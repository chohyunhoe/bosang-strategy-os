'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildWorkflows, writeWorkflows, validateBindings, authorizeTaskBinding, authorizeStartedTask, completionEnvelope, PROVIDER_URLS } = require('../scripts/build_n8n_cross_review');
const bindings = Object.fromEntries(['anthropic', 'google', 'openai', 'runner'].map(provider =>
  [provider, { credential_ref: 'synthetic-' + provider + '-header', account_ref: 'synthetic-' + provider + '-account' }]));

test('generated additive workflows are deterministic, inactive, and omit execution-data persistence', () => {
  const workflows = buildWorkflows();
  assert.deepEqual(workflows, buildWorkflows());
  for (const [key, workflow] of Object.entries(workflows)) {
    assert.equal(workflow.active, false);
    assert.match(workflow.name, /UNVALIDATED_INSTALL/);
    assert.equal(workflow.settings.saveDataErrorExecution, 'none');
    assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
    assert.equal(workflow.settings.saveExecutionProgress, false);
    assert.equal(workflow.settings.saveManualExecutions, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname, '../integrations/n8n/cross-review-' + key + '.json'))), workflow);
    const names = new Set(workflow.nodes.map(node => node.name));
    assert.equal(names.size, workflow.nodes.length);
    for (const branches of Object.values(workflow.connections)) for (const branch of branches.main) for (const edge of branch) assert.ok(names.has(edge.node));
    for (const node of workflow.nodes.filter(node => node.type.endsWith('.httpRequest'))) {
      assert.equal(node.retryOnFail, false);
      assert.equal(node.parameters.options.redirect.redirect.followRedirects, false);
      assert.equal(node.parameters.authentication, 'genericCredentialType');
      assert.deepEqual(Object.keys(node.credentials.httpHeaderAuth), ['name']);
    }
  }
});

test('each ticket starts its own child without waiting for earlier children', () => {
  const dispatcher = buildWorkflows().dispatcher;
  const child = dispatcher.nodes.find(node => node.type.endsWith('.executeWorkflow'));
  assert.equal(child.parameters.mode, 'each');
  assert.equal(child.parameters.options.waitForSubWorkflow, false);
  assert.equal(child.parameters.workflowId.value, 'UNCONFIGURED_REVIEWER_WORKFLOW_ID');
  assert.equal(child.parameters.workflowInputs, undefined);
  assert.equal(dispatcher.nodes.find(node => node.type.endsWith('.splitOut')).parameters.fieldToSplitOut, 'tasks');
});

test('the paid nodes are reachable only after successful runner start and authoritative task validation', () => {
  const w = buildWorkflows().reviewer;
  assert.deepEqual(w.connections['Review task trigger'].main[0].map(edge => edge.node), ['Check installed credential binding']);
  assert.deepEqual(w.connections['Check installed credential binding'].main[0].map(edge => edge.node), ['Authorize call start']);
  assert.deepEqual(w.connections['Authorize call start'].main[0].map(edge => edge.node), ['Use authoritative started task']);
  assert.equal(w.nodes.find(node => node.name === 'Authorize call start').onError, undefined);
  const route = w.nodes.find(node => node.name === 'Route fixed provider');
  assert.equal(route.parameters.rules.values.length, 3);
  assert.equal(route.parameters.options.fallbackOutput, 'extra');
  for (const provider of ['anthropic', 'google', 'openai']) {
    const node = w.nodes.find(item => item.name === 'Call ' + provider);
    assert.equal(node.parameters.url, PROVIDER_URLS[provider]);
    assert.equal(node.parameters.options.response.response.fullResponse, true);
    assert.equal(node.parameters.options.response.response.neverError, true);
    assert.equal(node.onError, 'continueErrorOutput');
    assert.deepEqual(w.connections[node.name].main[1].map(edge => edge.node), ['Record uncertain transport failure']);
    assert.doesNotMatch(node.parameters.url, /request\.url|trigger|http:\/\//);
  }
  const failure = w.nodes.find(node => node.name === 'Record uncertain transport failure');
  assert.match(failure.parameters.jsonBody, /uncertain:true/);
  assert.doesNotMatch(failure.parameters.jsonBody, /\$json\.error|headers|message|stack/);
});

test('start response binding blocks forged tickets/providers/models and supports one revision author', () => {
  const request = { body: { model: 'configured-model', messages: [] }, url: 'https://untrusted.invalid' };
  const task = { ticket_id: 'ticket', reviewer: 'claude', provider: 'anthropic', model_id: 'configured-model', request,
    credential_ref: bindings.anthropic.credential_ref, account_ref: bindings.anthropic.account_ref };
  const trigger = { ticket_id: 'ticket', request: { body: { injected: true } } };
  const started = authorizeStartedTask({ task }, trigger, 'time', bindings);
  assert.equal(started.request.body.injected, undefined);
  assert.equal(started.call_started_at, 'time');
  assert.equal(authorizeStartedTask({ task: { ...task, reviewer: 'reviser' } }, trigger, 'time', bindings).provider, 'anthropic');
  for (const change of [{ ticket_id: 'different' }, { provider: 'google' }, { model_id: '../../evil?key=secret' }, { request: { body: [] } },
    { credential_ref: 'different-credential' }, { account_ref: 'different-account' }]) {
    assert.throws(() => authorizeStartedTask({ task: { ...task, ...change } }, trigger, 'time', bindings), /(?:RUNNER_START|INSTALLED_CREDENTIAL_ACCOUNT)_BINDING_REQUIRED/);
  }
  assert.throws(() => authorizeStartedTask({ task }, trigger, 'time'), /INSTALLED_CREDENTIAL_ACCOUNT_BINDING_REQUIRED/);
  assert.throws(() => authorizeTaskBinding(task, buildWorkflows().reviewer.meta.lkCrossReview.credential_bindings), /INSTALLED_CREDENTIAL_ACCOUNT_BINDING_REQUIRED/);
  authorizeTaskBinding(task, bindings);
});

test('private binding metadata configures exact node credentials and rejects actual credential values', () => {
  const workflow = buildWorkflows(bindings).reviewer;
  assert.equal(workflow.meta.lkCrossReview.installation_verified, false);
  assert.equal(workflow.meta.lkCrossReview.funding_mode, 'FREE_CREDITS_ONLY');
  assert.deepEqual(workflow.meta.lkCrossReview.credential_bindings, bindings);
  for (const provider of ['anthropic', 'google', 'openai']) {
    assert.equal(workflow.nodes.find(node => node.name === 'Call ' + provider).credentials.httpHeaderAuth.name, bindings[provider].credential_ref);
  }
  assert.equal(workflow.nodes.find(node => node.name === 'Authorize call start').credentials.httpHeaderAuth.name, bindings.runner.credential_ref);
  assert.ok(workflow.nodes.find(node => node.name === 'Check installed credential binding').parameters.jsCode.includes(JSON.stringify(bindings)));
  for (const entry of [{ ...bindings.anthropic, apiKey: 'sentinel' }, { credential_ref: 'Bearer sentinel', account_ref: 'account' }, { credential_ref: 'sk-sentinel', account_ref: 'account' }]) {
    assert.throws(() => validateBindings({ ...bindings, anthropic: entry }), /CREDENTIAL_BINDING_METADATA_REQUIRED/);
  }
  assert.throws(() => validateBindings({ ...bindings, apiKey: 'sentinel' }), /CREDENTIAL_BINDING_METADATA_REQUIRED/);
});

test('approved HTTPS runner prefixes are compiled consistently into every inactive workflow', () => {
  const configured = { ...bindings, runner: { ...bindings.runner, base_url: 'https://runner.example.com:443/lk-review/v1/' } };
  const original = structuredClone(configured);
  const workflows = buildWorkflows(configured);
  const endpoints = new Set();
  for (const workflow of Object.values(workflows)) {
    assert.equal(workflow.active, false);
    assert.equal(workflow.meta.lkCrossReview.installation_verified, false);
    assert.equal(workflow.meta.lkCrossReview.credential_bindings.runner.base_url, 'https://runner.example.com/lk-review/v1');
    const nodes = workflow.nodes.filter(node => node.type.endsWith('.httpRequest') &&
      node.credentials.httpHeaderAuth.name === bindings.runner.credential_ref);
    assert.ok(nodes.length);
    for (const node of nodes) {
      assert.match(node.parameters.url, /^https:\/\/runner\.example\.com\/lk-review\/v1\/(?:dispatch|start|complete|fail|watchdog)$/);
      assert.doesNotMatch(node.parameters.url, /\$json|request\.url|\{\{/);
      assert.equal(node.parameters.options.redirect.redirect.followRedirects, false);
      assert.equal(node.retryOnFail, false);
      endpoints.add(node.parameters.url.split('/').at(-1));
    }
    for (const node of workflow.nodes.filter(node => node.type.endsWith('.httpRequest') && node.name.startsWith('Call '))) {
      assert.equal(node.parameters.url, PROVIDER_URLS[node.name.slice('Call '.length)]);
    }
  }
  assert.deepEqual([...endpoints].sort(), ['complete', 'dispatch', 'fail', 'start', 'watchdog']);
  assert.deepEqual(configured, original);
  assert.equal(buildWorkflows({ ...bindings, runner: { ...bindings.runner, base_url: 'https://runner.example.com' } })
    .dispatcher.nodes.find(node => node.name === 'Reserve call batch').parameters.url, 'https://runner.example.com/dispatch');
  assert.equal(buildWorkflows({ ...bindings, runner: { ...bindings.runner, base_url: 'http://127.0.0.1:8791' } })
    .dispatcher.nodes.find(node => node.name === 'Reserve call batch').parameters.url, 'http://127.0.0.1:8791/dispatch');
});

test('runner base URLs reject alternate protocols, auth material, private names and URL normalization tricks', () => {
  for (const base_url of [
    null, 123, '', 'http://runner.example.com', 'file:///tmp/runner', 'javascript:alert(1)',
    'https://user:secret@runner.example.com', 'https://user@runner.example.com',
    'https://runner.example.com?key=secret', 'https://runner.example.com?', 'https://runner.example.com#',
    'https://runner.example.com/#fragment', 'https://runner.example.com:444', 'https://runner.example.com:0443',
    'https://localhost', 'https://localhost.', 'https://runner.localhost', 'https://runner.local',
    'https://metadata.google.internal', 'https://runner.home.arpa', 'https://runner.lan',
    'https://127.0.0.1', 'https://127.1', 'https://2130706433', 'https://0x7f000001',
    'https://10.0.0.1', 'https://192.168.0.1', 'https://169.254.169.254', 'https://999.999.999.999', 'https://[::1]',
    'https://[::ffff:127.0.0.1]', 'https://runner.example.com.', 'https://-runner.example.com',
    'https://runner..example.com', 'https://runner.example.com/a/../b', 'https://runner.example.com/./',
    'https://runner.example.com/%2e%2e', 'https://runner.example.com/a//b',
    'https://runner.example.com/={{$json.url}}', 'https://runner.example.com\\@evil.example.com',
    ' https://runner.example.com', 'https://runner.example.com\n', 'https://runner.example.com/path with space',
  ]) {
    assert.throws(() => buildWorkflows({ ...bindings, runner: { ...bindings.runner, base_url } }),
      /TRUSTED_RUNNER_HTTPS_BASE_URL_REQUIRED/, String(base_url));
  }
  assert.throws(() => validateBindings({ ...bindings, anthropic: { ...bindings.anthropic, base_url: 'https://runner.example.com' } }),
    /CREDENTIAL_BINDING_METADATA_REQUIRED/);
  assert.throws(() => validateBindings({ ...bindings, runner: { ...bindings.runner, url: 'https://runner.example.com' } }),
    /CREDENTIAL_BINDING_METADATA_REQUIRED/);
});

test('private binding CLI output is restricted to ignored n8n-private paths and refuses symlinks', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-cross-review-workflows-'));
  const input = path.join(temp, 'bindings.json');
  fs.writeFileSync(input, JSON.stringify(bindings));
  const privateOutput = path.resolve(__dirname, '../n8n-private/workflow-test-' + path.basename(temp));
  const publicOutput = path.join(temp, 'forbidden-public-output');
  try {
    assert.throws(() => writeWorkflows(publicOutput, input), /PRIVATE_BINDINGS_REQUIRE_N8N_PRIVATE_OUTPUT/);
    assert.equal(fs.existsSync(publicOutput), false);
    writeWorkflows(privateOutput, input);
    const exported = JSON.parse(fs.readFileSync(path.join(privateOutput, 'cross-review-reviewer.json')));
    assert.deepEqual(exported.meta.lkCrossReview.credential_bindings, bindings);
    assert.equal(fs.statSync(path.join(privateOutput, 'cross-review-reviewer.json')).mode & 0o777, 0o600);
    const symlink = path.join(privateOutput, 'alias');
    fs.symlinkSync(temp, symlink, 'dir');
    assert.throws(() => writeWorkflows(symlink, input), /PRIVATE_OUTPUT_SYMLINK_BLOCKED/);
    fs.unlinkSync(path.join(privateOutput, 'cross-review-dispatcher.json'));
    fs.symlinkSync(path.join(temp, 'outside.json'), path.join(privateOutput, 'cross-review-dispatcher.json'));
    assert.throws(() => writeWorkflows(privateOutput, input), /PRIVATE_OUTPUT_SYMLINK_BLOCKED/);
    assert.equal(fs.existsSync(path.join(temp, 'outside.json')), false);
  } finally {
    fs.rmSync(privateOutput, { recursive: true, force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('HTTP callbacks preserve official envelope evidence and exclude headers with credentials', () => {
  const envelope = completionEnvelope({ statusCode: 200, body: { id: 'official-response', output: [] }, headers: {
    'X-Request-ID': 'official-request', Authorization: 'Bearer sentinel', 'x-api-key': 'sentinel', 'set-cookie': 'sentinel',
  } }, { ticket_id: 'ticket', call_started_at: 'start' }, 'n8n-42', 'finish');
  assert.equal(envelope.execution_id, 'n8n-42');
  assert.equal(envelope.ticket_id, 'ticket');
  assert.equal(envelope.provider_response.status_code, 200);
  assert.deepEqual(envelope.provider_response.headers, { 'x-request-id': 'official-request' });
  assert.doesNotMatch(JSON.stringify(envelope), /sentinel|Bearer/);
  assert.throws(() => completionEnvelope({ error: { headers: { Authorization: 'sentinel' } } }, {}, 'x', 'x'), /PROVIDER_HTTP_ENVELOPE_REQUIRED/);
});

test('watchdog and error paths independently inspect the durable ledger without model nodes', () => {
  const workflows = buildWorkflows();
  for (const key of ['watchdog', 'error-handler']) {
    const w = workflows[key];
    assert.equal(w.nodes.filter(node => node.type.endsWith('.httpRequest')).length, 1);
    assert.equal(w.nodes.find(node => node.type.endsWith('.httpRequest')).parameters.url, 'http://127.0.0.1:8791/watchdog');
    assert.doesNotMatch(JSON.stringify(w), /\$json\.error|api\.anthropic\.com|api\.openai\.com|generativelanguage/);
  }
});
