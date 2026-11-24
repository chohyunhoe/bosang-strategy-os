// BSO 고시 세목표 → 고시 세목 색인(bso-notice-index/1) 변환기 — 전국 공통, 로컬 전용
// - 텍스트 레이어가 있는 고시 PDF의 '수용·사용할 토지 세목' 표에서 일련번호·소재지(읍면·리)·지번·지목·공부면적·편입면적·PDF 쪽만 읽는다.
// - 소유자·관계인 열(첫 '성명' 머리글부터 오른쪽)은 좌표로 잘라내 아예 읽지 않는다. 출력·로그에도 남기지 않는다.
// - 원본 PDF와 결과 색인은 저장소에 올리지 않는다(기본 출력: local-data/notice-index/, .gitignore).
// 사용: node scripts/notice_index/import_notice_pdf.mjs --pdf <고시.pdf> --profile osong3 [--out <index.json>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { NOTICE_INDEX_SCHEMA, jimokName, validateNoticeIndex } from '../../browser/consultation-sim/core/notice-index.js';
import { lotLabel } from '../../browser/consultation-sim/core/pnu.js';
import { getProfile } from '../../browser/consultation-sim/profiles/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };

// ── 표 해석(순수 함수, 테스트 대상) ──────────────────────────────────────────────
const LOT_TOKEN = /^(산\s*)?(\d{1,4})(?:-(\d{1,4}))?$/;
const AREA_TOKEN = /^\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^\d+(?:\.\d+)?$/;
const area = (s) => Number(String(s).replace(/,/g, ''));

// items: [{str, x, y}] (PDF 좌표: y가 클수록 위). header: 직전 쪽에서 이어받은 열 위치.
export function findHeader(items) {
  const pick = (label) => items.find((it) => it.str.trim() === label);
  const loc = pick('소재지'); const lot = pick('지번'); const jimok = pick('지목'); const owner = pick('성명');
  if (!loc || !lot || !jimok || !owner) return null;
  return { loc_x: loc.x, lot_x: lot.x, jimok_x: jimok.x, owner_x: owner.x };
}

export function parseTablePage(items, header, { page, eupmyeons, riPattern = /^[가-힣]+(리|동|가)$/ }) {
  // 지분(1/1 등) 열 왼쪽만 사용 — 지분 열이 없으면 '성명' 머리글 왼쪽. 소유자·관계인 열은 이 함수 밖으로 나가지 않는다.
  const shareXs = items.filter((it) => it.x > header.jimok_x && it.x < header.owner_x && /^\d+\/\d+$/.test(it.str.trim())).map((it) => it.x);
  const cutoff = shareXs.length ? Math.min(...shareXs) - 1 : header.owner_x - 4;
  const left = items.filter((it) => it.str.trim() && it.x < cutoff).map((it) => ({ ...it, str: it.str.trim() }));
  const lines = new Map();
  for (const it of left) {
    const key = [...lines.keys()].find((y) => Math.abs(y - it.y) <= 2) ?? it.y;
    (lines.get(key) || lines.set(key, []).get(key)).push(it);
  }
  const ys = [...lines.keys()].sort((a, b) => b - a);
  const rows = []; const anomalies = [];
  for (const y of ys) {
    const line = lines.get(y).sort((a, b) => a.x - b.x);
    const serialTok = line.find((it) => it.x < header.loc_x - 2 && /^\d{1,5}$/.test(it.str));
    if (!serialTok) continue;
    const rest = line.filter((it) => it.x > header.loc_x + 15);
    let mountain = false; let lotTok = null;
    for (let i = 0; i < rest.length; i += 1) {
      const t = rest[i].str;
      if (t === '산' && rest[i + 1] && /^\d/.test(rest[i + 1].str)) { mountain = true; lotTok = rest[i + 1]; break; }
      const m = LOT_TOKEN.exec(t.replace(/\s+/g, ''));
      if (m && rest[i].x < header.jimok_x - 2) { mountain = Boolean(m[1]); lotTok = rest[i]; break; }
    }
    const jimokTok = rest.find((it) => Math.abs(it.x - header.jimok_x) <= 12 && jimokName(it.str));
    let areas = rest.filter((it) => it.x > header.jimok_x + 8 && AREA_TOKEN.test(it.str) && !/\//.test(it.str));
    if (areas.length === 1) {
      // 칸이 좁아 공부면적이 위·아래 줄로 접힌 경우('10,367.' + '0'): 편입면적 칸 왼쪽의 조각을 위→아래 순서로 잇는다.
      const inc = areas[0];
      const frags = left.filter((it) => it.x > header.jimok_x + 8 && it.x < inc.x - 2 && Math.abs(it.y - y) <= 8 && Math.abs(it.y - y) > 2 && /^[\d,.]+$/.test(it.str))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      const joined = frags.map((it) => it.str).join('');
      if (frags.length && AREA_TOKEN.test(joined)) areas = [{ str: joined, x: frags[0].x, y }, inc];
    }
    if (!lotTok || !jimokTok || areas.length < 2) {
      anomalies.push({ page, serial: Number(serialTok.str), reason: !lotTok ? 'LOT_MISSING' : !jimokTok ? 'JIMOK_MISSING' : 'AREA_MISSING', left_tokens: line.map((it) => it.str) });
      continue;
    }
    const lm = LOT_TOKEN.exec(lotTok.str.replace(/^산\s*/, '').replace(/\s+/g, ''));
    const bun = Number(lm[2]); const ji = lm[3] ? Number(lm[3]) : 0;
    // 소재지 열: 읍면은 행 위(+), 리는 행 아래(-)에 따로 찍힌다. 같은 행 높이 ±12 안에서 찾는다.
    const near = left.filter((it) => Math.abs(it.x - header.loc_x) <= 25 && Math.abs(it.y - y) <= 12);
    const riTok = near.filter((it) => riPattern.test(it.str) && !eupmyeons.includes(it.str)).sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0];
    const emTok = near.find((it) => eupmyeons.includes(it.str));
    rows.push({
      serial: Number(serialTok.str), eupmyeon: emTok ? emTok.str : null, ri: riTok ? riTok.str : null,
      mountain, bun, ji, lot_label: lotLabel({ mountain, bun, ji }), jimok_code: jimokTok.str, jimok: jimokName(jimokTok.str),
      ledger_area_m2: area(areas[0].str), incorporated_area_m2: area(areas[1].str), pdf_page: page,
    });
  }
  return { rows, anomalies };
}

