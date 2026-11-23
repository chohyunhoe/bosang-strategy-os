// 합성 데이터 전용 — 실제 행정구역·필지·가격·사건과 무관하다.
// 시도코드 98·99는 실제 법정동코드에 쓰이지 않으므로 모든 합성 PNU는 '98' 또는 '99'로 시작한다.
// 좌표계는 실제 지리좌표가 아닌 합성 로컬 평면(미터)이다.

export const SYNTHETIC_MARK = '합성 데이터 · 실제 필지/사건 아님';
export const SYNTHETIC_CRS = 'SYNTHETIC_LOCAL_M';

export const SYNTHETIC_REGIONS = Object.freeze([
  { code: '9900000000', full_name: '가상특별시', level: 'SIDO', status: 'ACTIVE' },
  { code: '9901100000', full_name: '가상특별시 누리구', level: 'SIGUNGU', status: 'ACTIVE' },
  { code: '9901101000', full_name: '가상특별시 누리구 새솔동', level: 'LEAF', status: 'ACTIVE' },
  { code: '9901102000', full_name: '가상특별시 누리구 다온동', level: 'LEAF', status: 'ACTIVE' },
  { code: '9901199000', full_name: '가상특별시 누리구 옛터동', level: 'LEAF', status: 'ABOLISHED', successor_code: '9901101000', abolished_note: '합성 시나리오: 2025년 새솔동으로 통합' },
  { code: '9901200000', full_name: '가상특별시 한빛구', level: 'SIGUNGU', status: 'ACTIVE' },
  { code: '9901201000', full_name: '가상특별시 한빛구 새솔동', level: 'LEAF', status: 'ACTIVE' },
  { code: '9800000000', full_name: '가상도', level: 'SIDO', status: 'ACTIVE' },
  { code: '9821000000', full_name: '가상도 연습군', level: 'SIGUNGU', status: 'ACTIVE' },
  { code: '9821025021', full_name: '가상도 연습군 숲내면 바위리', level: 'LEAF', status: 'ACTIVE' },
]);

const NURI_SAESOL = '9901101000';
const HANBIT_SAESOL = '9901201000';
const BAWI = '9821025021';
const p = (region, mountain, bun, ji = 0) => `${region}${mountain ? '2' : '1'}${String(bun).padStart(4, '0')}${String(ji).padStart(4, '0')}`;

// 공시지가 산정용 토지특성(가격형성 요인 표기)과 공부(지목·면적)를 구분해 둔다.
const base2026 = { land_category: '대', area_m2: 412.5, zoning: '제2종일반주거지역', zoning_secondary: '지구단위계획구역(합성)', land_use: '단독', road_access: '세로한면(가)', shape: '세로장방형', elevation: '평지' };

export const SYNTHETIC_PARCELS = Object.freeze({
  // 일반 필지
  [p(NURI_SAESOL, false, 123, 4)]: {
    scenario: 'NORMAL', cell: [0, 0],
    years: {
      2024: { ...base2026, price: 1_812_000 },
      2025: { ...base2026, price: 1_905_000 },
      2026: { ...base2026, price: 1_968_000 },
    },
  },
  [p(NURI_SAESOL, false, 123, 5)]: {
    scenario: 'NEIGHBOR', cell: [1, 0],
    years: { 2026: { ...base2026, area_m2: 388.1, land_use: '다세대', price: 2_010_000 }, 2025: { ...base2026, area_m2: 388.1, land_use: '다세대', price: 1_950_000 } },
  },
  // 필수 값 일부 빈칸
  [p(NURI_SAESOL, false, 125)]: {
    scenario: 'PARTIAL_BLANK', cell: [2, 0],
    years: { 2026: { ...base2026, road_access: null, shape: null, area_m2: 296.0, price: 1_880_000 }, 2025: { ...base2026, road_access: null, shape: null, area_m2: 296.0, price: 1_830_000 } },
  },
  // 연도별 지목·이용상황 모순 (전년 전/전 → 기준연도 대/주거나지) + 지목과 이용상황 상이
  [p(NURI_SAESOL, false, 130)]: {
    scenario: 'YEAR_CONFLICT', cell: [0, 1],
    years: {
      2025: { ...base2026, land_category: '전', land_use: '전', area_m2: 655.0, road_access: '맹지', price: 812_000 },
      2026: { ...base2026, land_category: '전', land_use: '주거나지', area_m2: 655.0, road_access: '세로한면(불)', price: 1_120_000 },
    },
  },
  // 지적 exact 결과 복수
  [p(NURI_SAESOL, false, 140)]: { scenario: 'GEOMETRY_MULTIPLE', cell: [1, 1], years: { 2026: { ...base2026, price: 1_950_000 }, 2025: { ...base2026, price: 1_890_000 } } },
  // 지적 응답 PNU 불일치
  [p(NURI_SAESOL, false, 141)]: { scenario: 'GEOMETRY_MISMATCH', cell: [2, 1], years: { 2026: { ...base2026, price: 1_950_000 }, 2025: { ...base2026, price: 1_890_000 } } },
  // 늦은 응답 (응답 폐기 검증용)
  [p(NURI_SAESOL, false, 150)]: { scenario: 'SLOW', cell: [0, 2], slow_ms: 1500, years: { 2026: { ...base2026, area_m2: 501.2, price: 1_777_000 }, 2025: { ...base2026, area_m2: 501.2, price: 1_700_000 } } },
  // API 호출 제한
  [p(NURI_SAESOL, false, 160)]: { scenario: 'RATE_LIMIT', cell: [1, 2], years: { 2026: { ...base2026 } } },
  // 토지특성은 있으나 지적 도형 없음
  [p(NURI_SAESOL, false, 170)]: { scenario: 'GEOMETRY_NOT_FOUND', cell: [2, 2], years: { 2026: { ...base2026, price: 1_910_000 }, 2025: { ...base2026, price: 1_860_000 } } },
  // 기준연도 자료 없음(2026 미공시 가정)
  [p(NURI_SAESOL, false, 180)]: { scenario: 'YEAR_MISSING', cell: [3, 0], years: { 2025: { ...base2026, price: 1_760_000 }, 2024: { ...base2026, price: 1_700_000 } } },
  // 동일 동명·지번 중복 (다른 구)
  [p(HANBIT_SAESOL, false, 123, 4)]: {
    scenario: 'DUPLICATE_NAME', cell: [0, 0],
    years: { 2026: { ...base2026, zoning: '일반상업지역', land_use: '상업용', road_access: '광대한면', shape: '정방형', area_m2: 230.4, price: 5_420_000 }, 2025: { ...base2026, zoning: '일반상업지역', land_use: '상업용', road_access: '광대한면', shape: '정방형', area_m2: 230.4, price: 5_210_000 } },
  },
  // 산번지
  [p(BAWI, true, 12, 3)]: {
    scenario: 'MOUNTAIN', cell: [0, 0],
    years: {
      2026: { land_category: '임야', area_m2: 18_420, zoning: '자연녹지지역', zoning_secondary: null, land_use: '자연림', road_access: '맹지', shape: '부정형', elevation: '완경사', price: 41_300 },
      2025: { land_category: '임야', area_m2: 18_420, zoning: '자연녹지지역', zoning_secondary: null, land_use: '자연림', road_access: '맹지', shape: '부정형', elevation: '완경사', price: 39_800 },
    },
  },
});

