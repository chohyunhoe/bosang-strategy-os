#!/usr/bin/env node
'use strict';
// 시험 전용 가짜 파이썬 워커(field_server.js의 PYTHON 대체). 합성 PNU만 · 네트워크·키 없음.
// 끝자리 규칙: …10000 OK · …20000 MISMATCH · …30000 FAILED · …40000 ROW_CONFLICT. 호출 기록은 FAKE_WORKER_LOG 파일에 한 줄씩.
const fs = require('node:fs');
let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  const p = JSON.parse(raw || '{}');
  if (process.env.FAKE_WORKER_LOG) fs.appendFileSync(process.env.FAKE_WORKER_LOG, `${JSON.stringify(p)}\n`);
  if (p.operation === 'status') { console.log(JSON.stringify({ ok: true, vworld_configured: true, public_data_configured: false })); return; }
  if (p.operation !== 'standard_traits') { console.log(JSON.stringify({ ok: false, error_code: 'UNSUPPORTED_OPERATION' })); return; }
  const items = p.items.map(({ pnu, year }) => {
    const base = { pnu, year, requested: { pnu, year } };
    const kind = pnu.slice(-5, -4);
    if (kind === '1') return { ...base, status: 'OK', record: { pnu, stdrYear: String(year), ladUseSittn: '510', ladUseSittnNm: '전', roadSideCode: '05', roadSideCodeNm: '세로(가)', tpgrphFrmCode: '05', tpgrphFrmCodeNm: '부정형', tpgrphHgCode: '02', tpgrphHgCodeNm: '평지', lndpclAr: '990', lndcgrCode: '01', lndcgrCodeNm: '전', prposArea1: '71', prposArea1Nm: '농림지역' }, verified: { pnu: true, year: true } };
    if (kind === '2') return { ...base, status: 'MISMATCH', response_keys: ['9999999999999999999|2026'] };
    if (kind === '3') return { ...base, status: 'FAILED', code: 'VWORLD_TRANSPORT_ERROR' };
    return { ...base, status: 'ROW_CONFLICT', rows: [{ pnu, stdrYear: String(year), roadSideCodeNm: '맹지' }, { pnu, stdrYear: String(year), roadSideCodeNm: '세로(가)' }], conflict_fields: ['roadSideCodeNm'] };
  });
  console.log(JSON.stringify({ ok: true, items, request_count: { land_characteristics: items.length, total: items.length }, source: 'synthetic' }));
});
