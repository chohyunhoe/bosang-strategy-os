import { validateCaseSnapshot } from './case-store.js';

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function text(value) { return value == null ? '' : String(value).trim(); }
const BACKUP_SCHEMA = 'bso-case-backup/1.0';
const PRIVATE_FIELD = /^(?:vworld_?api_?key|public_?data_?api_?key|api_?key|access_?token|refresh_?token|secret|password|pdf_?bytes|file_?bytes|array_?buffer|blob|base64|data_?url)$/i;

function safeBackupValue(value) {
  if (Array.isArray(value)) return value.map(safeBackupValue).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      if (PRIVATE_FIELD.test(key) || ['__proto__','prototype','constructor'].includes(key)) return;
      const safe = safeBackupValue(item);
      if (safe !== undefined) out[key] = safe;
    });
    return out;
  }
  if (typeof value === 'string' && (/^data:(?:application\/pdf|image\/)[^,]*;base64,/i.test(value)||/[?&](?:key|token|secret|credential)=/i.test(value))) return undefined;
  return value;
}

function fingerprintSnapshot(snapshot) {
  const copy = safeBackupValue(snapshot || {});
  delete copy.status; delete copy.route; delete copy.error; delete copy.capabilities;
  return copy;
}

export class SessionCaseRegistry {
  constructor(store, { maxCases = 12 } = {}) {
    this.store = store;
    this.maxCases = Math.max(2, Number(maxCases) || 12);
    this.entries = new Map();
    this.activeId = null;
    this.sequence = 0;
    this.suspended = false;
    this.lastSavedFingerprint = null;
    this.unsubscribe = store.subscribe(() => {
      if (!this.suspended && this.activeId) this.saveActive();
    });
  }

  assertIdle() {
    if (this.store.state.status === 'PROCESSING') throw new Error('평가서 처리 완료 후 사건을 변경하세요.');
  }

  nextId() {
    this.sequence += 1;
    return `SESSION_CASE_${String(this.sequence).padStart(3, '0')}`;
  }

  ensureActive() {
    if (this.activeId) return this.activeId;
    const id = this.nextId();
    this.activeId = id;
    this.saveActive();
    return id;
  }

  startNew() {
    this.assertIdle();
    if (this.entries.size >= this.maxCases) throw new Error('사건목록이 가득 찼습니다. 사건을 파일로 저장한 뒤 사용하지 않는 사건을 삭제하세요.');
    if (this.activeId) this.saveActive();
    const id = this.nextId();
    this.activeId = id;
    this.suspended = true;
    try {
      this.store.reset();
      this.store.state.caseInfo = { ...this.store.state.caseInfo, session_case_id: id };
    } finally {
      this.suspended = false;
    }
    this.saveActive();
    this.store.emit();
    this.enforceLimit();
    return id;
  }

  saveActive() {
    if (!this.activeId) return;
    const snapshot = this.store.snapshot();
    const current = this.entries.get(this.activeId);
    this.entries.set(this.activeId, {
      id: this.activeId,
      updated_at: new Date().toISOString(),
      created_at: current?.created_at || new Date().toISOString(),
      snapshot,
    });
  }

  switchTo(id) {
    this.assertIdle();
    if (!this.entries.has(id) || id === this.activeId) return false;
    if (this.activeId) this.saveActive();
    const entry = this.entries.get(id);
    this.suspended = true;
    try {
      this.activeId = id;
      this.store.restoreSnapshot(entry.snapshot);
    } finally {
      this.suspended = false;
    }
    return true;
  }

  remove(id) {
    this.assertIdle();
    if (!this.entries.has(id)) return false;
    this.entries.delete(id);
    if (this.activeId !== id) return true;
    this.activeId = null;
    const next = [...this.entries.keys()].at(-1);
    if (next) this.switchTo(next);
    else {
      this.suspended = true;
      try { this.store.reset(); } finally { this.suspended = false; }
      this.store.emit();
    }
    return true;
  }

