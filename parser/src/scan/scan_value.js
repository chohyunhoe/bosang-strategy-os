'use strict';

// 스캔 OCR 값의 fail-closed 정규화.
//
// Tesseract 는 괘선 표에서 소수점과 천단위 쉼표를 자주 떨어뜨린다.
//   1.10575 → "110575",  0.73 → "073",  0.526 → "0526"
// 그렇다고 아무 숫자나 소수점을 끼워 맞추면 요인값이 통째로 바뀐다. 그래서
// 열이 어떤 값을 담는 칸인지(도메인)를 먼저 정하고,
//   (1) 구분자가 그대로 살아 있으면 그 값을 쓰고,
//   (2) 없으면 도메인 안에 들어오는 해석이 "정확히 하나"일 때만 복원하며,
//   (3) 해석이 없거나 둘 이상이면 값을 만들지 않고 null 로 닫는다.
// 복원된 값은 항상 저신뢰로 표시해 자동확정되지 않게 한다.

// kind 로 읽는 방식을 나눈다.
//   'decimal'  소수점이 통째로 사라지는 칸(요인·시점수정). 자리별로 넣어 보고 유일할 때만 복원.
//   'grouped'  천단위 구분자만 있고 소수부가 없는 칸(단가·금액). 구분자를 떼고 숫자를 그대로 읽는다.
//              여기서 소수점을 끼워 넣으면 386.000(=386,000)이 386 으로 둔갑한다.
//   'measure'  면적. 천단위 구분자 + 선택적 소수부까지만 허용.
const DOMAINS = Object.freeze({
  factor: { min: 0.01, max: 3, kind: 'decimal' },
  time_correction: { min: 0.5, max: 5, kind: 'decimal' },
  other_factor: { min: 0.5, max: 30, kind: 'decimal' },
  price: { min: 100, max: 100000000, kind: 'grouped' },
  amount: { min: 1000, max: 100000000000000, kind: 'grouped' },
  area: { min: 0.1, max: 100000000, kind: 'measure' },
});

const GROUPED_PATTERN = /^\d{1,3}(?:[.,]\d{3})*$|^\d+$/;
const MEASURE_PATTERN = /^\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^\d+(?:\.\d+)?$/;

const CONFUSION_MAP = Object.freeze({ O: '0', o: '0', l: '1', I: '1', i: '1', S: '5', B: '8' });

