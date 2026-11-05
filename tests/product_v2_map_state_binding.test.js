'use strict';

// Deterministic map/output lifecycle coverage. Only rendering and external map
// providers are stubbed; CaseStore, the map UI and output adapter are real modules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..', 'browser', 'product-v2');
const moduleCache = new Map();
const stubSources = {
  'map-local-adapter.js': `
    export const probeLocalMapBridge = async () => ({available:false});
    export const buildLocalMap = (state) => globalThis.mapBindingTest.local(state);
    export const downloadMapPdf = () => {};
  `,
  'vworld-api-map.js': `
    export const setSessionVworldKey = () => true;
    export const hasSessionVworldKey = () => true;
    export const clearSessionVworldKey = () => {};
    export const buildQuickMaps = (...args) => globalThis.mapBindingTest.api(...args);
  `,
  'map-preview.js': `
    export const renderMapPreview = () => '';
    export const hydrateMapInsetImages = async () => {};
    export const downloadMapPreviewPng = async () => ({});
    export const renderMapPreviewPng = (preview) => globalThis.mapBindingTest.png(preview);
  `,
};
function moduleUrl(fileName) {
  const file = path.resolve(root, fileName);
  if (moduleCache.has(file)) return moduleCache.get(file);
  let source = stubSources[path.basename(file)] || fs.readFileSync(file, 'utf8');
  source = source.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (_match, quote, dependency) => `from ${quote}${moduleUrl(path.resolve(path.dirname(file), dependency))}${quote}`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  moduleCache.set(file, url);
  return url;
}
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function caseData(name) {
  return {
    caseInfo:{case_name:name},
    lands:[{land_id:'L1',parcel_address:`익명시 ${name}동 1-1`,pnu:'1111111111100010001'}],
  };
}
function localResult(name) {
  return {ok:true,preview_png_base64:`LOCAL_${name}`,map_preview:{title:name,layers:[]}};
}
function apiResult(name) {
  return {maps:[{}],failures:[],exact_one_count:1,point_count:0,render_previews:[{title:name}],map_preview:{title:name,layers:[]}};
}