export const SYNTHETIC_ORIGIN = Object.freeze({ [NURI_SAESOL]: [0, 0], [HANBIT_SAESOL]: [800, 0], [BAWI]: [0, 900] });
export const CELL = Object.freeze({ w: 22, h: 26, gap: 6 });

// ── PR-2 합성 표준지 (VWorld 표준지공시지가 속성 필드 이름 형태 · 값은 전부 가상) ──
// 설계: 새솔동(누리구) 123-4 기준 후보 3건, 가장 가까운 표준지는 용도지역 상이로 배제 / 바위리 산12-3 기준 후보 1건 / 한빛구 새솔동 기준 후보 0건
const std = (region, bun, cell, year, over) => ({
  pnu: `${region}1${String(bun).padStart(4, '0')}0000`, stdrYear: String(year), ldCodeNm: SYNTHETIC_REGIONS.find((r) => r.code === region)?.full_name || '',
  mnnmSlno: String(bun), lndcgrCodeNm: '대', lndpclAr: '400', prposArea1Nm: '제2종일반주거지역', prposArea2Nm: '', ladUseSittnNm: '단독',
  roadSideCodeNm: '세로한면(가)', tpgrphFrmCodeNm: '가로장방형', tpgrphHgCodeNm: '평지', pblntfPclnd: '1900000', lastUpdtDt: `${year}-02-28`, _cell: cell, ...over,
});
const both = (region, bun, cell, base, p26, p25) => [std(region, bun, cell, 2026, { ...base, pblntfPclnd: String(p26) }), std(region, bun, cell, 2025, { ...base, pblntfPclnd: String(p25) })];
export const SYNTHETIC_STANDARD_LANDS = Object.freeze({
  [NURI_SAESOL]: [
    ...both(NURI_SAESOL, 110, [4, 1], { ladUseSittnNm: '다세대', roadSideCodeNm: '소로한면', lndpclAr: '350', srrndngsNm: '주택지대' }, 2150000, 2080000),
    ...both(NURI_SAESOL, 200, [6, 4], { lndpclAr: '520', tpgrphFrmCodeNm: '부정형', srrndngsNm: '주택지대' }, 1820000, 1760000),
    ...both(NURI_SAESOL, 400, [8, 3], { ladUseSittnNm: '연립', roadSideCodeNm: '세로각지(가)', tpgrphFrmCodeNm: '사다리형', tpgrphHgCodeNm: '완경사', lndpclAr: '610' }, 1760000, 1700000),
    ...both(NURI_SAESOL, 128, [-1, 0], { prposArea1Nm: '일반상업지역', ladUseSittnNm: '상업용', roadSideCodeNm: '중로한면', lndpclAr: '280', srrndngsNm: '상가지대' }, 4800000, 4650000),
    ...both(NURI_SAESOL, 300, [5, -2], { lndcgrCodeNm: '전', ladUseSittnNm: '전', roadSideCodeNm: '맹지', lndpclAr: '1200', srrndngsNm: '농경지대' }, 690000, 660000),
    std(NURI_SAESOL, 310, [7, 0], 2025, { pblntfPclnd: '1880000' }),
  ],
  [HANBIT_SAESOL]: [
    ...both(HANBIT_SAESOL, 90, [2, 1], { srrndngsNm: '주택지대' }, 2300000, 2240000),
  ],
  [BAWI]: [
    ...both(BAWI, 40, [2, 0], { lndcgrCodeNm: '임야', prposArea1Nm: '자연녹지지역', ladUseSittnNm: '자연림', roadSideCodeNm: '맹지', tpgrphFrmCodeNm: '부정형', tpgrphHgCodeNm: '급경사', lndpclAr: '25000' }, 38000, 36500),
    ...both(BAWI, 55, [1, 1], { lndcgrCodeNm: '전', prposArea1Nm: '계획관리지역', ladUseSittnNm: '전', roadSideCodeNm: '세로한면(불)', lndpclAr: '1800' }, 120000, 115000),
  ],
});
