// BSO 내부 실무기본서 연결(코드만 공개). 본문은 사용자가 기기에서 선택한 JSON을 메모리에만 보유한다.
// API/네트워크/스토리지 접근 없음. 참고문헌 탐색만 수행하며 법률 결론 또는 보상금 산정에 사용하지 않는다.
export const MANUAL_SCHEMA = 'LK_BSO_PRIVATE_MANUAL_KNOWLEDGE_PACK/0.1';

const CODE_COUNTS = Object.freeze({ T:46, S:11, B:12, R:6, Y:12, N:10, L:9, H:9, P:83 });
const NEEDED = Object.freeze(['쟁점', '판단기준', '근거', '확인자료', '편람쪽']);
const normalize = (v) => String(v == null ? '' : v).normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
const compact = (s) => normalize(s).replace(/\s+/g, '');

export function validateManualPack(pack) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return { ok:false, code:'PACK_NOT_OBJECT' };
  if (pack.schema !== MANUAL_SCHEMA) return { ok:false, code:'PACK_SCHEMA_MISMATCH' };
  if (pack.classification !== 'LK_INTERNAL_RESTRICTED_NOT_FOR_PUBLIC_GITHUB') return { ok:false, code:'PACK_CLASSIFICATION_MISSING' };
  if (pack.source?.review_status !== 'INTERNAL_DRAFT; NOT VERIFIED_AS_APPROVED_FINAL') return { ok:false, code:'PACK_REVIEW_STATUS_MISSING' };
  if (!Array.isArray(pack.issue_codes) || pack.issue_codes.length !== 198) return { ok:false, code:'PACK_ISSUE_COUNT_INVALID' };
  if (!Array.isArray(pack.all_pages_text) || pack.all_pages_text.length !== 320) return { ok:false, code:'PACK_PAGE_COUNT_INVALID' };
  const codes = new Map();
  for (const entry of pack.issue_codes) {
    if (!entry || !/^[TSBRYNLHP]-\d{2}$/.test(entry.code || '') || codes.has(entry.code)) return { ok:false, code:'PACK_CODE_INVALID' };
    if (typeof entry.title !== 'string' || !entry.title || !entry.sections || NEEDED.some((key) => typeof entry.sections[key] !== 'string')) {
      return { ok:false, code:'PACK_SECTION_MISSING' };
    }
    if (!Number.isInteger(entry.pdf_page_start) || !Number.isInteger(entry.pdf_page_end) || entry.pdf_page_start < 1 || entry.pdf_page_end > 320 || entry.pdf_page_end < entry.pdf_page_start) {
      return { ok:false, code:'PACK_SOURCE_PAGE_INVALID' };
    }
    codes.set(entry.code, true);
  }
  for (const [prefix, count] of Object.entries(CODE_COUNTS)) {
    for (let i = 1; i <= count; i++) {
      if (!codes.has(`${prefix}-${String(i).padStart(2, '0')}`)) return { ok:false, code:'PACK_CODE_GAP' };
    }
  }
  return { ok:true, code:'VALID_PRIVATE_REFERENCE_PACK', issue_count:198, page_count:320,
    review_status:'INTERNAL_DRAFT', source_sha256:pack.source?.source_pdf_sha256 || null };
}

export function searchManualPack(pack, term, maxResults = 10) {
  if (!pack?.issue_codes || !normalize(term)) return [];
  const q = compact(term);
  const exact = q.match(/^([tsbrynlhp])-?(\d{1,2})$/);
  const code = exact ? `${exact[1].toUpperCase()}-${exact[2].padStart(2, '0')}` : null;
  return pack.issue_codes.map((entry) => {
    const title = compact(entry.title);
    const codeMatched = Boolean(code && entry.code === code);
    const titleMatched = title.includes(q);
    const corpus = compact([entry.sections['쟁점'],entry.sections['확인자료'],entry.sections['판단기준']].join(' '));
    const contentMatched = !code && !titleMatched && corpus.includes(q);
    const rank = codeMatched ? 0 : title === q ? 1 : titleMatched ? 2 : contentMatched ? 3 : 99;
    return { entry, rank };
  }).filter((v) => v.rank !== 99).sort((a,b) => a.rank - b.rank || a.entry.code.localeCompare(b.entry.code))
    .slice(0,Math.max(1,Math.min(20,Number(maxResults)||10))).map((v) => v.entry);
}

// 지번만으로 법률쟁점의 성립을 추정하지 않는다. 아래 추천은 원문을 찾아볼 위치만 안내한다.
export function suggestManualReferences(pack, draft) {
  if (!pack?.issue_codes || !draft) return [];
  const terms = [];
  if (['FOUND','NONE'].includes(draft.analysis?.standard?.status)) terms.push('비교표준지 선정');
  if (draft.analysis?.signals?.some((s) => s.kind === 'YEAR_CHANGE')) terms.push('판단시점');
  if (draft.map?.status === 'POINT_FALLBACK') terms.push('지적불부합');
  const used = new Set();
  const results = [];
  for (const term of terms) {
    const entry = searchManualPack(pack,term,3).find((v) => !used.has(v.code));
    if (!entry) continue;
    used.add(entry.code);
    results.push({ code:entry.code, title:entry.title, pdf_page:entry.pdf_page_start, role:'READING_REFERENCE_ONLY',
      reason:`관련 원문을 확인할 참고자료: ${term}` });
  }
  return results;
}
