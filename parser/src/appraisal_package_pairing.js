'use strict';

const ROLE = Object.freeze({
  STATEMENT: 'STATEMENT',
  BASIS: 'BASIS',
  UNKNOWN: 'UNKNOWN',
});

function compact(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\.[Pp][Dd][Ff]$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function classifyDocumentRole(value) {
  const text = compact(value);
  if (/토지(?:평가)?조서/.test(text)) return ROLE.STATEMENT;
  if (/토지(?:가격|가액)산출근거/.test(text)) return ROLE.BASIS;
  return ROLE.UNKNOWN;
}

function extractDescriptor(value) {
  const text = String(value || '').normalize('NFKC').replace(/\.[Pp][Dd][Ff]$/g, '');
  const matches = [...text.matchAll(/[\(（]([^\)）]{3,220})[\)）]/g)];
  if (matches.length === 0) return null;
  const descriptor = matches[matches.length - 1][1]
    .split(',')
    .map((part) => compact(part))
    .filter(Boolean);
  if (descriptor.length < 2) return null;
  const companyHint = descriptor[descriptor.length - 1];
  const projectHint = descriptor.slice(0, -1).join(',');
  if (companyHint.length < 1 || projectHint.length < 2) return null;
  return { companyHint, projectHint };
}

function packageIdentity(document) {
  const source = document && (document.title || document.file_name || document.fileName || '');
  const role = classifyDocumentRole(source);
  const descriptor = extractDescriptor(source);
  if (role === ROLE.UNKNOWN || !descriptor) {
    return { role, pair_key: '', pairing_status: 'UNRESOLVED' };
  }
  return {
    role,
    pair_key: `PKG_${fnv1a(`${descriptor.projectHint}|${descriptor.companyHint}`)}`,
    pairing_status: 'IDENTIFIED',
  };
}

function pairAppraisalDocuments(documents = []) {
  if (!Array.isArray(documents)) throw new TypeError('documents must be an array');
  const grouped = new Map();
  const unresolved = [];

  documents.forEach((document, index) => {
    const identity = packageIdentity(document);
    const row = { input_index: index, role: identity.role };
    if (!identity.pair_key) {
      unresolved.push({ ...row, pairing_status: 'UNRESOLVED' });
      return;
    }
    if (!grouped.has(identity.pair_key)) grouped.set(identity.pair_key, []);
    grouped.get(identity.pair_key).push(row);
  });

  const packages = [...grouped.entries()].map(([pairKey, rows]) => {
    const statements = rows.filter((row) => row.role === ROLE.STATEMENT);
    const bases = rows.filter((row) => row.role === ROLE.BASIS);
    let status = 'INCOMPLETE';
    if (statements.length === 1 && bases.length === 1 && rows.length === 2) status = 'PAIR_READY';
    else if (statements.length > 1 || bases.length > 1 || rows.length > 2) status = 'AMBIGUOUS';
    return {
      pair_key: pairKey,
      pairing_status: status,
      documents: rows,
      auto_confirmed: false,
    };
  });

  return { packages, unresolved };
}

module.exports = {
  ROLE,
  classifyDocumentRole,
  packageIdentity,
  pairAppraisalDocuments,
};
