'use strict';
// BSO 상담 시뮬레이터 공개 시연판 빌드 — 합성 데이터 전용 단일 HTML.
// - 실데이터 어댑터(bridge-adapter.js, vworld-direct-adapter.js)는 번들에서 제외하고 호출 시 예외를 던지는 스텁으로 대체한다.
// - 외부 네트워크 호출·키·브리지 경로·실제 사건명 흔적이 있으면 빌드를 실패시킨다.
// - Product v2 / Release v1 / 기존 Cloudflare·Netlify 빌드와 무관한 별도 출력(dist/consultation-sim-demo).
// 사용: node scripts/build_consultation_sim_demo.js [--host=claude-artifact|static] [--variant=synthetic|vworld-direct-test]
// - vworld-direct-test: Fold8 HTTPS 출처 검증용. VWorld 직접 어댑터만 포함(키 미포함, 사용자가 화면에서 입력), 로컬 브리지는 계속 제외.
//   외부 주소는 https://api.vworld.kr 하나만 허용. 아티팩트 호스트와는 조합 불가(CSP가 외부 스크립트 차단).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'browser', 'consultation-sim');
const hostArg = (process.argv.find((arg) => arg.startsWith('--host=')) || '--host=claude-artifact').slice(7);
if (!['claude-artifact', 'static'].includes(hostArg)) throw new Error(`unknown host: ${hostArg}`);
const variant = (process.argv.find((arg) => arg.startsWith('--variant=')) || '--variant=synthetic').slice(10);
if (!['synthetic', 'vworld-direct-test'].includes(variant)) throw new Error(`unknown variant: ${variant}`);
const LIVE = variant === 'vworld-direct-test';
if (LIVE && hostArg !== 'static') throw new Error('vworld-direct-test requires --host=static (artifact CSP blocks api.vworld.kr)');
const out = path.join(root, 'dist', LIVE ? 'consultation-sim-live-test' : 'consultation-sim-demo');

const ORDER = [
  'core/pnu.js',
  'adapters/synthetic-data.js',
  'core/ned-revisions.js',
  'core/standard-land-engine.js',
  'core/consult-opinion.js',
  'core/consultation-session.js',
  'core/manual-pack.js',
  'core/consult-intake.js',
  'core/case-tracks.js',
  'core/consult-record.js',
  'core/output-binding.js',
  'core/consult-report.js',
  'adapters/synthetic-adapter.js',
  'map-view.js',
  'app.js',
];
const STUBS = {
  'adapters/bridge-adapter.js': 'function createBridgeAdapter() { throw new Error("LIVE_BRIDGE_EXCLUDED_FROM_PUBLIC_DEMO"); }\nreturn { createBridgeAdapter };',
  'adapters/vworld-direct-adapter.js': 'function createVworldDirectAdapter() { throw new Error("VWORLD_DIRECT_EXCLUDED_FROM_PUBLIC_DEMO"); }\nconst DIRECT_PROBE = Object.freeze({ address: "", note: "" });\nreturn { createVworldDirectAdapter, DIRECT_PROBE };',
};

function transform(key, code) {
  const exported = [];
  const body = code
    .replace(/^import\s*\{([^}]+)\}\s*from\s*'([^']+)';\s*$/gm, (_m, names, rel) => {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(key), rel));
      if (!ORDER.includes(target) && !STUBS[target] && target !== 'adapters/vworld-direct-adapter.js') throw new Error(`${key}: unknown import ${rel}`);
      return `const {${names}} = __bsoModules[${JSON.stringify(target)}];`;
    })
    .replace(/^export\s+(async\s+function|function|const)\s+([A-Za-z_$][\w$]*)/gm, (_m, kind, name) => { exported.push(name); return `${kind} ${name}`; });
  if (/^\s*(import|export)\s/m.test(body)) throw new Error(`${key}: unsupported import/export form`);
  return `__bsoModules[${JSON.stringify(key)}] = (() => {\n${body}\nreturn { ${exported.join(', ')} };\n})();`;
}

