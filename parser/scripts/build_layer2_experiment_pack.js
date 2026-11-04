#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const paths = {
  debugText: path.join(ROOT, 'parser/output/debug_actual_text_sample.txt'),
  gptPromptV2: path.join(ROOT, 'parser/prompts/layer2_extraction_prompt_gpt_v2.md'),
  shortPrompt: path.join(ROOT, 'parser/prompts/layer2_extraction_prompt_short.md'),
  checklist: path.join(ROOT, 'parser/prompts/layer2_model_comparison_checklist.md'),
  sampleCase: path.join(ROOT, 'reference/sample_case_001_v021_full.json'),
  outputDir: path.join(ROOT, 'parser/output'),
  pack: path.join(ROOT, 'parser/output/layer2_experiment_pack.md'),
  gpt: path.join(ROOT, 'parser/output/layer2_prompt_gpt.md'),
  gptV2: path.join(ROOT, 'parser/output/layer2_prompt_gpt_v2.md'),
  claude: path.join(ROOT, 'parser/output/layer2_prompt_claude.md'),
  gemini: path.join(ROOT, 'parser/output/layer2_prompt_gemini.md'),
  sheet: path.join(ROOT, 'parser/output/layer2_model_comparison_sheet.md'),
};

const KEYWORDS = [
  '감정평가 목적',
  '감정평가 개요',
  '본건은',
  '사업명',
  '공익사업의 명칭',
  '기준시점',
  '가격시점',
  '평가기준일',
  '감정평가법인',
  '평가법인',
  '비교표준지',
  '토지가액 산출근거',
  '감정평가 세부내역',
  '산출단가',
  '평가금액',
  '합계',
];

const COMPARISON_ITEMS = [
  ['사업명 추출 정확도', '`case.project_name`이 명시 라벨과 일치하는지 확인'],
  ['평가법인명 추출 정확도', '`appraisals[].appraisal_company`가 원문 법인명과 일치하는지 확인'],
  ['기준시점/가격시점 추출 정확도', '작성일·조사기간·고시일과 혼동하지 않았는지 확인'],
  ['비교표준지 추출 정확도', '`standard_lands[]`가 표준지 섹션 근거를 갖는지 확인'],
  ['편입토지 추출 정확도', '토지가액 산출근거 행을 편입토지 기본정보로 오인하지 않았는지 확인'],
  ['토지가액 산출근거 추출 정확도', '`land_appraisal_results[]`가 원문 기재값만 사용했는지 확인'],
  ['source_refs 품질', '짧은 excerpt, page/block/char 또는 위치 부재 notes가 적절한지 확인'],
  ['MISSING 처리 안전성', '원문 근거 없는 항목을 null/MISSING/LOW로 둔 비율 확인'],
  ['false positive 발생 여부', '그럴듯한 추론, 섹션 혼동, 평가법인-토지 연결 오류 확인'],
  ['금지 표현 발생 여부', '산정, 증액 가능성, 법률판단 확정, 평가 대체 표현 여부 확인'],
  ['JSON schema 호환성', '엄격 JSON, wrapper 필드, KillerKit v0.2.5 key 호환성 확인'],
  ['실무 검수 편의성', '담당자가 원문 대조와 수동 검수를 빠르게 할 수 있는지 확인'],
];

const PRIVACY_NOTICE = '이 excerpt에는 지번, 금액, 사업명 등 민감정보가 포함될 수 있습니다. 외부 모델에 투입하기 전 사용자 판단으로 최소 범위만 사용하십시오.';
const EXCERPT_RADIUS = 1500;
const CLAUDE_EXCERPT_LIMIT = 1500;

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function ensureRequiredFiles() {
  const required = [paths.gptPromptV2, paths.shortPrompt, paths.checklist, paths.sampleCase];
  const missing = required.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length > 0) {
    throw new Error(`Required input file(s) not found:\n${missing.map((filePath) => `- ${path.relative(ROOT, filePath)}`).join('\n')}`);
  }
}

function findKeywordRanges(rawText) {
  const ranges = [];
  for (const keyword of KEYWORDS) {
    let fromIndex = 0;
    while (fromIndex < rawText.length) {
      const index = rawText.indexOf(keyword, fromIndex);
      if (index === -1) {
        break;
      }
      ranges.push({
        keyword,
        start: Math.max(0, index - EXCERPT_RADIUS),
        end: Math.min(rawText.length, index + keyword.length + EXCERPT_RADIUS),
      });
      fromIndex = index + keyword.length;
    }
  }
  return ranges.sort((a, b) => a.start - b.start || a.end - b.end);
}

function mergeRanges(ranges) {
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) {
      merged.push({ start: range.start, end: range.end, keywords: [range.keyword] });
      continue;
    }
    last.end = Math.max(last.end, range.end);
    if (!last.keywords.includes(range.keyword)) {
      last.keywords.push(range.keyword);
    }
  }
  return merged;
}

