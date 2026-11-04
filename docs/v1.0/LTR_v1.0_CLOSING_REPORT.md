# 보상전략 OS v1.0 LTR — 종료보고

판정일: 2026-08-20
판정: **FEATURE FREEZE APPROVED**
Gate A 최종: `PASS_WITH_WARNINGS` · `READY_WITH_REVIEW` · hard blockers **0** · 검토항목 **1**

---

## 1. 이번 릴리즈가 한 일

v1.0 LTR 은 **새 기능을 만들지 않고**, 이미 구현·검증된 기능을 (1) 비개발자가 쓸 수 있는 하나의 UI로
통합하고 (2) 산출물을 터미널 없이 파일로 꺼낼 수 있게 연결했다. 작업은 세 축으로 진행됐다.

| 축 | 결과 |
| --- | --- |
| UI 통합 | 사건처리 6단계 IA · 상태 기반 다음 Action · 검증기능 UI 진입점 복구 — **DONE / FROZEN** |
| Parser·Gate | `P0-PARSER-SUBJECT-LAND-ROWS` 종료 → Gate 과잉 계약 제거 → Gate A 통과 — **CLOSED / FROZEN** |
| Output Center | 7트랙 중 6트랙 No-CLI 연결, GIS 1건 비차단 BLOCKED — **CONNECTED / FROZEN** |

---

## 2. Parser·Gate 축이 어떻게 끝났는가

### 2.1 제기된 결함

`P0-PARSER-SUBJECT-LAND-ROWS` — "편입토지 행 후보 10건 중 4필지만 인식되고 평가행이 3행만 생성된
추출 완전성 결함". Gate A 유일 하드 블로커였다.

### 2.2 계측이 밝힌 것

규칙을 고치기 전에 탈락 사유를 먼저 계측했다(원문 라인은 저장하지 않고 사유 코드와 구조 수치만).
그 결과 **제기된 결함의 전제가 두 군데에서 틀렸다**는 것이 드러났다.

1. **"후보 10" 은 행 손실이 아니라 후보 카운터의 결함이었다.** 조서 구역이 닫히지 않아 표준지·산출근거
   표 행까지 편입토지 후보로 세고 있었다. 실제 조서 데이터 행은 4행이다.
2. 표 머리글에 다른 구역 어휘가 **열 이름으로** 들어가면(`… 지목 면적 비교표준지 평가액`) 조서 구역
   전체가 비교표준지 구역으로 넘어가 편입토지가 통째로 사라지고 있었다. → `looksLikeColumnHeaderRow()`
   **규칙 1개 최소 수정**으로 해소. 탈락 4종 사유 모두 0건.

### 2.3 남은 1건과 그 처리

편입토지 4 : 평가행 3 이 남았다. 계측은 파서 손실 지표(`starts_with_address`, `unmatched_identity`,
`ambiguous_identity`, `unindexable_lands`, `duplicates`, 드롭·미연결)가 **전부 0** 임을 보였고,
파싱된 3행은 모두 깨끗하게 연결돼 있었다. 가능한 해석은 둘뿐이었다.

- (A) 산출근거에 그 행이 있는데 파서가 놓친다 → Parser 결함
- (B) 현황분리행이라 원문 산출근거가 실제로 3행이다 → **게이트의 1:1 계약이 결함**

계측 위치를 한 줄 앞당겨 다음 Gate A 실행이 (A)/(B) 를 가르게 했고, 실측값
`appraisal_row_reject_starts_with_address_count = 0` 으로 **(B) 가 확정**됐다.

따라서 **Parser 는 수정하지 않았다.** 없는 행을 만들어 수를 맞추는 것은 금지 사항이다.
대신 게이트에서 편입토지 완전성 판정을 조서 행 계측만으로 분리했다.

```
편입토지 완전성 = subject_land_data_row_candidates === subject_land_parsed_rows
                 AND subject_land_lost_rows === 0
```

평가행이 편입토지보다 **적고** 파서 손실 지표가 전부 0이면 FAIL 이 아니라 검토항목
`APPRAISAL_ROW_COVERAGE_GAP` 으로 남긴다. 반대로 평가행이 **많으면** 자동 생성·복제 의심으로
`EXTRA_APPRAISAL_ROWS`, 손실 지표가 하나라도 켜지면 `APPRAISAL_ROWS_LOST_BY_PARSER` 로 계속 차단한다.

이 완화는 한 방향뿐이며, 3축(브라우저 판정·서버 재검증·실행기 재계산) 모두에 같은 규칙으로 들어갔다.

---

## 3. Output Center 7트랙

| # | 트랙 | 상태 | 산출 | 실행 |
| --- | --- | --- | --- | --- |
| 1 | 보상전략 분석보고서 | **CONNECTED** | DOCX 5페이지 | 버튼 1회 |
| 2 | 재결·이의 의견서 작성자료 | **CONNECTED** | DOCX 10구성 | 버튼 1회 |
| 3 | 수치 비교표 | **CONNECTED** | XLSX 4시트 · CSV | 버튼 1회 |
| 4 | 지도·그래픽 | **CONNECTED** | SVG | 버튼 1회 |
| 5 | 현장검토 자료 | **CONNECTED** | A4 인쇄 · PDF | 버튼 1회 |
| 6 | 쟁점·검토 메모 | **CONNECTED** | TXT · Markdown | 버튼 1회 |
| 7 | GIS 패키지 | **BLOCKED / NON-BLOCKING** | — | 연결하지 않음 |

작업 시작 시점에는 **파일로 나오는 산출물이 지도 SVG 1개뿐**이었고, 문서형 산출물은 전부
Python CLI 에 있으면서 브라우저 스키마를 소비하지 못했다(스키마 3개 · 어댑터 0개). 이 단절이
산출물 센터의 단일 최대 병목이었다.

