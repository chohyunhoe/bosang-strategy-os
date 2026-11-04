#!/usr/bin/env node
/*
 * VWorld 토지특성 일괄조회 로컬 실행 스크립트.
 * VWorld 공식 문서 확인 필요: endpoint, 파라미터, 응답 구조, 호출 제한/쿼터, 도메인 정책은 변경될 수 있습니다.
 * API Key, 전체 요청 URL, 원문 VWorld 응답 전체는 결과 JSON에 저장하지 않습니다.
 */

const fs = require("fs");
const path = require("path");

const ENDPOINT = "https://api.vworld.kr/ned/data/getLandCharacteristics";
const DEFAULT_INPUT = "input/pnu_list_sample.csv";
const DEFAULT_OUTPUT = "output/vworld_results.json";
const DEFAULT_DELAY_MS = 300;
const DEFAULT_LIMIT = 200;
const DEFAULT_NUM_OF_ROWS = "10";
const DEFAULT_PAGE_NO = "1";
const SUCCESS_STATUS = "VWORLD_LOOKUP_SUCCESS";
const NO_RESULT_STATUS = "VWORLD_NO_RESULT";
const FAILED_STATUS = "VWORLD_LOOKUP_FAILED";
const INCORRECT_KEY_STATUS = "VWORLD_INCORRECT_KEY";
const PNU_MISSING_STATUS = "PNU_MISSING";
const PNU_INVALID_STATUS = "PNU_INVALID";

function printUsage() {
  console.log(`Usage: node scripts/vworld_batch_lookup.js [options]\n\nOptions:\n  --input <file>    CSV input path (default: ${DEFAULT_INPUT})\n  --output <file>   JSON output path (default: ${DEFAULT_OUTPUT})\n  --year <year>     Default stdrYear override (default: VWORLD_DEFAULT_YEAR or current year)\n  --delay <ms>      Delay between requests in milliseconds (default: ${DEFAULT_DELAY_MS})\n  --limit <count>   Maximum rows to process (default: ${DEFAULT_LIMIT}, max recommended: 200)\n  --help            Show this help\n\nRequired environment variables:\n  VWORLD_API_KEY    VWorld API Key from .env or shell environment\n  VWORLD_DOMAIN     Registered VWorld domain from .env or shell environment\n  VWORLD_DEFAULT_YEAR Optional default standard year\n`);
}

function parseArgs(argv) {
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    year: undefined,
    delay: DEFAULT_DELAY_MS,
    limit: DEFAULT_LIMIT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const nextValue = argv[index + 1];
    if (["--input", "--output", "--year", "--delay", "--limit"].includes(arg) && (!nextValue || nextValue.startsWith("--"))) {
      throw new Error(`${arg} 옵션에는 값이 필요합니다.`);
    }
    if (arg === "--input") {
      options.input = nextValue;
      index += 1;
    } else if (arg === "--output") {
      options.output = nextValue;
      index += 1;
    } else if (arg === "--year") {
      options.year = nextValue;
      index += 1;
    } else if (arg === "--delay") {
      options.delay = Number.parseInt(nextValue, 10);
      index += 1;
    } else if (arg === "--limit") {
      options.limit = Number.parseInt(nextValue, 10);
      index += 1;
    } else if (!options.help) {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }
  }

  if (!Number.isFinite(options.delay) || options.delay < 0) {
    throw new Error("--delay 값은 0 이상의 숫자여야 합니다.");
  }
  if (!Number.isFinite(options.limit) || options.limit < 1) {
    throw new Error("--limit 값은 1 이상의 숫자여야 합니다.");
  }
  if (options.limit > DEFAULT_LIMIT) {
    console.warn(`⚠️  --limit ${options.limit}이 지정되었습니다. 100~200필지 검토용 도구이므로 ${DEFAULT_LIMIT}건으로 제한합니다.`);
    options.limit = DEFAULT_LIMIT;
  }
  return options;
}

