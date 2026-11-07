'use strict';

// Additive templates only. Installation/version/credential mapping is a separate gate.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const RUNNER_URL = 'http://127.0.0.1:8791';
const CREDENTIAL_NAMES = Object.freeze({
  runner: 'SELECT_EXISTING_LK_RUNNER_HEADER_AUTH',
  anthropic: 'SELECT_EXISTING_ANTHROPIC_HEADER_AUTH',
  google: 'SELECT_EXISTING_GEMINI_HEADER_AUTH',
  openai: 'SELECT_EXISTING_OPENAI_HEADER_AUTH',
});
const DEFAULT_BINDINGS = Object.freeze(Object.fromEntries(Object.entries(CREDENTIAL_NAMES)
  .map(([provider, credential_ref]) => [provider, Object.freeze({ credential_ref, account_ref: 'UNCONFIGURED_ACCOUNT' })])));
const PROVIDER_URLS = Object.freeze({
  anthropic: 'https://api.anthropic.com/v1/messages',
  google: '={{ "https://generativelanguage.googleapis.com/v1beta/models/" + $json.model_id + ":generateContent" }}',
  openai: 'https://api.openai.com/v1/responses',
});
const SETTINGS = Object.freeze({
  executionOrder: 'v1', timezone: 'Asia/Seoul', callerPolicy: 'workflowsFromSameOwner',
  saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none', saveExecutionProgress: false,
  saveManualExecutions: false, availableInMCP: false,
});

function stableId(key) {
  const s = createHash('sha256').update(key).digest('hex');
  return [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20, 32)].join('-');
}

function validateBindings(input = DEFAULT_BINDINGS) {
  const expectedKeys = ['runner', 'anthropic', 'google', 'openai'];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== expectedKeys.sort().join(',')) throw Error('CREDENTIAL_BINDING_METADATA_REQUIRED');
  const bindings = {};
  for (const provider of expectedKeys) {
    const entry = input[provider];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).some(key => !['credential_ref', 'account_ref'].includes(key)) ||
        typeof entry.credential_ref !== 'string' || !entry.credential_ref.trim() ||
        entry.credential_ref.length > 200 || /[\r\n\x00-\x1f]/.test(entry.credential_ref) ||
        /^(?:Bearer\s|sk-|AIza)/i.test(entry.credential_ref) ||
        (provider !== 'runner' && (typeof entry.account_ref !== 'string' || !entry.account_ref)) ||
        (entry.account_ref !== undefined && (typeof entry.account_ref !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(entry.account_ref)))) {
      throw Error('CREDENTIAL_BINDING_METADATA_REQUIRED');
    }
    bindings[provider] = { credential_ref: entry.credential_ref,
      ...(entry.account_ref === undefined ? {} : { account_ref: entry.account_ref }) };
  }
  return bindings;
}

function authorizeTaskBinding(task, expectedBindings) {
  const expected = task && expectedBindings && expectedBindings[task.provider];
  const providers = { claude: 'anthropic', gemini: 'google', gpt: 'openai', reviser: 'anthropic' };
  if (!expected || typeof expected.credential_ref !== 'string' || typeof expected.account_ref !== 'string' ||
      /^(SELECT_EXISTING_|UNCONFIGURED_)/.test(expected.credential_ref) ||
      /^(SELECT_EXISTING_|UNCONFIGURED_)/.test(expected.account_ref) ||
      providers[task.reviewer] !== task.provider || task.credential_ref !== expected.credential_ref ||
      task.account_ref !== expected.account_ref || typeof task.model_id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(task.model_id)) {
    throw Error('INSTALLED_CREDENTIAL_ACCOUNT_BINDING_REQUIRED');
  }
}

function authorizeStartedTask(startResponse, triggerTask, now, expectedBindings) {
  const task = startResponse && startResponse.task;
  if (!task || task.ticket_id !== triggerTask.ticket_id || typeof task.ticket_id !== 'string' ||
      !task.ticket_id ||
      !task.request || !task.request.body || typeof task.request.body !== 'object' ||
      Array.isArray(task.request.body)) throw Error('RUNNER_START_BINDING_REQUIRED');
  authorizeTaskBinding(task, expectedBindings);
  return { ...task, call_started_at: now };
}