해소 방식은 어댑터 1본이다. 사건 JSON → `BriefOutput` 어댑터가 fail-closed·provenance·검토상태·
자동확정 경계를 한 곳에서 처리하고, 6개 트랙이 모두 그 결과 위에 올라간다. 트랙마다 안전 규칙을
다시 구현하지 않으므로, 경계를 고치면 6개 산출물에 동시에 반영된다.

### 3.1 산출물 전반에 유지되는 안전 경계

- **자동확정 금지**: `auto_confirmed:true` 가 하나라도 있으면 어댑터가 중단(`AdapterSafetyError`).
  브라우저에서도 1차 차단하며, 카드가 `BLOCKED` 로 잠긴다.
- **누락값 0채움 금지**: 숫자 아님·빈값·`-` 는 `null` → 문서·표에 `확인 필요`. 스키마 범위를 벗어난
  값은 클램프하지 않고 비운다.
- **추정·역산 금지**: 개별요인 누계에서 세부값을 쪼개지 않고, 세부값에서 누계를 만들지 않는다.
  지역요인은 원천 스키마에 없으므로 항상 `null`.
- **provenance 승계**: parser `source_ref` → `SourceRef` 1:1. 근거가 없으면 만들지 않고 세어서 보고하며,
  근거 0건이면 문서 상태가 `partial` 로 고정된다.
- **`NEEDS_REVIEW` 보존**: 목표 스키마에 검토상태 필드가 없는 레코드는 QA 규칙으로 올려 상태가
  조용히 사라지지 않게 한다.
- **미연결 필지 삭제 금지**: `APPRAISAL_ROW_COVERAGE_GAP` 필지는 표·문서·메모에서 지우지 않고
  값만 `확인 필요` 로 남긴다. 평가행을 자동 생성·복제하지 않는다.
- **법률·평가 판단 금지**: 의견서 작성자료는 쟁점·문안을 사건 데이터에서 1:1 복사하며,
  `최종 의견서`·`법률의견`·`증액 가능성` 표현은 조립 후 문서 전문을 검사해 fail-closed 로 차단한다.

### 3.2 로컬 출력 브리지 경계

- `127.0.0.1` loopback 서버에만 붙는다. 외부 호스트 참조·outbound 호출이 소스에 없다(테스트로 고정).
- 사건 데이터는 OS 임시폴더에만 쓰고 응답 후 반드시 지운다. 저장소에 쓰지 않으며 `output/brief/` 는
  `.gitignore` 로 차단했다.
- 임시 경로·원본 파일명(소유자 실명 포함)은 브라우저 응답에 넣지 않는다.
- 형식별 구성요소를 따로 감지해, 하나가 없어도 나머지 버튼은 살아 있다.

---

## 4. 최종 회귀

| 스위트 | 결과 |
| --- | --- |
| `npm run test:rc` (parser · static · runtime) | PASS |
| Playwright — Chromium 1440 / Chromium 768 / WebKit 390 | 104 passed · 1 skipped |
| `brief_output` (python) | 77 passed |
| privacy purge guard | PASS — tracked 366건, 실사건 식별자 0 |
| Gate A (실제 익명화 TEXT_PDF 1건) | PASS_WITH_WARNINGS |

Playwright 1건 skip 은 설계상 Chromium 전용 PDF 저장 검증이다(WebKit 에서 건너뜀).

---

## 5. 알려진 한계

1. **`APPRAISAL_ROW_COVERAGE_GAP` 1건** — 편입토지 4필지 중 1필지에 산출근거 평가행이 없다.
   실측상 파서 손실이 아니라 원문이 3행인 것으로 확정됐으나, **원문 대조는 사람이 해야 한다.**
   하드 블로커가 아니며 모든 산출물에 검토항목으로 남는다.
2. **IMAGE_PDF 구조화는 Beta** — 스캔 괘선표 완전 자동 구조화는 v1.1 `SCAN_TABLE_STRUCTURE_RECOVERY`.
3. **GIS 패키지 미연결** — 브라우저 실행 경로가 없다. v1.0 지원범위 밖(비차단).
4. **QGIS 최종 도면·PNU 검증** — Windows + QGIS 실기 필요. 로컬 전용 산출물로 분리.
5. **검토 메모 입력·보관 없음** — 읽기 전용 내보내기만 제공. 입력 state 는 v1.1 후보.
6. **개별요인 6조건 세부값** — 원문에 세부계수가 없으면 누계만 표기되고 나머지는 `확인 필요`.
   누계를 쪼개 채우지 않는다.
7. **`renderSpecCompareTable` 미연결** — 호출부 0건. v1.1 후보.
8. **v0.3.x OCR 뷰어 중복 정의** — 기술부채. 별도 PR 대상이며 런타임 도달하지 않는다.

---

## 6. 이 릴리즈에 포함하지 않은 것

공공데이터 Provider 확장(`public_data/`, `docs/public_data_provider.md`, `tests/test_public_data*.py`,
`.env.example` 의 `PUBLIC_DATA_API_KEY`)은 **별도 작업 축**이며 이 릴리즈 커밋에서 분리했다.

---

## 7. Freeze 이후 규칙

- 신규 기능·리팩터링·UI 디자인 개선·Parser 개선·의존성 상향은 범위 밖이다.
- 변경은 **실제 실패가 재현된 항목**의 수정에 한정한다.
- 안전 경계(자동확정 금지, 0채움 금지, 추정 금지, provenance, `NEEDS_REVIEW`)를 완화하는 변경은
  Gate A 재실행 없이 반영하지 않는다.
