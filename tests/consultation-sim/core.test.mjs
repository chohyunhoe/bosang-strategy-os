// BSO 상담 시뮬레이터 PR-1 결정론 테스트 (합성 데이터만 사용)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLotInput, validatePnu, buildPnu, resolveConsultationInput } from '../../browser/consultation-sim/core/pnu.js';
import { createConsultationSession, buildSavePayload, evaluateGeometry, STATUS } from '../../browser/consultation-sim/core/consultation-session.js';
import { createSyntheticAdapter } from '../../browser/consultation-sim/adapters/synthetic-adapter.js';
import { createBridgeAdapter } from '../../browser/consultation-sim/adapters/bridge-adapter.js';
import { SYNTHETIC_REGIONS, SYNTHETIC_PARCELS } from '../../browser/consultation-sim/adapters/synthetic-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NURI = '가상특별시 누리구 새솔동';

function session(options = {}) {
  const adapter = createSyntheticAdapter({ baseDelayMs: 1, ...options });
  return createConsultationSession({ adapter });
}

test('1-a 일반 필지: 법정동 컨텍스트 + 지번 → PNU 정규화', () => {
  const r = resolveConsultationInput(SYNTHETIC_REGIONS, { context: NURI, lotText: '123-4' });
  assert.equal(r.ok, true);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].pnu, '9901101000101230004');
  assert.equal(buildPnu('9901101000', { bun: 123, ji: 4 }), '9901101000101230004');
  assert.equal(parseLotInput('１２３－４번지').ok, true, '전각 숫자·하이픈·번지 정규화');
});

test('1-b 산번지: 대장구분 2', () => {
  const r = resolveConsultationInput(SYNTHETIC_REGIONS, { context: '가상도 연습군 숲내면 바위리', lotText: '산 12-3' });
  assert.equal(r.ok, true);
  assert.equal(r.candidates[0].pnu, '9821025021200120003');
  assert.equal(r.candidates[0].lot_label, '산12-3');
});

