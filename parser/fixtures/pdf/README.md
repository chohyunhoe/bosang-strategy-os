# Parser PDF fixtures

실제 감정평가서 PDF는 개인정보와 PR binary 처리 제한을 고려해 Git에 포함하지 않고 로컬 테스트 입력물로만 사용합니다.

로컬에서 실제 PDF 기반 Parser Layer 1A 확인이 필요하면 아래 경로에 파일을 수동 배치합니다.

```text
parser/fixtures/pdf/text_pdf_layer1_actual_gyeongil.pdf
```

해당 PDF가 없으면 테스트는 실패하지 않고 SKIP 안내를 출력합니다. 파일이 있으면 `pdf-parse`로 TEXT_PDF 텍스트 추출을 시도하고, 결과는 Git 제외 대상인 아래 파일에만 기록합니다.

```text
parser/output/generated_case.layer1.actual.json
```

actual output은 개인정보·지번·짧은 원문 excerpt가 포함될 수 있으므로 커밋하지 않습니다. 추출값은 검토 보조용 후보이며 `auto_confirmed: false`, 수동 검수와 전문가 검토 필요 상태를 유지합니다. 이미지/스캔본 또는 텍스트 레이어 부재 후보는 `OCR_REQUIRED`로 분류하되 이번 단계에서 OCR은 수행하지 않습니다.