function snapToParagraph(rawText, range) {
  const before = rawText.lastIndexOf('\n\n', range.start);
  const after = rawText.indexOf('\n\n', range.end);
  return {
    start: before === -1 ? range.start : Math.max(0, before + 2),
    end: after === -1 ? range.end : Math.min(rawText.length, after),
    keywords: range.keywords,
  };
}

function extractSections(rawText) {
  const ranges = mergeRanges(findKeywordRanges(rawText)).map((range) => snapToParagraph(rawText, range));

  if (ranges.length === 0) {
    const fallbackEnd = Math.min(rawText.length, 5000);
    return [
      {
        title: 'Fallback excerpt — 핵심 키워드 미발견',
        keywords: [],
        start: 0,
        end: fallbackEnd,
        text: rawText.slice(0, fallbackEnd).trim(),
      },
    ];
  }

  return ranges.map((range, index) => ({
    title: `Excerpt ${String(index + 1).padStart(2, '0')}`,
    keywords: range.keywords,
    start: range.start,
    end: range.end,
    text: rawText.slice(range.start, range.end).trim(),
  }));
}

function formatSections(sections) {
  return sections
    .map((section) => {
      const keywordText = section.keywords.length > 0 ? section.keywords.join(', ') : 'N/A';
      return `## ${section.title}\n\n- matched_keywords: ${keywordText}\n- char_range: ${section.start}-${section.end}\n\n\`\`\`text\n${section.text}\n\`\`\``;
    })
    .join('\n\n---\n\n');
}

function compactExcerpt(sections, maxChars) {
  const joined = sections
    .map((section) => `[${section.title} / ${section.keywords.join(', ') || 'N/A'}]\n${section.text}`)
    .join('\n\n---\n\n');
  if (joined.length <= maxChars) {
    return { text: joined, truncated: false };
  }
  return {
    text: `${joined.slice(0, maxChars).trim()}\n\n[원문 추가 필요: Claude 운영 원칙에 따라 ${maxChars.toLocaleString('ko-KR')}자까지만 포함했습니다.]`,
    truncated: true,
  };
}

function readSampleSchemaSummary() {
  const sample = JSON.parse(readUtf8(paths.sampleCase));
  const topLevelKeys = Object.keys(sample);
  const selectedShape = {
    case: sample.case ? Object.keys(sample.case) : [],
    appraisals: Array.isArray(sample.appraisals) && sample.appraisals[0] ? Object.keys(sample.appraisals[0]) : [],
    lands: Array.isArray(sample.lands) && sample.lands[0] ? Object.keys(sample.lands[0]) : [],
    standard_lands: Array.isArray(sample.standard_lands) && sample.standard_lands[0] ? Object.keys(sample.standard_lands[0]) : [],
    land_appraisal_results: Array.isArray(sample.land_appraisal_results) && sample.land_appraisal_results[0] ? Object.keys(sample.land_appraisal_results[0]) : [],
    appraisal_totals: Array.isArray(sample.appraisal_totals) && sample.appraisal_totals[0] ? Object.keys(sample.appraisal_totals[0]) : [],
  };
  return { topLevelKeys, selectedShape };
}

function jsonRequirements(schemaSummary) {
  return `## 출력 JSON 요구사항\n\n- Markdown 설명, 코드펜스, 주석 없이 파싱 가능한 JSON만 출력하십시오.\n- top-level meta에는 layer, output_type, schema_target, auto_confirmed:false, privacy_notice를 포함하십시오.\n- 모든 후보 wrapper는 candidate_value, confidence_level, review_status_code, auto_confirmed:false, source_refs, parser_notes, llm_extraction_notes를 포함하십시오.\n- 원문 근거가 없으면 candidate_value:null, confidence_level:"LOW", review_status_code:"MISSING", source_refs:[]로 두십시오.\n- HIGH/MEDIUM confidence에는 source_refs가 반드시 필요합니다.\n- 이번 실험 대상은 case, appraisals, lands, standard_lands, land_appraisal_results, appraisal_totals 중심입니다.\n- 후속 보류 대상(comp_cases, subject_to_standard_factor_comparisons, standard_to_comp_case_factor_comparisons, other_factor_reviews, issue_candidates, draft_sentences, risk_warnings)은 생성하지 않거나 비워 두십시오.\n- KillerKit schema compatibility 참고 top-level keys: ${schemaSummary.topLevelKeys.join(', ')}\n- selected shape 참고:\n\n\`\`\`json\n${JSON.stringify(schemaSummary.selectedShape, null, 2)}\n\`\`\``;
}

