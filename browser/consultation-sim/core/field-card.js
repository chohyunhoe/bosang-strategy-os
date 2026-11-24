// 현장 상담카드 — 확인 사실 / 미확인 / 선택 쟁점 / 확보할 문서 / 후속조치를 한 장으로 만든다(순수 함수).
// - '확인 사실'은 고시 기재값뿐이다. 공적자료 실조회 값은 이용조건 확인 전에는 카드 출력(복사·저장)에 넣지 않는다.
// - 법률판단·보상액·기간을 만들지 않는다.
import { noticeFacts } from './notice-index.js';
import { issuesFor } from './field-issues.js';

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '—');

export const UNVERIFIED_BASE = Object.freeze([
  '현재(2026) 토지조서·물건조서 반영 여부와 사업변경 여부',
  '현재 소유자·지분(고시 이후 변동 가능)',
  '실제 이용상황(현장 확인 전)',
  '현재 절차 단계(받은 문서 원문 확인 전)',
  '공시지가·보상액(이 카드는 산정하지 않음)',
]);

// 고시 색인 밖 필지(전국 직접 조회) 카드 — 고시 기재값이 없으므로 '확인 사실'은 입력 주소뿐이다.
export function buildDirectCard({ profile, target, selectedIssueIds = [], memo = '', now = new Date() }) {
  if (!target?.ok) return null;
  const issues = issuesFor(profile);
  const chosen = issues.filter((it) => selectedIssueIds.includes(it.id));
  const documents = [...new Set(chosen.flatMap((it) => it.documents))];
  const next = [...new Set(['받은 통지문 원문으로 사업·고시 해당 여부와 현재 절차 단계 확인', ...chosen.flatMap((it) => it.next)])];
  const unverified = ['사업 편입 여부·편입면적(고시 색인에 없음 — 미편입 판정 아님)', ...UNVERIFIED_BASE];
  const memoText = String(memo || '').trim();
  const confirmed = [`입력 주소: ${target.address} (상담자 입력 · 법정동은 조회 시 행안부 코드로 재확인)`];
  const text = [
    `[BSO 현장 상담카드 · 검토 보조 · 고시 색인 밖 필지]`,
    `작성 ${now.toISOString().slice(0, 16).replace('T', ' ')} · 고시 기재값 없음`,
    '', '■ 확인 사실', ...confirmed.map((s) => `- ${s}`),
    '', '■ 미확인', ...unverified.map((s) => `- ${s}`),
    '', '■ 상담자가 선택한 쟁점', ...(chosen.length ? chosen.map((it) => `- ${it.label}`) : ['- (선택 없음)']),
    '', '■ 확보할 문서', ...(documents.length ? documents.map((s) => `- ${s}`) : ['- (쟁점 선택 후 표시)']),
    '', '■ 후속조치', ...next.map((s) => `- ${s}`),
    ...(memoText ? ['', '■ 상담 메모', memoText] : []),
    '', '※ 보상액·법률 결론·기간을 정하지 않으며 증액을 약속하지 않습니다. 공적자료 실조회 값은 이용조건 확인 전이라 이 카드에 넣지 않았습니다.',
  ].join('\n');
  return { address: target.address, confirmed, unverified, chosen, documents, next, memo: memoText, text };
}

export function buildFieldCard({ profile, index, row, selectedIssueIds = [], memo = '', now = new Date() }) {
  if (!row) return null;
  const facts = noticeFacts(row);
  const notice = index?.notice || profile?.notice || {};
  const loc = index?.location || profile?.location || {};
  const address = [loc.sido, loc.sigungu, row.eupmyeon || loc.eupmyeon, row.ri, row.lot_label].filter(Boolean).join(' ');
  const confirmed = [
    `${notice.notice_no || '고시'}(${notice.notice_date || '일자 미상'}) 세목표 일련번호 ${row.serial} — 원본 PDF ${row.pdf_page}쪽`,
    `소재지: ${address}`,
    `지목(고시 기재): ${facts.jimok || '—'}`,
    `공부면적(고시 기재): ${fmt(facts.ledger_area_m2)}㎡ · 편입면적(고시 기재): ${fmt(facts.incorporated_area_m2)}㎡`,
  ];
  const arithmetic = [];
  if (facts.arithmetic) {
    arithmetic.push(`[산술] 편입률 ${facts.arithmetic.incorporated_ratio_pct}% · 공부면적−편입면적 ${fmt(facts.arithmetic.remainder_area_m2)}㎡`);
    if (facts.arithmetic.partial) arithmetic.push('[산술] 일부 편입으로 보임 — 잔여지 여부는 현재 조서·도면으로 확인(제73조·제74조 구별)');
  }
  const unverified = [...UNVERIFIED_BASE];
  if (row.ri_source === 'CARRIED') unverified.unshift(`리 이름(${row.ri})은 원본 표의 반복 셀에서 이어받음 — PDF ${row.pdf_page}쪽 원문 재확인`);
  const issues = issuesFor(profile);
  const chosen = issues.filter((it) => selectedIssueIds.includes(it.id));
  const documents = [...new Set(chosen.flatMap((it) => it.documents))];
  const next = [...new Set(['받은 통지문 원문으로 현재 절차 단계 확인', ...chosen.flatMap((it) => it.next)])];
  const memoText = String(memo || '').trim();
  const text = [
    `[BSO 현장 상담카드 · 검토 보조 · ${profile?.title || notice.project || ''}]`,
    `작성 ${now.toISOString().slice(0, 16).replace('T', ' ')} · 기준: ${notice.notice_no || '고시'} 기록(현재 상태 아님)`,
    '',
    '■ 확인 사실(고시 기재값 · 원문확인 필요)', ...confirmed.map((s) => `- ${s}`), ...arithmetic.map((s) => `- ${s}`),
    '', '■ 미확인', ...unverified.map((s) => `- ${s}`),
    '', '■ 상담자가 선택한 쟁점', ...(chosen.length ? chosen.map((it) => `- ${it.label}`) : ['- (선택 없음)']),
    '', '■ 확보할 문서', ...(documents.length ? documents.map((s) => `- ${s}`) : ['- (쟁점 선택 후 표시)']),
    '', '■ 후속조치', ...next.map((s) => `- ${s}`),
    ...(memoText ? ['', '■ 상담 메모', memoText] : []),
    '', '※ 보상액·법률 결론·기간을 정하지 않으며 증액을 약속하지 않습니다. 공적자료 실조회 값은 이용조건 확인 전이라 이 카드에 넣지 않았습니다.',
  ].join('\n');
  return { address, facts, confirmed, arithmetic, unverified, chosen, documents, next, memo: memoText, text };
}