test('1-c 동일 동명·지번 중복: 자동선택 금지, 후보 2건', () => {
  const r = resolveConsultationInput(SYNTHETIC_REGIONS, { context: '', lotText: '새솔동 123-4' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'REGION_MULTIPLE');
  assert.equal(r.auto_selectable, false);
  assert.deepEqual(r.candidates.map((c) => c.pnu).sort(), ['9901101000101230004', '9901201000101230004']);
});

test('1-d 지번만 입력·전국 검색 금지 / 시군구 컨텍스트는 법정동 선택 요구', () => {
  assert.equal(resolveConsultationInput(SYNTHETIC_REGIONS, { context: '', lotText: '123-4' }).code, 'REGION_CONTEXT_REQUIRED');
  const sgg = resolveConsultationInput(SYNTHETIC_REGIONS, { context: '가상특별시 누리구', lotText: '123-4' });
  assert.equal(sgg.ok, false);
  assert.equal(sgg.code, 'REGION_NOT_LEAF');
  assert.ok(sgg.candidates.length >= 2);
});

test('1-e PNU 오류·0번지·비정형·행정구역 변경', () => {
  assert.equal(parseLotInput('990110100010123000').code, 'PNU_LENGTH_INVALID', '18자리');
  assert.equal(parseLotInput('99011010001012300041').code, 'PNU_LENGTH_INVALID', '20자리');
  assert.equal(validatePnu('9901101000301230004').code, 'PNU_STRUCTURE_INVALID', '대장구분 3');
  assert.equal(validatePnu('9901101000100000004').code, 'PNU_STRUCTURE_INVALID', '본번 0');
  assert.equal(parseLotInput('0').code, 'LOT_ZERO_INVALID');
  assert.equal(parseLotInput('0-1').code, 'LOT_ZERO_INVALID');
  for (const value of ['123-4 외 2필지', '123~125', '123, 124', '김씨 소유 123', '123 일대', '12345-1']) {
    assert.notEqual(parseLotInput(value).ok, true, value);
  }
  const changed = resolveConsultationInput(SYNTHETIC_REGIONS, { context: '가상특별시 누리구 옛터동', lotText: '10' });
  assert.equal(changed.code, 'REGION_ADMIN_CHANGED');
  assert.equal(changed.candidates[0].pnu, null, '승계 법정동 자동 적용 금지');
});

test('1-f 존재하지 않는 필지: 빈 값·거짓 숫자 없이 미조회', async () => {
  const s = session();
  await s.lookup({ context: NURI, lotText: '999', baseYear: 2026 });
  const d = s.state.draft;
  assert.equal(s.state.phase, 'READY');
  for (const field of Object.values(d.fields)) {
    assert.equal(field.value, null, field.key);
    assert.equal(field.status, STATUS.NOT_QUERIED, field.key);
  }
  assert.notEqual(d.map.status, 'EXACT_ONE');
});

test('2 지적 exact-one / multiple / mismatch / not-found / 지도 키 없음', async () => {
  const cases = [['123-4', 'EXACT_ONE', 'EXACT_ONE'], ['140', 'POINT_FALLBACK', 'VWORLD_PNU_GEOMETRY_NOT_UNIQUE'], ['141', 'POINT_FALLBACK', 'VWORLD_PNU_GEOMETRY_MISMATCH'], ['170', 'POINT_FALLBACK', 'VWORLD_PNU_GEOMETRY_NOT_FOUND']];
  for (const [lot, status, code] of cases) {
    const s = session();
    await s.lookup({ context: NURI, lotText: lot, baseYear: 2026 });
    assert.equal(s.state.draft.map.status, status, lot);
    assert.equal(s.state.draft.map.code, code, lot);
    if (status !== 'EXACT_ONE') { assert.equal(s.state.draft.map.geometry, null, `${lot}: 확정 도형 사용 금지`); assert.ok(s.state.draft.map.point, `${lot}: 좌표 점`); }
  }
  const noKey = session({ scenario: 'NO_MAP_KEY' });
  await noKey.lookup({ context: NURI, lotText: '123-4', baseYear: 2026 });
  assert.equal(noKey.state.draft.map.status, 'KEY_REQUIRED');
  assert.equal(noKey.state.draft.fields.land_category.status, STATUS.OK, '지도 실패가 공적자료를 막지 않음');
  assert.equal(evaluateGeometry('1', { ok: true, features: [] }).code, 'VWORLD_PNU_GEOMETRY_NOT_FOUND');
});

test('2-b 늦은 응답 폐기: 이전 필지 응답이 새 필지 드래프트에 섞이지 않음', async () => {
  const s = session();
  const slow = s.lookup({ context: NURI, lotText: '150', baseYear: 2026 });
  await new Promise((r) => setTimeout(r, 40));
  await s.lookup({ context: NURI, lotText: '123-4', baseYear: 2026 });
  await slow;
  assert.equal(s.state.draft.parcel.pnu, '9901101000101230004');
  assert.equal(s.state.draft.fields.area_m2.value, 412.5, '150번지 면적(501.2)이 섞이면 안 됨');
  assert.ok(s.state.discarded_responses >= 1);
});

test('3 연도별 모순·필수값 빈칸·연도 자료 없음·API 제한/장애', async () => {
  const y = session();
  await y.lookup({ context: NURI, lotText: '130', baseYear: 2026 });
  const kinds = y.state.draft.analysis.signals.map((s) => s.kind);
  assert.ok(kinds.includes('YEAR_CHANGE'));
  assert.ok(kinds.includes('CATEGORY_USE_DIFF'));
  assert.equal(y.state.draft.fields.land_use.status, STATUS.FIELD_CHECK);
  assert.equal(y.state.draft.fields.road_access.status, STATUS.MISMATCH);

  const blank = session();
  await blank.lookup({ context: NURI, lotText: '125', baseYear: 2026 });
  assert.equal(blank.state.draft.fields.road_access.value, null);
  assert.equal(blank.state.draft.fields.road_access.status, STATUS.NOT_QUERIED);
  assert.equal(blank.state.draft.fields.price_per_m2.status, STATUS.OK);

  const missingYear = session();
  await missingYear.lookup({ context: NURI, lotText: '180', baseYear: 2026 });
  assert.equal(missingYear.state.draft.fields.price_per_m2.value, null, '2025값 자동 대체 금지');
  assert.match(missingYear.state.draft.fields.price_per_m2.note, /자동 대체하지 않음/);

  const limited = session();
  await limited.lookup({ context: NURI, lotText: '160', baseYear: 2026 });
  assert.match(limited.state.draft.fields.land_category.note, /API_RATE_LIMITED/);
  assert.equal(limited.state.draft.fields.land_category.value, null);

  const down = session({ scenario: 'API_DOWN' });
  await down.lookup({ context: NURI, lotText: '123-4', baseYear: 2026 });
  assert.ok(Object.values(down.state.draft.fields).every((f) => f.value === null));
});

test('5 공적자료 원본과 전문가 수정값 출처 분리 + 입력 전환 혼합 방지', async () => {
  const s = session();
  await s.lookup({ context: NURI, lotText: '123-4', baseYear: 2026 });
  assert.equal(s.overrideField('land_use', { value: '상업용', by: '' }), false, '수정자 없는 수정 금지');
  assert.equal(s.overrideField('land_use', { value: '상업용', by: '상담자A(합성)', reason: '현장사진 확인 전 가정' }), true);
  const field = s.state.draft.fields.land_use;
  assert.equal(field.value, '단독주택', '공적자료 원본 보존');
  assert.equal(field.override.value, '상업용');
  assert.equal(field.reviewed, false);
  await s.lookup({ context: '가상도 연습군 숲내면 바위리', lotText: '산 12-3', baseYear: 2026 });
  assert.equal(s.state.draft.fields.land_use.override, null, '새 필지에 이전 수정값 이월 금지');
  assert.equal(s.state.draft.fields.land_category.value, '임야');
});

test('6 저장: 명시 확인 필요, API 키·URL 키·지도 원본 좌표 저장 금지', async () => {
  const s = session();
  await s.lookup({ context: NURI, lotText: '123-4', baseYear: 2026 });
  assert.equal(s.saveExplicit({ confirmedByUser: false }).ok, false);
  s.state.draft.fields.zoning.source = 'https://api.example.invalid/req?serviceKey=SECRET123&pnu=1';
  s.state.draft.apiKey = 'SECRET-SHOULD-NOT-SAVE';
  const saved = s.saveExplicit({ confirmedByUser: true });
  assert.equal(saved.ok, true);
  const json = JSON.stringify(saved.payload);
  assert.doesNotMatch(json, /SECRET/);
  assert.equal(saved.payload.map.geometry_persisted, false);
  assert.equal(saved.payload.map.geometry, undefined);
  assert.equal(saved.payload.map.neighbors, undefined);
  assert.equal(saved.payload.bso_handoff.status, 'NOT_SENT');
  assert.equal(buildSavePayload(s.state.draft).map.capture_date, '미확인');
});

test('합성 데이터 경계: 모든 합성 PNU는 98/99 시도코드, 실제 사건명 미사용', () => {
  for (const pnu of Object.keys(SYNTHETIC_PARCELS)) { assert.match(pnu, /^9[89]\d{17}$/); assert.equal(validatePnu(pnu).ok, true); }
  const dir = path.join(root, 'browser', 'consultation-sim');
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => /\.(js|html|css)$/.test(f));
  for (const file of files) {
    const body = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(body, /신림/, `${file}: 실제 사건명 금지`);
    assert.doesNotMatch(body, /(serviceKey|apiKey)\s*[:=]\s*['"][A-Za-z0-9]{8,}/, `${file}: 키 하드코딩 금지`);
  }
});

test('브리지 어댑터: 키 없으면 합성 대체 없이 API 키/권한 필요, 지도 실연결 보류', async () => {
  const fetchImpl = async (url) => ({
    json: async () => (String(url).endsWith('/status') ? { ok: true, vworld_configured: false, public_data_configured: false }
      : String(url).endsWith('/resolve_pnu') ? { ok: false, error_code: 'PUBLIC_DATA_KEY_MISSING' }
        : { ok: false, error_code: 'VWORLD_API_KEY_MISSING' }),
  });
  const adapter = createBridgeAdapter({ fetchImpl });
  assert.equal((await adapter.status()).characteristics, false);
  assert.equal((await adapter.resolveParcel({ context: '', lotText: '123-4' })).code, 'REGION_CONTEXT_REQUIRED', '브리지 호출 전 차단');
  const r = await adapter.resolveParcel({ context: '어느시 어느동', lotText: '1' });
  assert.equal(r.ok, false);
  assert.match(r.message, /API 키\/권한 필요/);
  const s = createConsultationSession({ adapter });
  s.state.input = { baseYear: 2026 };
  s.state.resolution = { candidates: [{ pnu: '9901101000101230004', legal_dong_name: 'x', lot_label: '123-4' }] };
  await s.selectCandidate('9901101000101230004');
  assert.equal(s.state.draft.fields.land_category.status, STATUS.KEY_REQUIRED);
  assert.equal(s.state.draft.map.status, 'KEY_REQUIRED');
  assert.equal(s.state.draft.fields.land_category.value, null);
});

test('리뷰 반영: 폐지 법정동은 PNU 직접입력으로도 선택 불가', async () => {
  const r = resolveConsultationInput(SYNTHETIC_REGIONS, { context: '', lotText: '9901199000100100000' });
  assert.equal(r.code, 'REGION_ADMIN_CHANGED');
  assert.equal(r.candidates[0].pnu, null);
  const s = session();
  await s.lookup({ context: '', lotText: '9901199000100100000', baseYear: 2026 });
  assert.notEqual(s.state.phase, 'READY');
  assert.equal(s.state.draft, null);
});

test('리뷰 반영: 브리지 실패 응답은 캐시하지 않아 재조회 시 다시 호출', async () => {
  let calls = 0; let healthy = false;
  const fetchImpl = async (url) => ({ json: async () => {
    if (String(url).endsWith('/vworld_land')) { calls += 1; return healthy ? { ok: true, record: { land_category: '대', individual_official_price: 1000, price_year: 2026 } } : { ok: false, error_code: 'API_RATE_LIMITED' }; }
    return { ok: true };
  } });
  const adapter = createBridgeAdapter({ fetchImpl });
  const pnu = '9901101000101230004';
  const [a, b] = await Promise.all([adapter.getLandCharacteristics(pnu, 2026), adapter.getIndividualPrice(pnu, 2026)]);
  assert.equal(a.ok, false); assert.equal(b.ok, false);
  assert.equal(calls, 1, '동시 요청은 1회로 묶음');
  healthy = true;
  const retry = await adapter.getLandCharacteristics(pnu, 2026);
  assert.equal(retry.ok, true);
  assert.equal(calls, 2, '실패 후 재조회는 브리지를 다시 호출');
  await adapter.getIndividualPrice(pnu, 2026);
  assert.equal(calls, 2, '성공 응답은 재사용');
});

test('리뷰 반영: 브리지 주소는 정규화된 지번 구성요소로 전달', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body)); return { json: async () => ({ ok: false, error_code: 'LEGAL_DONG_NOT_FOUND' }) }; };
  const adapter = createBridgeAdapter({ fetchImpl });
  await adapter.resolveParcel({ context: '어느시 어느구', lotText: '어느동 １２３ － ４번지' });
  await adapter.resolveParcel({ context: '어느군 어느면 어느리', lotText: '산 12 - 3' });
  assert.equal(sent[0].parcel_address, '어느시 어느구 어느동 123-4');
  assert.equal(sent[1].parcel_address, '어느군 어느면 어느리 산12-3');
});

test('배포 보안: 실데이터 브리지 서버는 루프백(127.0.0.1)에만 바인딩, 시연판은 브리지·네트워크 코드 없음', async () => {
  const server = fs.readFileSync(path.join(root, 'scripts', 'serve_product_v2.js'), 'utf8');
  assert.match(server, /const host = '127\.0\.0\.1';/);
  assert.match(server, /server\.listen\(port, host,/);
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build_consultation_sim_demo.js'), '--host=static'], { stdio: 'pipe' });
  const demo = fs.readFileSync(path.join(root, 'dist', 'consultation-sim-demo', 'index.html'), 'utf8');
  assert.doesNotMatch(demo, /__public_data_bridge|\bfetch\s*\(|XMLHttpRequest|api\.vworld\.kr/);
  assert.match(demo, /"synthetic_only":true/);
  assert.match(demo, /LIVE_BRIDGE_EXCLUDED_FROM_PUBLIC_DEMO/);
});