function loadDotEnv(envPath = ".env") {
  const resolved = path.resolve(process.cwd(), envPath);
  if (!fs.existsSync(resolved)) {
    return;
  }
  const lines = fs.readFileSync(resolved, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((csvRow) => csvRow.some((value) => value.trim() !== ""));
  if (nonEmptyRows.length === 0) {
    return [];
  }

  const headers = nonEmptyRows[0].map((value) => value.trim());
  return nonEmptyRows.slice(1).map((csvRow, rowIndex) => {
    const item = { _rowNumber: rowIndex + 2 };
    headers.forEach((header, headerIndex) => {
      item[header] = (csvRow[headerIndex] || "").trim();
    });
    return item;
  });
}

function readInputRows(inputPath, limit) {
  const resolved = path.resolve(process.cwd(), inputPath);
  const text = fs.readFileSync(resolved, "utf8");
  const rows = parseCsv(text);
  return rows.slice(0, limit);
}

function maskSecret(value) {
  if (!value) {
    return "(missing)";
  }
  if (value.length <= 8) {
    return `${value.slice(0, 1)}***${value.slice(-1)}`;
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function normalizeCount(value) {
  if (Array.isArray(value)) {
    return value.length;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [value];
}

function getFirstDefined(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return "";
}

function getFieldItems(payload) {
  return asArray(payload?.landCharacteristicss?.field)
    .concat(asArray(payload?.landCharacteristicss?.fields))
    .concat(asArray(payload?.landCharacteristics?.field))
    .concat(asArray(payload?.landCharacteristics?.fields));
}

function getTotalCount(payload, items) {
  const possibleCounts = [
    payload?.response?.totalCount,
    payload?.landCharacteristicss?.totalCount,
    payload?.landCharacteristics?.totalCount
  ];
  for (const count of possibleCounts) {
    if (count !== undefined && count !== null && count !== "") {
      return normalizeCount(count);
    }
  }
  return items.length;
}

function extractResultCode(payload) {
  return getFirstDefined(payload?.response || payload?.landCharacteristicss || payload?.landCharacteristics || payload, [
    "resultCode",
    "resultCd",
    "errorCode"
  ]);
}

function extractResultMessage(payload) {
  return getFirstDefined(payload?.response || payload?.landCharacteristicss || payload?.landCharacteristics || payload, [
    "resultMsg",
    "resultMessage",
    "errorMsg",
    "message"
  ]);
}

function normalizeDateValue(value) {
  if (!value) {
    return 0;
  }
  const compact = String(value).replace(/[^0-9]/g, "");
  return Number.parseInt(compact || "0", 10);
}

function selectLatestCandidate(items, pnu, stdrYear) {
  const samePnuYear = items.filter((item) => {
    const itemPnu = String(getFirstDefined(item, ["pnu", "PNU"]));
    const itemYear = String(getFirstDefined(item, ["stdrYear", "STD_YEAR", "stdYear", "year"]));
    return (!itemPnu || itemPnu === pnu) && (!itemYear || itemYear === stdrYear);
  });
  const candidates = samePnuYear.length > 0 ? samePnuYear : items;
  return candidates
    .slice()
    .sort((a, b) => normalizeDateValue(getFirstDefined(b, ["lastUpdtDt", "lastUpdateDate", "last_updt_dt"])) - normalizeDateValue(getFirstDefined(a, ["lastUpdtDt", "lastUpdateDate", "last_updt_dt"])))
    .at(0);
}

function makeBaseResult(row, stdrYear, status, message) {
  return {
    case_id: row.case_id || "",
    land_id: row.land_id || "",
    pnu: row.pnu || "",
    parcel_address: row.parcel_address || "",
    status,
    public_standard_year: stdrYear,
    public_last_updated_at: "",
    public_data_source: "VWorld",
    land_category_public: "",
    land_area_public: "",
    zoning_public: "",
    zoning_secondary_public: "",
    land_use_status_public: "",
    terrain_height_public: "",
    terrain_shape_public: "",
    road_frontage_public: "",
    official_land_price_public: "",
    legal_dong_public: "",
    parcel_number_public: "",
    vworld_result_total_count: 0,
    vworld_duplicate_candidate_count: 0,
    review_status_code: status,
    message
  };
}

function normalizeCandidate(row, stdrYear, payload) {
  const items = getFieldItems(payload);
  const resultCode = extractResultCode(payload);
  const resultMessage = extractResultMessage(payload);
  const totalCount = getTotalCount(payload, items);

  if (resultCode) {
    const status = resultCode === "INCORRECT_KEY" ? INCORRECT_KEY_STATUS : FAILED_STATUS;
    return makeBaseResult(row, stdrYear, status, resultMessage || `VWorld resultCode=${resultCode}`);
  }

  if (totalCount === 0 || items.length === 0) {
    const noResult = makeBaseResult(row, stdrYear, NO_RESULT_STATUS, "조회는 성공했지만 해당 PNU/기준연도의 토지특성 결과가 없습니다. 기준연도 변경 또는 수동 검수가 필요합니다.");
    noResult.vworld_result_total_count = totalCount;
    return noResult;
  }

  const selected = selectLatestCandidate(items, row.pnu, stdrYear);
  const duplicateCount = items.filter((item) => {
    const itemPnu = String(getFirstDefined(item, ["pnu", "PNU"]));
    const itemYear = String(getFirstDefined(item, ["stdrYear", "STD_YEAR", "stdYear", "year"]));
    return (!itemPnu || itemPnu === row.pnu) && (!itemYear || itemYear === stdrYear);
  }).length;

  return {
    case_id: row.case_id || "",
    land_id: row.land_id || "",
    pnu: row.pnu || getFirstDefined(selected, ["pnu", "PNU"]),
    parcel_address: row.parcel_address || "",
    status: SUCCESS_STATUS,
    public_standard_year: getFirstDefined(selected, ["stdrYear", "STD_YEAR", "stdYear", "year"]) || stdrYear,
    public_last_updated_at: getFirstDefined(selected, ["lastUpdtDt", "lastUpdateDate", "last_updt_dt"]),
    public_data_source: "VWorld",
    land_category_public: getFirstDefined(selected, ["lndcgrCodeNm", "lndcgrNm", "landCategory", "jimok"]),
    land_area_public: getFirstDefined(selected, ["lndpclAr", "pclndAr", "landArea", "area"]),
    zoning_public: getFirstDefined(selected, ["prposArea1Nm", "prposAreaNm", "zoning", "useRegion"]),
    zoning_secondary_public: getFirstDefined(selected, ["prposArea2Nm", "zoningSecondary", "useRegion2"]),
    land_use_status_public: getFirstDefined(selected, ["ladUseSittnNm", "landUseSittnNm", "landUseStatus", "useSituation"]),
    terrain_height_public: getFirstDefined(selected, ["tpgrphHgCodeNm", "terrainHeight", "height"]),
    terrain_shape_public: getFirstDefined(selected, ["tpgrphFrmCodeNm", "terrainShape", "shape"]),
    road_frontage_public: getFirstDefined(selected, ["roadSideCodeNm", "roadFrontage", "road"]),
    official_land_price_public: getFirstDefined(selected, ["pblntfPclnd", "officialLandPrice", "price"]),
    legal_dong_public: getFirstDefined(selected, ["ldCodeNm", "legalDong", "dong"]),
    parcel_number_public: getFirstDefined(selected, ["mnnmSlno", "parcelNumber", "jibun"]),
    vworld_result_total_count: totalCount,
    vworld_duplicate_candidate_count: Math.max(0, duplicateCount - 1),
    review_status_code: duplicateCount > 1 ? "NEEDS_DUPLICATE_CANDIDATE_REVIEW" : "NEEDS_MANUAL_REVIEW",
    message: duplicateCount > 1
      ? "동일 PNU/기준연도 후보가 여러 건이므로 lastUpdtDt 최신값을 우선 반영했습니다. 수동 검수가 필요합니다."
      : "VWorld 조회값을 공적자료 검토 보조자료로 정규화했습니다. 평가서값을 자동 덮어쓰지 않습니다."
  };
}

async function requestVWorld(row, stdrYear, env) {
  const params = new URLSearchParams({
    key: env.apiKey,
    domain: env.domain,
    pnu: row.pnu,
    stdrYear,
    format: "json",
    numOfRows: DEFAULT_NUM_OF_ROWS,
    pageNo: DEFAULT_PAGE_NO
  });

  const response = await fetch(`${ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }
  return response.json();
}

function resolveRowYear(row, options, env) {
  return String(options.year || row.stdrYear || env.defaultYear || new Date().getFullYear());
}

function validatePnu(row, stdrYear) {
  if (!row.pnu) {
    return makeBaseResult(row, stdrYear, PNU_MISSING_STATUS, "PNU가 비어 있어 VWorld 조회를 건너뜁니다. 수동 검수가 필요합니다.");
  }
  if (!/^\d{19}$/.test(row.pnu)) {
    return makeBaseResult(row, stdrYear, PNU_INVALID_STATUS, "PNU는 19자리 숫자여야 합니다. 수동 검수가 필요합니다.");
  }
  return null;
}

function updateSummary(summary, status) {
  summary.total += 1;
  if (status === SUCCESS_STATUS) {
    summary.success += 1;
  } else if (status === NO_RESULT_STATUS) {
    summary.no_result += 1;
  } else if (status === PNU_MISSING_STATUS) {
    summary.pnu_missing += 1;
  } else if (status === PNU_INVALID_STATUS) {
    summary.pnu_invalid += 1;
  } else {
    summary.failed += 1;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeBatchId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `VWORLD_BATCH_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  loadDotEnv();

  const env = {
    apiKey: process.env.VWORLD_API_KEY || "",
    domain: process.env.VWORLD_DOMAIN || "",
    defaultYear: process.env.VWORLD_DEFAULT_YEAR || ""
  };
  if (!env.apiKey) {
    throw new Error("VWORLD_API_KEY가 필요합니다. .env 파일 또는 환경변수에 설정하세요.");
  }
  if (!env.domain) {
    throw new Error("VWORLD_DOMAIN이 필요합니다. .env 파일 또는 환경변수에 설정하세요.");
  }

  const rows = readInputRows(options.input, options.limit);
  const batchYear = String(options.year || env.defaultYear || new Date().getFullYear());
  const firstCaseId = rows.find((row) => row.case_id)?.case_id || "";
  const output = {
    case_id: firstCaseId,
    lookup_batch_id: makeBatchId(),
    source: "VWorld",
    stdrYear: batchYear,
    lookup_created_at: new Date().toISOString(),
    results: [],
    errors: [],
    summary: {
      total: 0,
      success: 0,
      no_result: 0,
      failed: 0,
      pnu_missing: 0,
      pnu_invalid: 0
    }
  };

  console.log(`VWorld batch lookup 시작: ${rows.length}건`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`API Key: ${maskSecret(env.apiKey)} / Domain: ${env.domain} / 기본 기준연도: ${batchYear}`);
  console.log("VWorld 조회값은 검토 보조자료이며 평가서값을 자동 덮어쓰지 않습니다.");

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const stdrYear = resolveRowYear(row, options, env);
    const prefix = `[${index + 1}/${rows.length}] ${row.land_id || `row-${row._rowNumber}`}`;
    const validationError = validatePnu(row, stdrYear);

    if (validationError) {
      output.results.push(validationError);
      output.errors.push({
        case_id: row.case_id || "",
        land_id: row.land_id || "",
        pnu: row.pnu || "",
        status: validationError.status,
        message: validationError.message
      });
      updateSummary(output.summary, validationError.status);
      console.log(`${prefix} ${validationError.status}: ${validationError.message}`);
      continue;
    }

    try {
      const payload = await requestVWorld(row, stdrYear, env);
      const normalized = normalizeCandidate(row, stdrYear, payload);
      output.results.push(normalized);
      if (normalized.status !== SUCCESS_STATUS) {
        output.errors.push({
          case_id: row.case_id || "",
          land_id: row.land_id || "",
          pnu: row.pnu || "",
          status: normalized.status,
          message: normalized.message
        });
      }
      updateSummary(output.summary, normalized.status);
      console.log(`${prefix} ${normalized.status}: ${normalized.message}`);
    } catch (error) {
      const failed = makeBaseResult(row, stdrYear, FAILED_STATUS, `VWorld 조회 실패: ${error.message}. 수동 검수가 필요합니다.`);
      output.results.push(failed);
      output.errors.push({
        case_id: row.case_id || "",
        land_id: row.land_id || "",
        pnu: row.pnu || "",
        status: FAILED_STATUS,
        message: failed.message
      });
      updateSummary(output.summary, FAILED_STATUS);
      console.log(`${prefix} ${FAILED_STATUS}: ${failed.message}`);
    }

    if (index < rows.length - 1 && options.delay > 0) {
      await sleep(options.delay);
    }
  }

  const outputPath = path.resolve(process.cwd(), options.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`완료: success=${output.summary.success}, no_result=${output.summary.no_result}, failed=${output.summary.failed}, pnu_missing=${output.summary.pnu_missing}, pnu_invalid=${output.summary.pnu_invalid}`);
  console.log(`결과 JSON: ${options.output}`);
}

run().catch((error) => {
  console.error(`실행 실패: ${error.message}`);
  process.exitCode = 1;
});
