'use strict';
// 표준지 개별 직접조회 — 실제 VWorld 검증(사용자 PC 전용, 키는 .env에만 · 출력·파일에 키 없음).
//
// 1) 실 API 검증: 이 체크아웃의 scripts/field_server.js를 루프백 임시 포트로 띄워(토큰·허용계정 없음, 이 PC 안에서만)
//    대상 PNU 주변 표준지 → 화면과 같은 엔진으로 후보 ①②③ → 각 후보 PNU·공시연도 직접조회 → 같은 요청 반복(캐시 확인).
//    node scripts/verify_standard_traits_live.js --pnu <19자리> --year 2026 [--zoning 계획관리지역] [--env .env]
//    결과: local-data/field-server/std-direct-live-<시각>.json (gitignore 경로, 공개·커밋 금지)
//
// 2) 배포 확인: 실행 중인 시험 서버(Tailscale HTTPS)의 서버 코드·화면 버전이 이 체크아웃과 같은지.
//    node scripts/verify_standard_traits_live.js --check-deployed https://<기기>.<tailnet>.ts.net:10005
//    (접근 토큰은 local-data/field-server/access-token.txt에서 읽어 쿠키로만 보냄 · 화면 출력 없음)
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { SERVER_REV, CAPABILITIES } = require('./field_server.js');

const root = path.resolve(__dirname, '..');
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const UI_REV = (/name="bso-field-ui-rev" content="([^"]+)"/.exec(fs.readFileSync(path.join(root, 'browser', 'consultation-sim', 'field.html'), 'utf8')) || [])[1] || null;

async function checkDeployed(base) {
  const stateDir = process.env.BSO_FIELD_STATE_DIR ? path.resolve(process.env.BSO_FIELD_STATE_DIR) : path.join(root, 'local-data', 'field-server');
  const tokenFile = path.join(stateDir, 'access-token.txt');
  const headers = fs.existsSync(tokenFile) ? { Cookie: `bso_field=${fs.readFileSync(tokenFile, 'utf8').trim()}` } : {};
  const status = await fetch(new URL('/__public_data_bridge/status', base), { headers }).then(async (r) => ({ http: r.status, body: await r.json().catch(() => null) }));
  const page = await fetch(new URL('/', base), { headers }).then(async (r) => ({ http: r.status, text: await r.text() }));
  const pageRev = (/name="bso-field-ui-rev" content="([^"]+)"/.exec(page.text) || [])[1] || null;
  const b = status.body || {};
  const report = {
    url_host: new URL(base).host, checked_at: new Date().toISOString(),
    server: { http: status.http, server_rev: b.server_rev || null, expected: SERVER_REV, capabilities: b.capabilities || null, ok: b.server_rev === SERVER_REV && Array.isArray(b.capabilities) && CAPABILITIES.every((c) => b.capabilities.includes(c)) },
    page: { http: page.http, ui_rev: pageRev, expected: UI_REV, ok: pageRev === UI_REV },
    vworld_configured: Boolean(b.vworld_configured), standard_traits_metrics: b.standard_traits_metrics || null,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.server.ok) console.error('✗ 서버 코드가 이 체크아웃과 다름(또는 인증 실패) — 이 체크아웃의 scripts/field_server.js로 시험 서버를 다시 시작하세요.');
  if (!report.page.ok) console.error('✗ 화면 HTML 버전이 이 체크아웃과 다름 — --page 경로의 HTML을 다시 빌드·지정하세요.');
  process.exit(report.server.ok && report.page.ok ? 0 : 1);
}