const parts = ['"use strict";', 'const __bsoModules = Object.create(null);'];
if (path.dirname(out) !== path.join(root, 'dist')) throw new Error('Invalid demo output');
const order = LIVE ? [...ORDER.slice(0, -1), 'adapters/vworld-direct-adapter.js', ORDER[ORDER.length - 1]] : ORDER;
const stubs = Object.fromEntries(Object.entries(STUBS).filter(([key]) => !(LIVE && key === 'adapters/vworld-direct-adapter.js')));
for (const [key, stub] of Object.entries(stubs)) parts.push(`__bsoModules[${JSON.stringify(key)}] = (() => {\n${stub}\n})();`);
for (const key of order) parts.push(transform(key, fs.readFileSync(path.join(src, key), 'utf8')));
const script = parts.join('\n\n').replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(src, 'styles.css'), 'utf8');
const runtime = LIVE
  ? { synthetic_only: false, live_test: true, host: hostArg, build: 'vworld-direct-test' }
  : { synthetic_only: true, host: hostArg, build: 'public-demo' };

let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const swap = (from, to) => { if (!html.includes(from)) throw new Error(`index.html anchor missing: ${from}`); html = html.replace(from, () => to); };
swap('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`);
swap('<meta name="referrer" content="no-referrer">', '<meta name="referrer" content="no-referrer">\n  <meta name="robots" content="noindex,nofollow">');
swap('<title>BSO 지번 상담 시뮬레이터 · 검토 보조</title>', LIVE ? '<title>BSO 지번 상담 · 실데이터 연결 테스트(비공개)</title>' : '<title>BSO 지번 상담 시연판 · 합성 데이터</title>');
swap('<script type="module" src="app.js"></script>', `<script>window.BSO_CONSULT_RUNTIME = ${JSON.stringify(runtime)};</script>\n  <script>\n(() => {\n${script}\n})();\n  </script>`);
if (!/^<!doctype html>/i.test(html)) throw new Error('demo must start with doctype');

// 공개 배포물 안전 검사
const FORBIDDEN = [
  [/__public_data_bridge/, '로컬 브리지 경로'],
  [/\bfetch\s*\(/, '네트워크 fetch 호출'],
  [/XMLHttpRequest|WebSocket|sendBeacon/, '네트워크 API'],
  LIVE ? [/apis\.data\.go\.kr|https?:\/\/(?!www\.w3\.org|api\.vworld\.kr['\/])/, 'VWorld 외 외부 URL']
    : [/api\.vworld\.kr|apis\.data\.go\.kr|https?:\/\/(?!www\.w3\.org)/, '외부 URL'],
  // 키 값처럼 보이는 문자열(숫자 포함 16자 이상)이 키 이름 뒤에 붙은 경우만 차단. 마스킹용 정규식 자체는 허용.
  [/(serviceKey|apiKey|api_key|authKey|key)\s*[:=]\s*['"]?(?=[A-Za-z0-9%+/=-]*\d)[A-Za-z0-9%+/=-]{16,}|VWORLD_API_KEY\s*=|PUBLIC_DATA_SERVICE_KEY\s*=/i, 'API 키 흔적'],
  [/신림/, '실제 사건명'],
  [/localStorage\.setItem|sessionStorage\.setItem|indexedDB\.open/, '브라우저 영구저장'],
];
for (const [pattern, label] of FORBIDDEN) {
  const hit = html.match(pattern);
  if (hit) throw new Error(`public demo safety check failed (${label}): ${hit[0].slice(0, 60)}`);
}
const pnus = html.match(/\b\d{19}\b/g) || [];
const nonSynthetic = pnus.filter((pnu) => !/^9[89]/.test(pnu));
if (nonSynthetic.length) throw new Error(`non-synthetic PNU in demo: ${nonSynthetic[0]}`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
const sha = crypto.createHash('sha256').update(html).digest('hex');
fs.writeFileSync(path.join(out, 'demo-manifest.json'), `${JSON.stringify({
  schema_version: 'bso-consultation-sim-demo/0.1', host: hostArg, variant, data: LIVE ? 'SYNTHETIC_DEFAULT_PLUS_VWORLD_DIRECT_WITH_USER_KEY' : 'SYNTHETIC_ONLY', live_bridge: 'EXCLUDED',
  network_calls: LIVE ? 'api.vworld.kr JSONP only, after user enters key' : 'NONE', persistence: 'NONE_EXCEPT_EXPLICIT_USER_SAVE', index_sha256: sha, bytes: Buffer.byteLength(html),
}, null, 2)}\n`);
console.log(`consultation simulator ${LIVE ? 'live-test' : 'public demo'} built: ${path.join(out, 'index.html')} (${Buffer.byteLength(html)} bytes, host=${hostArg}, variant=${variant}, sha256=${sha.slice(0, 12)})`);
