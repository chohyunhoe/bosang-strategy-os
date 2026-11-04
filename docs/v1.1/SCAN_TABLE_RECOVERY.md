# v1.1 P0-1 — 스캔 평가서 표 구조 복원 지원계약

`SCAN_TABLE_STRUCTURE_RECOVERY` 의 첫 단계(P0-1) 범위 기록이다.

v1.0 의 지원계약([`docs/v1.0/SUPPORT_CONTRACT.md`](../v1.0/SUPPORT_CONTRACT.md))은 이미 태그·릴리스된
역사적 문서이므로 **수정하지 않는다.** v1.0 시점의 `BETA / STRUCTURED_SCAN_OPEN` 기록은
그때의 사실로 그대로 보존하고, 이 문서가 그 이후 상태를 잇는다.

## SUPPORTED IN v1.1 P0-1

- IMAGE_PDF 자동 OCR
- OCR word bbox 기반 표 구조 복원
- 토지조서 구조화
- 토지가격 산출근거 구조화
- scan result → canonical adapter
- 기존 TEXT_PDF 법인들과 비교표 병합
- 현황분리행 보존
- fail-closed / NEEDS_REVIEW 유지

## ACTUAL VERIFIED

제일 실제 스캔 평가서(로컬 검증, 실 PDF 미커밋):

| 항목 | 값 |
| --- | --- |
| 페이지 수 | 19 |
| 좌표 복원 대상 | 핵심 p16 / p17 |
| lands | 5 |
| land_appraisal_results | 5 |
| 3법인(TEXT 2 + SCAN 1) results | 15 |
| canonical lands | 5 |
| dropped | 0 |
| 적용단가 대조 | 5 / 5 |
| 평가액 대조 | 5 / 5 |
| 면적 × 적용단가 = 평가액 일치 | 5 / 5 |
| `auto_confirmed: true` | **0** |

## LIMITATIONS

- 78-4 산출단가: **null** (OCR 자릿수 손상 fail-closed)
- 일부 표준지 기호 미확인
- 일부 개별요인 세부 미확인
- 일부 지목 미확인
- 스캔 단독 업로드 시 소재지 법정동 복원은 **보장하지 않는다**
- 기존 canonical land 와 지번 + 면적이 유일하게 일치할 때에 한해 reconciliation 이 가능하다

## 표현 규칙

허용:

- "이미지 PDF 자동 OCR과 토지조서·토지가격 산출근거 표 구조 복원을 지원합니다."
- "복원 결과는 검토 후보이며 원문 대조가 필요합니다."

금지:

- **"모든 스캔 평가서 완전 자동 구조화"**
- **"감정평가서 범용 스캔 지원 완료"**
- 그와 같은 뜻의 표현

## 검토 안전 경계

이 경로로 생성되는 모든 후보는 `review_status_code: NEEDS_REVIEW`, `auto_confirmed: false`
를 유지한다. 값이 확정되지 않은 칸은 채우지 않고 닫으며, 닫힌 이유는 행별 flag 로 남긴다.
단가·평가액·요인값을 새로 계산하거나 역산하지 않는다.
