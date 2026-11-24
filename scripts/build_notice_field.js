'use strict';
// BSO 현장 지번 상담 — 단일 HTML 빌드(오프라인 백업 겸 Fold8용). 전국 공통, 사업 색인은 로컬 파일에서만 넣는다.
// 사용: node scripts/build_notice_field.js --index <local-data/notice-index/*.json> [--out dist/notice-field/<name>.html]
//       --index 없이 빌드하면 색인을 내장하지 않은 빈 화면(화면에서 색인 JSON을 직접 고름).
// - 실데이터 색인을 넣은 결과물은 dist/(gitignore) 아래에만 쓴다. 공개 배포·커밋 금지.
// - 개인정보 키·외부 URL·영구저장 API·키 흔적이 있으면 빌드를 실패시킨다.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'browser', 'consultation-sim');
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };

const ORDER = ['core/pnu.js', 'core/notice-index.js', 'core/field-issues.js', 'core/zoning-basis.js', 'core/field-card.js', 'core/field-direct.js', 'core/field-public-data.js', 'core/field-map.js',
  'profiles/osong3.js', 'profiles/index.js', 'field.js'];

function transform(key, code) {
  const exported = [];
  const body = code
    .replace(/^import\s*\{([^}]+)\}\s*from\s*'([^']+)';\s*$/gm, (_m, names, rel) => {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(key), rel));
      if (!ORDER.includes(target)) throw new Error(`${key}: unknown import ${rel}`);
      return `const {${names}} = __bsoModules[${JSON.stringify(target)}];`;
    })
    .replace(/^export\s+(async\s+function|function|const)\s+([A-Za-z_$][\w$]*)/gm, (_m, kind, name) => { exported.push(name); return `${kind} ${name}`; });
  if (/^\s*(import|export)\s/m.test(body)) throw new Error(`${key}: unsupported import/export form`);
  return `__bsoModules[${JSON.stringify(key)}] = (() => {\n${body}\nreturn { ${exported.join(', ')} };\n})();`;
}

async function main() {
  const { validateNoticeIndex } = await import(require('node:url').pathToFileURL(path.join(src, 'core', 'notice-index.js')).href);
  const indexPath = arg('index');
  let index = null; let check = null;
  if (indexPath) {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    delete index.stats;
    check = validateNoticeIndex(index);
    if (!check.ok) throw new Error(`index invalid: ${check.errors.join(' / ')}`);
  }
  const parts = ['"use strict";', 'const __bsoModules = Object.create(null);'];
  for (const key of ORDER) parts.push(transform(key, fs.readFileSync(path.join(src, key), 'utf8')));
  const script = parts.join('\n\n').replace(/<\/script/gi, '<\\/script');
  const css = fs.readFileSync(path.join(src, 'field.css'), 'utf8');
  let html = fs.readFileSync(path.join(src, 'field.html'), 'utf8');
  const swap = (from, to) => { if (!html.includes(from)) throw new Error(`field.html anchor missing: ${from}`); html = html.replace(from, () => to); };
  swap('<link rel="stylesheet" href="field.css">', `<style>\n${css}\n</style>`);
  const data = index ? `<script type="application/json" id="bso-notice-index">${JSON.stringify(index).replace(/</g, '\\u003c')}</script>\n  ` : '';
  swap('<script type="module" src="field.js"></script>', `${data}<script>\n(() => {\n${script}\n})();\n  </script>`);

  // 안전 검사: 외부 URL은 고시 원문 주소(표시용 텍스트)만, 네트워크는 로컬 브리지 상대경로만.
  const allowedUrls = new Set(['http://www.w3.org', ...(index?.notice?.source_url ? [index.notice.source_url] : []), 'https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp?seq=618070']);
  const urls = (html.match(/https?:\/\/[^\s"'<>)`]+/g) || []).filter((u) => ![...allowedUrls].some((a) => u.startsWith(a)));
  if (urls.length) throw new Error(`external URL in field build: ${urls[0]}`);
  const FORBIDDEN = [
    [/localStorage\.setItem|sessionStorage\.setItem|indexedDB\.open/, '브라우저 영구저장'],
    [/XMLHttpRequest|WebSocket|sendBeacon/, '네트워크 API'],
    [/(serviceKey|apiKey|api_key|authKey)\s*[:=]\s*['"]?[A-Za-z0-9%+/=-]{16,}|VWORLD_API_KEY\s*=|PUBLIC_DATA_SERVICE_KEY\s*=/i, 'API 키 흔적'],
    [/"(owner|owners|owner_name|소유자|성명|주소|address)"\s*:/, '개인정보 키'],
  ];
  for (const [pattern, label] of FORBIDDEN) { const hit = html.match(pattern); if (hit) throw new Error(`field build safety check failed (${label}): ${hit[0].slice(0, 60)}`); }
  const fetchTargets = (script.match(/fetch\w*\(\s*`?([^`),]*)/g) || []);
  if (!/const PREFIX = '\/__public_data_bridge'/.test(script)) throw new Error('bridge prefix changed');

  const name = index ? `${(index.notice?.id || 'notice').replace(/[^a-z0-9-]/gi, '')}-field.html` : 'field-empty.html';
  const out = path.resolve(arg('out') || path.join(root, 'dist', 'notice-field', name));
  if (!out.startsWith(path.join(root, 'dist') + path.sep) && index) throw new Error('real-data field build must be written under dist/ (gitignored)');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  const sha = crypto.createHash('sha256').update(html).digest('hex');
  const manifest = { schema_version: 'bso-notice-field/0.1', file: path.basename(out), sha256: sha, bytes: Buffer.byteLength(html),
    index: index ? { notice: index.notice?.notice_no, notice_id: index.notice?.id, rows: check.stats.rows, incorporated_area_m2_total: check.stats.incorporated_area_m2_total, ri_carried: check.stats.ri_carried } : null,
    network: 'LOCAL_BRIDGE_ONLY_WHEN_SERVED_FROM_LOOPBACK (file:// = offline, no calls)', persistence: 'NONE_EXCEPT_EXPLICIT_COPY_SAVE_PRINT', fetch_sites: fetchTargets.length };
  fs.writeFileSync(out.replace(/\.html$/, '.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`notice field built: ${out} (${manifest.bytes} bytes, sha256=${sha.slice(0, 12)}${index ? `, rows=${check.stats.rows}` : ', no index'})`);
}

main().catch((e) => { console.error(String(e?.stack || e)); process.exit(1); });
