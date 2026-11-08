# BSO GIS: cadastral SHP ZIP → verified aerial maps (portable runner)

**Status:** new isolated CLI entry; does **not** modify BSO stable graphics gate, app UI or previous subject-only workflow.

## Scope / input

- Original official continuous cadastral `*.zip` at a local-only path (SHP, SHX, DBF; EPSG:5174, EUC-KR).
- PNU 19-digit identifiers and parcels with land category, registered area, expected WGS84 bounds and a **non-identifying** ASCII case ID.
- Optional `source_document_verified=true` only if the original land/acquisition register was actually checked.
- Provider: `esri` for imagery without a VWorld key or `vworld` with local `VWORLD_API_KEY` and `VWORLD_DOMAIN` environment variables.
- Sensitive case JSON and ZIP belong under `bso/graphics-input/local_only/` (gitignored). Do **not** commit them.

Example **structure only** (all identifiers/coordinates synthetic, not a real case):

```json
{
  "case_id": "SYNTHETIC_PARCEL_MAP",
  "title": "대상토지 위치도",
  "archive": "source/COUNTY_LDREG.zip",
  "source_crs": "EPSG:5174",
  "dbf_encoding": "euc-kr",
  "provider": "esri",
  "expected_bounds_wgs84": [126.5, 36.2, 127.5, 37.1],
  "source_document_verified": false,
  "imagery_capture_date": null,
  "imagery_accuracy_m": null,
  "parcels": [
    {"pnu": "9999900000100010001", "jibun": "1-1",
     "category": "대", "registered_area_m2": 100.0,
     "incorporated_area_m2": null}
  ]
}
```

## Run

```bash
python -m pip install -r bso/tools/requirements_cadastral_aerial.txt
python bso/tools/cadastral_aerial.py \
  --config bso/graphics-input/local_only/case.json \
  --out bso/graphics-output/aerial
```

On Windows in `bso/`: `RUN_CADASTRAL_AERIAL.cmd graphics-input\local_only\case.json graphics-output\aerial`.
Install Python dependencies in the Windows Python interpreter used by the launcher first.
For absent Korean fonts, supply `--font /path/to/Korean.ttf` via the Python CLI.
Keep real PNU/owner data and API keys out of GitHub Actions.

## Fail closed: completed **before imagery retrieval**

1. ZIP must contain one coherent `shp/shx/dbf` set and pass CRC.
2. Each requested 19-digit PNU must appear **exactly once** in the archive.
3. PNU-derived lot number equals requested JIBUN **and** the SHP record JIBUN base.
4. JIBUN land-category suffix matches requested category (including warehouse `창`).
5. Polygon is non-empty, valid, measured in explicit **EPSG:5174**. Do **not** infer datum from an incomplete `.prj`.
6. Transformed WGS84 geometry lies within configured expected region bounds.

Any failure blocks map output. No estimated boundary and no point placeholder masquerading as a parcel.

## Produced locally

Use a **fresh output directory** for each run; old maps are never silently reused.

A successful run produces `<case_id>_overview.png/.jpg`, `<case_id>_detail.png/.jpg`,
`<case_id>_one_page.pdf/.jpg`, `<case_id>_verified_wgs84.geojson` and
`<case_id>_verification.json`. Close-by polygons are grouped into panels, distant groups are separated.
The engine stamps imagery attribution, its capture date *if independently known*, cadastral disclaimer,
and source-document verification status. Every PNG/JPG map prints its imagery provider,
capture date and positional accuracy, or explicitly `미확인` when not verified. Outputs are internal **DRAFT_REVIEW_REQUIRED**, not approved court exhibits.

Study-specific reported discrepancy (not independently reverified here): cadastral geometry area may differ
from registered area; report both and the percentage but **do not** silently rewrite register area.
Boundaries remain a *reference* layer: legal area depends on public register and boundary on cadastral survey.

### Distinguish achievements

- `geometry_status=PASS`: local PNU/JIBUN/category/CRS/polygon gates passed.
- `delivery_status=DRAFT_REVIEW_REQUIRED`: source land-acquisition register and attorney approval are separate gates.
- Esri substitution is explicit; Esri imagery capture date is not inferred from tile URL or falsely described as VWorld.
- CI uses **synthetic** SHP and **mock** aerial tiles: its success does **not** prove a live VWorld response,
  actual location alignment, or live Windows/QGIS operation.

## Security

No local case JSON, cadastral SHP, address, owner name, GeoJSON or imagery output in the public repo.
No API keys in code, test fixtures, logs, ZIP filenames, URLs in emitted verification files, or GitHub Actions.
VWorld request failures do not print full URLs. Image downloads require valid image response; missing tiles block output.

## Acceptance for real cases

After runtime success, compare original land register (jibun, land category, area, acquired area);
inspect cadastral outline against road/property edges and survey evidence; verify imagery source and
capture date independently where possible; reopen the PNG/JPG and 1-page PDF; then seek attorney approval.
Copy only reviewed, approved output into official LK formats.