function completionEnvelope(providerResponse, startedTask, executionId, now) {
  const raw = providerResponse || {};
  if (!Number.isInteger(raw.statusCode) || raw.statusCode < 100 || raw.statusCode > 599 ||
      raw.body === undefined) throw Error('PROVIDER_HTTP_ENVELOPE_REQUIRED');
  // Request auth headers and error objects never enter callbacks or logs.
  const headers = {};
  const allowed = new Set(['request-id', 'x-request-id', 'x-goog-request-id', 'content-type', 'retry-after']);
  for (const [key, value] of Object.entries(raw.headers || {})) {
    const normalized = key.toLowerCase();
    if (allowed.has(normalized) && typeof value === 'string') headers[normalized] = value;
  }
  return {
    ticket_id: startedTask.ticket_id, execution_id: String(executionId),
    provider_response: { body: raw.body, headers, status_code: raw.statusCode },
    started_at: startedTask.call_started_at, finished_at: now,
  };
}

function graph(key, title, bindings) {
  const nodes = [], connections = {};
  function add(name, type, parameters, extra = {}) {
    const node = { id: stableId(key + ':' + name), name, type: 'n8n-nodes-base.' + type,
      typeVersion: 1, position: [(nodes.length % 5) * 300, Math.floor(nodes.length / 5) * 240],
      parameters, ...extra };
    nodes.push(node); return node;
  }
  function link(a, b, output = 0) {
    connections[a] ||= { main: [] };
    while (connections[a].main.length <= output) connections[a].main.push([]);
    connections[a].main[output].push({ node: b, type: 'main', index: 0 });
  }
  function runner(name, endpoint, jsonBody) {
    return add(name, 'httpRequest', {
      method: 'POST', url: RUNNER_URL + endpoint,
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody,
      options: { timeout: 15000, redirect: { redirect: { followRedirects: false } },
        response: { response: { responseFormat: 'json' } } },
    }, { typeVersion: 4.2, credentials: { httpHeaderAuth: { name: bindings.runner.credential_ref } }, retryOnFail: false });
  }
  function note(text) {
    add('Installation gate', 'stickyNote', {
      content: '**UNVALIDATED_INSTALL — inactive template**\n\n' + text +
        '\n\nConfirm installed n8n version, runner reachability, existing credential/account mapping, and FREE_CREDITS_ONLY balances before activation. No paid fallback. No actual API or concurrency evidence is implied by this export.',
      height: 300, width: 600,
    });
  }
  function workflow() {
    return { name: title + ' | UNVALIDATED_INSTALL', active: false, nodes, connections,
      settings: { ...SETTINGS }, pinData: {}, tags: [], meta: { lkCrossReview: {
        installation_verified: false, credential_bindings: structuredClone(bindings),
        funding_mode: 'FREE_CREDITS_ONLY', source_delivery: 'EXTRACTED_TEXT_ONLY',
      } } };
  }
  return { add, link, runner, note, workflow };
}

function buildDispatcher(bindings) {
  const g = graph('dispatcher', 'LK Cross Review Dispatcher', bindings);
  g.add('Dispatch schedule', 'scheduleTrigger', { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } }, { typeVersion: 1.2 });
  g.add('Manual dispatch', 'manualTrigger', {});
  g.runner('Reserve call batch', '/dispatch', '={{ JSON.stringify({owner:String($execution.id)}) }}');
  g.add('Split reserved tasks', 'splitOut', { fieldToSplitOut: 'tasks', include: 'noOtherFields', options: {} });
  g.add('Start independent child', 'executeWorkflow', {
    source: 'database', workflowId: { __rl: true, mode: 'id', value: 'UNCONFIGURED_REVIEWER_WORKFLOW_ID' },
    mode: 'each', options: { waitForSubWorkflow: false },
  }, { typeVersion: 1.3, retryOnFail: false });
  g.link('Dispatch schedule', 'Reserve call batch'); g.link('Manual dispatch', 'Reserve call batch');
  g.link('Reserve call batch', 'Split reserved tasks'); g.link('Split reserved tasks', 'Start independent child');
  g.note('Import the reviewer first, then select its real workflow ID in Start independent child. Each ticket starts its own child execution with waitForSubWorkflow=false. Measure real start/end overlap before reporting simultaneous completion. Keep existing intake/router workflows unchanged.');
  return g.workflow();
}

