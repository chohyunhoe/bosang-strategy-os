# Layer 2 Model Result Inputs

이 디렉터리는 offline evaluator가 비교할 모델별 Layer 2 후보 JSON을 임시로 두는 위치입니다.

## 예상 입력 파일명

- `gpt_result.json`
- `claude_result.json`
- `gemini_result.json`

## Git 관리 원칙

모델 출력 JSON에는 평가서 원문에서 유래한 민감정보가 포함될 수 있으므로 `*.json` 결과 파일은 Git에 포함하지 않습니다. 디렉터리 구조 유지를 위해 `.gitkeep`과 이 README만 커밋합니다.

## strict JSON 저장 방법

GPT/Claude/Gemini 응답 원문을 직접 커밋하지 말고, 로컬 임시 파일이나 표준 입력으로 변환 스크립트에 전달합니다. 스크립트는 markdown code fence나 앞뒤 설명문이 섞여 있어도 첫 번째 유효 JSON object/array를 추출해 strict JSON으로 저장합니다.

```bash
# 파일에서 변환해 모델별 evaluator 입력 위치에 저장
npm run layer2:normalize -- --model gpt --input /tmp/gpt_layer2_raw.txt
npm run layer2:normalize -- --model claude --input /tmp/claude_layer2_raw.txt
npm run layer2:normalize -- --model gemini --input /tmp/gemini_layer2_raw.txt

# 저장하지 않고 strict JSON 변환 가능 여부만 확인
npm --silent run layer2:normalize -- --model gpt --input /tmp/gpt_layer2_raw.txt --dry-run

# 클립보드/표준 입력으로 전달하는 경우
cat /tmp/gpt_layer2_raw.txt | npm run layer2:normalize -- --model gpt
```

생성 대상 경로는 다음과 같습니다.

- `parser/output/layer2_results/gpt_result.json`
- `parser/output/layer2_results/claude_result.json`
- `parser/output/layer2_results/gemini_result.json`

위 결과 JSON은 `.gitignore`의 `parser/output/layer2_results/*.json` 규칙으로 제외되므로 Git에 포함하지 않습니다.

## 평가 실행

```bash
npm run layer2:evaluate
```

평가 결과는 아래 파일로 생성되며 Git에 포함하지 않습니다.

- `parser/output/layer2_model_eval_report.md`
- `parser/output/layer2_model_eval_report.json`
