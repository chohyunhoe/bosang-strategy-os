import test from 'node:test';
import assert from 'node:assert/strict';
import { MANUAL_SCHEMA, validateManualPack, searchManualPack, suggestManualReferences, getManualEvidenceGates } from '../../browser/consultation-sim/core/manual-pack.js';

const PREFIX = { T:46, S:11, B:12, R:6, Y:12, N:10, L:9, H:9, P:83 };
function makePack() {
  const codes = [];
  for (const [p, n] of Object.entries(PREFIX)) for (let i = 1; i <= n; i++) {
    const code = `${p}-${String(i).padStart(2, '0')}`;
    const title = code === 'T-01' ? '비교표준지 선정 검토(합성 테스트용)' :
      code === 'T-11' ? '판단시점 확인(합성 테스트용)' :
        code === 'T-09' ? '지목과 현황 비교(합성 테스트용)' : `가상 유형 ${code}`;
    codes.push({ code, title, pdf_page_start:150, pdf_page_end:151, book_page_start:149,
      sections:{ '쟁점':'가상 질문', '판단기준':'실제 법령 확인 전 확정 금지', '근거':'합성 자료',
        '확인자료':'평가서·현장사진', '편람쪽':'가상 페이지' } });
  }
  return { schema:MANUAL_SCHEMA, classification:'LK_INTERNAL_RESTRICTED_NOT_FOR_PUBLIC_GITHUB',
    source:{review_status:'INTERNAL_DRAFT; NOT VERIFIED_AS_APPROVED_FINAL',source_pdf_sha256:'SYNTHETIC'},
    all_pages_text:Array.from({length:320}, (_,j)=>({pdf_page:j+1,text:'가상 교육용'})),issue_codes:codes };
}
test('실무기본서: 320쪽·198개 코드와 필수 섹션 보존 구조만 수용', () => {
  const pack=makePack(),result=validateManualPack(pack);
  assert.equal(result.ok,true);assert.equal(result.issue_count,198);
  const bad=structuredClone(pack);bad.issue_codes[0].sections['확인자료']=undefined;
  assert.equal(validateManualPack(bad).ok,false);
  const leak=structuredClone(pack);leak.classification='PUBLIC';
  assert.equal(validateManualPack(leak).ok,false);
  const incomplete=structuredClone(pack);incomplete.issue_codes.pop();
  assert.equal(validateManualPack(incomplete).ok,false);
  const wrongPages=structuredClone(pack);wrongPages.all_pages_text.pop();
  assert.equal(validateManualPack(wrongPages).ok,false);
});
test('기본서 검색: 코드·제목을 찾아 원문 위치만 반환, 자료를 외부로 보내지 않음', () => {
  const p=makePack();
  assert.equal(searchManualPack(p,'T-01')[0].code,'T-01');
  assert.equal(searchManualPack(p,'비교표준지')[0].code,'T-01');
  assert.equal(searchManualPack(p,'없는문구').length,0);
  assert.equal(searchManualPack(p,'')[0],undefined);
});
test('지번 조회로 법률쟁점 자동 확정 금지: reference only, 허위 T-09 신호 없음', () => {
  const p=makePack();
  const draft={fields:{land_category:{value:'대'},land_use:{value:'단독'}},
    analysis:{standard:{status:'FOUND'},signals:[]},map:{status:'EXACT_ONE'}};
  const list=suggestManualReferences(p,draft);
  assert.equal(list.length,1);
  assert.equal(list[0].code,'T-01');
  assert.equal(list[0].role,'READING_REFERENCE_ONLY');
  assert.ok(!list.some((v)=>v.code==='T-09'));
  draft.analysis.signals=[{kind:'YEAR_CHANGE'}];
  assert.ok(suggestManualReferences(p,draft).some((v)=>v.code==='T-11'));
});

test('기본서 증빙 게이트 T-01·T-05·T-09·T-12: 확인자료 누락 시 법률판단 금지', () => {
  const p = makePack();
  const draft = { fields:{land_category:{value:'대'},land_use:{value:'단독'}},
    analysis:{standard:{status:'FOUND'},signals:[]}, map:{status:'EXACT_ONE'} };
  const gates = getManualEvidenceGates(p,draft);
  assert.deepEqual(gates.map((g)=>g.code),['T-01','T-05','T-09','T-12']);
  assert.equal(gates[2].state,'NOT_TRIGGERED');
  assert.ok(gates.every((g)=>g.automatic_legal_conclusion===false));
  assert.ok(gates.every((g)=>g.role==='REFERENCE_CHECKLIST_ONLY' && g.requires.length >= 3));
});