function buildReviewer(bindings) {
  const g = graph('reviewer', 'LK Cross Review Provider Child', bindings);
  g.add('Review task trigger', 'executeWorkflowTrigger', { inputSource: 'passthrough' }, { typeVersion: 1.1 });
  g.add('Check installed credential binding', 'code', { jsCode: authorizeTaskBinding.toString() +
    '\nconst expectedBindings=' + JSON.stringify(bindings) +
    ";\nif($input.all().length!==1)throw Error('ONE_TICKET_PER_CHILD_REQUIRED');\nauthorizeTaskBinding($input.first().json,expectedBindings);return $input.all();" }, { typeVersion: 2 });
  g.runner('Authorize call start', '/start', '={{ JSON.stringify({ticket_id:$json.ticket_id,execution_id:String($execution.id)}) }}');
  g.add('Use authoritative started task', 'code', { jsCode: authorizeTaskBinding.toString() + '\n' + authorizeStartedTask.toString() +
    '\nconst expectedBindings=' + JSON.stringify(bindings) +
    ";\nif($input.all().length!==1||$('Review task trigger').all().length!==1)throw Error('ONE_TICKET_PER_CHILD_REQUIRED');\nreturn [{json:authorizeStartedTask($input.first().json,$('Review task trigger').first().json,new Date().toISOString(),expectedBindings)}];" }, { typeVersion: 2 });
  g.add('Route fixed provider', 'switch', {
    mode: 'rules', rules: { values: Object.keys(PROVIDER_URLS).map(provider => ({
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: '={{ $json.provider }}', rightValue: provider, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
      renameOutput: true, outputKey: provider,
    })) }, options: { fallbackOutput: 'extra' },
  }, { typeVersion: 3.2 });
  Object.keys(PROVIDER_URLS).forEach((provider, index) => {
    const name = 'Call ' + provider;
    const parameters = {
      method: 'POST', url: PROVIDER_URLS[provider], authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.request.body) }}',
      options: { timeout: 120000, redirect: { redirect: { followRedirects: false } },
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } },
    };
    if (provider === 'anthropic') {
      parameters.sendHeaders = true;
      parameters.headerParameters = { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] };
    }
    g.add(name, 'httpRequest', parameters, { typeVersion: 4.2,
      credentials: { httpHeaderAuth: { name: bindings[provider].credential_ref } },
      retryOnFail: false, onError: 'continueErrorOutput' });
    g.link('Route fixed provider', name, index);
    g.link(name, 'Build trusted HTTP callback');
    g.link(name, 'Record uncertain transport failure', 1);
  });
  g.add('Build trusted HTTP callback', 'code', { jsCode: completionEnvelope.toString() +
    "\nreturn [{json:completionEnvelope($input.first().json,$('Use authoritative started task').first().json,$execution.id,new Date().toISOString())}];" }, { typeVersion: 2 });
  g.runner('Persist provider completion', '/complete', '={{ JSON.stringify($json) }}');
  g.runner('Record uncertain transport failure', '/fail', "={{ JSON.stringify({ticket_id:$('Review task trigger').first().json.ticket_id,execution_id:String($execution.id),error_code:'PROVIDER_TRANSPORT_UNCERTAIN',uncertain:true}) }}");
  g.runner('Record unsupported provider', '/fail', "={{ JSON.stringify({ticket_id:$('Review task trigger').first().json.ticket_id,execution_id:String($execution.id),error_code:'UNSUPPORTED_PROVIDER',uncertain:false}) }}");
  g.link('Review task trigger', 'Check installed credential binding');
  g.link('Check installed credential binding', 'Authorize call start');
  g.link('Authorize call start', 'Use authoritative started task');
  g.link('Use authoritative started task', 'Route fixed provider');
  g.link('Route fixed provider', 'Record unsupported provider', 3);
  g.link('Build trusted HTTP callback', 'Persist provider completion');
  g.note('Generate private bindings to the existing credential names and exact account references before import. Default placeholder bindings block /start. The generated checks and HTTP credential selections must remain consistent. Select existing header credentials only: Anthropic x-api-key; Gemini x-goog-api-key; OpenAI Authorization (Bearer); runner local authorization header. Credential values never belong in this JSON. /start must succeed and return the authoritative task with matching account and credential references before any provider node executes. HTTP failures are recorded without retry. A timeout remains blocked for reconciliation; keep the watchdog independent.');
  return g.workflow();
}

