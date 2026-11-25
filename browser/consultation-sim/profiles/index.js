// 사업 프로필 등록부 — 새 사업은 프로필 파일 하나와 로컬 고시 색인 하나로 추가한다.
// 프로필이 없는 사업의 색인도 공통 프로필(공통 쟁점·공통 경고)로 바로 쓸 수 있다.
import { OSONG3 } from './osong3.js';

export const PROFILES = Object.freeze({ osong3: OSONG3 });

export function getProfile(id) { return PROFILES[id] || null; }

const GENERIC_WARNINGS = Object.freeze([
  '이 화면의 지번 검색은 고시 세목표 기록 검색입니다. 현재 조서·소유·현황·공시지가·보상금과 다를 수 있습니다.',
  '현재 절차 단계는 받은 문서 원문으로 확인하세요. 고시가 있다는 사실과 보상금 통지는 다릅니다.',
  '보상액·법률 결론·기간을 이 화면이 정하지 않습니다. 증액을 약속하지 않습니다.',
]);

// 색인의 고시 ID로 프로필을 찾는다. 없으면 색인 메타로 공통 프로필을 만든다.
export function profileForIndex(index) {
  const id = index?.notice?.id;
  const found = Object.values(PROFILES).find((p) => p.notice.id === id);
  if (found) return found;
  const ris = [...new Set((index?.rows || []).map((r) => r.ri))];
  return { id: 'generic', title: index?.notice?.project || index?.notice?.title || '고시 세목 색인', notice: index?.notice || {}, location: index?.location || {},
    ris, issue_ids: null, extra_issues: [], warnings: GENERIC_WARNINGS };
}
