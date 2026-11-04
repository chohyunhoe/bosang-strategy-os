const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const stable16 = fs.readFileSync(path.join(root, "bosang_os_v04_alpha2_stable16.html"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const coreWorkflowPath = path.join(root, "core_workflow.md");
assert.ok(fs.existsSync(coreWorkflowPath), "core_workflow.md must exist as the top-level appraisal-to-opinion workflow standard");
const coreWorkflow = fs.readFileSync(coreWorkflowPath, "utf8");
const publicDataApiDesignPath = path.join(root, "public_data_api_design.md");
assert.ok(fs.existsSync(publicDataApiDesignPath), "public_data_api_design.md must exist for public data API design review");
const publicDataApiDesign = fs.readFileSync(publicDataApiDesignPath, "utf8");
const demoWalkthroughPath = path.join(root, "demo_walkthrough.md");
assert.ok(fs.existsSync(demoWalkthroughPath), "demo_walkthrough.md must exist for portfolio demo QA");
const demoWalkthrough = fs.readFileSync(demoWalkthroughPath, "utf8");
const apiRuntimeQaPath = path.join(root, "api_runtime_qa.md");
assert.ok(fs.existsSync(apiRuntimeQaPath), "api_runtime_qa.md must exist for browser API runtime QA");
const apiRuntimeQa = fs.readFileSync(apiRuntimeQaPath, "utf8");
const vworldSuccessFlowPath = path.join(root, "vworld_success_flow.md");
assert.ok(fs.existsSync(vworldSuccessFlowPath), "vworld_success_flow.md must exist for VWorld yearly success flow docs");
const vworldSuccessFlow = fs.readFileSync(vworldSuccessFlowPath, "utf8");
const vworldBatchLookupDesignPath = path.join(root, "vworld_batch_lookup_design.md");
assert.ok(fs.existsSync(vworldBatchLookupDesignPath), "vworld_batch_lookup_design.md must exist for VWorld batch lookup design");
const vworldBatchLookupDesign = fs.readFileSync(vworldBatchLookupDesignPath, "utf8");
const vworldBatchScriptPath = path.join(root, "scripts", "vworld_batch_lookup.js");
assert.ok(fs.existsSync(vworldBatchScriptPath), "scripts/vworld_batch_lookup.js must exist for local VWorld batch lookup");
const vworldBatchScript = fs.readFileSync(vworldBatchScriptPath, "utf8");
const envExamplePath = path.join(root, ".env.example");
assert.ok(fs.existsSync(envExamplePath), ".env.example must exist for local VWorld batch environment setup");
const envExample = fs.readFileSync(envExamplePath, "utf8");
const pnuListSamplePath = path.join(root, "input", "pnu_list_sample.csv");
assert.ok(fs.existsSync(pnuListSamplePath), "input/pnu_list_sample.csv must exist for VWorld batch sample input");
const pnuListSample = fs.readFileSync(pnuListSamplePath, "utf8");
assert.ok(fs.existsSync(path.join(root, "output", ".gitkeep")), "output/.gitkeep must exist so generated VWorld output directory is available");
const sample = JSON.parse(fs.readFileSync(path.join(root, "sample_case_gongju.json"), "utf8"));

const manualQaPath = path.join(root, "manual_qa_checklist.md");
const portfolioNotesPath = path.join(root, "portfolio_demo_notes.md");
assert.ok(fs.existsSync(manualQaPath), "manual_qa_checklist.md must exist for release demo QA");
assert.ok(fs.existsSync(portfolioNotesPath), "portfolio_demo_notes.md must exist for portfolio/interview demo notes");
const manualQa = fs.readFileSync(manualQaPath, "utf8");
const portfolioNotes = fs.readFileSync(portfolioNotesPath, "utf8");
const uxRedesignPlan = fs.readFileSync(path.join(root, "ux_redesign_plan.md"), "utf8");
const technicalDebtPath = path.join(root, "technical_debt.md");
assert.ok(fs.existsSync(technicalDebtPath), "technical_debt.md must exist for PR-29G-1 stabilization debt tracking");
const technicalDebt = fs.readFileSync(technicalDebtPath, "utf8");

const htmlLineCount = html.split(/\r?\n/).length;
assert.ok(htmlLineCount >= 500, `index.html must stay at least 500 lines; got ${htmlLineCount}`);
assert.ok(Buffer.byteLength(html, "utf8") >= 100 * 1024, `index.html must stay at least 100KB; got ${Buffer.byteLength(html, "utf8")} bytes`);

function assertIncludes(source, needle, label) {
  assert.ok(source.includes(needle), `${label} must include ${needle}`);
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function assertOrder(source, earlier, later, label) {
  const earlierIndex = source.indexOf(earlier);
  const laterIndex = source.indexOf(later);
  assert.ok(earlierIndex >= 0, `${label} must include ${earlier}`);
  assert.ok(laterIndex >= 0, `${label} must include ${later}`);
  assert.ok(earlierIndex < laterIndex, `${label} must place ${earlier} before ${later}`);
}

const requiredCoreWorkflowPhrases = [
  "평가서 업로드",
  "평가 원리",
  "의견서 작성 필수정보",
  "비교표준지 정보",
  "편입토지 정보",
  "VWorld API",
  "편입토지↔비교표준지 개별요인표",
  "거래사례↔비교표준지 개별요인표",
  "지도 로드",
  "자동 쟁점도출",
  "의견서 주장문 초안",
  "제출검토"
];
for (const phrase of requiredCoreWorkflowPhrases) {
  assertIncludes(coreWorkflow, phrase, "core_workflow.md top-level workflow contract");
}
assertIncludes(readme, "core_workflow.md", "README.md core workflow link");

for (const phrase of [
  "법률자문·감정평가 업무를 대체하지 않습니다",
  "보상금 증감을 단정하지 않습니다",
  "앱 서버에 저장하지 않습니다",
  "VWorld 조회 시 PNU",
  "검토 보강자료",
  "평가상 문제를 단정하지 않습니다",
  "개발자 옵션 — JSON·API·OCR 관리",
  "기타조건은 개별요인 비교의 하위 항목",
  "그 밖의 요인",
  "generateOcrTestCandidates"
]) {
  assertIncludes(html, phrase, "index.html PR-29G-1 stabilization copy contract");
}
assert.equal(countOccurrences(html, "function generateOcrTestCandidates"), 1, "index.html must define generateOcrTestCandidates exactly once");
for (const phrase of [
  "평가서 PDF 또는 JSON을 등록합니다",
  "조회값은 확정값이 아니라 검토 보강자료입니다",
  "평가상 문제를 단정하지 않습니다",
  "보상금 증감을 단정하지 않습니다",
  "제출 전 전문가 확인이 필요합니다"
]) {
  assertIncludes(html, phrase, "index.html five workflow section-note stabilization copy");
}
for (const phrase of [
  "stable wrapper chain 정리 필요",
  "CSS `:root` / override 통합 필요",
  "`renderAll` 전체 재렌더 최적화 필요",
  "개발자 상세 메뉴 사용자 노출 최소화 필요"
]) {
  assertIncludes(technicalDebt, phrase, "technical_debt.md PR-29G-1 debt log");
}

for (const phrase of [
  "법인별 수치 비교 매트릭스",
  "수치 차이는 보상금 증액 가능성이나 평가 오류를 의미하지 않습니다",
  "원문·산식·개별요인표를 수동검수",
  "VWorld 보강값은 토지특성 검토 보강자료",
  "그 밖의 요인과 기타조건을 혼동하지 않도록",
  "appraisal_company_comparison_matrix",
  "draft_land_appraisal_comparisons",
  "comparison_summary_by_land",
  "land_appraisal_results"
]) {
  assertIncludes(html, phrase, "index.html PR-29F appraisal company comparison matrix contract");
  assertIncludes(readme, phrase, "README.md PR-29F appraisal company comparison matrix docs");
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md PR-29F appraisal company comparison matrix demo");
}

for (const phrase of [
  "수치 비교 기반 쟁점 후보",
  "쟁점 후보는 평가상 문제나 위법성을 확정하는 판단이 아닙니다",
  "수치 차이는 검토 단서",
  "보상금 증액 가능성을 의미하지 않습니다",
  "A~C등급 후보만 의견서 보조문안",
  "D등급은 반영 보류",
  "draft_issue_candidates",
  "VALUE_COMPARE",
  "VWORLD",
  "issue_candidates"
]) {
  assertIncludes(html, phrase, "index.html PR-29G comparison-to-issue candidate contract");
  assertIncludes(readme, phrase, "README.md PR-29G comparison-to-issue candidate docs");
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md PR-29G comparison-to-issue candidate demo");
}
assert.ok(Array.isArray(sample.draft_issue_candidates), "sample draft_issue_candidates must be an array");
assert.ok(sample.draft_issue_candidates.length > 0, "sample draft_issue_candidates must include PR-29G demo rows");
assert.ok(sample.draft_issue_candidates.every((row) => Object.hasOwn(row, "source_ref_ids")), "draft issue candidates must keep source references for later issue_candidates linkage");
assertIncludes(readme, "평가서 업로드부터 의견서 제출검토까지의 실무 흐름", "README.md core workflow baseline");

for (const phrase of [
  "평가서 해석·추출 진행상태",
  "텍스트 추출 대기",
  "OCR 필요 여부 확인",
  "평가서 추출 작업 큐",
  "업로드 후 바로 VWorld 보강이 아니라 평가서 해석·추출이 먼저입니다"
]) {
  assertIncludes(html, phrase, "index.html appraisal extraction queue contract");
  assertIncludes(readme, phrase, "README.md appraisal extraction queue docs");
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md appraisal extraction queue demo");
}

for (const phrase of [
  "텍스트 추출 미리보기",
  "TEXT_EXTRACTED",
  "OCR_REQUIRED",
  "MANUAL_TEXT_PASTE",
  "텍스트 추출 결과는 원문 검토용 후보",
  "이미지 기반 PDF는 OCR_REQUIRED",
  "필수정보 후보 추출",
  "VWorld 보강은 편입토지 상세 생성 후"
]) {
  assertIncludes(html, phrase, "index.html PR-29B PDF text extraction preview contract");
  assertIncludes(readme, phrase, "README.md PR-29B PDF text extraction preview docs");
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md PR-29B PDF text extraction preview demo");
}

for (const phrase of [
  "필수정보 후보 추출",
  "후보값은 자동 확정값이 아닙니다",
  "비교표준지 후보",
  "편입토지 후보",
  "거래사례 후보",
  "개별요인표 후보",
  "그 밖의 요인 후보",
  "AUTO_CANDIDATE",
  "LOW_CONFIDENCE",
  "VWorld 보강은 편입토지 상세 후보가 검수된 후"
]) {
  assertIncludes(html, phrase, "index.html PR-29C essential candidate extraction contract");
  assertIncludes(readme, phrase, "README.md PR-29C essential candidate extraction docs");
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md PR-29C essential candidate extraction demo");
}

for (const phrase of [
  "원본 파일 등록",
  "문서 구성 요약 카드",
  "page_texts, preview_text, raw_text_snippet",
  "원문은 접힘/스크롤",
  "앱 내부 OCR 작업대",
  "외부 OCR 결과 가져오기",
  "고급 fallback",
  "compact 후보 테이블"
]) {
  assertIncludes(html, phrase, "index.html PR-29B-C compact extraction UX contract");
  assertIncludes(readme, phrase, "README.md PR-29B-C compact extraction UX docs");
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md PR-29B-C compact extraction UX demo");
}


for (const phrase of [
  "평가서 해석·추출 진행상태",
  "진행상태는 실제 저장된 후보·초안·검토자료를 기준으로 계산됩니다",
  "완료 표시는 자동 확정값을 의미하지 않습니다",
  "원본 파일 등록",
  "다음 작업",
  // v1.0: OCR이 필요한 평가서는 사용자가 작업대로 이동하는 게 아니라 앱이 자동으로 처리한다.
  // "앱 안에서 처리한다(외부 도구로 내보내지 않는다)"는 원래 취지는 아래 문구로 유지한다.
  "OCR이 필요한 평가서는 앱 안에서 자동 OCR로 처리합니다",
  "기본 흐름은 앱 안에서 PDF 텍스트 추출 또는 OCR을 실행",
  "수동 보조 입력 (고급)",
  "VWorld 보강은 편입토지 상세 후보가 검수된 후",
  "NOT_STARTED",
  "IN_PROGRESS",
  "NEEDS_REVIEW",
  "COMPLETED",
  "BLOCKED",
  "FAILED",
  "HOLD",
  "mobile-file-card",
  "extraction-progress-card",
  "next-action-card",
  "advanced-fallback",
  "원본 추가·교체",
  "평가서 파일 추가",
  "구조화 JSON 불러오기",
  "원본 파일 등록",
  "source-add-card",
  "secondary-upload-action",
  "source-add-input",
  "원본 등록 탭의 첫 화면은 사건 요약보다 작업 진입 카드가 우선",
  "업로드 후에는 다음 작업과 진행상태가 최상단",
  "source-registration-card"
]) {
  assertIncludes(html, phrase, "index.html PR-30A mobile workflow stabilization contract");
}

const renderOverviewStart = html.indexOf("function renderOverview()");
const renderOverviewEnd = html.indexOf("function renderSourceStatus", renderOverviewStart);
assert.ok(renderOverviewStart >= 0 && renderOverviewEnd > renderOverviewStart, "index.html must expose renderOverview block for PR-30A-2 order guard");
const renderOverviewBlock = html.slice(renderOverviewStart, renderOverviewEnd);
assertOrder(renderOverviewBlock, "sourceEntryCard +", "renderCaseHero(c, meta, progress)", "renderOverview first-screen source workflow order");
assertOrder(renderOverviewBlock, "renderExtractionProgressCard()", "renderCaseHero(c, meta, progress)", "renderOverview first-screen progress before case summary order");
assertOrder(renderOverviewBlock, "sourceSupportCard +", "renderCaseHero(c, meta, progress)", "renderOverview uploaded source-add before case summary order");

const renderUploadHubStart = html.indexOf("function renderUploadHub()");
const renderUploadHubEnd = html.indexOf("function renderPublicData", renderUploadHubStart);
assert.ok(renderUploadHubStart >= 0 && renderUploadHubEnd > renderUploadHubStart, "index.html must expose renderUploadHub block for PR-30A-2 order guard");
const renderUploadHubBlock = html.slice(renderUploadHubStart, renderUploadHubEnd);
assertOrder(renderUploadHubBlock, "renderWorkflowNextActionCard()", "renderExtractionProgressCard()", "upload hub uploaded first-screen next action before progress order");
assertOrder(renderUploadHubBlock, "renderExtractionProgressCard()", "renderSourceAddReplaceCard", "upload hub uploaded progress before source-add order");

for (const phrase of [
  "PR-30A",
  "모바일 워크플로우 및 UX 안정화",
  "업로드 전/후 CTA를 분리",
  "실제 저장 데이터 기준",
  "모바일에서는 파일별 테이블을 카드형",
  "OCR_REQUIRED는 내부 OCR 작업대",
  "외부 OCR은 고급 fallback",
  "Primary / Support / Notice card",
  "원본 파일 추가·교체",
  "원본 추가·교체",
  "구조화 JSON 불러오기",
  "시작하기 CTA는 반복하지 않지만 원본 등록 기능은 사라지지 않음",
  "원본 등록 탭의 첫 화면은 사건 요약보다 작업 진입 카드가 우선함",
  "업로드 전에는 **원본 파일 등록**이 최상단에 표시",
  "업로드 후에는 **다음 작업**과 **평가서 해석·추출 진행상태**가 최상단",
  "**원본 추가·교체**는 업로드 후 support card로 유지"
]) {
  assertIncludes(readme, phrase, "README.md PR-30A mobile workflow stabilization docs");
}

for (const phrase of [
  "PR-30A 모바일 워크플로우 QA",
  "평가서 3건 업로드",
  "업로드 후 시작하기 카드가 사라지는지 확인",
  "평가서 해석·추출 진행상태 카드",
  "모바일 파일별 카드 리스트",
  "OCR_REQUIRED 파일이 내부 OCR 작업대",
  "Gemini importer가 고급 fallback",
  "다음 작업 CTA가 한 화면에 1개",
  "평가서 1건 업로드 후",
  "원본 추가·교체",
  "평가서 파일 추가",
  "구조화 JSON 불러오기",
  "PR-30A-2 모바일 첫 화면 순서 QA",
  "모바일 첫 화면에서 **원본 파일 등록** 카드 확인",
  "업로드 후 **다음 작업** 카드가 첫 번째로 보이는지 확인",
  "**원본 추가·교체** 카드가 사건 요약보다 위에 보이는지 확인",
  "**사건 요약**은 작업 진입 카드 아래에 위치"
]) {
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md PR-30A mobile workflow QA");
}

for (const phrase of [
  "CSS override 통합은 별도 PR 필요",
  "stable wrapper chain 통합은 별도 PR 필요",
  "renderAll 전체 재렌더 최적화는 별도 PR 필요",
  "개발자 상세 메뉴와 사용자 주 플로우 분리 필요"
]) {
  assertIncludes(technicalDebt, phrase, "technical_debt.md PR-30A remaining debt");
}


for (const phrase of [
  "등록된 평가서",
  "텍스트 추출 완료",
  "필수정보 후보 추출",
  "수동 보조 입력 (고급)",
  "업로드 후 원본 파일 등록 primary card 반복 노출 금지",
  "TEXT_EXTRACTED 상태에서는 필수정보 후보 추출이 primary action",
  "자동 추출이 실패하면 원문 텍스트를 직접 붙여넣거나 검토된 구조화 JSON을 불러올 수 있습니다",
  "TEXT_EXTRACTED",
  "OCR_REQUIRED",
  "EXTRACTION_FAILED"
]) {
  assertIncludes(html, phrase, "index.html PR-30B-2 post-upload extraction UX contract");
}
for (const phrase of [
  "PR-30B-2는 업로드 후 **원본 파일 등록** 카드 반복 노출과 `TEXT_EXTRACTED` 결과 화면의 혼선을 정리하는 UX 핫픽스",
  "업로드 후에는 **등록된 평가서** 또는 **다음 작업** 카드가 우선 표시",
  "`TEXT_EXTRACTED` 상태에서는 **필수정보 후보 추출**이 primary action",
  "**수동 텍스트 입력**과 **외부 OCR 결과 가져오기 (고급)** fallback은 `OCR_REQUIRED`/`EXTRACTION_FAILED` 또는 고급 경로"
]) {
  assertIncludes(readme, phrase, "README.md PR-30B-2 post-upload extraction UX docs");
}
for (const phrase of [
  "PR-30B-2 업로드 후 추출 결과 UX QA",
  "PDF 업로드 후 **원본 파일 등록** 큰 카드가 반복 노출되지 않는지 확인",
  "**등록된 평가서** 또는 **다음 작업** 카드가 먼저 보이는지 확인",
  "`TEXT_EXTRACTED` 상태에서 **필수정보 후보 추출** 버튼이 primary action",
  "`TEXT_EXTRACTED` 상태에서 **수동 텍스트 입력**이 기본 노출되지 않고",
  "**외부 OCR 결과 가져오기 (고급)** 이 고급 fallback 접힘 영역"
]) {
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md PR-30B-2 extraction UX QA");
}
for (const phrase of [
  "extraction preview 화면의 상태별 UI 분기 E2E 테스트 필요",
  "TEXT_EXTRACTED/OCR_REQUIRED/EXTRACTION_FAILED 상태별 표시 회귀 테스트 필요"
]) {
  assertIncludes(technicalDebt, phrase, "technical_debt.md PR-30B-2 status UI debt");
}
const renderExtractionPreviewStart = html.indexOf("function shouldShowManualTextInputByDefault(status)");
const renderExtractionPreviewEnd = html.indexOf("function ensureBaseDataForUpload", renderExtractionPreviewStart);
assert.ok(renderExtractionPreviewStart >= 0 && renderExtractionPreviewEnd > renderExtractionPreviewStart, "index.html must expose renderExtractionPreviewCards block for PR-30B-2 status guards");
const renderExtractionPreviewBlock = html.slice(renderExtractionPreviewStart, renderExtractionPreviewEnd);
assertIncludes(renderExtractionPreviewBlock, "status === \"TEXT_EXTRACTED\"", "renderExtractionPreviewCards must branch TEXT_EXTRACTED");
assertIncludes(renderExtractionPreviewBlock, "status === \"OCR_REQUIRED\"", "renderExtractionPreviewCards must branch OCR_REQUIRED");
assertIncludes(renderExtractionPreviewBlock, "status === \"EXTRACTION_FAILED\"", "renderExtractionPreviewCards must branch EXTRACTION_FAILED");
assertOrder(renderExtractionPreviewBlock, "${renderExtractionPrimaryActions(u, status, Boolean(fullText))}", "${renderManualTextInput(u.upload_id, status)}", "extraction primary actions must render before manual text details");
assertIncludes(renderExtractionPreviewBlock, "<button class=\"primary\" onclick=\"extractEssentialInfoCandidates", "TEXT_EXTRACTED must expose candidate extraction primary button");
assertIncludes(renderExtractionPreviewBlock, "수동 입력 열기", "TEXT_EXTRACTED manual input must be behind a details opener");
assertIncludes(renderExtractionPreviewBlock, "<details class=\"raw-source-details advanced-fallback\"><summary>수동 보조 입력 (고급)", "manual fallback must be advanced details");
const renderUploadHubBlockFor30B2 = html.slice(renderUploadHubStart, renderUploadHubEnd);
assertIncludes(renderUploadHubBlockFor30B2, "renderRegisteredAppraisalSummaryCard", "upload hub must show registered appraisal summary after upload");
assertIncludes(renderUploadHubBlockFor30B2, "uploads.length ? \"\" : card(\"원본 파일 등록\"", "upload hub must not repeat source registration primary card after upload");

for (const phrase of [
  "텍스트 추출 대기",
  "텍스트 추출 시작",
  "텍스트 추출 중…",
  "텍스트 추출 완료",
  "필수정보 후보 추출",
  "PDF.js로 텍스트 레이어와 OCR 필요 여부를 확인하고 있습니다.",
  "후보 카드",
  "근거 보기",
  "수동 수정",
  "검수 후 반영",
  "다음 작업: 수동검수",
  "후보값은 원문 대조 후 반영 여부를 결정합니다.",
  "검수 필요",
  "높음",
  "보통",
  "낮음",
  "수동 보조 입력 (고급)"
]) {
  assertIncludes(html, phrase, "index.html PR-30B-3 extraction state and mobile candidate copy");
}
for (const className of [
  "candidate-mobile-list",
  "candidate-mobile-card",
  "candidate-card-actions",
  "candidate-evidence-details",
  "confidence-badge",
  "review-status-badge"
]) {
  assertIncludes(html, className, "index.html PR-30B-3 mobile candidate classes");
}
for (const status of ["TEXT_EXTRACTED", "OCR_REQUIRED", "EXTRACTION_FAILED", "CANDIDATES_READY", "EXTRACTING"]) {
  assertIncludes(html, status, "index.html PR-30B-3 extraction states");
}
assertIncludes(html, "candidate-desktop-table", "desktop candidate table wrapper must coexist with mobile candidate card classes");
assertIncludes(html, "renderCandidateMobileList", "mobile candidate card renderer must share candidate data source");
assertOrder(html, "candidate-desktop-table", "candidate-mobile-list", "desktop candidate table and mobile candidate list classes must both exist");
assertIncludes(renderExtractionPreviewBlock, "COPY.EXTRACTED_BTN_PRIMARY", "TEXT_EXTRACTED branch must use candidate extraction primary copy");
assertIncludes(renderExtractionPreviewBlock, "advanced-fallback", "manual fallback must be inside advanced-fallback details");
assertIncludes(renderExtractionPreviewBlock, "<details class=\"raw-source-details advanced-fallback\"><summary>", "advanced fallback must render as details/summary");
for (const phrase of [
  "PR-30B-3는 신규 기능 추가가 아니라 텍스트 추출 상태/CTA 명확화와 모바일 후보 카드 전환 작업",
  "업로드 직후에는 **텍스트 추출 대기** 상태와 **텍스트 추출 시작** CTA",
  "`TEXT_EXTRACTED` 후에는 **필수정보 후보 추출**이 primary action",
  "모바일에서는 후보 테이블 대신 **카드형 리스트**를 우선 표시",
  "외부 OCR/Gemini는 고급 fallback이며 `TEXT_EXTRACTED` 기본 화면에 노출하지 않습니다"
]) {
  assertIncludes(readme, phrase, "README.md PR-30B-3 docs");
}
for (const phrase of [
  "PR-30B-3 텍스트 추출 상태/CTA 및 모바일 후보 카드 QA",
  "PDF 업로드 후 **텍스트 추출 대기** 상태",
  "primary CTA가 **텍스트 추출 시작**",
  "**텍스트 추출 중…**",
  "`TEXT_EXTRACTED` 후 **필수정보 후보 추출** 버튼",
  "후보 테이블 대신 **후보 카드** 리스트",
  "**근거 보기** 버튼이 세로로 찢어지지 않는지",
  "`NEEDS_REVIEW` 대신 **검수 필요**, `HIGH`/`MEDIUM` 대신 **높음**/**보통**",
  "외부 OCR/Gemini가 기본 화면의 상위 옵션이 아니라 **외부 OCR 결과 가져오기 (고급)** fallback"
]) {
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md PR-30B-3 QA");
}
for (const phrase of [
  "후보 검수 모바일 카드 UI의 실제 기기 E2E 테스트 필요",
  "extraction state transition E2E 테스트 필요",
  "데스크톱 테이블과 모바일 카드 이중 렌더링 회귀 테스트 필요"
]) {
  assertIncludes(technicalDebt, phrase, "technical_debt.md PR-30B-3 debt");
}


for (const phrase of [
  "후보 검수·구조화",
  "구조화 초안은 감정평가 결과나 법률 판단의 확정값이 아닙니다",
  "편입토지 상세 초안",
  "VWorld 공란 보강 대기",
  "비교표준지는 평가 기준",
  "거래사례는 그 밖의 요인 검토용 참조자료",
  "기타조건은 개별요인 비교의 하위 항목",
  "draft_land_details",
  "standard_land_draft_candidates",
  "transaction_case_draft_candidates",
  "other_factor_draft_candidates"
]) {
  assertIncludes(html, phrase, "index.html PR-29D candidate review and draft structuring contract");
  assertIncludes(readme, phrase, "README.md PR-29D candidate review and draft structuring docs");
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md PR-29D candidate review and draft structuring demo");
}
assertIncludes(html, "function renderCandidateReviewStructuringWorkspace", "index.html PR-29D candidate review renderer");
assertIncludes(html, "subject_to_standard_factor_draft_candidates", "index.html PR-29D subject factor draft store");
assertIncludes(html, "case_to_standard_factor_draft_candidates", "index.html PR-29D case factor draft store");

for (const phrase of [
  "편입토지 상세 초안의 공란 특성정보",
  "VWorld 검토 보강자료",
  "편입토지 상세 초안 기반",
  "VWorld 보강 대기 초안 수",
  "보강 결과는 편입토지 상세 초안 옆에 병기",
  "PNU가 없는 초안은 수동입력",
  "VWorld 보강은 후보 검수·구조화 이후 단계",
  "draft_land_details",
  "bulkEnrichBlankPublicLandCharacteristics"
]) {
  assertIncludes(html, phrase, "index.html PR-29E draft land detail VWorld enrichment contract");
  assertIncludes(readme, phrase, "README.md PR-29E draft land detail VWorld enrichment docs");
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md PR-29E draft land detail VWorld enrichment demo");
}
assertIncludes(html, "vworld_enrichment_preview", "index.html PR-29E draft enrichment preview storage");
assertIncludes(html, "public_enrichment_review_status", "index.html PR-29E draft public enrichment review status");

for (const phrase of [
  "공란 특성정보 일괄 보강",
  "평가서 해석 결과에서 편입토지 상세 생성",
  "VWorld API Key 1회 입력",
  "공란 필드 원클릭 일괄 보강",
  "JSON import는 고급 fallback",
  "평가서값은 자동으로 덮어쓰지 않습니다"
]) {
  assertIncludes(html, phrase, "index.html VWorld blank field completion primary flow");
  assertIncludes(readme, phrase, "README.md VWorld blank field completion primary flow");
  assertIncludes(coreWorkflow, phrase, "core_workflow.md VWorld blank field completion primary flow");
}

assertIncludes(readme, "vworld_batch_lookup_design.md", "README.md VWorld batch lookup design link");
for (const phrase of [
  "vworld_batch_lookup_design.md",
  "200필지",
  "VWorld 일괄조회",
  "로컬 Node.js 프록시",
  "결과 JSON 반영",
  "VWorld API Key는 저장하지 않음",
  "원문 VWorld 응답 전체를 장기 저장하지 않음",
  "평가서값은 자동 덮어쓰지 않음",
  "BATCH_PENDING",
  "VWORLD_LOOKUP_SUCCESS",
  "VWORLD_NO_RESULT",
  "PNU_MISSING"
]) {
  assertIncludes(vworldBatchLookupDesign, phrase, "vworld_batch_lookup_design.md batch lookup contract");
}

for (const phrase of [
  "scripts/vworld_batch_lookup.js",
  "https://api.vworld.kr/ned/data/getLandCharacteristics",
  "VWORLD_API_KEY",
  "VWORLD_DOMAIN",
  "VWORLD_DEFAULT_YEAR",
  "--input",
  "--output",
  "--year",
  "--delay",
  "--limit",
  "PNU_INVALID",
  "PNU_MISSING",
  "VWORLD_NO_RESULT",
  "VWORLD_INCORRECT_KEY",
  "VWORLD_LOOKUP_FAILED",
  "landCharacteristicss",
  "lastUpdtDt",
  "API Key, 전체 요청 URL, 원문 VWorld 응답 전체는 결과 JSON에 저장하지 않습니다"
]) {
  assertIncludes(vworldBatchScript, phrase, "scripts/vworld_batch_lookup.js local batch contract");
}

for (const phrase of [
  "VWORLD_API_KEY=your_vworld_api_key_here",
  "VWORLD_DOMAIN=your_registered_domain_here",
  "VWORLD_DEFAULT_YEAR=2025"
]) {
  assertIncludes(envExample, phrase, ".env.example VWorld environment contract");
}

for (const phrase of [
  "case_id,land_id,pnu,parcel_address,stdrYear",
  "CASE_SAMPLE,LAND_001,9999999999100780001",
  "CASE_SAMPLE,LAND_002,,익명화된 샘플 주소,",
  "CASE_SAMPLE,LAND_003,12345"
]) {
  assertIncludes(pnuListSample, phrase, "input/pnu_list_sample.csv sample contract");
}

for (const phrase of [
  "VWorld 토지특성 로컬 batch 조회",
  "100~200필지",
  "scripts/vworld_batch_lookup.js",
  ".env 생성",
  "API Key는 저장소에 커밋하지 않습니다",
  "output/vworld_results.json",
  "공적자료 보강자료",
  "평가서값을 자동으로 덮어쓰지 않습니다",
  "VWorld 공식 문서 확인 필요"
]) {
  assertIncludes(readme, phrase, "README.md local VWorld batch instructions");
}

const requiredSampleKeys = [
  "schema_version",
  "case",
  "subjects",
  "lands",
  "appraisals",
  "appraisal_totals",
  "public_land_data_enrichment",
  "public_land_characteristics",
  "land_characteristics",
  "land_characteristic_crosscheck",
  "standard_lands",
  "comp_cases",
  "land_appraisal_results",
  "comparison_summary_by_land",
  "subject_to_standard_factor_comparisons",
  "standard_to_comp_case_factor_comparisons",
  "other_factor_reviews",
  "ocr_review_items",
  "v04_ocr_factor_candidates",
  "issue_candidates",
  "draft_issue_candidates",
  "draft_sentences",
  "risk_warnings",
  "gemini_candidates",
  "gemini_imports"
];
for (const key of requiredSampleKeys) {
  assert.ok(Object.hasOwn(sample, key), `sample_case_gongju.json must contain ${key}`);
}

const nonEmptyDemoArrays = [
  "lands",
  "appraisals",
  "appraisal_totals",
  "public_land_characteristics",
  "land_characteristics",
  "land_characteristic_crosscheck",
  "standard_lands",
  "comp_cases",
  "land_appraisal_results",
  "comparison_summary_by_land",
  "subject_to_standard_factor_comparisons",
  "standard_to_comp_case_factor_comparisons",
  "other_factor_reviews",
  "ocr_review_items",
  "issue_candidates",
  "draft_issue_candidates",
  "draft_sentences",
  "risk_warnings"
];
for (const key of nonEmptyDemoArrays) {
  assert.ok(Array.isArray(sample[key]), `sample ${key} must be an array`);
  assert.ok(sample[key].length > 0, `sample ${key} must include demo rows so stable16 screens are not empty`);
}

assert.ok(!Object.hasOwn(sample, "appraisal_firms"), "sample must not use the obsolete appraisal_firms structure");
assert.ok(!JSON.stringify(sample).includes("recommended_amount"), "sample must not use recommended_amount");
assert.ok(!JSON.stringify(sample).includes("recommended_unit_price"), "sample must not use recommended_unit_price");
assert.ok(!/\d{6}[- ]?[1-4]\d{6}/.test(JSON.stringify(sample)), "sample must not contain resident registration number-like values");
assert.ok(JSON.stringify(sample).includes("익명화·가공"), "sample must clearly label the demo data as anonymized/synthetic");
assert.ok(sample.appraisals.every((appraisal) => Object.hasOwn(appraisal, "appraisal_company")), "appraisals must use stable16 appraisal_company");
assert.ok(sample.land_appraisal_results.every((result) => Object.hasOwn(result, "review_average_amount")), "land results must use review_average_amount");
assert.ok(sample.land_appraisal_results.every((result) => Object.hasOwn(result, "review_average_unit_price")), "land results must use review_average_unit_price");
assert.ok(sample.land_appraisal_results.every((result) => Object.hasOwn(result, "appraisal_company")), "land results must include appraisal_company for stable16 comparison tables");
assert.ok(sample.comparison_summary_by_land.every((row) => Object.hasOwn(row, "parcel_address") && Object.hasOwn(row, "primary_review_axis")), "comparison summary rows must include stable16 display fields");

const requiredStable16Strings = [
  "보상전략 OS",
  "v0.4-alpha2",
  "public_land_characteristics",
  "public_land_data_enrichment",
  "land_characteristics",
  "land_characteristic_crosscheck",
  "function renderPublicData",
  "function renderLandCompare",
  "function renderSubjectFactors",
  "function renderCaseFactors",
  "function renderOcrReview",
  "documentWorkspace",
  "OCR 검수 작업대",
  "JSON/API/OCR",

  "표준지↔사례 상세",
  "공적자료 상세",
  "comparison_summary_by_land",
  "land_appraisal_results",
  "subject_to_standard_factor_comparisons",
  "standard_to_comp_case_factor_comparisons",
  "other_factor_reviews",
  "ocr_review_items",
  "v04_ocr_factor_candidates",
  "쟁점 상세",
  "문안 상세",
  "리스크 상세"
];

for (const needle of requiredStable16Strings) {
  assertIncludes(html, needle, "index.html");
}

// v1.0 검토 순서 내비게이션. 라벨 문구는 바뀔 수 있으므로 화면 도달 가능성만 고정한다.
// (stable16 기준선 파일에는 없는 v1.0 전용 계약이라 위 목록과 분리한다.)
for (const reviewSection of [
  "data-section=\"lands\"",
  "data-section=\"landCompare\"",
  "data-section=\"subjectFactors\"",
  "data-section=\"otherFactors\"",
  "data-section=\"workflowLogic\"",
  "data-section=\"reviewQueue\"",
  "function renderReviewQueue",
  "function renderSelectedLandMapContext"
]) {
  assertIncludes(html, reviewSection, "index.html v1.0 review navigation");
}


for (const vworldBatchImportPreviewContract of [
  "VWorld batch 결과 JSON import",
  "batch import preview",
  "output/vworld_results.json",
  "lookup_batch_id",
  "VWORLD_LOOKUP_SUCCESS",
  "VWORLD_NO_RESULT",
  "VWORLD_LOOKUP_FAILED",
  "PNU_MISSING",
  "PNU_INVALID",
  "평가서값이나 공적자료 데이터에 아직 반영하지 않습니다"
]) {
  assertIncludes(html, vworldBatchImportPreviewContract, "index.html VWorld batch import preview");
  assertIncludes(readme, vworldBatchImportPreviewContract, "README.md VWorld batch import preview docs");
}
assertIncludes(html, "function validateVworldBatchImportJson", "index.html VWorld batch import preview validator");
assertIncludes(html, "function renderVworldBatchImportPreviewCard", "index.html VWorld batch import preview UI");

for (const vworldBatchImportSummaryContract of [
  "총 results 수",
  "반영 성공 수",
  "결과 없음 수",
  "실패 수",
  "PNU 누락/오류 수",
  "crosscheck 생성/갱신 수",
  "검토 필요 수",
  "수동입력 필요 수",
  "source: VWorld",
  "import_created_at",
  "원문 VWorld 응답과 API Key는 저장하지 않습니다",
  "평가서값은 자동으로 덮어쓰지 않습니다",
  "수동 검수 필요"
]) {
  assertIncludes(html, vworldBatchImportSummaryContract, "index.html VWorld batch import summary closeout");
  assertIncludes(readme, vworldBatchImportSummaryContract, "README.md VWorld batch import summary closeout docs");
}
for (const vworldBatchImportQaContract of [
  "VWorld batch 결과 JSON import QA 체크리스트",
  "정상 JSON preview",
  "success row 반영",
  "no_result row 처리",
  "failed row 처리",
  "PNU_MISSING/PNU_INVALID 처리",
  "crosscheck 생성 확인",
  "평가서값 보호 확인",
  "API Key/원문 응답 비저장 확인"
]) {
  assertIncludes(apiRuntimeQa, vworldBatchImportQaContract, "api_runtime_qa.md VWorld batch import QA checklist");
}
for (const vworldBatchImportDesignContract of [
  "PR-26A~26D 앱 import 구현 요약",
  "PR-26A preview",
  "PR-26B 반영",
  "PR-26C crosscheck",
  "PR-26D summary/QA",
  "남은 과제"
]) {
  assertIncludes(vworldBatchLookupDesign, vworldBatchImportDesignContract, "vworld_batch_lookup_design.md VWorld batch import closeout design");
}
for (const vworldBatchImportApplyContract of [
  "검토 보강자료로 반영",
  "VWORLD_BATCH_IMPORTED",
  "public_input_origin",
  "VWORLD_BATCH_IMPORT",
  "vworld_batch_import_summary",
  "vworld_batch_review_queue",
  "평가서값 자동 덮어쓰기 없음"
]) {
  assertIncludes(html, vworldBatchImportApplyContract, "index.html VWorld batch import apply contract");
  assertIncludes(readme, vworldBatchImportApplyContract, "README.md VWorld batch import apply docs");
}

for (const vworldBatchCrosscheckContract of [
  "updateVWorldBatchImportCrosscheck",
  "land_characteristic_crosscheck",
  "MATCHED",
  "DIFFERENT",
  "PUBLIC_DATA_MISSING",
  "APPRAISAL_VALUE_MISSING",
  "차이값은 검토 단서",
  "원문·공부·현장자료 수동 검수 필요"
]) {
  assertIncludes(html, vworldBatchCrosscheckContract, "index.html VWorld batch crosscheck contract");
  assertIncludes(readme, vworldBatchCrosscheckContract, "README.md VWorld batch crosscheck docs");
  assertIncludes(vworldBatchLookupDesign, vworldBatchCrosscheckContract, "vworld_batch_lookup_design.md VWorld batch crosscheck docs");
}

for (const publicBlankContract of [
  "PUBLIC_LAND_CHARACTERISTIC_REQUIRED_FIELDS",
  "function isPublicLandCharacteristicBlank",
  "function makeDefaultPublicLandCharacteristicRow",
  "function makeDefaultPublicLandCrosscheckRows",
  "function ensurePublicLandBlankWorkflow",
  "function renderPublicBlankGuideCard",
  "공란 처리 안내",
  "조회 필요",
  "수동입력 필요",
  "브이월드 조회 대기",
  "PNU 후보 필요",
  "공적자료 보강 필요",
  "PUBLIC_DATA_MISSING",
  "NEEDS_PUBLIC_DATA",
  "PNU_REQUIRED",
  "API_LOOKUP_PENDING",
  "MANUAL_INPUT_REQUIRED",
  "MANUAL_EDITED",
  "공적자료 수동 보강",
  "조회값/입력값은 검토 보조자료이며 실제 현황과 다를 수 있음",
  "수동 보강값 반영",
  "검수 처리",
  "manual_public_input",
  "USER_MANUAL_PUBLIC_DATA",
  "function renderManualPublicLandEnrichmentCard",
  "function applyManualPublicLandData",
  "function confirmManualPublicLandData",
  "function parseManualPublicLandPaste",
  "function updateManualPublicLandCrosscheck",
  "브이월드 토지특성 조회",
  "VWorld API Key",
  "PUBLIC_LAND_CHARACTERISTIC_API_ENDPOINT",
  "function parsePublicLandAddressCandidate",
  "function validatePublicLandApiLookupInput",
  "function fetchPublicLandCharacteristicApi",
  "function normalizePublicLandApiResponse",
  "function lookupPublicLandDataFromApi",
  "function findPublicLandPnuCandidatesFromAddress",
  "function fetchPublicLandAddressSearchApi",
  "function setPublicLandAddressSearchStatus",
  "function normalizePublicLandAddressSearchResponse",
  "function applyPublicLandApiLookupResult",
  "function markPublicLandApiLookupFallback",
  "PUBLIC_LAND_API_STATUS_CODES",
  "PUBLIC_DATA_API_LOOKUP",
  "출처: ",
  "조회일자: ",
  "브이월드 조회값은 검토 보강자료이며 평가서값을 자동 덮어쓰지 않습니다",
  "원문 요청 URL 보기",
  "새 탭에서 VWorld 원문 열기",
  "붙여넣은 VWorld 응답 반영",
  "VWorld 응답 붙여넣기",
  "key 포함 URL 공유 금지",
  "paste fallback",
  "function buildPublicLandCharacteristicApiUrl",
  "function parsePublicLandRawResponseText",
  "function collectPublicLandApiItems",
  "function makePublicLandRawParseDiagnostic",
  "function publicLandRawParseDiagnosticHtml",
  "response.result.items",
  "response.result.item",
  "response.result.featureCollection.features",
  "landCharacteristicss.field",
  "landCharacteristicss.fields",
  "landCharacteristics.field",
  "landCharacteristics.fields",
  "result.items",
  "result.item",
  "features",
  "단일 객체 응답",
  "응답 구조 미리보기 / 파싱 진단",
  "붙여넣은 응답 또는 URL에 API Key가 포함되어 있을 수 있습니다. 외부 공유 전 제거하세요.",
  "NO_ITEM_FOUND",
  "FIELD_MAPPING_FAILED",
  "UNSUPPORTED_RESPONSE_SHAPE",
  "function openPublicLandRawRequestUrl",
  "function copyPublicLandRawRequestUrl",
  "function applyPastedPublicLandRawResponse"
]) {
  assertIncludes(html, publicBlankContract, "index.html public land blank workflow");
}

for (const field of [
  "zoning_appraisal",
  "road_frontage_public",
  "terrain_height_public",
  "terrain_shape_public",
  "official_land_price_public",
  "pnu",
  "land_category_public",
  "land_use_status_public",
  "land_area_public",
  "public_standard_year",
  "landCharacteristicss.field",
  "pblntfPclnd",
  "lastUpdtDt",
  "official_land_price_public",
  "public_last_updated_at",
  "VWORLD_NO_RESULT",
  "NO_RESULT_FOR_YEAR",
  "기준연도별로 값이 다를 수 있습니다",
  "동일 PNU/기준연도 후보",
  "lastUpdtDt 최신값",
  "public_last_updated_at",
  "zoning_secondary_public",
  "legal_dong_public",
  "parcel_number_public",
  "public_lookup_date",
  "public_data_source"
]) {
  assertIncludes(html, field, "index.html public blank required field");
}

for (const apiLookupStatus of [
  "API_LOOKUP_PENDING",
  "API_LOOKUP_SUCCESS",
  "API_LOOKUP_FAILED",
  "PNU_CANDIDATE_REQUIRED",
  "MULTIPLE_CANDIDATES",
  "NEEDS_MANUAL_INPUT",
  "NEEDS_REVIEW",
  "CONFIRMED"
]) {
  assertIncludes(html, apiLookupStatus, "index.html public land API lookup statuses");
}
assertIncludes(readme, "브이월드 토지특성 조회 사용법", "README.md VWorld land API lookup docs");
assertIncludes(readme, "https://api.vworld.kr/ned/data/getLandCharacteristics", "README.md VWorld land API endpoint docs");
assertIncludes(readme, "https://api.vworld.kr/ned/data/ladfrlList", "README.md VWorld ladfrlList endpoint docs");
assertIncludes(readme, "https://map.vworld.kr/search.do", "README.md VWorld address search endpoint docs");
assertIncludes(readme, "평가서 지목·이용상황·용도지역 값은 유지", "README.md public land API no overwrite docs");
assertIncludes(html, "VWorld API Key", "index.html VWorld API key label");
assertIncludes(html, "브이월드 토지특성 조회", "index.html VWorld land lookup button/copy");
assertIncludes(readme, "VWorld API Key", "README.md VWorld API key docs");
assertIncludes(demoWalkthrough, "브이월드 토지특성 조회 보조 UI", "demo_walkthrough.md VWorld land API lookup docs");
assertIncludes(demoWalkthrough, "수동입력·붙여넣기 fallback", "demo_walkthrough.md public land API fallback docs");
assertIncludes(demoWalkthrough, "브이월드 조회 성공/실패 시연 절차", "demo_walkthrough.md API runtime demo docs");
assertIncludes(demoWalkthrough, "XML 응답 파싱 실패", "demo_walkthrough.md API parsing failure docs");
assertIncludes(demoWalkthrough, "JSON 응답 파싱 실패", "demo_walkthrough.md API parsing failure docs");
assertIncludes(demoWalkthrough, "응답값 없음", "demo_walkthrough.md API no response failure docs");
assertIncludes(demoWalkthrough, "수동입력으로 계속 진행", "demo_walkthrough.md visible manual fallback CTA docs");
assertIncludes(demoWalkthrough, "domain", "demo_walkthrough.md VWorld domain docs");
assertIncludes(demoWalkthrough, "stdrYear", "demo_walkthrough.md VWorld stdrYear docs");
assertIncludes(demoWalkthrough, "지번주소 기반 PNU 후보 찾기", "demo_walkthrough.md VWorld address search fallback docs");
assertIncludes(readme, "실제 API 수동 테스트 절차", "README.md browser API manual QA docs");
assertIncludes(readme, "api_runtime_qa.md", "README.md API runtime QA link");
assertIncludes(readme, "브라우저 환경에 따라 조회가 차단될 수 있으며, 이 경우 수동입력을 사용하세요", "README.md browser block guidance");
assertIncludes(readme, "브라우저에서 조회가 차단될 수 있으며, 이 경우 수동 보강을 사용합니다", "README.md manual fallback guidance");
assertIncludes(readme, "수동입력으로 계속 진행", "README.md visible manual fallback CTA docs");
assertIncludes(readme, "원문 요청 URL 보기", "README.md VWorld raw URL fallback docs");
assertIncludes(readme, "새 탭에서 VWorld 원문 열기", "README.md VWorld raw URL fallback docs");
assertIncludes(readme, "붙여넣은 VWorld 응답 반영", "README.md VWorld paste fallback docs");
assertIncludes(readme, "key 포함 URL 공유 금지", "README.md VWorld API key sharing warning");
assertIncludes(readme, "paste fallback", "README.md VWorld raw response paste fallback docs");
assertIncludes(apiRuntimeQa, "원문 요청 URL 보기", "api_runtime_qa.md VWorld raw URL QA docs");
assertIncludes(apiRuntimeQa, "붙여넣은 VWorld 응답 반영", "api_runtime_qa.md VWorld paste fallback QA docs");
assertIncludes(apiRuntimeQa, "응답 구조 미리보기 / 파싱 진단", "api_runtime_qa.md raw parser diagnostic QA docs");
assertIncludes(apiRuntimeQa, "FIELD_MAPPING_FAILED", "api_runtime_qa.md raw parser failure code docs");
assertIncludes(apiRuntimeQa, "key 포함 URL 공유 금지", "api_runtime_qa.md VWorld API key sharing warning");
assertIncludes(demoWalkthrough, "새 탭에서 VWorld 원문 열기", "demo_walkthrough.md VWorld raw URL demo docs");
assertIncludes(demoWalkthrough, "VWorld 응답 붙여넣기", "demo_walkthrough.md VWorld paste fallback demo docs");

for (const phrase of [
  "VWorld 토지특성 성공 조회 흐름",
  "landCharacteristicss.field",
  "PNU `9999999999100780001`",
  "2024년",
  "계획관리지역",
  "부정형",
  "516112",
  "2025년",
  "용도미지정",
  "사다리형",
  "529203",
  "기준연도별 값이 다를 수 있으므로 평가 기준시점과 조회 기준연도를 구분해 검토해야 합니다",
  "브이월드 조회값은 검토 보강자료입니다",
  "평가서값을 자동으로 덮어쓰지 않습니다",
  "기준연도별 차이는 검토 단서이며 평가상 문제 여부를 단정하지 않습니다",
  "pblntfPclnd",
  "lastUpdtDt",
  "totalCount=0",
  "lastUpdtDt 최신값",
  "원문 응답 전체는 저장하지 않습니다"
]) {
  assertIncludes(vworldSuccessFlow, phrase, "vworld_success_flow.md yearly success flow docs");
}

for (const phrase of [
  "vworld_success_flow.md",
  "VWorld 토지특성 성공 조회 흐름",
  "9999999999100780001",
  "2024년 계획관리지역·부정형·공시지가 516112",
  "2025년 용도미지정·사다리형·공시지가 529203",
  "평가 기준시점과 조회 기준연도를 구분해 검토",
  "VWorld API Key와 원문 응답 전체는 저장하지 않습니다"
]) {
  assertIncludes(readme, phrase, "README.md VWorld success flow link/docs");
}

for (const phrase of [
  "VWorld 성공 시연 루트",
  "landCharacteristicss.field",
  "9999999999100780001",
  "2024년은 계획관리지역·부정형·공시지가 516112",
  "2025년은 용도미지정·사다리형·공시지가 529203",
  "평가 기준시점과 조회 기준연도를 구분해 검토",
  "VWorld API Key와 원문 응답 전체는 저장하지 않는다고 확인합니다"
]) {
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md VWorld success demo route");
}

for (const phrase of [
  "VWorld 성공 확인 체크리스트",
  "landCharacteristicss.field",
  "9999999999100780001",
  "계획관리지역",
  "부정형",
  "516112",
  "용도미지정",
  "사다리형",
  "529203",
  "평가서값 보호",
  "원문/키 비저장",
  "성공 여부·기준연도·요약 진단만 기록"
]) {
  assertIncludes(apiRuntimeQa, phrase, "api_runtime_qa.md VWorld success QA checklist");
}

for (const actualVworldContract of [
  "landCharacteristicss.field",
  "pblntfPclnd",
  "lastUpdtDt",
  "official_land_price_public",
  "public_last_updated_at",
  "VWORLD_NO_RESULT",
  "NO_RESULT_FOR_YEAR",
  "기준연도별로 값이 다를 수 있습니다",
  "동일 PNU/기준연도 후보",
  "lastUpdtDt 최신값",
  "동일 PNU/기준연도 후보 2건 중 lastUpdtDt 최신값 2026-03-26 항목을 우선 반영",
  "응답 root: ",
  "field 후보 개수",
  "선택된 후보의 lastUpdtDt"
]) {
  assertIncludes(html, actualVworldContract, "index.html actual VWorld landCharacteristicss parser contract");
}
for (const actualVworldDocs of [readme, apiRuntimeQa, demoWalkthrough]) {
  assertIncludes(actualVworldDocs, "landCharacteristicss", "docs actual VWorld response root");
  assertIncludes(actualVworldDocs, "pblntfPclnd", "docs actual VWorld official land price field");
  assertIncludes(actualVworldDocs, "lastUpdtDt", "docs actual VWorld last update field");
  assertIncludes(actualVworldDocs, "2026-03-26", "docs actual VWorld normalized latest update example");
}

for (const phrase of [
  "브이월드 API 런타임 QA 체크리스트",
  "VWorld API Key 미입력 시 안내",
  "PNU 미입력 시 안내",
  "브이월드 조회 성공 시 표시값",
  "브이월드 브이월드 조회 실패 시 상태값",
  "CORS 또는 HTTP 오류 시 안내",
  "XML 응답 파싱 실패 시 안내",
  "JSON 응답 파싱 실패 시 안내",
  "복수 후보 발생 시 안내",
  "응답값 없음 안내",
  "수동입력 fallback 연결 여부",
  "실제 브라우저 수동 테스트 결과 기록란",
  "MISSING_API_KEY",
  "PNU_CANDIDATE_REQUIRED",
  "API_LOOKUP_SUCCESS",
  "API_LOOKUP_FAILED",
  "XML_PARSE_FAILED",
  "JSON_PARSE_FAILED",
  "MULTIPLE_CANDIDATES",
  "NO_API_RESPONSE",
  "NO_ITEM_FOUND",
  "FIELD_MAPPING_FAILED",
  "UNSUPPORTED_RESPONSE_SHAPE",
  "수동입력으로 계속 진행",
  "수동 보강값 반영",
  "검수 완료 표시",
  "실제 브라우저 테스트는 가능합니다",
  "본 기능은 브이월드 API Key 입력을 전제로 하며, 키는 세션 입력값으로만 사용하고 코드/JSON에 저장하지 않습니다.",
  "브라우저 환경, CORS, 키 권한, 요청 제한에 따라 조회가 실패할 수 있으며, 실패 시 수동입력 fallback을 사용합니다.",
  "domain",
  "stdrYear",
  "PNU_LENGTH_INVALID",
  "지번주소 기반 PNU 후보 찾기",
  "apiKey"
]) {
  assertIncludes(apiRuntimeQa, phrase, "api_runtime_qa.md browser runtime QA contract");
}

for (const phrase of [
  "브라우저 환경에 따라 조회가 차단될 수 있으며, 이 경우 수동입력을 사용하세요",
  "원문 요청 URL 보기",
  "새 탭에서 VWorld 원문 열기",
  "붙여넣은 VWorld 응답 반영",
  "VWorld 응답 붙여넣기",
  "key 포함 URL 공유 금지",
  "paste fallback",
  "실패 유형: VWorld API Key 미입력 · PNU 후보 미입력 · CORS/브라우저 차단 · HTTP 오류 · XML 파싱 실패 · JSON 파싱 실패 · 응답값 없음 · 복수 후보",
  "function publicLandApiFailureMessage",
  "function publicLandApiFallbackReason",
  "function focusManualPublicLandFallback",
  "PUBLIC_LAND_ADDRESS_SEARCH_API_ENDPOINT",
  "PUBLIC_LAND_FOREST_LIST_API_ENDPOINT",
  "params.set(\"key\", options.vworldApiKey)",
  "params.set(\"apiKey\", options.vworldApiKey)",
  "params.set(\"domain\", options.domain)",
  "params.set(\"stdrYear\", options.stdrYear || getDefaultPublicLandApiStdrYear())",
  "/^\\d{19}$/",
  "PNU_LENGTH_INVALID",
  "지번주소 기반 PNU 후보 찾기",
  "window.location.hostname",
  "수동입력으로 계속 진행",
  "VWorld API Key 미입력",
  "PNU 후보 미입력",
  "CORS/브라우저 차단",
  "HTTP 오류",
  "JSON 응답 파싱 실패",
  "XML 응답 파싱 실패",
  "응답값 없음",
  "복수 후보",
  "BROWSER_CALL_BLOCKED_OR_HTTP_ERROR",
  "HTTP_ERROR",
  "XML_PARSE_FAILED",
  "JSON_PARSE_FAILED",
  "NO_API_RESPONSE",
  "MULTIPLE_CANDIDATES",
  "NO_ITEM_FOUND",
  "FIELD_MAPPING_FAILED",
  "UNSUPPORTED_RESPONSE_SHAPE",
  "응답 구조 미리보기 / 파싱 진단"
]) {
  assertIncludes(html, phrase, "index.html API runtime fallback guidance");
}

assert.ok(sample.land_characteristics.some((row) => row.review_status_code === "PUBLIC_DATA_MISSING"), "sample_case_gongju.json must include one public land characteristic blank scenario");
assert.ok(sample.land_characteristic_crosscheck.some((row) => row.match_status === "PNU_REQUIRED"), "sample_case_gongju.json must include PNU_REQUIRED crosscheck blank scenario");
assertIncludes(readme, "토지특성정보 공란 시 처리 흐름", "README.md public blank workflow docs");
assertIncludes(readme, "공적자료 보강 필요", "README.md public blank workflow docs");
assertIncludes(readme, "공적자료 수동 보강", "README.md manual public enrichment docs");
assertIncludes(readme, "manual_public_input", "README.md manual public enrichment docs");
assertIncludes(readme, "public_data_api_design.md", "README.md public data API design link");

for (const phrase of [
  "공적 토지특성정보 외부 API 보강 설계",
  "브이월드 조회값은 **검토 보강자료**",
  "실제 API 호출 코드·VWorld API Key·외부 저장소 연동은 구현하지 않습니다",
  "브이월드 API로 보강할 필드",
  "지번주소",
  "법정동",
  "산 여부",
  "본번",
  "부번",
  "PNU 후보",
  "브이월드 응답값 데이터 키 매핑표",
  "조회 실패",
  "복수 후보",
  "PNU 불일치",
  "브이월드 응답 없음",
  "CORS 또는 브라우저 호출 제한",
  "VWorld API Key 누락",
  "개인정보 및 보안 리스크",
  "단일 HTML에서 직접 API 호출할 때의 한계",
  "브라우저 직접 호출",
  "로컬 프록시",
  "GitHub Pages + 서버리스 함수",
  "수동 붙여넣기 유지",
  "추천 구현 순서",
  "감정평가 판단",
  "VWorld API Key는 코드에 하드코딩하지 않고"
]) {
  assertIncludes(publicDataApiDesign, phrase, "public_data_api_design.md API design contract");
}

for (const mappingKey of [
  "pnu",
  "parcel_address",
  "land_category_public",
  "land_use_status_public",
  "zoning_public",
  "road_frontage_public",
  "terrain_height_public",
  "terrain_shape_public",
  "official_land_price_public",
  "public_lookup_date",
  "public_data_source",
  "lookup_input",
  "lookup_status",
  "lookup_error_code",
  "manual_public_input"
]) {
  assertIncludes(publicDataApiDesign, mappingKey, "public_data_api_design.md response key mapping");
}
assertIncludes(readme, "MANUAL_EDITED", "README.md manual public enrichment docs");
assertIncludes(demoWalkthrough, "공적자료 수동 보강", "demo_walkthrough.md manual public enrichment docs");
assertIncludes(demoWalkthrough, "검수 완료 표시", "demo_walkthrough.md manual public enrichment docs");

for (const dataKey of [
  "public_land_characteristics",
  "public_land_data_enrichment",
  "land_characteristics",
  "land_characteristic_crosscheck",
  "comparison_summary_by_land",
  "land_appraisal_results",
  "subject_to_standard_factor_comparisons",
  "standard_to_comp_case_factor_comparisons",
  "other_factor_reviews",
  "ocr_review_items",
  "issue_candidates",
  "draft_sentences",
  "risk_warnings"
]) {
  assertIncludes(html, dataKey, "index.html stable16 data key");
}

for (const renderFn of [
  "function renderOverview",
  "function renderWorkflowBase",
  "function renderWorkflowLogic",
  "function renderWorkflowValue",
  "function renderWorkflowOutput",
  "function renderPublicData",
  "function renderLandCompare",
  "function renderSubjectFactors",
  "function renderCaseFactors",
  "function renderOtherFactors",
  "function renderOcrReview",
  "function renderDocumentWorkspace",
  "function renderIssues",
  "function renderSentences",
  "function renderRisks"
]) {
  assertIncludes(html, renderFn, "index.html stable16 render function");
}

for (const workflow of [
  "1. 원본 등록",
  "2. 공적자료 보강",
  "3. 평가논리 검토",
  "4. 쟁점 정리",
  "5. 의견서 보조문안 검토",
  "감정평가서 검토 보조 워크벤치",
  "본 도구는 감정평가서 검토 보조 도구",
  "원본 파일 등록",
  "차이값은 검토 단서",
  "본 문안은 초안이며 제출 전 전문가 검토가 필요합니다",
  "status-chip",
  "tag-chip"
]) {
  assertIncludes(html, workflow, "index.html five-step IA");
}


for (const phrase of [
  "평가서 업로드",
  "주요 수치·표 추출",
  "편입토지 상세 작성",
  "공란 특성정보 VWorld 보강",
  "지도 검토",
  "쟁점 후보",
  "의견서 초안",
  "제출 검토",
  "검토 보조",
  "수동 검수",
  "전문가 검토 필요",
  "공란 특성정보 일괄 보강",
  "VWorld batch 결과 JSON import",
  "JSON import는 고급 fallback",
  "Core Workflow Timeline"
]) {
  assertIncludes(html, phrase, "index.html PR-28 review pack wording");
}

for (const className of [
  "app-shell",
  "app-header",
  "axis-nav",
  "status-badge",
  "review-card",
  "metric-card",
  "workflow-step",
  "risk-badge",
  "comparison-table",
  "issue-card",
  "draft-sentence-card",
  "empty-state",
  "upload-dropzone",
  "map-placeholder",
  "inspector-panel",
  "advanced-fallback"
]) {
  assertIncludes(html, className, "index.html PR-28 reusable component class");
}

assertIncludes(html, "stable16 핵심 데이터 키", "index.html PR-28 stable16 data key guard copy");
assertIncludes(html, "stable16 핵심 렌더 함수", "index.html PR-28 stable16 render function guard copy");

for (const pr28fCssNeedle of [
  "backdrop-filter",
  "-webkit-backdrop-filter",
  "rgba(255,255,255",
  "radial-gradient",
  "saturate",
  "inset 0 1px 0"
]) {
  assertIncludes(html, pr28fCssNeedle, "index.html PR-28F glass crystal CSS keyword");
}

for (const pr28fContractNeedle of [
  "advanced-fallback",
  "공란 특성정보 일괄 보강",
  "stable16 핵심 데이터 키",
  "stable16 핵심 렌더 함수"
]) {
  assertIncludes(html, pr28fContractNeedle, "index.html PR-28F stable16 and VWorld flow guard");
}

for (const pr28ePhrase of [
  "원본 파일 등록",
  "원본 등록·추출 검수",
  "v0.4-alpha2",
  "본 도구는 감정평가서 검토 보조 도구",
  "등록 후 추출값을 수동검수",
  "공란 특성정보 일괄 보강",
  "JSON import는 고급 fallback",
  "검토 보강자료",
  "stable16 핵심 데이터 키",
  "stable16 핵심 렌더 함수"
]) {
  assertIncludes(html, pr28ePhrase, "index.html PR-28E text hierarchy and stable16 guard wording");
}

const userVisibleHtml = html
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<script[\s\S]*?<\/script>/gi, "");
assert.ok(!userVisibleHtml.includes("v0.2.7"), "index.html user-visible surface must not show legacy v0.2.7");

// v1.0 에서 대상토지 / 법인별 평가 비교 / 그 밖의 요인은 고급검수 메뉴에서 검토 순서
// 메인 내비게이션으로 올라갔다. 라벨 문구 대신 화면 도달 가능성을 섹션 id로 고정한다.
for (const detailLabel of [
  "원본 등록·추출 검수",
  "원본·추출상태",
  "v0.4 문서해석 작업대",
  "표준지·사례 상세",
  "지장물 상세",
  "data-section=\"lands\"",
  "data-section=\"otherFactors\""
]) {
  assertIncludes(html, detailLabel, "index.html review and advanced menu");
}

assertIncludes(html, "공적 API 보강 스펙", "index.html subject factor comparison");
assertIncludes(html, "평가서 기재 스펙", "index.html subject factor comparison");
assertIncludes(html, "핵심 차이", "index.html subject factor comparison");
assertIncludes(html, "사례단가", "index.html other-factor review");
assertIncludes(html, "시점수정", "index.html other-factor review");
assertIncludes(html, "공시지가기준", "index.html other-factor review");
assertIncludes(html, "격차율", "index.html other-factor review");
assertIncludes(html, "검수 완료값 JSON 반영", "index.html OCR review workflow");
assertIncludes(html, "pdf.js", "index.html PDF.js document workspace");
assertIncludes(html, "본 도구는 감정평가서 검토 보조 도구", "index.html disclaimer");
assert.ok(!html.includes("감정평가 결과 산정, 추천, 대체, 보상금 증액 가능성 판단"), "index.html should not claim to calculate, recommend, substitute, or judge compensation increases");
assert.ok(!html.includes("권고 단가"), "index.html must not label any unit price as recommended");
assert.ok(!html.includes("권고 금액"), "index.html must not label any amount as recommended");

// The uploaded stable16 artifact remains the feature baseline. Keep it present and aligned on all core contracts.
for (const needle of requiredStable16Strings.filter((value) => value !== "편입토지↔표준지 상세")) {
  assertIncludes(stable16, needle, "bosang_os_v04_alpha2_stable16.html");
}
assert.ok(countOccurrences(html, "function renderOcrReview") >= 1, "index.html must keep the OCR review renderer");
assert.ok(countOccurrences(html, "function renderDocumentWorkspace") >= 1, "index.html must keep the document workspace renderer");

for (const phrase of [
  "파일 선택",
  "평가서 파일 추가",
  "source-add-input",
  "registerUploadedPdfFiles",
  "bindSourceAddInputs",
  "원본 파일 등록",
  "선택한 파일 없음",
  "파일이 등록되었습니다",
  "sourceUploadInputId",
  "sourceFilePickerHtml",
  "handleSourceFileInputChange",
  "document_uploads",
  "다음 작업"
]) {
  assertIncludes(html, phrase, "index.html PR-30B-1 source file picker binding contract");
}
assert.ok(!html.includes('id="pdfFileInput"'), "index.html PR-30B-1 must not keep the legacy duplicate-prone pdfFileInput id");
const staticSourceUploadIds = Array.from(html.matchAll(/sourceUploadInputId\(\s*[`"]([^`"]+)[`"]\s*\)/g)).map(match => match[1]);
assert.equal(new Set(staticSourceUploadIds).size, staticSourceUploadIds.length, "index.html PR-30B-1 source file input id contexts must be unique");

for (const phrase of [
  "PR-30B-1은 PR-30B 전체 구현이 아니라",
  "파일 선택",
  "실제 업로드 `input[type=file]` 연결",
  "업로드 전 **원본 파일 등록**의 **파일 선택**과 업로드 후 **원본 추가·교체**의 **평가서 파일 추가**",
  "같은 업로드 큐(`document_uploads`)와 `registerUploadedPdfFiles()` 흐름",
  "파일이 등록되었습니다",
  "다음 작업"
]) {
  assertIncludes(readme, phrase, "README.md PR-30B-1 source file picker binding docs");
}

for (const phrase of [
  "PR-30B-1 모바일 파일 선택 연결 QA",
  "모바일 첫 화면에서 **파일 선택** 버튼 클릭",
  "PDF 파일 1건 선택",
  "**다음 작업** 카드로 전환",
  "업로드 후 **평가서 파일 추가** 버튼도 보이는지 확인",
  "같은 업로드 큐"
]) {
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md PR-30B-1 source file picker binding QA");
}

assertIncludes(readme, "보상전략 OS v0.4-alpha2-stable16", "README.md");
assertIncludes(readme, "stable16", "README.md");
assertIncludes(readme, "감정평가 결과 산정, 추천, 대체, 보상금 증액 가능성 판단을 하지 않는 검토 보조도구", "README.md");
assertIncludes(readme, "file://", "README.md");

for (const safeLabel of [
  "원본 파일 등록",
  "쟁점 후보 표시",
  "보조문안 초안 생성",
  "비교 보기",
  "검수 처리"
]) {
  assertIncludes(html, safeLabel, "index.html consolidated UX labels");
}

assertIncludes(html, "실무자 모드", "index.html practice mode explanation");
assertIncludes(html, "포트폴리오 모드", "index.html portfolio mode explanation");

for (const phrase of [
  "PR-15는 기능 추가 PR이 아니라",
  "데이터 키와 `data-section` 값은 유지",
  "면책문은 3종으로 표준화",
  "칩 색상 의미는 5색으로 고정",
  "샘플 시나리오 기준",
  "모바일 개발자 상세 메뉴",
  "모바일 핵심 표를 필지별 카드뷰"
]) {
  assertIncludes(uxRedesignPlan, phrase, "ux_redesign_plan.md PR-15 contract");
}


assertIncludes(readme, "demo_walkthrough.md", "README.md demo walkthrough link");

for (const phrase of [
  "5단계 실무 워크벤치 UX",
  "sample_case_gongju.json",
  "원본 등록 → 공적자료 보강 → 평가논리 검토 → 쟁점 정리 → 의견서 보조문안 검토",
  "보상금 증액 가능성 판단을 하지 않는 검토 보조도구",
  "3분 시연 스크립트",
  "수동 QA 체크리스트",
  "법률자문 확정 표현",
  "감정평가를 대신하는 판단",
  "핵심 카드",
  "GJ-DEMO-SAN3-1"
]) {
  assertIncludes(demoWalkthrough, phrase, "demo_walkthrough.md portfolio demo contract");
}

for (const step of [
  "1단계 — 원본 등록",
  "2단계 — 공적자료 보강",
  "3단계 — 평가논리 검토",
  "4단계 — 쟁점 정리",
  "5단계 — 의견서 보조문안 검토"
]) {
  assertIncludes(demoWalkthrough, step, "demo_walkthrough.md five-step walkthrough");
}

for (const phrase of [
  "데모 실행 방법",
  "GitHub Pages 배포",
  "로컬 실행",
  "sample_case_gongju.json 적용 절차",
  "manual_qa_checklist.md",
  "portfolio_demo_notes.md",
  "public_land_characteristics",
  "subject_to_standard_factor_comparisons"
]) {
  assertIncludes(readme, phrase, "README.md deployment demo instructions");
}

for (const phrase of [
  "GitHub Pages URL",
  "로컬 서버",
  "PC 화면 확인",
  "모바일 화면 확인",
  "샘플 JSON 적용 확인",
  "5단계 화면 확인",
  "안전문구 확인",
  "데이터키 보존 확인",
  "보상금 증액 가능성 판단을 하지 않는 검토 보조도구",
  "법률자문 확정 표현",
  "public_land_characteristics",
  "comparison_summary_by_land",
  "subject_to_standard_factor_comparisons",
  "standard_to_comp_case_factor_comparisons",
  "other_factor_reviews",
  "ocr_review_items",
  "risk_warnings"
]) {
  assertIncludes(manualQa, phrase, "manual_qa_checklist.md release QA contract");
}

for (const phrase of [
  "포트폴리오 제출",
  "면접 시연",
  "GitHub Pages",
  "python3 -m http.server 8000",
  "5단계 실무 워크벤치 UX",
  "sample_case_gongju.json",
  "GJ-DEMO-SAN3-1",
  "stable16 데이터키 보존",
  "보상금 증액 가능성 판단을 하지 않는 검토 보조도구",
  "전문가 검토",
  "3분 시연 흐름"
]) {
  assertIncludes(portfolioNotes, phrase, "portfolio_demo_notes.md demo talking points contract");
}


// ---------------------------------------------------------------------------
// v1.0 LTR 통합 UI 계약
// 사건처리 흐름 6단계(홈·실행보드 → 사건 워크스페이스 → 자료·데이터 → 분석 →
// 지도·현장 → 결과물)와 상태 기반 다음 Action, 그리고 검증된 OCR 검수 로직의
// UI 진입점이 사라지지 않도록 고정한다. 라벨 문구가 아니라 도달 가능성·전이문구를 고정한다.
// ---------------------------------------------------------------------------
for (const ltrStage of ["home", "workspace", "data", "analysis", "map", "output"]) {
  assertIncludes(html, `{ key: "${ltrStage}"`, "index.html v1.0 LTR execution stage definition");
  assertIncludes(html, `data-stage="${ltrStage}"`, "index.html v1.0 LTR navigation stage grouping");
}

for (const ltrNeedle of [
  "lkExecutionBar",
  "LTR_EXECUTION_STAGES",
  "function renderExecutionBar",
  "function ltrNextAction",
  "function ltrStageStatusMap",
  "홈·실행보드",
  "사건 워크스페이스",
  "자료·데이터",
  "지도·현장",
  "결과물",
  "미등록 → 평가서 등록",
  "미조회 → 조회하기",
  "조회완료 → 분석 반영",
  "분석완료 → 지도·현장 확인",
  "분석완료 → 쟁점 검토",
  "검토완료 → 결과물 생성",
  "실행보드는 저장된 후보·초안·검토자료 기준으로 현재 단계를 표시하는 검토 보조 안내입니다",
  "보상금 증감이나 승소 가능성을 나타내지 않습니다"
]) {
  assertIncludes(html, ltrNeedle, "index.html v1.0 LTR execution board contract");
}

// G1: 검증된 OCR 검수 로직이 live 렌더 함수에서 UI로 접근 가능해야 한다.
for (const ltrOcrNeedle of [
  "function ltrOcrReviewToolbarCard",
  "function ltrFilterOcrReviewItems",
  "ocr-review-toolbar-card",
  "onclick=\"applyConfirmedOcrToJson()\"",
  "onclick=\"confirmAutoPassedOcrItems()\"",
  "onclick=\"clearOcrReviewItems()\"",
  "onclick=\"setOcrFilter('",
  "ltrOcrReviewToolbarCard(allReviewItems)",
  "renderPdfViewerForOcr()"
]) {
  assertIncludes(html, ltrOcrNeedle, "index.html v1.0 LTR OCR review entry point");
}

const ltrNavStart = html.indexOf("<nav class=\"axis-nav\">");
const ltrNavEnd = html.indexOf("</nav>", ltrNavStart);
assert.ok(ltrNavStart >= 0 && ltrNavEnd > ltrNavStart, "index.html must expose axis-nav block for v1.0 LTR IA guard");
const ltrNavBlock = html.slice(ltrNavStart, ltrNavEnd);
const ltrNavSections = Array.from(ltrNavBlock.matchAll(/<button[^>]*data-section="([^"]+)"/g)).map(m => m[1]);
const ltrReviewOrder = ["overview", "lands", "landCompare", "subjectFactors", "otherFactors", "workflowLogic", "reviewQueue"];
assert.deepEqual(
  ltrNavSections.filter(section => ltrReviewOrder.includes(section)).slice(0, ltrReviewOrder.length),
  ltrReviewOrder,
  "index.html v1.0 LTR navigation must keep the review section order"
);
for (const requiredSection of [
  "overview", "uploadHub", "sourceStatus", "ocrReview", "documentWorkspace",
  "lands", "publicData", "stdCases",
  "landCompare", "subjectFactors", "caseFactors", "otherFactors", "obstacles", "workflowBase", "workflowValue",
  "workflowLogic",
  "reviewQueue", "issues", "sentences", "risks", "workflowOutput", "json"
]) {
  assert.ok(ltrNavSections.includes(requiredSection), `index.html v1.0 LTR navigation must keep data-section="${requiredSection}"`);
}

console.log("Static site contract checks passed.");