function buildWatchdog(bindings, error = false) {
  const g = graph(error ? 'error-handler' : 'watchdog', error ? 'LK Cross Review Error Handler' : 'LK Cross Review Watchdog', bindings);
  if (error) g.add('Workflow failed', 'errorTrigger', {});
  else {
    g.add('Watchdog schedule', 'scheduleTrigger', { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } }, { typeVersion: 1.2 });
    g.add('Manual recovery inspection', 'manualTrigger', {});
  }
  g.runner('Inspect durable recovery state', '/watchdog', '={{ JSON.stringify({owner:String($execution.id)}) }}');
  if (error) g.link('Workflow failed', 'Inspect durable recovery state');
  else { g.link('Watchdog schedule', 'Inspect durable recovery state'); g.link('Manual recovery inspection', 'Inspect durable recovery state'); }
  g.note(error ? 'Select this workflow in n8n error settings after import. Do not send raw execution error objects, headers, or source contents. This invokes durable reconciliation inspection; it never replays uncertain calls.' : 'Run this workflow independently of the dispatcher. Lease expiry and offline hosts must be detected even when an error workflow never runs. Started calls remain blocked for reconciliation rather than being automatically resubmitted.');
  return g.workflow();
}

function buildWorkflows(input) {
  const bindings = validateBindings(input);
  return { dispatcher: buildDispatcher(bindings), reviewer: buildReviewer(bindings),
    watchdog: buildWatchdog(bindings), 'error-handler': buildWatchdog(bindings, true) };
}

function writeWorkflows(outputDirectory, bindingsPath) {
  const isSymlink = file => {
    try { return fs.lstatSync(file).isSymbolicLink(); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  const repoRoot = path.resolve(__dirname, '..');
  const out = path.resolve(outputDirectory || path.join(repoRoot, 'integrations/n8n'));
  if (bindingsPath) {
    const privateRoot = path.join(repoRoot, 'n8n-private');
    if (out !== privateRoot && !out.startsWith(privateRoot + path.sep)) throw Error('PRIVATE_BINDINGS_REQUIRE_N8N_PRIVATE_OUTPUT');
    let current = repoRoot;
    for (const part of path.relative(repoRoot, out).split(path.sep)) {
      current = path.join(current, part);
      if (isSymlink(current)) throw Error('PRIVATE_OUTPUT_SYMLINK_BLOCKED');
    }
  }
  const workflows = buildWorkflows(bindingsPath ? JSON.parse(fs.readFileSync(bindingsPath, 'utf8')) : undefined);
  fs.mkdirSync(out, { recursive: true, mode: bindingsPath ? 0o700 : 0o755 });
  if (bindingsPath) {
    for (const key of Object.keys(workflows)) {
      const file = path.join(out, 'cross-review-' + key + '.json');
      if (isSymlink(file)) throw Error('PRIVATE_OUTPUT_SYMLINK_BLOCKED');
    }
  }
  for (const [key, value] of Object.entries(workflows)) {
    const file = path.join(out, 'cross-review-' + key + '.json');
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: bindingsPath ? 0o600 : 0o644 });
    if (bindingsPath) fs.chmodSync(file, 0o600);
  }
  return workflows;
}

if (require.main === module) {
  writeWorkflows(process.argv[2], process.argv[3]);
  console.log('INACTIVE_CROSS_REVIEW_TEMPLATES_WRITTEN_NOT_DEPLOYED');
}

module.exports = { buildWorkflows, writeWorkflows, validateBindings, authorizeTaskBinding,
  authorizeStartedTask, completionEnvelope, PROVIDER_URLS, CREDENTIAL_NAMES, DEFAULT_BINDINGS, SETTINGS };
