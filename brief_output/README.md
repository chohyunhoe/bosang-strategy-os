# 보상전략 OS Brief Output v0.1

## 목적

감정평가 구조화 데이터와 사건 설정값을 받아 5페이지 분석 브리프 조립에 필요한 표·문안·쟁점·슬롯·QA·검토큐를 하나의 JSON으로 생성합니다.

## 실행

```bash
cd brief_output
python -m pip install -r requirements.txt
python -m unittest -v test_brief_output.py test_docx_binder.py
python build_golden_case.py
python build_golden_case_docx.py
```

## 생성 파일

- `bso_brief_output_v0.1.json`
- `bso_brief_output_v0.1.schema.json`
- `bso_brief_output_v0.1.docx` (`templates/bso_brief_template_v0.1.docx`에 슬롯 바인딩한 결과)

위 세 파일은 실행할 때마다 새로 만들어지는 산출물이라 Git 추적 대상이 아닙니다(`.gitignore` 참고). Git에는 소스 코드와 `templates/bso_brief_template_v0.1.docx`(개인정보 없는 빈 슬롯 템플릿)만 커밋합니다.

## 핵심 안전 규칙

- 개별요인 세부값과 종합값이 모두 없으면 해당 평가행은 `FAIL`입니다.
- 개별요인 누락이 있는 실행은 `complete`가 될 수 없고 `partial`로 반환됩니다.
- 누락값을 추정하지 않고 `확인 필요` 또는 `null`로 유지합니다.
- 핵심 쟁점은 최대 3개이며 모두 사람 검토대상입니다.
- 증액률·적정 보상액·감정평가 적정성의 최종 판단을 생성하지 않습니다.
- 원본 PDF 저장을 전제로 하지 않으며 개인정보는 마스킹된 사건 설정값만 사용합니다.

## 현재 골든케이스 범위

- 프로젝트: 광명시흥 공공주택지구
- 대상토지: 과림동 120-7, 120-8
- 비교표준지: 과림동 130-7
- 결정단가 fixture: 중앙 882,000원/㎡, 정해 927,000원/㎡
- 자동 산출 단가 차이: 45,000원/㎡
- 특이문구 fixture: `획지조건에서 우세함` + 적용값 `1.00`

fixture 값은 파이프라인 검증용이며 실제 원문 페이지·항목별 개별요인 수치는 별도 추출 및 대조가 필요합니다.

## DOCX 연결

`docx_slot_manifest.json`에 5페이지 16개 슬롯을 고정했고, `docx_template.py` / `docx_binder.py`가 실제 바인딩을 수행합니다.

- `docx_template.py`: 매니페스트의 16개 슬롯만 담은 NATIVE 빈 템플릿(`templates/bso_brief_template_v0.1.docx`)을 생성합니다. 헤더에 문서 제목, 푸터에 "검토 보조 자료 · 쟁점 후보 · 전문가 검토 필요" 고지문을 고정합니다.
- `docx_binder.py`: `BriefOutput` 데이터로 템플릿의 슬롯을 채운 새 파일을 만듭니다. 원본 템플릿은 열기만 하고 절대 덮어쓰지 않습니다.
  - `text`/`issues` 슬롯: 문단·쟁점 후보를 채웁니다. 값이 없으면 `확인 필요`를 그대로 유지합니다(새로 추정하지 않음).
  - `table` 슬롯: `TablePayload`를 NATIVE Word 표(`Table Grid` 스타일)로 삽입합니다.
  - `image` 슬롯: 지도 그래픽 4종은 아직 생성되지 않으므로(`GraphicAsset.status == "pending"`) 이미지 대신 `[그래픽 대기: ... — 후속 연결 필요. 전문가 검토 필요.]` 문구를 명시적으로 남깁니다. `status == "ready"`이고 `file_name`이 있으면 실제 이미지를 삽입합니다.
  - 템플릿에 없는 슬롯, 매니페스트에 없는 슬롯, 중복 슬롯이 있으면 `SlotBindingError`로 즉시 실패합니다(슬롯명 유일성 규칙 강제).

지도 그래픽 4종의 실제 자산 생성(위치도·확대도·흐름도)은 여전히 후속 구현이 필요합니다. 이 모듈은 그래픽이 없어도 5페이지 텍스트·표 슬롯이 모두 자동으로 채워지고 그래픽 슬롯만 명시적 대기 상태로 남는 것까지를 범위로 합니다.
