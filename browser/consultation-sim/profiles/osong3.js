// 사업 프로필: 오송 제3생명과학 국가산업단지 — 고시 세목 색인 기반 현장상담의 첫 검증 사례.
// 프로필에는 공개 고시의 서지 정보와 상담 문구만 둔다. 세목 행(지번·면적)은 로컬 색인 파일에만 있다.
const OSONG3_DECISION = Object.freeze({
  from: '농림지역', to: '제1종일반주거지역', area_m2: 217424,
  reason: '오송 제3생명과학 국가산업단지 개발사업에 따른 변경',
  source: '국토교통부 고시 제2025-456호(2025-08-28) 도시·군관리계획 용도지역 결정(변경) 사유서',
  verified: 'GPT 원문 확인(2026-11-24, Google Drive 고시 원문) — 사업 관련 변경 사유 명시',
  parcel_level: '필지별 변경도면 대조 전',
});
export const OSONG3 = Object.freeze({
  id: 'osong3',
  title: '오송 제3생명과학 국가산업단지',
  notice: Object.freeze({
    id: 'molit-2025-456',
    title: '오송 제3생명과학 국가산업단지 산업단지계획 승인 및 지형도면 고시',
    notice_no: '국토교통부 고시 제2025-456호',
    notice_date: '2025-08-28',
    authority: '국토교통부',
    project: '오송 제3생명과학 국가산업단지',
    operator: '한국토지주택공사(LH)',
    source_url: 'https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp?seq=618070',
    // 용도지역 보상평가 기준 검토용 확인 대상(내용 미대조 — 원문에서 해당 필지·용도지역 변경 여부를 직접 확인)
    zoning_check: '국토교통부 고시 제2025-456호 중 도시관리계획 결정(변경)(용도지역) — 산업단지계획 승인에 따른 결정 의제 여부·대상 필지·변경 전후 용도지역 원문 대조 필요',
  }),
  location: Object.freeze({ sido: '충청북도', sigungu: '청주시 흥덕구', eupmyeon: '오송읍' }),
  ris: Object.freeze(['오송리', '동평리', '봉산리', '서평리', '정중리', '궁평리']),
  import: Object.freeze({
    pages: [15, 219],
    // GPT 독립 검산(2026-11-24): 일련번호 1~2,933, 편입면적 합계 = 사업계획 고시 면적
    expected: Object.freeze({ rows: 2933, incorporated_area_m2: 4119584.0 }),
  }),
  // 고시 원문의 용도지역 결정(변경) 사유 — 보상평가 용도지역 검토 근거(필지별 변경도면 대조는 별도)
  zoning_decisions: Object.freeze([OSONG3_DECISION]),
  // 사업별 법적 변경 이벤트(용도지역 결정·변경 또는 의제가 고시 본문에 실제 포함되는지 원문으로 확인한 것만 INCLUDED)
  zoning_events: Object.freeze([
    Object.freeze({
      id: 'molit-2025-456', notice_no: '국토교통부 고시 제2025-456호', notice_date: '2025-08-28', effective_date: null,
      effective_basis: '고시일과 효력발생일 구별 — 고시문 시행일·효력 규정 원문 확인 필요(화면 등록일과도 구별)',
      kind: '산업단지계획 승인 및 지형도면 고시 — 도시·군관리계획 용도지역 결정(변경) 포함',
      zoning_decision: 'INCLUDED', project_related: true,
      decision_verified: 'GPT 원문 확인(2026-11-24) — 용도지역 결정(변경) 사유서에 사업 관련 변경 사유 명시',
      changes: Object.freeze([OSONG3_DECISION]),
    }),
  ]),
  // 2025-456 직전의 기정 용도지역 결정(필지 대조 대상)
  prior_designations: Object.freeze([
    Object.freeze({ id: 'cheongju-2020-236', notice_no: '청주시 고시 제2020-236호', notice_date: '2020-06-12', short: '2020-236 기정도면', kind: '기정 용도지역 결정도면' }),
  ]),
  // 보조 원천(③): 환경평가서의 기존 토지이용 현황 — 총괄 집계일 뿐 필지별 확정 근거 아님. 원본은 저장소에 넣지 않는다.
  supporting_documents: Object.freeze([
    Object.freeze({
      id: 'eia-draft-2021-12', title: '오송 제3생명과학 국가산업단지 환경영향평가서(초안) 요약문(2021.12)', document_date: '2021-12',
      survey_basis: '요약문 작성 시점 기존 토지이용 현황(조사 기준일 원문 확인 필요)',
      project_area_m2: 6769091,
      zoning_composition: Object.freeze([{ zoning: '농림지역', area_m2: 6264847 }, { zoning: '관리지역', area_m2: 504244 }]),
      scope_note: '2025-456 승인 사업면적 4,119,584㎡와 사업 범위가 다름',
      use_limit: '총괄 집계 — 궁평리 320-1 등 개별 필지의 기존 용도지역 확정 근거로 쓰지 않음',
      held: 'Google Drive 기존 보관 파일(저장소 미반입)',
    }),
  ]),
  // 필지별 실제 대조 기록(공개 고시 필지 · 소유자 정보 없음). PNU → 기록 목록.
  parcel_zoning_evidence: Object.freeze({
    '4311325027103200001': Object.freeze([
      Object.freeze({
        grade: 1, ref: 'molit-2025-456-map', short: '제2025-456호 첨부 변경도 제4도엽의 변경 후 용도지역',
        document: '제2025-456호 첨부 「용도지역지구의 세분에 관한 도시관리계획 결정(변경)도」(1/1,500) 제4도엽(전체 13도엽)',
        finding: '320-1 전 — 변경 후 제1종일반주거지역 표기 구역 내', zoning_after: '제1종일반주거지역', status: 'CONFIRMED',
        checked: 'GPT 육안 확인(2026-11-24, 토지이음 고시 seq=618070 첨부 도면) · 지형도면고시도 제4도엽도 필지 확인',
        caution: '도면의 굵은 붉은 선을 토지보상 편입선으로 해석하지 않음',
      }),
    ]),
  }),
  issue_ids: ['stage', 'obstacle', 'land_use', 'farming', 'business', 'residence', 'remainder', 'resident_appraiser'],
  extra_issues: Object.freeze([
    { id: 'flood', label: '수해 피해 중첩',
      question: '최근 수해 피해가 이 필지·지장물에 있었나요? 피해 신고나 지원을 받으셨나요?',
      documents: ['피해 사진(날짜)', '피해 신고·지원금 수령 서류'],
      next: ['수해 피해와 보상 조사 시점의 관계를 전문가 검토 — 여기서 판단하지 않음'] },
  ]),
  warnings: Object.freeze([
    '이 화면의 지번 검색은 2025년 고시 세목표 기록 검색입니다. 2026년 현재 조서·소유·현황·공시지가·보상금과 다를 수 있습니다.',
    '고시가 있다는 사실과 협의보상금 통지를 받았다는 사실은 다릅니다. 현재 절차 단계는 받은 문서 원문으로 확인하세요.',
    '보상액·법률 결론·기간을 이 화면이 정하지 않습니다. 증액을 약속하지 않습니다.',
  ]),
});
