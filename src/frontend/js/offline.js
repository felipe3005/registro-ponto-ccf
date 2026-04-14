// ==================== OFFLINE MANAGER (compat layer) ====================
// A RTDB do Firebase tem persistência offline nativa — registros feitos offline
// são enviados automaticamente quando a conexão volta. Este arquivo mantém
// a mesma API do sistema antigo para não quebrar app.js.

const OfflineManager = {
  _isOnline: true,
  _checkInterval: null,
  CHECK_INTERVAL: 15000,

  init() {
    this._isOnline = navigator.onLine;
    window.addEventListener('online', () => this._update());
    window.addEventListener('offline', () => this._update());
    // Escuta status de conexão da RTDB
    try {
      fbDb.ref('.info/connected').on('value', (snap) => {
        this._isOnline = !!snap.val();
        this._update();
      });
    } catch (e) {}
  },

  isOnline() { return this._isOnline && navigator.onLine; },
  hasCachedCredentials() { return false; },
  clearCredentials() { /* no-op */ },
  cacheCredentials() { /* no-op (Firebase gerencia sessão) */ },
  offlineLogin() { return null; },
  getQueue() { return []; },
  addToQueue() { /* RTDB já faz fila local */ },
  getQueueForDate() { return []; },
  getLastQueuedType() { return null; },
  getPendingCount() { return 0; },
  forceSync() { return Promise.resolve(); },

  _update() {
    const banner = document.getElementById('offline-banner');
    if (banner) {
      if (this.isOnline()) banner.classList.add('hidden');
      else banner.classList.remove('hidden');
    }
  }
};
