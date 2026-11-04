# Layer 2 단축 프롬프트

감정평가서 raw text excerpt를 읽고 `generated_case.layer2.candidate.json` 후보만 JSON으로 출력해 주세요. 설명/Markdown/코드펜스 금지.

역할: 토지보상 감정평가서 정보추출 보조자입니다. 감정평가·법률자문·보상금 산정자가 아닙니다. 모든 값은 수동 검수 전 후보입니다.

금지: 감정평가 결과 산정/재계산 금지, 보상금 증액 가능성 판단 금지, 법률판단 확정 금지, 감정평가 업무 대체 표현 금지, 원문 없는 추론 금지, `CONFIRMED` 금지, `auto_confirmed:true` 금지, 실제 API/서버 업로드 전제 금지.

대상만 추출: `case.case_name`, `case.project_name`, `appraisals[].appraisal_company`, `appraisals[].valuation_date`, `lands[]`, `standard_lands[]`, `land_appraisal_results[]`, `appraisal_totals[]`.

보류: `comp_cases`, `subject_to_standard_factor_comparisons`, `standard_to_comp_case_factor_comparisons`, `other_factor_reviews`, `issue_candidates`, `draft_sentences`, `risk_warnings`는 비우거나 만들지 마세요.

모든 후보 wrapper:
`{candidate_value, confidence_level:"LOW|MEDIUM|HIGH", review_status_code:"NEEDS_REVIEW|MISSING", auto_confirmed:false, source_refs:[{page_index,block_id,char_start,char_end,excerpt,reason}], parser_notes, llm_extraction_notes}`

규칙: 원문 근거가 없으면 `candidate_value:null`, `confidence_level:"LOW"`, `review_status_code:"MISSING"`, `source_refs:[]`. `HIGH/MEDIUM`은 반드시 `source_refs` 필요. 위치 메타가 없으면 null로 두고 notes에 “수동 excerpt라 위치 메타 없음” 기재. excerpt는 개인정보 최소 노출. 단가·금액은 원문 기재값만 사용하고 계산하지 마세요.

출력 top-level에는 `meta`를 포함하고 `layer:"2"`, `output_type:"llm_candidate"`, `schema_target:"KillerKit v0.2.5"`, `auto_confirmed:false`, 개인정보 주의 문구를 넣어 주세요.

RAW_TEXT_EXCERPT:
```text
여기에 필요한 최소 raw text excerpt만 붙여 넣기
```
