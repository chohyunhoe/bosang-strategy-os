'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'browser', 'product-v2', 'vworld-api-map.js'), 'utf8');
let scenario = 'UNIQUE';
let dataRequests = 0;
const requestedPnu = '1111111111100010001';

global.window = { location:{ hostname:'localhost', protocol:'http:', origin:'http://localhost:4174' } };
global.document = {
  createElement() { return { async:false, referrerPolicy:'', src:'', remove() {} }; },
  head:{ appendChild(script) {
    const url = new URL(script.src);
    const callback = url.searchParams.get('callback');
    if (url.pathname === '/req/data') {
      dataRequests += 1;
      const polygon = (offset = 0, pnu = requestedPnu) => ({
        type:'Feature', properties:{ pnu },
        geometry:{ type:'Polygon', coordinates:[[[127+offset,36],[127.0002+offset,36],[127.0002+offset,36.0002],[127+offset,36.0002],[127+offset,36]]] },
      });
      const features = scenario === 'UNIQUE' ? [polygon()] : scenario === 'MULTIPLE' ? [polygon(),polygon(.001)] : [polygon(0,'9999999999900010001')];
      queueMicrotask(() => window[callback]({ response:{ status:'OK', result:{ featureCollection:{ features } } } }));
      return;
    }
    if (url.pathname === '/req/search') {
      const item = { id:requestedPnu, address:{ parcel:'익명시 지도동 1-1' }, point:{ x:127, y:36 } };
      queueMicrotask(() => window[callback]({ response:{ status:'OK', result:{ items:[item] } } }));
    }
  } },
};

(async () => {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const api = await import(moduleUrl);
  const state = {
    caseInfo:{ case_name:'exact-one 계약 테스트' },
    lands:[{ land_id:'L1', pnu:requestedPnu, parcel_address:'익명시 지도동 1-1' }],
    standardLands:[], transactionCases:[], publicLandCharacteristics:[], subjectFactorDetails:[],
    subjectFactorTotals:[], comparisonSummaryByLand:[], appraisalResults:[], standardToCompCaseFactors:[], otherFactors:[],
  };

  api.setSessionVworldKey('UNIT-SESSION-KEY');
  const unique = await api.buildQuickMaps(state);
  assert.equal(unique.exact_one_count, 1);
  assert.equal(unique.point_count, 0);
  assert.equal(unique.maps[0].geometry_verification_status, 'EXACT_ONE');
  assert.equal(unique.map_preview.provenance.api_response_persisted, false);
  assert.equal(dataRequests, 1);

  const cached = await api.buildQuickMaps(state);
  assert.equal(cached.cache_hit_count, 1);
  assert.equal(dataRequests, 1, 'verified geometry should be reused only from in-memory session cache');

  api.clearSessionVworldKey();
  scenario = 'MULTIPLE';
  api.setSessionVworldKey('UNIT-SESSION-KEY-2');
  const multiple = await api.buildQuickMaps(state);
  assert.equal(multiple.exact_one_count, 0);
  assert.equal(multiple.point_count, 1);
  assert.equal(multiple.point_fallbacks[0].reason, 'VWORLD_PNU_GEOMETRY_NOT_UNIQUE');
  assert.equal(multiple.comparison_previews.length, 0);
  assert.equal(multiple.map_preview.layers[0].feature_collection.features[0].geometry.type, 'Point');

  api.clearSessionVworldKey();
  scenario = 'MISMATCH';
  api.setSessionVworldKey('UNIT-SESSION-KEY-3');
  const mismatch = await api.buildQuickMaps(state);
  assert.equal(mismatch.point_fallbacks[0].reason, 'VWORLD_PNU_GEOMETRY_MISMATCH');
  assert.equal(mismatch.exact_one_count, 0);

  console.log('product_v2_vworld_api_map.test.js passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
