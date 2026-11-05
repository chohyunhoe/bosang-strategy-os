'use strict';

// 실평가서 2건(라인 65p / 프라임 95p)을 실제 Product v2 화면에 넣고 확인하는 인수 검증.
//
// 평가서 원문은 저장소에 두지 않는다. 로컬 경로를 환경변수로 받고, 없으면 SKIP 한다.
//   BSO_LEAD_CASE_PDFS="<라인>.pdf;<프라임>.pdf"
//
// 사건 고유값을 화면 코드에 넣지 않기 위해, 법인·지번 대신 "형태"와 관계 수로 검증한다.

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const pdfs = String(process.env.BSO_LEAD_CASE_PDFS || '')
  .split(path.delimiter).map((value) => value.trim()).filter(Boolean);
const enabled = pdfs.length === 2 && pdfs.every((file) => fs.existsSync(file));

const EXPECTED_VALUATION_DATE = '2025.03.13';
const PARTICLES = ['를', '을', '의', '로', '으', '는', '은', '이', '가', '와', '과', '에', '도', '만', '및', '중', '등'];

test.describe('lead case browser acceptance', () => {
  test.skip(!enabled, 'BSO_LEAD_CASE_PDFS local files are required');

  test('두 평가서를 한 배치로 넣어도 법인별 값과 승격 판정이 각각 보존된다', async ({ page }) => {
    test.setTimeout(900_000);
    await page.goto('/');
    await page.locator('[data-upload]').first().setInputFiles(pdfs);
    await expect(page.locator('.status-pill')).not.toHaveAttribute('data-status','PROCESSING', { timeout: 840_000 });

    const snapshot = await page.evaluate((particles) => {
      const store = window.BSOProductV2.store;
      const state = store.state;
      const list = (rows) => (Array.isArray(rows) ? rows : []);
      const forId = (rows, id) => list(rows).filter((row) => row.appraisal_id === id);
      const sentenceLike = (value) => {
        const address = String(value || '').trim();
        if (!address) return false;
        if (/(?:대등|열등|우세|유사|조건|요인|비교|대상|물건|판단|선정|참조|기준|해당|없음|있음)/.test(address)) return true;
        return address.replace(/(?:^|\s)(?:산)?\d{1,5}(?:-\d{1,5})?(?=\s|$)/g, ' ')
          .split(/\s+/).filter((token) => /[가-힣]/.test(token)).length > 4;
      };
      const firms = list(state.appraisals).map((appraisal) => {
        const id = appraisal.appraisal_id;
        const sanity = list(state.documentSanity).find((row) => row.appraisal_id === id) || {};
        const standards = forId(state.standardLands, id);
        return {
          id,
          company: String(appraisal.appraisal_company || ''),
          valuationDate: String(appraisal.valuation_date || ''),
          sanity: sanity.status || null,
          holdCodes: sanity.hold_codes || [],
          lands: list(state.lands).filter((row) => list(row.source_appraisal_ids).includes(id)).length,
          results: forId(state.appraisalResults, id).length,
          standards: standards.length,
          standardAreas: standards.map((row) => row.area),
          subjectToStandard: forId(state.subjectFactorDetails, id).length,
          standardToCase: forId(state.standardToCompCaseFactors, id).length,
          particleSymbols: forId(state.transactionCases, id)
            .filter((row) => particles.includes(String(row.case_symbol || '').trim())).length,
          sentenceAddresses: [...standards, ...forId(state.transactionCases, id)]
            .filter((row) => sentenceLike(row.parcel_address)).length,
        };
      });
      return {
        status: state.status,
        batchHasHold: state.batchHasHold === true,
        firms,
        eligibility: store.mapEligibility(),
        mapInput: {
          appraisalIds: [...new Set(list(store.mapInputState().standardLands).map((row) => row.appraisal_id))],
          standards: list(store.mapInputState().standardLands).length,
        },
      };
    }, PARTICLES);

    // ── 문서 단위 승격 판정이 남아 있어야 한다 ──────────────────────────────
    const held = snapshot.firms.filter((firm) => firm.sanity === 'PARSE_HOLD');
    const ready = snapshot.firms.filter((firm) => firm.sanity === 'READY');
    expect(snapshot.firms).toHaveLength(2);
    expect(held, 'HOLD 인 평가서가 하나 있어야 한다').toHaveLength(1);
    expect(ready, 'READY 인 평가서가 하나 있어야 한다').toHaveLength(1);

    // 배치가 HOLD 를 READY 로 덮지 않는다.
    expect(snapshot.batchHasHold).toBe(true);
    expect(snapshot.status, 'HOLD 문서가 있는 배치를 READY 로 만들면 안 된다').toBe('PARSE_HOLD');

    // ── 두 평가서 공통 계약 ────────────────────────────────────────────────
    for (const firm of snapshot.firms) {
      expect(firm.company, `${firm.id}: 평가법인명`).toMatch(/감\s*정\s*평\s*가\s*법\s*인/);
      expect(firm.valuationDate, `${firm.id}: 기준시점`).toBe(EXPECTED_VALUATION_DATE);
      expect(firm.particleSymbols, `${firm.id}: 조사형 사례기호`).toBe(0);
      expect(firm.sentenceAddresses, `${firm.id}: 문장형 소재지`).toBe(0);
      expect(firm.standards, `${firm.id}: 비교표준지`).toBeGreaterThan(0);
      for (const area of firm.standardAreas) {
        if (area === null || area === undefined) continue;
        expect(area, `${firm.id}: 표준지 면적 자리에 공시지가가 들어왔다`).toBeLessThan(100000);
      }
    }

    // ── READY 평가서: 관계까지 복원되어야 한다 ─────────────────────────────
    const readyFirm = ready[0];
    expect(readyFirm.lands, 'READY 평가서 편입토지').toBeGreaterThanOrEqual(7);
    expect(readyFirm.results, 'READY 평가서 평가행').toBeGreaterThanOrEqual(3);
    expect(readyFirm.standards, 'READY 평가서 비교표준지').toBe(11);
    expect(readyFirm.subjectToStandard, 'READY 평가서 subject↔standard').toBeGreaterThanOrEqual(3);
    expect(readyFirm.standardToCase, 'READY 평가서 standard↔case').toBeGreaterThanOrEqual(10);

    // ── HOLD 평가서: 열 밀림 없이 보류 ─────────────────────────────────────
    const heldFirm = held[0];
    expect(heldFirm.holdCodes.length, 'HOLD 사유가 남아야 한다').toBeGreaterThan(0);
    expect(heldFirm.standardAreas.every((area) => area === null || area === undefined),
      'HOLD 평가서의 표준지 면적 열은 없는 서식이므로 비어 있어야 한다').toBe(true);

    // ── 지도: HOLD 문서 데이터는 섞지 않는다 ───────────────────────────────
    expect(snapshot.eligibility.excluded_appraisal_ids, '지도에서 HOLD 문서를 제외해야 한다')
      .toContain(heldFirm.id);
    expect(snapshot.mapInput.appraisalIds, '지도 입력에 HOLD 문서가 남으면 안 된다')
      .not.toContain(heldFirm.id);
    if (snapshot.eligibility.allowed) {
      expect(snapshot.mapInput.appraisalIds, '허용된 지도는 READY 문서 값만 쓴다').toEqual([readyFirm.id]);
    } else {
      expect(['ONLY_HOLD_DOCUMENTS_HAVE_MAP_DATA', 'NO_MAPPABLE_PARCEL', 'RELATION_SPANS_HELD_DOCUMENT'])
        .toContain(snapshot.eligibility.reason);
    }
  });
});