function buildGptPrompt(longPrompt, sectionsText, schemaSummary) {
  return `# GPT Layer 2 Prompt-only Experiment Pack\n\n> ${PRIVACY_NOTICE}\n\n${longPrompt.trim()}\n\n${jsonRequirements(schemaSummary)}\n\n## RAW_TEXT_EXCERPT\n\n${sectionsText}\n`;
}

function buildClaudePrompt(shortPrompt, sections, schemaSummary) {
  const compact = compactExcerpt(sections, CLAUDE_EXCERPT_LIMIT);
  const brief = `# Claude Layer 2 Prompt-only Experiment Pack\n\n> ${PRIVACY_NOTICE}\n\n## 운영 원칙\n\n- 1,500자 이하 단축 브리프를 우선 사용합니다.\n- 긴 원문 전체를 붙여 넣지 말고, 아래 excerpt만 대상으로 검토 보조 후보 JSON을 작성합니다.\n- excerpt가 잘렸다면 보이지 않는 내용은 MISSING으로 두고, 필요한 경우 parser_notes에 "원문 추가 필요"라고 적습니다.\n- 감정평가 대체, 법률자문 확정, 보상금 증액 단정 표현을 사용하지 않습니다.\n\n## 단축 프롬프트\n\n${shortPrompt.trim()}\n\n## Claude 추가 출력 조건\n\n- 출력은 JSON만 허용합니다.\n- source_refs.excerpt는 짧게 유지합니다.\n- 위치 메타가 없으면 page_index, block_id, char_start, char_end를 null로 두고 수동 excerpt라 위치 메타 없음이라고 적습니다.\n- schema compatibility 참고 top-level keys: ${schemaSummary.topLevelKeys.join(', ')}\n- excerpt_truncated: ${compact.truncated ? 'true — 원문 추가 필요' : 'false'}\n\n## RAW_TEXT_EXCERPT_FOR_CLAUDE\n\n\`\`\`text\n${compact.text}\n\`\`\`\n`;
  return brief;
}

function buildGeminiPrompt(shortPrompt, sectionsText, schemaSummary) {
  return `# Gemini Layer 2 Schema/Data Review Prompt-only Experiment Pack\n\n> ${PRIVACY_NOTICE}\n\n## 역할\n\nKillerKit schema compatibility와 source_refs 품질을 우선 검토하는 Layer 2 의미추출 보조자입니다. 감정평가·법률자문·보상금 산정을 수행하지 말고, 수동 검수 가능한 후보 JSON만 출력하십시오.\n\n## 기본 프롬프트\n\n${shortPrompt.trim()}\n\n## Gemini 중점 검토\n\n1. JSON schema 호환성: top-level key와 배열 구조가 KillerKit v0.2.5 후보 병합에 맞는지 확인합니다.\n2. source_refs 품질: 각 후보값이 짧은 원문 근거, reason, 위치 메타 null 처리 notes를 갖는지 확인합니다.\n3. 표/데이터 구조: 평가법인, 비교표준지, 편입토지, 토지가액 산출근거를 서로 혼동하지 않습니다.\n4. MISSING 안전성: 근거 없는 값은 추론하지 않고 MISSING/LOW/source_refs:[]로 둡니다.\n5. 금지 표현: 감정평가 대체, 법률자문 확정, 보상금 증액 단정 표현을 출력하지 않습니다.\n\n${jsonRequirements(schemaSummary)}\n\n## RAW_TEXT_EXCERPT\n\n${sectionsText}\n`;
}

function buildComparisonSheet(checklist, sections) {
  const extractedSummary = sections
    .map((section) => `- ${section.title}: ${section.keywords.join(', ') || 'N/A'} (${section.start}-${section.end})`)
    .join('\n');
  const rows = COMPARISON_ITEMS.map(([item, memo]) => `| ${item} |  |  |  | ${memo} |`).join('\n');
  return `# Layer 2 모델 출력 비교표\n\n> ${PRIVACY_NOTICE}\n\n## 생성된 excerpt 범위\n\n${extractedSummary}\n\n## 점수 기준\n\n| 점수 | 의미 |\n| --- | --- |\n| 0 | 실패 |\n| 1 | 일부 성공 |\n| 2 | 실무 검수 가능 |\n| 3 | 매우 우수 |\n\n## 비교표\n\n| 평가 항목 | GPT 점수(0-3) | Claude 점수(0-3) | Gemini 점수(0-3) | 관찰 메모 |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## 원본 체크리스트 참고\n\n${checklist.trim()}\n`;
}