async function live() {
  const pnu = String(arg('pnu') || ''); const year = Number(arg('year'));
  if (!/^\d{19}$/.test(pnu) || !Number.isInteger(year)) { console.error('사용: --pnu <19자리> --year <공시연도> [--zoning 용도지역] [--env .env]'); process.exit(2); }
  const port = 4600 + Math.floor(Math.random() * 300);
  const page = path.join(root, 'dist', 'notice-field', 'field-empty.html');
  const child = spawn(process.execPath, [path.join(__dirname, 'field_server.js'), '--page', page, '--port', String(port), '--env', arg('env', path.join(root, '.env'))],
    { cwd: root, env: { ...process.env, BSO_FIELD_STATE_DIR: path.join(root, 'local-data', 'field-server-verify') }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, no) => { child.stdout.on('data', (d) => { if (String(d).includes('BSO field server')) ok(); }); child.on('exit', () => no(new Error('server exited'))); setTimeout(() => no(new Error('start timeout')), 15000); });
    const base = `http://127.0.0.1:${port}/__public_data_bridge`;
    const post = (op, body) => fetch(`${base}/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const status = await fetch(`${base}/status`).then((r) => r.json());
    if (!status.vworld_configured) throw new Error('VWORLD_API_KEY 미설정(.env)');
    const land = await post('vworld_land', { pnu, standard_year: year, dedupe_revisions: true });
    const t = land.record || {};
    const std = await post('standard_lands', { pnu, year, radius_m: 1000, review_zoning: arg('zoning', t.zoning || '') });
    if (!std.ok) throw new Error(`standard_lands 실패: ${std.error_code}`);
    const { buildStandardReview, directTargets, applyDirect } = await import(pathToFileURL(path.join(root, 'browser', 'consultation-sim', 'core', 'field-standard.js')).href);
    const sr = buildStandardReview({ response: std, target: { zoning: arg('zoning', t.zoning), land_use: t.land_use, land_category: t.land_category, road_access: t.road_access, shape: t.shape, elevation: t.elevation } });
    const items = directTargets(sr, null);
    if (!items.length) throw new Error(`후보 없음(판정 ${sr.status}) — 다른 PNU로 시험`);
    const first = await post('standard_traits', { items });
    const second = await post('standard_traits', { items });
    const rows = items.map((it) => {
      const cand = sr.list.find((x) => x.pnu === it.pnu && Number(x.year) === it.year);
      const got = (first.items || []).find((x) => x.pnu === it.pnu && Number(x.year) === it.year) || {};
      const merged = applyDirect(cand, got);
      return { rank: cand.rank, pnu: it.pnu, year: it.year, lot: cand.label, status: got.status, code: got.code || null,
        response_pnu: got.record?.pnu || null, response_year: got.record?.stdrYear || null,
        pnu_year_match: got.record ? got.record.pnu === it.pnu && String(got.record.stdrYear) === String(it.year) : false,
        traits: Object.fromEntries(['land_use', 'road_access', 'shape', 'elevation'].map((k) => [k, { value: merged.traits[k]?.value ?? null, status: merged.traits[k]?.status }])),
        area: merged.area ?? null, zoning: merged.zoning ?? null, land_category: merged.land_category ?? null, mismatches: merged.direct?.mismatches || [] };
    });
    const report = {
      checked_at: new Date().toISOString(), target_pnu: pnu, year, server_rev: status.server_rev, candidates: rows,
      calls: { standard_lands_vworld: std.request_count, standard_traits_first: first.request_count, standard_traits_second: second.request_count, cache_second: second.cache },
      server_metrics_after: (await fetch(`${base}/status`).then((r) => r.json())).standard_traits_metrics,
      source: first.source,
    };
    const outDir = path.join(root, 'local-data', 'field-server'); fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `std-direct-live-${report.checked_at.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.table(rows.map((r) => ({ 순위: r.rank, PNU: r.pnu, 연도: r.year, 상태: r.status, 'PNU·연도 일치': r.pnu_year_match, 이용상황: r.traits.land_use.value, 도로접면: r.traits.road_access.value, 형상: r.traits.shape.value, 지세: r.traits.elevation.value, 면적: r.area, 불일치: r.mismatches.join(',') })));
    console.log(`VWorld 호출: 표준지 검색 ${std.request_count?.total ?? '?'}회 · 직접조회 1차 ${first.request_count?.land_characteristics ?? '?'}회 · 2차 ${second.request_count?.land_characteristics ?? '?'}회(캐시 재사용 ${second.cache?.hits ?? '?'}건)`);
    console.log(`보고서: ${path.relative(root, out)}`);
    const pass = rows.every((r) => r.status === 'OK' && r.pnu_year_match) && second.request_count?.land_characteristics === 0;
    console.log(pass ? '✓ 후보 전원 직접조회 성공 · PNU·연도 일치 · 2차 호출 0회(캐시)' : '✗ 일부 후보 실패·불일치 또는 캐시 미적용 — 보고서 확인');
    process.exitCode = pass ? 0 : 1;
  } finally { child.kill(); }
}

(process.argv.includes('--check-deployed') ? checkDeployed(arg('check-deployed')) : live()).catch((e) => { console.error(`실패: ${String(e.message || e)}`); process.exit(1); });
