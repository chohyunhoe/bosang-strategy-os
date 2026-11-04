# 보상전략 OS v0.1 시용 실행

## 목적

여러 감정평가서 PDF를 한 번에 입력하여 법인별 canonical JSON, 시용 준비도, 비교표를 생성한다.

## Windows 실행

```bat
RUN_TRIAL_BATCH.cmd "경일.pdf" "제일.pdf" "가람.pdf"
```

필수 환경:

- Python
- Tesseract OCR
- Korean language data (`kor`)

## 출력

`trial-output/`

- `경일.canonical.json`
- `제일.canonical.json`
- `가람.canonical.json`
- `batch_comparison.json`
- `trial_manifest.json`

## 시용 준비도

각 평가서는 다음 6개 항목을 점검한다.

1. 비교표준지 식별
2. 대상토지↔표준지 개별요인 행
3. 비교사례 식별
4. 그 밖의 요인 후보
5. 토지조서 행
6. 표준지·대상토지 GIS 입력 가능성

6개 중 4개 이상 확보하면 `trial_usable=true`로 표시한다. 이는 감정평가 적정성이나 보상금 증액 가능성 판단이 아니라, 사람이 검토할 수 있는 시용 결과가 생성되었는지를 뜻한다.

## 개인정보·보안

PDF 원문과 OCR 중간결과는 로컬에서만 처리한다. 원문 PDF, API 키, 개인정보가 포함된 산출물을 저장소에 커밋하지 않는다.
