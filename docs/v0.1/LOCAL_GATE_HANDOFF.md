# 보상전략 OS v0.1 PC 인계 메모

모바일/챗 작업 종료 후 PC에서 할 일만 남긴다.

## PC Gate A

1. 최신 `main` 동기화
2. `RUN_PC_GATE.cmd` 더블클릭
3. 익명화 실제 감정평가서 PDF 1건 선택
4. 자동 분석 종료 후 원문과 핵심 수치 대조
5. `P` / `W` / `F` 입력
6. `PC_GATE_RESULT.json` 보관

확인할 핵심:
- 편입토지 수 = 평가행 수
- 비교표준지 연결 누락 없음
- Parser dropped/unmatched row 0
- NaN/undefined 없음
- 자동확정 없음
- 모바일/데스크톱 결과 정렬 이상 없음

## PC Gate B — 필요할 때만

Windows QGIS와 실제 지적원자료가 준비되어 있고 v0.1 최종 지도 산출을 요구할 때만 수행한다.

확인할 핵심:
- PNU exact-one
- CRS/geometry
- PDF/PNG/QGZ 출력
- 항공사진/경계/라벨/축척
- API Key/민감정보 미노출

## 종료판정

- Gate A PASS + Gate B 필요 없음/비차단 → `BSO v0.1 MVP COMPLETE`
- Gate A PASS + Gate B PASS → `BSO v0.1 MVP COMPLETE`
- Gate 실패 → 실패한 항목만 수정. 통과한 Parser/스키마/안전경계 재설계 금지.
