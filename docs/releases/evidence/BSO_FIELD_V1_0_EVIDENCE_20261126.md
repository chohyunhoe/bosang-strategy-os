# BSO 현장상담 V1.0 실행 증거 (2026-11-26, 클라우드 컨테이너 · 합성 데이터만)

- 환경: Linux · Node v22.23.5 · Playwright 1.54.1 · Chromium(사전설치). 실제 VWorld·키·실상담 데이터 미사용.
- 기준선: 원격 bc4ff7e 별도 worktree. 수정본: 이 브랜치 작업트리. 두 E2E 모두 같은 조건(--workers=3 --timeout=15000).

## 1. 결정론 테스트 `npm run consult:test`
```
# tests 189
# pass 189
# fail 0
```
신규 `tests/consultation-sim/consult-records-server.test.mjs` 7건:
```
ok 1 - 저장소: 생성·같은 내용 재전송(중복 없음)·수정차수·충돌·검색·내보내기·수정 이력
ok 2 - 저장소: 다필지 묶음 · 필지별 PNU 검색 · 입력 검증
ok 3 - 백업·손상 자동복구·CLI 복구(사용 중 거부 · 이전 DB 보존)
ok 4 - 화면 자동저장: 디바운스·한 번에 하나·같은 내용 재전송 없음·실패 재시도·충돌 정지·인증 만료·마지막 저장
ok 5 - 실제 field_server.js: 기능 표지·저장·재시작 후 유지·재접속 복원(기기 쿠키)·내보내기·백업
ok 6 - 실제 field_server.js 인증: 토큰 없으면 화면은 /pair로·API는 401+pair · 만료 코드 재발급 · 페어링 뒤 저장
ok 7 - 공개 저장소 보호: DB·백업·상담기록 내보내기 파일은 gitignore 대상
```

## 2. 신규 E2E `field_v1_records.spec.js` (PC 1440 · Fold8 펼침 884 · 접힘 412)
```
✓  50 [pc-1440] › tests/consultation-sim-browser/field_v1_records.spec.js:56:1 › 저장 → 새로고침 → 브라우저 종료 → 서버 재시작 후 같은 상담 복원 (Fold8은 접힘↔펼침 중 입력) (2.6s)
✓  53 [pc-1440] › tests/consultation-sim-browser/field_v1_records.spec.js:108:1 › 다필지 묶음 저장 · 검색 · 재열기 · 수정 · 내보내기 (3.4s)
✓  58 [pc-1440] › tests/consultation-sim-browser/field_v1_records.spec.js:163:1 › 자동저장 실패 경고 → 자동 재시도로 복구 · 같은 내용 중복 저장 없음 (4.0s)
✓  64 [pc-1440] › tests/consultation-sim-browser/field_v1_records.spec.js:187:1 › 인증 만료: 입력 중이면 이 화면에서 6자리 코드로 다시 연결(입력 보존) · 저장된 상태면 /pair로 이동 (4.6s)
✓  65 [pc-1440] › tests/consultation-sim-browser/field_v1_records.spec.js:218:1 › 기존 현장 UI 유지: 지도 고정·지도 크게·단계 이동·상담 버튼은 그대로 (369ms)
✓  197 [fold-open-884] › tests/consultation-sim-browser/field_v1_records.spec.js:56:1 › 저장 → 새로고침 → 브라우저 종료 → 서버 재시작 후 같은 상담 복원 (Fold8은 접힘↔펼침 중 입력) (2.5s)
✓  198 [fold-open-884] › tests/consultation-sim-browser/field_v1_records.spec.js:108:1 › 다필지 묶음 저장 · 검색 · 재열기 · 수정 · 내보내기 (3.5s)
✓  199 [fold-open-884] › tests/consultation-sim-browser/field_v1_records.spec.js:163:1 › 자동저장 실패 경고 → 자동 재시도로 복구 · 같은 내용 중복 저장 없음 (4.0s)
✓  200 [fold-open-884] › tests/consultation-sim-browser/field_v1_records.spec.js:187:1 › 인증 만료: 입력 중이면 이 화면에서 6자리 코드로 다시 연결(입력 보존) · 저장된 상태면 /pair로 이동 (4.7s)
✓  202 [fold-open-884] › tests/consultation-sim-browser/field_v1_records.spec.js:218:1 › 기존 현장 UI 유지: 지도 고정·지도 크게·단계 이동·상담 버튼은 그대로 (554ms)
✓  327 [fold-cover-412] › tests/consultation-sim-browser/field_v1_records.spec.js:56:1 › 저장 → 새로고침 → 브라우저 종료 → 서버 재시작 후 같은 상담 복원 (Fold8은 접힘↔펼침 중 입력) (2.6s)
✓  331 [fold-cover-412] › tests/consultation-sim-browser/field_v1_records.spec.js:108:1 › 다필지 묶음 저장 · 검색 · 재열기 · 수정 · 내보내기 (3.5s)
✓  336 [fold-cover-412] › tests/consultation-sim-browser/field_v1_records.spec.js:163:1 › 자동저장 실패 경고 → 자동 재시도로 복구 · 같은 내용 중복 저장 없음 (4.0s)
✓  342 [fold-cover-412] › tests/consultation-sim-browser/field_v1_records.spec.js:187:1 › 인증 만료: 입력 중이면 이 화면에서 6자리 코드로 다시 연결(입력 보존) · 저장된 상태면 /pair로 이동 (4.6s)
✓  345 [fold-cover-412] › tests/consultation-sim-browser/field_v1_records.spec.js:218:1 › 기존 현장 UI 유지: 지도 고정·지도 크게·단계 이동·상담 버튼은 그대로 (349ms)
```

