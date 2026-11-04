# 보상전략 OS v1.0 지원계약

이 문서는 v1.0이 **무엇을 보장하고 무엇을 보장하지 않는지** 한 곳에 적어 둔 기준서다.
릴리스 표현과 화면 문구는 이 문서를 넘어서면 안 된다.

## SUPPORTED

### 1. TEXT_PDF (텍스트 레이어가 있는 평가서)

```
평가서 입력 → 자동 Parser → 대상토지/현황분리행 통합 → 법인별 평가요소 비교
→ 개별요인 → 그 밖의 요인 → 지도 컨텍스트 → 검토 필요사항
```

- 같은 지번의 현황분리행은 합치지 않고 각각 별도 행으로 비교한다.
- 법인별 비교표 열: 표준지 · 공시지가 · 시점수정 · 개별요인 누계 · 그 밖의 요인 ·
  산출단가 · 적용단가 · 평가액.
- 모든 값은 평가서 기재값 후보다. 단가·평가액을 새로 계산하지 않는다.

### 2. IMAGE_PDF (스캔 평가서)

```
자동 감지 → 사용자 추가 클릭 없이 로컬 자동 OCR → OCR 텍스트/후보 생성 → NEEDS_REVIEW
```

- 최초 파일 선택 1회 이후 사용자가 파일을 다시 고르거나 OCR 작업대로 이동할 필요가 없다.
- 진행 상태(AUTO_OCR_RUNNING, n/N쪽, 진행률)를 화면에 표시한다.
- 수동 OCR 작업대는 자동 OCR이 실패했을 때만 앞세운다.
- OCR 결과는 전량 `NEEDS_REVIEW` / `auto_confirmed: false`.

## BETA / NOT GUARANTEED

**순수 이미지 평가서의 괘선 표를 자동 구조화하여 TEXT_PDF와 동일한 평가행·비교표까지
생성하는 기능.**

스캔 평가서의 OCR 텍스트는 생성되지만, 괘선이 있는 표는 열 구조가 보존되지 않아
평가행(`lands` / `land_appraisal_results`)이 만들어지지 않을 수 있다. 이 경우 비교표에
해당 법인 열이 생기지 않으며 추가 검수가 필요하다.

### Scan Gate 실검증 기록 (제일 스캔 평가서, 데스크톱 Chromium)

| 항목 | 값 |
| --- | --- |
| 페이지 수 | 19 |
| 자동 OCR | COMPLETE |
| 소요 시간 | 약 116초 (데스크톱) |
| OCR 텍스트 | 23,548자 |
| 추출 후보 | 15건 |
| parser lands / results | **0 / 0** |
| 원인 | scanned ruled-table layout loss (괘선 표의 열 구조 소실) |
| 상태 | **BETA / STRUCTURED_SCAN_OPEN** |

사용자 추가 클릭 0회로 `OCR_REQUIRED → EXTRACTING → AUTO_OCR_RUNNING 1/19…19/19 →
CANDIDATES_READY` 까지는 도달한다. 그 다음 구조화 단계에서 멈춘다.

## 릴리스 표현 규칙

허용:

- "이미지 PDF 자동 OCR을 지원합니다."
- "표 구조가 복잡한 스캔 평가서는 구조화 결과에 추가 검수가 필요합니다."

금지:

- **"모든 스캔 평가서 자동 분석 지원"** 또는 그와 같은 뜻의 표현.
- 스캔 평가서가 TEXT_PDF와 동일한 비교표를 항상 만든다는 표현.

## v1.1 backlog

`SCAN_TABLE_STRUCTURE_RECOVERY`

- OCR word bbox / 좌표 기반 행·열 재구성
- 표 cell reconstruction
- scan → canonical parser adapter

**v1.0에서 구현하지 않는다.**
