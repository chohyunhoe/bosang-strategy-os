'use strict';

const {
  extractLandAppraisalResults,
  createAppraisalRowExtractionStats,
  looksLikeParcelAddress,
} = require('./extractors/land_appraisal_results_extractor');

function provinceRelaxedAddress(address) {
  const tokens = String(address || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3 || !/(?:특별자치도|도)$/.test(tokens[0])) return null;
  const relaxed = tokens.slice(1).join(' ');
  return looksLikeParcelAddress(relaxed) ? relaxed : null;
}

// 평가조서가 소재지 셀을 줄바꿈으로 쪼개면 편입토지 주소는 법정동을 복원해 갖지만
// 산출단가 행 원문에는 법정동이 없을 수 있습니다. 그 때 법정동을 미리 떼고 맞춰봅니다.
function legalDongRelaxedAddress(address) {
  const tokens = String(address || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return null;
  const dongIndex = tokens.findIndex((token) => /(?:동|읍|면|리)$/.test(token));
  if (dongIndex <= 0 || dongIndex === tokens.length - 1) return null;
  const relaxed = tokens.filter((_, index) => index !== dongIndex).join(' ');
  return looksLikeParcelAddress(relaxed) ? relaxed : null;
}

const ADDRESS_RELAXATIONS = [
  {
    relax: provinceRelaxedAddress,
    note: '평가조서 행에서 광역단위가 생략된 주소를 편입토지 canonical 주소와 exact-one으로 연결했습니다.',
  },
  {
    relax: legalDongRelaxedAddress,
    note: '평가조서 행에서 법정동이 생략된 주소를 편입토지 canonical 주소와 exact-one으로 연결했습니다.',
  },
];

function extractLinkedLandAppraisalResults(lines, context = {}, stats = null) {
  const lands = Array.isArray(context.lands) ? context.lands : [];
  const primary = extractLandAppraisalResults(lines, context, stats);
  const byLandId = new Map(primary.map((row) => [row.land_id, row]));
  const recordUnlinked = () => {
    if (stats) stats.unlinked_lands = Math.max(0, lands.length - byLandId.size);
  };
  if (lands.length === 0 || byLandId.size === lands.length) {
    recordUnlinked();
    return primary;
  }

  const canonicalByLandId = new Map(lands.map((land) => [land.land_id, land]));

  for (const { relax, note } of ADDRESS_RELAXATIONS) {
    if (byLandId.size === lands.length) break;
    const relaxedLands = lands.map((land) => {
      const relaxed = relax(land.parcel_address);
      return relaxed ? { ...land, parcel_address: relaxed } : land;
    });
    const relaxedRows = extractLandAppraisalResults(lines, { ...context, lands: relaxedLands });
    relaxedRows.forEach((row) => {
      if (byLandId.has(row.land_id)) return;
      const canonical = canonicalByLandId.get(row.land_id);
      if (!canonical || !relax(canonical.parcel_address)) return;
      byLandId.set(row.land_id, {
        ...row,
        parcel_address: canonical.parcel_address,
        confidence_level: row.confidence_level === 'HIGH' ? 'MEDIUM' : row.confidence_level,
        parser_notes: `${row.parser_notes} ${note} 자동확정하지 않으며 원문 대조 필요.`,
      });
    });
  }

  recordUnlinked();
  // 평가행이 붙지 못한 편입토지는 여기서 조용히 사라진다. 손실 건수를 stats 로 남긴다.
  return lands.flatMap((land) => byLandId.has(land.land_id) ? [byLandId.get(land.land_id)] : []);
}

module.exports = {
  createAppraisalRowExtractionStats,
  extractLinkedLandAppraisalResults,
  provinceRelaxedAddress,
  legalDongRelaxedAddress,
};