function cleanNumericToken(raw) {
  return String(raw === undefined || raw === null ? '' : raw)
    .replace(/[\s ]/g, '')
    // 표 괘선이 글자로 잡힌 것들과 꼬리 구두점을 떼어 낸다.
    .replace(/[|｜ㅣlI!:;·・`'"\]\[){}]+/g, (match, offset, full) => (offset === 0 || offset + match.length === full.length ? '' : match))
    .replace(/^[,.]+|[,.]+$/g, '')
    .replace(/[OolISB]/g, (character) => CONFUSION_MAP[character] || character);
}

function inDomain(value, domain) {
  if (!Number.isFinite(value)) return false;
  return value >= domain.min && value <= domain.max;
}

// 구분자가 사라진 숫자열에 소수점을 한 자리씩 넣어 보고, 도메인에 들어오는 해석을 모은다.
function recoveredCandidates(digits, domain) {
  const found = new Set();
  const asInteger = Number(digits);
  if (inDomain(asInteger, domain)) found.add(asInteger);
  for (let cut = 1; cut < digits.length; cut += 1) {
    const value = Number(`${digits.slice(0, cut)}.${digits.slice(cut)}`);
    if (inDomain(value, domain)) found.add(value);
  }
  return [...found];
}

/**
 * @returns {{value: number|null, status: string, reason?: string, raw: string}}
 *   status: EXPLICIT | SEPARATOR_RECOVERED | UNREADABLE | AMBIGUOUS | OUT_OF_DOMAIN
 */
function readNumber(raw, domainName) {
  const domain = DOMAINS[domainName];
  if (!domain) throw new TypeError(`unknown scan value domain: ${domainName}`);
  const rawText = String(raw === undefined || raw === null ? '' : raw).trim();
  // 공백으로 갈라진 두 숫자를 하나로 붙이면 "1 40239" 가 140239 가 되어 값이 조용히 오염된다.
  // 여러 토큰이 섞인 칸은 여기서 닫고, 토큰별 해석은 readCellNumber 가 맡는다.
  const digitTokens = rawText.split(/\s+/).filter((part) => /\d/.test(part));
  if (digitTokens.length > 1) {
    return { value: null, status: 'UNREADABLE', reason: 'MULTI_TOKEN', raw: rawText };
  }
  const token = cleanNumericToken(digitTokens[0] !== undefined ? digitTokens[0] : rawText);
  if (!token || !/\d/.test(token)) {
    return { value: null, status: 'UNREADABLE', reason: 'NO_DIGITS', raw: rawText };
  }
  if (/[^\d.,]/.test(token)) {
    return { value: null, status: 'UNREADABLE', reason: 'NON_NUMERIC_GLYPH', raw: rawText };
  }

  if (domain.kind === 'grouped' || domain.kind === 'measure') {
    const pattern = domain.kind === 'grouped' ? GROUPED_PATTERN : MEASURE_PATTERN;
    if (!pattern.test(token)) {
      return { value: null, status: 'UNREADABLE', reason: 'MALFORMED_SEPARATORS', raw: rawText };
    }
    const value = domain.kind === 'grouped'
      ? Number(token.replace(/[.,]/g, ''))
      : Number(token.replace(/,/g, ''));
    if (!inDomain(value, domain)) {
      return { value: null, status: 'OUT_OF_DOMAIN', reason: `NOT_IN_${domainName.toUpperCase()}`, raw: rawText };
    }
    return { value, status: 'EXPLICIT', raw: rawText };
  }

  if (/^\d+\.\d+$/.test(token)) {
    const value = Number(token);
    if (inDomain(value, domain)) return { value, status: 'EXPLICIT', raw: rawText };
    return { value: null, status: 'OUT_OF_DOMAIN', reason: `NOT_IN_${domainName.toUpperCase()}`, raw: rawText };
  }

  const digits = token.replace(/[.,]/g, '');
  if (!/^\d+$/.test(digits)) {
    return { value: null, status: 'UNREADABLE', reason: 'MALFORMED_SEPARATORS', raw: rawText };
  }
  const candidates = recoveredCandidates(digits, domain);
  if (candidates.length === 1) {
    const wasPlain = digits === token;
    return {
      value: candidates[0],
      status: wasPlain && candidates[0] === Number(digits) ? 'EXPLICIT' : 'SEPARATOR_RECOVERED',
      raw: rawText,
    };
  }
  if (candidates.length === 0) {
    return { value: null, status: 'OUT_OF_DOMAIN', reason: `NO_READING_IN_${domainName.toUpperCase()}`, raw: rawText };
  }
  return { value: null, status: 'AMBIGUOUS', reason: `${candidates.length}_READINGS`, raw: rawText };
}

/**
 * 한 칸에 괘선 글자가 섞여 들어온다("BA 0.720", "[UE 1.00"). 칸 전체가 안 읽히면
 * 토큰별로 읽어 보고, 도메인에 맞는 해석이 정확히 하나일 때만 값을 준다.
 */
function readCellNumber(cellText, domainName) {
  const whole = readNumber(cellText, domainName);
  if (whole.value !== null) return whole;
  const tokens = String(cellText || '').split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return whole;
  const readings = tokens.map((token) => readNumber(token, domainName)).filter((result) => result.value !== null);
  const distinct = [...new Set(readings.map((result) => result.value))];
  if (distinct.length === 1) {
    const first = readings.find((result) => result.value === distinct[0]);
    return { value: distinct[0], status: first.status, raw: String(cellText || '') };
  }
  if (distinct.length === 0) return whole;
  return { value: null, status: 'AMBIGUOUS', reason: `${distinct.length}_TOKEN_READINGS`, raw: String(cellText || '') };
}

const LOT_PATTERN = /^(산)?(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/;

/**
 * 지번은 붙임표가 사라지거나("781") 산 표기가 깨지기 쉬우므로,
 * 명확히 지번 꼴일 때만 값을 준다. 781 → 78-1 같은 복원은 하지 않는다.
 */
function readLot(raw) {
  const rawText = String(raw === undefined || raw === null ? '' : raw).trim();
  const token = rawText.replace(/[\s ]/g, '').replace(/[|｜ㅣ]/g, '');
  const match = token.match(LOT_PATTERN);
  if (!match) return { value: null, status: 'UNREADABLE', reason: 'NOT_LOT_SHAPE', raw: rawText };
  const mountain = match[1] ? '산' : '';
  const value = match[3] ? `${mountain}${match[2]}-${match[3]}` : `${mountain}${match[2]}`;
  return { value, status: 'EXPLICIT', raw: rawText };
}

const STANDARD_SYMBOL_PATTERN = /^[A-Za-z가-힣]$/;

function readStandardSymbol(raw) {
  const rawText = String(raw === undefined || raw === null ? '' : raw).trim();
  const token = rawText.replace(/[\s|｜ㅣ.,:;]/g, '');
  if (STANDARD_SYMBOL_PATTERN.test(token)) return { value: token, status: 'EXPLICIT', raw: rawText };
  return { value: null, status: 'UNREADABLE', reason: 'NOT_SINGLE_SYMBOL', raw: rawText };
}

module.exports = {
  DOMAINS,
  cleanNumericToken,
  readCellNumber,
  readLot,
  readNumber,
  readStandardSymbol,
};
