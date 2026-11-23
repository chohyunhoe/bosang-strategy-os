// 상담 초동의견 자동 생성 (결정론 템플릿 · LLM 없음)
// ① 대상토지 주요 특징 ② 비교표준지 검토 ③ 향후 주장 가능 쟁점(후보) ④ 추가 확보자료·상담 멘트
// - 모든 문장은 근거 필드(basis)에 연결한다. 근거가 없는 문장은 만들지 않는다.
// - 증액 가능성·보상액·위법 여부를 단정하지 않는다(FORBIDDEN_PHRASES로 자체 검사).

export const FORBIDDEN_PHRASES = Object.freeze([/증액\s*가능/, /증액될/, /보상금이\s*(오릅|늘어납|올라갑)/, /확정적/, /위법\s*(확정|입니다)/, /틀림없/, /반드시\s*(받|오르|인정)/, /보장/]);

const fmtWon = (n) => `${Number(n).toLocaleString('ko-KR')}원/㎡`;
const fmtM = (m) => (m == null ? '거리 미산출' : m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`);
const item = (text, basis, extra = {}) => ({ text, basis, ...extra });

function fieldValue(draft, key) { const f = draft.fields?.[key]; return f && f.value != null ? f : null; }

export function buildConsultOpinion(draft) {
  const d = draft;
  const prefix = d.synthetic ? '[합성 시연자료] ' : '';
  const f = (k) => fieldValue(d, k);
  const signals = d.analysis?.signals || [];
  const std = d.analysis?.standard || { status: 'NOT_QUERIED' };

  // ① 주요 특징 — 값이 확인된 필드만
  const features = [];
  const lc = f('land_category'); const ar = f('area_m2'); const zn = f('zoning'); const zs = f('zoning_secondary');
  if (lc || ar || zn) {
    features.push(item(`${prefix}${[lc && `지목 ${lc.value}`, ar && `면적 ${Number(ar.value).toLocaleString('ko-KR')}㎡`, zn && zn.value, zs && zs.value && `(${zs.value})`].filter(Boolean).join(' · ')}`,
      ['land_category', 'area_m2', 'zoning', 'zoning_secondary'].filter((k) => f(k))));
  }
  const pr = f('price_per_m2');
  if (pr) features.push(item(`${prefix}개별공시지가 ${fmtWon(pr.value)}(${pr.base_year || d.binding.base_year}년 기준)`, ['price_per_m2']));
  const chars = ['land_use', 'road_access', 'shape', 'elevation'].map((k) => f(k) && `${d.fields[k].label} ${d.fields[k].value}`).filter(Boolean);
  if (chars.length) features.push(item(`${prefix}공시지가 산정용 토지특성: ${chars.join(' · ')} (실제 현황과 다를 수 있음)`, ['land_use', 'road_access', 'shape', 'elevation'].filter((k) => f(k))));
  signals.filter((s) => ['YEAR_CHANGE', 'REVISION_CONFLICT'].includes(s.kind))
    .forEach((s) => features.push(item(`확인 필요: ${s.title} — ${s.detail}`, s.fields, { kind: 'signal' })));
  if (!features.length) features.push(item(d.synthetic ? '합성 시연자료에서 토지특성을 확보하지 못했습니다.' : '공적자료에서 확인된 토지 특성이 없습니다(조회 실패 또는 자료 없음).', []));

  // ② 비교표준지 검토
  const standard = [];
  if (std.status === 'FOUND') {
    std.candidates.forEach((c) => {
      const diffs = c.factors.filter((x) => x.hypothesis && x.hypothesis.direction !== 'SIMILAR').map((x) => `${x.label}(${x.hypothesis.text})`);
      standard.push(item(
        `후보 ${c.rank}(검토 순서 · 적정성 순위 아님) ${c.row.label || c.row.pnu} — 공시지가 ${c.row.price != null ? fmtWon(c.row.price) : '미기재'}, ${fmtM(c.distance_m)}. 선정 근거: ${c.selection_reasons.slice(0, 3).join(', ')}.${diffs.length ? ` 차이 검토 항목: ${diffs.join('; ')}.` : ' 확인된 자료상 뚜렷한 차이 항목 없음.'}`,
        [`standard:${c.row.pnu}`, ...c.factors.flatMap((x) => x.basis)].filter((v, i, a) => a.indexOf(v) === i),
        { candidate: c.rank },
      ));
    });
    if (std.nearest_excluded) {
      standard.push(item(`${std.nearest_excluded.scope_label || '위치가 확인된 표준지 중 가장 가까운'} ${std.nearest_excluded.label || std.nearest_excluded.pnu}(${fmtM(std.nearest_excluded.distance_m)})는 ${std.nearest_excluded.reasons.join(', ')}로 후보에서 제외했습니다.`, [`standard:${std.nearest_excluded.pnu}`]));
    }
    standard.push(item(`위 후보는 ${std.scope?.label || '같은 법정동'} 표준지 ${std.total_rows || 0}건 안에서의 ${d.synthetic ? '합성자료' : '공적자료'} 기준 유사도 순서일 뿐입니다. 실제 이용상황·주위환경·선정 기준시점은 확인하지 않았고, 인접 법정동 등 다른 지역 표준지도 비교하지 않았습니다. 감정평가서상 최종 비교표준지의 적정성을 판단한 것은 아닙니다.`, ['standard:scope']));
  } else if (std.status === 'NONE') {
    standard.push(item(`${std.scope?.label || '조회 범위'}에서 용도지역·이용상황이 유사한 표준지 후보를 찾지 못했습니다(조회 ${std.total_rows || 0}건). 범위 확대 여부는 전문가가 판단해야 합니다.`, ['standard:scope']));
  } else if (std.status === 'SCHEMA_UNMAPPED') {
    standard.push(item(`표준지 응답 ${std.mapping?.row_count || 0}행을 받았지만 ${std.mapping?.unmapped.map((u) => u.label).join('·')} 필드를 해석하지 못해 후보 판정을 보류했습니다. 필드 이름 확인이 필요합니다.`, ['standard:mapping']));
  } else if (std.status === 'INSUFFICIENT_TARGET') {
    standard.push(item('대상토지 용도지역·이용상황이 확보되지 않아 표준지 후보를 고르지 않았습니다.', ['zoning', 'land_use']));
  } else if (std.status === 'LOADING') {
    standard.push(item('표준지 자료 조회 중입니다.', []));
  } else {
    standard.push(item(`표준지 자료를 조회하지 못했습니다${std.code ? `(${std.code})` : ''}. 임의 후보를 만들지 않습니다.`, []));
  }

  // ③ 향후 주장 가능 쟁점 — 근거가 있는 것만, 모두 '후보'
  const issues = [];
  const top = std.status === 'FOUND' ? std.candidates[0] : null;
  const fac = (key) => top?.factors.find((x) => x.key === key);
  // 지목과 조사용 이용상황의 명칭 차이만으로 현황불일치 주장을 만들지 않는다.
  const street = fac('street');
  if (street?.hypothesis && street.hypothesis.direction === 'UNDETERMINED') {
    issues.push(item(`가로조건: ${street.hypothesis.text}. 조사용 분류만으로 평가상 우열을 주장하지 않으며 현장·평가서 확인이 필요합니다.`,
      street.basis, { title: '가로(도로)조건 확인', needs: ['도로 폭·포장·통행 상태 현장 사진', '지적도·도로대장', '보상평가서(개별요인)'], gate: 'EVIDENCE_REQUIRED' }));
  }
  const lot = fac('lot');
  if (lot?.hypothesis) {
    issues.push(item(`획지조건: ${lot.hypothesis.text}. 현장·평가서 확인 전에는 실제 이용 효용이나 보상상 우열을 판단할 수 없습니다.`,
      lot.basis, { title: '획지조건 확인', needs: ['지적도·실측도', '현장 사진(경사·출입)', '보상평가서(획지요인 비교)'], gate: 'EVIDENCE_REQUIRED' }));
  }
  const adm = fac('administrative');
  if (adm?.hypothesis || (d.fields.zoning_secondary?.value)) {
    issues.push(item(`행정적 조건: ${adm?.hypothesis ? adm.hypothesis.text : `대상에 ${d.fields.zoning_secondary.value} 기재가 있으므로 실제 행위제한 원문을 확인할 필요가 있습니다.`} 기재 차이만으로 보상상 우열을 판단하지 않습니다.`,
      ['zoning', 'zoning_secondary'], { title: '행정적 조건 확인', needs: ['토지이용계획확인서', '계획시설·지구단위계획 결정도서'], gate: 'EVIDENCE_REQUIRED' }));
  }
  if (std.status === 'NONE') {
    issues.push(item('비교표준지 선정: 같은 법정동 안에 유사 표준지가 없어, 평가서의 비교표준지 선정 근거가 쟁점이 될 수 있습니다.', ['standard:scope'], { title: '비교표준지 선정 적정성', needs: ['보상평가서(비교표준지 선정 사유)'] }));
  }
  signals.filter((s) => s.kind === 'YEAR_CHANGE').forEach((s) => issues.push(item(`토지특성 변경: ${s.detail}. 변경 경위가 평가에 어떻게 반영됐는지 확인할 사항입니다.`, s.fields, { title: '연도 간 토지특성 변경', needs: ['지자체 토지특성 변경 사유'] })));
  const issueNote = `표시된 항목은 ${d.synthetic ? '합성자료' : '공적자료'}에 따른 확인 과제이며, 감정평가서·현장증빙·법령 원문 대조 전에는 주장 성립이나 가치 우열을 확정하지 않습니다.`;

  // ④ 추가 확보자료 · 상담 멘트
  const materials = [...new Set([
    ...issues.flatMap((i) => i.needs || []),
    ...(signals.some((s) => s.kind === 'MISSING') ? ['토지대장·토지이용계획확인원(미확보 항목 보완)'] : []),
    '사업인정 고시문·보상계획 공고문', '보상평가서(수령 시) — 비교표준지·개별요인 비교표',
  ])];
  const sentences = [];
  if (zn || lc || pr) {
    sentences.push(`${d.synthetic ? '(시연자료 기준) 가상 조사자료상 ' : '공적자료로 보면 '}이 토지는 ${[zn?.value, lc && `지목 ${lc.value}`, ar && `${Number(ar.value).toLocaleString('ko-KR')}㎡`].filter(Boolean).join(', ')}이고${pr ? `, 개별공시지가는 ${pr.base_year || d.binding.base_year}년 ㎡당 ${Number(pr.value).toLocaleString('ko-KR')}원` : ''}으로 확인됩니다.`);
  }
  if (top) {
    sentences.push(`인근 표준지 중 ${top.row.label || '후보 1'}이(가) 용도지역과 조사용 이용상황이 유사한 후보로 보이지만, 실제 이용상황·주위환경·요인비교 기준시점을 확인하기 전에는 적정성을 판단할 수 없습니다. ${top.factors.filter((x) => x.hypothesis && x.hypothesis.direction === 'UNDETERMINED').map((x) => x.label).slice(0, 3).join('·') || '추가 비교항목'}은 확인할 항목입니다.`);
  } else if (std.status === 'NONE') {
    sentences.push('같은 동네 안에서는 조건이 비슷한 표준지가 바로 확인되지 않아, 평가서의 비교표준지 선정 근거부터 확인해야 합니다.');
  }
  if (issues.length) sentences.push(`지금 검토해 볼 만한 부분은 ${issues.map((i) => i.title).slice(0, 3).join(', ')}입니다.`);
  sentences.push(`현재 단계에서 보상금이 얼마가 될지나 늘어날지를 말씀드릴 수는 없고, ${materials.slice(0, 3).join(', ')} 등을 확보하시면 정밀 검토가 가능합니다.`);

  const opinion = {
    features, standard, issues, issue_note: issueNote,
    materials, script: sentences.join(' '),
    synthetic: Boolean(d.synthetic), generated_at: new Date().toISOString(), rule_set: 'bso-consult-opinion/0.1',
  };
  const all = [...features, ...standard, ...issues].map((x) => x.text).concat([opinion.script]);
  opinion.forbidden_hits = all.filter((t) => FORBIDDEN_PHRASES.some((re) => re.test(t)));
  return opinion;
}