// 리 이름이 반복 셀로 생략된 행은 직전 행의 리를 이어받고 CARRIED로 표시한다(원문 재확인 대상).
export function carryLocation(rows, defaultEupmyeon) {
  let ri = null; let em = defaultEupmyeon || null;
  return rows.map((r) => {
    const out = { ...r, ri_source: r.ri ? 'CELL' : 'CARRIED' };
    if (r.ri) ri = r.ri; else out.ri = ri;
    if (r.eupmyeon) em = r.eupmyeon; else out.eupmyeon = em;
    return out;
  });
}

async function main() {
  const pdfPath = arg('pdf'); const profileId = arg('profile');
  if (!pdfPath || !profileId) { console.error('사용: --pdf <고시.pdf> --profile <id> [--out <json>]'); process.exit(2); }
  const profile = getProfile(profileId);
  if (!profile?.notice) throw new Error(`profile ${profileId} has no notice metadata`);
  const require = createRequire(path.join(root, 'package.json'));
  const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const bytes = fs.readFileSync(pdfPath);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const [from, to] = profile.import.pages || [1, doc.numPages];
  const eupmyeons = [profile.location.eupmyeon];
  let header = null; let all = []; const anomalies = [];
  for (let p = from; p <= Math.min(to, doc.numPages); p += 1) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const items = tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
    header = findHeader(items) || header;
    if (!header) continue;
    const res = parseTablePage(items, header, { page: p, eupmyeons });
    all = all.concat(res.rows); anomalies.push(...res.anomalies);
  }
  all.sort((a, b) => a.serial - b.serial);
  const rows = carryLocation(all, profile.location.eupmyeon);
  const index = {
    schema: NOTICE_INDEX_SCHEMA,
    notice: { ...profile.notice, source_file_sha256: crypto.createHash('sha256').update(bytes).digest('hex'), pages: [from, to] },
    location: { ...profile.location },
    generated_at: new Date().toISOString(),
    generator: 'scripts/notice_index/import_notice_pdf.mjs (owner columns excluded by layout)',
    rows,
  };
  const check = validateNoticeIndex(index, { expected: profile.import.expected });
  const out = arg('out') || path.join(root, 'local-data', 'notice-index', `${profile.id}-${profile.notice.id}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify({ ...index, stats: check.stats }, null, 1)}\n`);
  // 로그: 집계·검증 결과만. 행 원문·개인정보는 출력하지 않는다.
  const perRi = {}; rows.forEach((r) => { perRi[r.ri] = (perRi[r.ri] || 0) + 1; });
  console.log(JSON.stringify({ out, pages: [from, to], rows: rows.length, stats: check.stats, per_ri: perRi, ok: check.ok, errors: check.errors, warnings: check.warnings,
    anomalies: anomalies.length, anomaly_samples: anomalies.slice(0, 8).map((a) => ({ page: a.page, serial: a.serial, reason: a.reason, left: a.left_tokens })) }, null, 1));
  process.exit(check.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(String(error?.stack || error)); process.exit(1); });
}