function buildPack({ sectionsText, gptPrompt, claudePrompt, geminiPrompt, sheet, schemaSummary }) {
  return `# Layer 2 Prompt-only Experiment Pack\n\nDefault Layer 2 model: GPT v2\n\nClaude/Gemini comparison is optional and not part of the routine loop.\n\n> ${PRIVACY_NOTICE}\n\n## 목적\n\n이 파일은 실제 LLM API 호출 없이 GPT / Claude / Gemini에 수동으로 붙여 넣을 Layer 2 의미추출 실험 자료를 한곳에 모은 prompt-only 실험팩입니다. API key 저장, 서버 업로드, OCR, VWorld/API 연동, 의견서 자동작성은 포함하지 않습니다.\n\n## 생성 파일\n\n- GPT v2: \`parser/output/layer2_prompt_gpt_v2.md\`\n- GPT legacy-compatible alias: \`parser/output/layer2_prompt_gpt.md\`\n- Claude: \`parser/output/layer2_prompt_claude.md\`\n- Gemini: \`parser/output/layer2_prompt_gemini.md\`\n- 비교표: \`parser/output/layer2_model_comparison_sheet.md\`\n\n## KillerKit schema 참고\n\n- top-level keys: ${schemaSummary.topLevelKeys.join(', ')}\n\n## 추출 excerpt\n\n${sectionsText}\n\n---\n\n## GPT v2 Prompt\n\n${gptPrompt}\n\n---\n\n## Claude Prompt\n\n${claudePrompt}\n\n---\n\n## Gemini Prompt\n\n${geminiPrompt}\n\n---\n\n## Comparison Sheet\n\n${sheet}\n`;
}

function relative(filePath) {
  return path.relative(ROOT, filePath);
}

function printSummary({ debugText, extractedSections, result, next }) {
  console.log('=== Layer 2 Experiment Pack ===');
  console.log(`Debug Text: ${debugText}`);
  console.log(`Extracted Sections: ${extractedSections}`);
  console.log(`GPT v2 Prompt: ${fs.existsSync(paths.gptV2) ? relative(paths.gptV2) : 'N/A'}`);
  console.log(`GPT Prompt: ${fs.existsSync(paths.gpt) ? relative(paths.gpt) : 'N/A'}`);
  console.log(`Claude Prompt: ${fs.existsSync(paths.claude) ? relative(paths.claude) : 'N/A'}`);
  console.log(`Gemini Prompt: ${fs.existsSync(paths.gemini) ? relative(paths.gemini) : 'N/A'}`);
  console.log(`Comparison Sheet: ${fs.existsSync(paths.sheet) ? relative(paths.sheet) : 'N/A'}`);
  console.log(`Result: ${result}`);
  console.log(`Next: ${next}`);
  console.log('=== END ===');
}

function main() {
  const hasDebugText = fs.existsSync(paths.debugText);

  ensureRequiredFiles();
  fs.mkdirSync(paths.outputDir, { recursive: true });

  const rawText = hasDebugText
    ? readUtf8(paths.debugText)
    : 'Layer 2 debug text sample is not available. 생성된 프롬프트를 외부 모델에 수동 투입하기 전에 npm run parser:actual 또는 npm run bosang:cycle을 실행해 parser/output/debug_actual_text_sample.txt를 생성하십시오.';
  const sections = extractSections(rawText);
  const sectionsText = formatSections(sections);
  const gptPromptV2 = readUtf8(paths.gptPromptV2);
  const shortPrompt = readUtf8(paths.shortPrompt);
  const checklist = readUtf8(paths.checklist);
  const schemaSummary = readSampleSchemaSummary();

  const gptPrompt = buildGptPrompt(gptPromptV2, sectionsText, schemaSummary);
  const claudePrompt = buildClaudePrompt(shortPrompt, sections, schemaSummary);
  const geminiPrompt = buildGeminiPrompt(shortPrompt, sectionsText, schemaSummary);
  const sheet = buildComparisonSheet(checklist, sections);
  const pack = buildPack({ sectionsText, gptPrompt, claudePrompt, geminiPrompt, sheet, schemaSummary });

  fs.writeFileSync(paths.gptV2, gptPrompt, 'utf8');
  fs.writeFileSync(paths.gpt, gptPrompt, 'utf8');
  fs.writeFileSync(paths.claude, claudePrompt, 'utf8');
  fs.writeFileSync(paths.gemini, geminiPrompt, 'utf8');
  fs.writeFileSync(paths.sheet, sheet, 'utf8');
  fs.writeFileSync(paths.pack, pack, 'utf8');

  printSummary({
    debugText: hasDebugText ? relative(paths.debugText) : `${relative(paths.debugText)} not found — generated with fallback notice`,
    extractedSections: `${sections.length} section(s)`,
    result: hasDebugText ? 'CREATED' : 'CREATED_WITH_FALLBACK_DEBUG_NOTICE',
    next: '생성된 prompt-only 파일을 열어 민감정보 최소 범위를 확인한 뒤 외부 모델에 수동으로 붙여 넣으십시오.',
  });
}

try {
  main();
} catch (error) {
  console.error('Layer 2 experiment pack generation failed.');
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
