// ==================== OFFLINE MANAGER ====================
// Responsabilidades:
//   1. Login offline: compara hash SHA-256 da senha (nunca texto puro)
//   2. Fila de ponto: salva registros no localStorage e sincroniza ao voltar online
//   3. Guard: bloqueia outras funções com aviso quando offline
// Segurança: credenciais armazenadas sem senha em texto; apenas hash irreversível.

const OfflineManager = {
  KEY_CRED:  'ccf_cred_v2',   // {usuario, pwdHash, userData, cachedAt}
  KEY_QUEUE: 'ccf_queue_v2',  // [{_oid, uid, tipo, data_hora, data}]
  CRED_TTL:  7 * 86400 * 1000, // 7 dias em ms

  _online: navigator.onLine,

  // ─── INIT ──────────────────────────────────────────────────────────────────
  init() {
    this._online = navigator.onLine;
    window.addEventListener('online',  () => this._onOnline());
    window.addEventListener('offline', () => this._onOffline());
    try {
      fbDb.ref('.info/connected').on('value', snap => {
        this._online = !!snap.val();
        this._updateBanner();
        if (this._online) this._syncQueue();
      });
    } catch (e) {}
    this._updateBanner();
  },

  // ─── STATUS ────────────────────────────────────────────────────────────────
  isOnline() { return this._online && navigator.onLine; },

  // ─── CREDENCIAIS (hash SHA-256 — sem texto puro) ───────────────────────────
  async cacheCredentials(usuario, senha, userData) {
    try {
      const pwdHash = await _sha256(senha);
      const record = {
        usuario,
        pwdHash,
        userData: _sanitizeUser(userData),
        cachedAt: Date.now()
      };
      localStorage.setItem(this.KEY_CRED, JSON.stringify(record));
    } catch (e) {}
  },

  async offlineLogin(usuario, senha) {
    try {
      const raw = localStorage.getItem(this.KEY_CRED);
      if (!raw) return null;
      const cred = JSON.parse(raw);
      if (cred.usuario !== usuario) return null;
      if (Date.now() - cred.cachedAt > this.CRED_TTL) {
        localStorage.removeItem(this.KEY_CRED);
        return null;
      }
      const hash = await _sha256(senha);
      if (hash !== cred.pwdHash) return null;
      return { user: cred.userData };
    } catch (e) { return null; }
  },

  hasCachedCredentials(usuario) {
    try {
      const raw = localStorage.getItem(this.KEY_CRED);
      if (!raw) return false;
      const cred = JSON.parse(raw);
      if (usuario && cred.usuario !== usuario) return false;
      return (Date.now() - cred.cachedAt) <= this.CRED_TTL;
    } catch (e) { return false; }
  },

  // Atualiza o hash da senha sem mexer nos outros dados (ex: após troca de senha)
  async updateCachedPassword(novaSenha) {
    try {
      const raw = localStorage.getItem(this.KEY_CRED);
      if (!raw) return;
      const cred = JSON.parse(raw);
      cred.pwdHash = await _sha256(novaSenha);
      cred.cachedAt = Date.now(); // renova TTL
      localStorage.setItem(this.KEY_CRED, JSON.stringify(cred));
    } catch (e) {}
  },

  clearCredentials() {
    localStorage.removeItem(this.KEY_CRED);
  },

  // ─── FILA DE PONTO ─────────────────────────────────────────────────────────
  addToQueue(record) {
    const q = this._queue();
    q.push({
      _oid: Date.now() + '_' + Math.random().toString(36).slice(2),
      uid:       record.uid,
      tipo:      record.tipo,
      data_hora: record.data_hora,
      data:      record.data || record.data_hora.slice(0, 10)
    });
    this._saveQueue(q);
  },

  getQueue() { return this._queue(); },

  getQueueForDate(date) {
    return this._queue().filter(r => r.data === date);
  },

  getPendingCount() { return this._queue().length; },

  // ─── SYNC ──────────────────────────────────────────────────────────────────
  async _syncQueue() {
    const q = this._queue();
    if (q.length === 0) return;
    const synced = [];
    for (const r of q) {
      try {
        const uid = r.uid || (typeof currentUser !== 'undefined' && currentUser?.id);
        if (!uid) continue;
        await fbDb.ref('registros/' + uid).push().set({
          tipo:      r.tipo,
          data_hora: r.data_hora,
          data:      r.data,
          ip_origem: 'offline-sync',
          created_at: r.data_hora
        });
        synced.push(r._oid);
      } catch (e) {}
    }
    if (synced.length > 0) {
      this._saveQueue(q.filter(r => !synced.includes(r._oid)));
      if (typeof toast === 'function')
        toast(`${synced.length} registro(s) de ponto sincronizado(s)!`, 'success');
      // Recarregar tela de ponto se estiver aberta
      if (typeof currentPage !== 'undefined' && currentPage === 'ponto' && typeof loadRegistrosPonto === 'function')
        loadRegistrosPonto();
    }
  },

  // ─── GUARD para funções que exigem conexão ─────────────────────────────────
  // Retorna true se OFFLINE (use para bloquear a chamada)
  offlineGuard(nomeFuncao) {
    if (this.isOnline()) return false;
    if (typeof toast === 'function')
      toast(`Você está offline. "${nomeFuncao}" requer conexão com a internet.`, 'warning');
    return true;
  },

  // ─── INTERNOS ──────────────────────────────────────────────────────────────
  _queue() {
    try { return JSON.parse(localStorage.getItem(this.KEY_QUEUE) || '[]'); }
    catch (e) { return []; }
  },

  _saveQueue(q) {
    localStorage.setItem(this.KEY_QUEUE, JSON.stringify(q));
  },

  _onOnline() {
    this._online = true;
    this._updateBanner();
    this._syncQueue();
  },

  _onOffline() {
    this._online = false;
    this._updateBanner();
  },

  _updateBanner() {
    const el = document.getElementById('offline-banner');
    if (!el) return;
    if (this.isOnline()) el.classList.add('hidden');
    else el.classList.remove('hidden');
  }
};

// ─── helpers (módulo-privados) ─────────────────────────────────────────────
async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _sanitizeUser(u) {
  // Armazena apenas o mínimo necessário para exibir UI — sem senha ou token
  return {
    id:                u.id   || u.uid || '',
    uid:               u.uid  || u.id  || '',
    nome:              u.nome || '',
    usuario:           u.usuario || '',
    role:              u.role || 'funcionario',
    cargo:             u.cargo || '',
    departamento:      u.departamento || '',
    perfil_horario_id: u.perfil_horario_id || null,
    abono_minutos:     u.abono_minutos || 0
  };
}