(async () => {
  const { CaseStore } = await import(moduleUrl('case-store.js'));
  const { installMapBridgeUi } = await import(moduleUrl('map-bridge-ui.js'));
  const { generateOpinionPackage } = await import(moduleUrl('output-adapter.js'));
  function setup(name = 'A') {
    const dom = new JSDOM('<!doctype html><main></main>', {url:'http://localhost/'});
    global.window = dom.window; global.document = dom.window.document;
    global.mapBindingTest = {
      local:async (state) => localResult(state.caseInfo.case_name),
      api:async (state) => apiResult(state.caseInfo.case_name),
      png:async (preview) => ({png_base64:`API_${preview.title}`,background_included:false}),
    };
    const store = new CaseStore();
    store.restoreSnapshot(caseData(name));
    const ui = installMapBridgeUi(store);
    global.BSOProductV2 = {store,mapBridge:ui};
    return {store,ui};
  }
  async function capturedOpinion(state, explicit = '') {
    let payload;
    global.fetch = async (_url, options) => {
      payload = JSON.parse(options.body);
      // Stop before download; this test inspects the exact bridge request.
      return {ok:false,status:422,json:async () => ({ok:false,message:'CAPTURED'})};
    };
    await assert.rejects(generateOpinionPackage(state, explicit), /CAPTURED/);
    return payload;
  }

  // Current maps survive route/review-only activity and still reach the output.
  {
    const {store,ui} = setup();
    await ui.build(); await ui.buildApi();
    store.setRoute('outputs');
    store.decide('GROUP:lands','CONFIRMED');
    const sent = await capturedOpinion(store.state);
    assert.equal(sent.case.case.case_name, 'A');
    assert.equal(sent.map_png_base64, 'LOCAL_A');
    assert.equal(sent.map_png_items[0].png_base64, 'API_A');
    assert.equal(JSON.stringify(store.snapshot()).includes('API_A'), false);
    const explicit = await capturedOpinion(store.state, 'EXPLICIT_MAP');
    assert.equal(explicit.map_png_base64, 'EXPLICIT_MAP');
    assert.deepEqual(explicit.map_png_items, []);

    const previous = store.state;
    store.reset(); store.restoreSnapshot(caseData('B'));
    assert.equal(ui.state.result, null); assert.equal(ui.apiState.result, null);
    await assert.rejects(ui.reportMapsForState(previous), (error) => error.code === 'MAP_INPUT_CHANGED');
    const changed = await capturedOpinion(store.state);
    assert.equal(changed.case.case.case_name, 'B');
    assert.equal(changed.map_png_base64, ''); assert.deepEqual(changed.map_png_items, []);
  }

  // A different case object invalidates maps even when every input value is equal.
  {
    const {store,ui} = setup();
    await ui.build(); await ui.buildApi();
    store.restoreSnapshot(store.snapshot());
    assert.equal(ui.state.result, null); assert.equal(ui.apiState.result, null);
  }

  // A saved preview remains usable on restore, but not after its parcel changes.
  {
    const {store,ui} = setup();
    await ui.buildApi();
    store.restoreSnapshot(store.snapshot());
    assert.equal(store.state.mapContext.title, 'A');
    assert.equal(store.state.capabilities.map, 'AVAILABLE');
    store.updateRecord('lands', () => true, {pnu:'2222222222100090009',parcel_address:'익명시 변경동 9-9'});
    assert.equal(store.state.mapContext, null);
    assert.equal(store.state.capabilities.map, 'NOT_CONNECTED');
  }

  // Imported LK_MAP_PREVIEW data has the same input-change boundary.
  {
    const {store} = setup();
    store.setMapContext({artifact_type:'LK_MAP_PREVIEW',title:'IMPORTED',layers:[]});
    assert.equal(store.state.capabilities.map, 'AVAILABLE');
    store.updateRecord('lands', () => true, {parcel_address:'익명시 다른동 2-2'});
    assert.equal(store.state.mapContext, null);
    assert.equal(store.state.capabilities.map, 'NOT_CONNECTED');
  }

  // In-place edits to parcel identity or comparison relations require fresh maps.
  for (const edit of [
    (store) => store.updateRecord('lands', () => true, {pnu:'2222222222100010001'}),
    (store) => store.updateRecord('lands', () => true, {parcel_address:'익명시 변경동 9-9'}),
    (store) => { store.state.appraisalResults.push({land_id:'L1',standard_land_symbol:'B'}); store.emit(); },
    (store) => { store.state.documentSanity.push({appraisal_id:'APP_001',status:'PARSE_HOLD'}); store.emit(); },
  ]) {
    const {store,ui} = setup();
    await ui.build(); await ui.buildApi();
    edit(store);
    assert.equal(ui.state.result, null); assert.equal(ui.apiState.result, null);
    assert.equal(store.state.mapContext, null);
    assert.equal(store.state.capabilities.map, 'NOT_CONNECTED');
  }

  // Late local responses cannot replace a newer case's result or loading state.
  {
    const {store,ui} = setup();
    const old = deferred(); const newer = deferred();
    global.mapBindingTest.local = (state) => state.caseInfo.case_name === 'A' ? old.promise : newer.promise;
    const oldBuild = ui.build();
    store.restoreSnapshot(caseData('B'));
    const newBuild = ui.build();
    old.resolve(localResult('A')); await oldBuild;
    assert.equal(ui.state.result, null); assert.equal(ui.state.loading, true);
    newer.resolve(localResult('B')); await newBuild;
    assert.equal(ui.state.result.preview_png_base64, 'LOCAL_B');
    assert.equal(store.state.mapContext.title, 'B');
  }
  {
    const {store,ui} = setup();
    const old = deferred();
    global.mapBindingTest.local = () => old.promise;
    const oldBuild = ui.build();
    store.restoreSnapshot(caseData('B'));
    global.mapBindingTest.local = async () => localResult('B');
    await ui.build(); old.reject(new Error('OLD_ERROR')); await oldBuild;
    assert.equal(ui.state.error, null);
    assert.equal(ui.state.result.preview_png_base64, 'LOCAL_B');
  }

  // API requests use an immutable input snapshot and ignore stale progress/result.
  {
    const {store,ui} = setup();
    const old = deferred(); const newer = deferred(); let oldInput; let progress;
    global.mapBindingTest.api = (state, onProgress) => {
      if (state.caseInfo.case_name === 'A') { oldInput = state; progress = onProgress; return old.promise; }
      return newer.promise;
    };
    const oldBuild = ui.buildApi();
    store.updateCaseInfo({case_name:'B'});
    assert.equal(oldInput.caseInfo.case_name, 'A');
    const newBuild = ui.buildApi(); const newProgress = ui.apiState.progress;
    progress({index:9,total:9,label:'OLD'});
    assert.equal(ui.apiState.progress, newProgress);
    old.resolve(apiResult('A')); await oldBuild;
    assert.equal(ui.apiState.result, null); assert.equal(ui.apiState.loading, true);
    newer.resolve(apiResult('B')); await newBuild;
    assert.equal(ui.apiState.result.map_preview.title, 'B');
    assert.equal(store.state.mapContext.title, 'B');
  }

  // Case change while rendering a report PNG must prevent the output POST.
  {
    const {store,ui} = setup();
    await ui.build(); await ui.buildApi();
    const rendering = deferred();
    global.mapBindingTest.png = () => rendering.promise;
    let posts = 0; global.fetch = async () => { posts += 1; throw new Error('UNEXPECTED_POST'); };
    const pending = generateOpinionPackage(store.state);
    store.restoreSnapshot(caseData('B'));
    rendering.resolve({png_base64:'API_A',background_included:false});
    await assert.rejects(pending, (error) => error.code === 'MAP_INPUT_CHANGED');
    assert.equal(posts, 0);
  }

  // Output revalidates even if an unsupported caller mutated inputs without emit.
  {
    const {store,ui} = setup();
    await ui.build(); await ui.buildApi();
    store.state.lands[0].pnu = '2222222222100090009';
    const sent = await capturedOpinion(store.state);
    assert.equal(sent.map_png_base64, ''); assert.deepEqual(sent.map_png_items, []);
  }

  console.log('product_v2_map_state_binding.test.js passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
