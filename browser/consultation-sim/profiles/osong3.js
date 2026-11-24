// 사업 프로필: 오송 제3생명과학 국가산업단지 — 고시 세목 색인 기반 현장상담의 첫 검증 사례.
// 프로필에는 공개 고시의 서지 정보와 상담 문구만 둔다. 세목 행(지번·면적)은 로컬 색인 파일에만 있다.
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
  zoning_decisions: Object.freeze([
    Object.freeze({
      from: '농림지역', to: '제1종일반주거지역', area_m2: 217424,
      reason: '오송 제3생명과학 국가산업단지 개발사업에 따른 변경',
      source: '국토교통부 고시 제2025-456호(2025-08-28) 도시·군관리계획 용도지역 결정(변경) 사유서',
      verified: 'GPT 원문 확인(2026-11-24, Google Drive 고시 원문) — 사업 관련 변경 사유 명시',
      parcel_level: '필지별 변경도면 대조 전',
    }),
  ]),
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
