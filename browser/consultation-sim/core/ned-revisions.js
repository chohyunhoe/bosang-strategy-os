// VWorld 국가중점데이터(NED) 속성 응답의 같은 PNU·연도 복수 행 정리 규칙 — 토지특성·표준지 공용(키·네트워크 없음)
// 같은 PNU·기준연도 행이 여러 개일 때의 규칙 (2026-11-23 실호출: 2026년 2행·2025년 3행, 행 간 차이는 lastUpdtDt뿐)
// - 갱신 메타(lastUpdtDt)를 뺀 모든 필드 값이 행끼리 완전히 같을 때만 정리한다. 대표행 = 날짜로 검증되는 최신 lastUpdtDt 행.
//   값이 같으므로 어느 행을 골라도 결과는 같고, 대표행은 출처 기록용이다. 행 수·갱신일 목록·근거를 selection에 남긴다.
// - 그 외 필드가 하나라도 다르면 자동 선택하지 않는다(VWORLD_REVISION_CONFLICT, 충돌 필드 이름만 기록).
// - 최신 lastUpdtDt가 날짜로 해석되지 않거나 최신 행이 2개 이상이어도 값이 동일하면 정리하되, 근거에 그 사실을 남긴다.
export const NED_REVISION_META_FIELDS = Object.freeze(['lastUpdtDt']);
const norm = (v) => (v == null ? '' : String(v).trim());
const dateKey = (v) => { const m = norm(v).match(/^(\d{4})-?(\d{2})-?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

export function collapseNedRevisions(rows) {
  if (rows.length === 1) return { ok: true, row: rows[0], selection: { row_count: 1, rule: 'SINGLE_ROW' } };
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row || {})))].filter((k) => !NED_REVISION_META_FIELDS.includes(k)).sort();
  const conflicts = keys.filter((k) => new Set(rows.map((row) => norm(row[k]))).size > 1);
  const updated = rows.map((row) => norm(row.lastUpdtDt));
  if (conflicts.length) {
    return { ok: false, code: 'VWORLD_REVISION_CONFLICT', selection: { row_count: rows.length, rule: 'CONFLICT_HOLD', conflict_fields: conflicts, last_updated: updated } };
  }
  const dated = rows.map((row) => ({ row, key: dateKey(row.lastUpdtDt) }));
  const valid = dated.filter((d) => d.key);
  const latest = valid.length ? valid.reduce((a, b) => (b.key > a.key ? b : a)).key : null;
  const winners = latest ? valid.filter((d) => d.key === latest) : [];
  const chosen = winners[0]?.row || rows[0];
  return {
    ok: true, row: chosen,
    selection: {
      row_count: rows.length,
      rule: 'IDENTICAL_DATA_REVISIONS',
      basis: latest
        ? `응답 ${rows.length}행 · 최종갱신일 외 모든 값 동일 → 최신 갱신행(${latest}) 대표${winners.length > 1 ? ` · 같은 날짜 ${winners.length}행` : ''}`
        : `응답 ${rows.length}행 · 최종갱신일 외 모든 값 동일 · 갱신일 해석 불가(값이 같아 결과 동일)`,
      selected_last_updated: latest,
      unparsed_last_updated: dated.filter((d) => !d.key).length,
      last_updated: updated,
    },
  };
}

