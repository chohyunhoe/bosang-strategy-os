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
const base2026 = { land_category: '대', area_m2: 412.5, zoning: '제2종일반주거지역', zoning_secondary: '지구단위계획구역(합성)', land_use: '단독주택', road_access: '세로한면(가)', shape: '세로장방형', elevation: '평지' };

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