## 3. 전체 상담 E2E 회귀 비교
| 구분 | 전체 | 통과 | 실패 | 건너뜀 |
|---|---|---|---|---|
| 기준선 bc4ff7e | 432 | 275 | 139 | 18 |
| V1.0 수정본 | 447 | 290 | 139 | 18 |

- 실패 목록(테스트명·화면) 비교: **수정본에만 있는 실패 0건, 기준선에만 있는 실패 0건** → V1.0으로 인한 회귀 없음.
- 기존 실패 139건은 모두 `notice_field.spec.js`·`notice_field_bundle.spec.js`·`notice_field_defects.spec.js`(기준선에서도 동일하게 실패). 대표 원인: 기본값이 된 3단계 집중 화면에서 단계 밖 요소(확인 사실·쟁점 접힘 등)가 숨겨져 기존 시나리오의 가시성 기대가 맞지 않음(예: notice_field.spec.js:40 `[data-f-parcel="1"]` hidden). V1.0 범위 밖으로 분리, 수정하지 않음.

기존 실패 파일·테스트별:
```
3  tests/consultation-sim-browser/notice_field.spec.js:116:1 
3  tests/consultation-sim-browser/notice_field.spec.js:129:1 
3  tests/consultation-sim-browser/notice_field.spec.js:171:1 
3  tests/consultation-sim-browser/notice_field.spec.js:183:1 
3  tests/consultation-sim-browser/notice_field.spec.js:201:1 
1  tests/consultation-sim-browser/notice_field.spec.js:21:1 
3  tests/consultation-sim-browser/notice_field.spec.js:255:1 
3  tests/consultation-sim-browser/notice_field.spec.js:293:1 
3  tests/consultation-sim-browser/notice_field.spec.js:305:1 
3  tests/consultation-sim-browser/notice_field.spec.js:333:1 
3  tests/consultation-sim-browser/notice_field.spec.js:364:1 
3  tests/consultation-sim-browser/notice_field.spec.js:374:1 
3  tests/consultation-sim-browser/notice_field.spec.js:37:1 
3  tests/consultation-sim-browser/notice_field.spec.js:398:1 
3  tests/consultation-sim-browser/notice_field.spec.js:505:1 
3  tests/consultation-sim-browser/notice_field.spec.js:50:1 
3  tests/consultation-sim-browser/notice_field.spec.js:605:1 
3  tests/consultation-sim-browser/notice_field.spec.js:615:1 
3  tests/consultation-sim-browser/notice_field.spec.js:641:1 
3  tests/consultation-sim-browser/notice_field.spec.js:692:1 
3  tests/consultation-sim-browser/notice_field.spec.js:73:1 
3  tests/consultation-sim-browser/notice_field.spec.js:757:1 
3  tests/consultation-sim-browser/notice_field.spec.js:92:1 
3  tests/consultation-sim-browser/notice_field_bundle.spec.js:128:1 
3  tests/consultation-sim-browser/notice_field_bundle.spec.js:154:1 
3  tests/consultation-sim-browser/notice_field_bundle.spec.js:168:1 
3  tests/consultation-sim-browser/notice_field_bundle.spec.js:197:1 
3  tests/consultation-sim-browser/notice_field_bundle.spec.js:225:1 
3  tests/consultation-sim-browser/notice_field_bundle.spec.js:243:1 
3  tests/consultation-sim-browser/notice_field_bundle.spec.js:274:1 
3  tests/consultation-sim-browser/notice_field_bundle.spec.js:290:1 
3  tests/consultation-sim-browser/notice_field_bundle.spec.js:73:1 
3  tests/consultation-sim-browser/notice_field_bundle.spec.js:84:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:115:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:133:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:141:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:150:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:160:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:170:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:188:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:195:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:206:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:45:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:56:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:68:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:76:1 
3  tests/consultation-sim-browser/notice_field_defects.spec.js:86:1 
```

## 4. 기타
```
Static site contract checks passed.
git diff --check: OK
notice field built: field-empty.html (408655 bytes, sha256=63f4569fa83c, no index)
```