  enforceLimit() {
    while (this.entries.size > this.maxCases) {
      const oldest = [...this.entries.values()]
        .filter((entry) => entry.id !== this.activeId)
        .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))[0];
      if (!oldest) break;
      this.entries.delete(oldest.id);
    }
  }

  list() {
    if (this.activeId) this.saveActive();
    return [...this.entries.values()]
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .map((entry) => {
        const state = entry.snapshot || {};
        const caseInfo = state.caseInfo || {};
        return {
          id: entry.id,
          active: entry.id === this.activeId,
          label: text(caseInfo.case_name || caseInfo.project_name) || state.sourceDocuments?.[0]?.file_name || state.documentWorkflow?.[0]?.title || '새 사건',
          documents: Array.isArray(state.sourceDocuments) ? state.sourceDocuments.length : 0,
          lands: Array.isArray(state.lands) ? state.lands.length : 0,
          review_pending: Array.isArray(state.reviewQueue) ? state.reviewQueue.filter((item) => item.status !== 'CONFIRMED').length : 0,
          updated_at: entry.updated_at,
        };
      });
  }

  fingerprint() {
    if (this.activeId) this.saveActive();
    return JSON.stringify({
      active_id:this.activeId,
      entries:[...this.entries.values()].map((entry)=>({id:entry.id,snapshot:fingerprintSnapshot(entry.snapshot)})),
    });
  }

  hasMeaningfulData() {
    if (this.activeId) this.saveActive();
    return [...this.entries.values()].some(({ snapshot = {} }) =>
      ['sourceDocuments','appraisals','lands','standardLands','transactionCases','appraisalResults','documentWorkflow'].some((key)=>Array.isArray(snapshot[key])&&snapshot[key].length)
      || (snapshot.reviewDecisions&&Object.keys(snapshot.reviewDecisions).length)
      || Boolean(snapshot.mapContext));
  }

  hasUnsavedWork() {
    if (!this.hasMeaningfulData()) return false;
    return this.lastSavedFingerprint !== this.fingerprint();
  }

  exportBundle() {
    if (this.activeId) this.saveActive();
    const bundle = {
      schema_version:BACKUP_SCHEMA,
      exported_at:new Date().toISOString(),
      privacy_notice:'주소, PNU, 평가금액 등 사건정보가 포함될 수 있습니다. 안전한 로컬 위치에 보관하세요.',
      source_files_included:false,
      api_keys_included:false,
      active_id:this.activeId,
      entries:[...this.entries.values()].map((entry)=>safeBackupValue(entry)),
    };
    this.lastSavedFingerprint = this.fingerprint();
    return bundle;
  }

  importBundle(bundle) {
    this.assertIdle();
    if (!bundle||bundle.schema_version!==BACKUP_SCHEMA||!Array.isArray(bundle.entries)||!bundle.entries.length) throw new Error('지원하지 않는 사건 백업 파일입니다.');
    if (bundle.entries.length>this.maxCases) throw new Error(`사건은 최대 ${this.maxCases}건까지 불러올 수 있습니다.`);
    const entries=new Map();let maxSequence=0;
    bundle.entries.forEach((source,index)=>{
      const rawId=text(source?.id);const id=/^SESSION_CASE_\d{3,}$/.test(rawId)?rawId:`SESSION_CASE_${String(index+1).padStart(3,'0')}`;
      const snapshot=safeBackupValue(source?.snapshot);
      if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new Error('사건 백업에 유효한 상태 정보가 없습니다.');
      if (entries.has(id)) throw new Error('백업 파일에 중복된 사건 ID가 있습니다.');
      validateCaseSnapshot(snapshot);
      // Validate derived queues before replacing any live case or registry entry.
      const validator = new this.store.constructor();
      validator.restoreSnapshot(snapshot);
      entries.set(id,{id,created_at:text(source.created_at)||new Date().toISOString(),updated_at:text(source.updated_at)||new Date().toISOString(),snapshot});
      maxSequence=Math.max(maxSequence,Number(id.match(/\d+$/)?.[0])||0);
    });
    this.entries=entries;this.sequence=maxSequence;
    this.activeId=entries.has(bundle.active_id)?bundle.active_id:[...entries.keys()][0];
    this.suspended=true;
    try{this.store.restoreSnapshot(entries.get(this.activeId).snapshot);}finally{this.suspended=false;}
    this.saveActive();this.lastSavedFingerprint=this.fingerprint();return this.list();
  }

  destroy() { this.unsubscribe?.(); }
}

export { BACKUP_SCHEMA };

