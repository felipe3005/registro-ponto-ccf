// ==================== OFFLINE MANAGER ====================
const OfflineManager = {
  _isOnline: true,
  _checkInterval: null,
  _syncInProgress: false,
  CHECK_INTERVAL: 10000, // 10 segundos

  // ==================== INIT ====================
  init() {
    this._isOnline = navigator.onLine;
    window.addEventListener('online', () => this._onConnectivityChange());
    window.addEventListener('offline', () => this._onConnectivityChange());
    this._startHealthCheck();
    this._updateBanner();
  },

  isOnline() {
    return this._isOnline;
  },

  // ==================== CONNECTIVITY ====================
  async _checkHealth() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${API_BASE}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      const data = await res.json();
      return data.status === 'online';
    } catch {
      return false;
    }
  },

  _startHealthCheck() {
    this._checkInterval = setInterval(async () => {
      const wasOnline = this._isOnline;
      this._isOnline = await this._checkHealth();
      if (wasOnline !== this._isOnline) {
        this._onConnectivityChange();
      }
    }, this.CHECK_INTERVAL);
    // Check immediately
    this._checkHealth().then(online => {
      if (online !== this._isOnline) {
        this._isOnline = online;
        this._onConnectivityChange();
      }
    });
  },

  async _onConnectivityChange() {
    const nowOnline = navigator.onLine ? await this._checkHealth() : false;
    this._isOnline = nowOnline;
    this._updateBanner();

    if (nowOnline) {
      this._syncPendingRegistros();
    }
  },

  _updateBanner() {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;
    if (this._isOnline) {
      banner.classList.add('hidden');
    } else {
      banner.classList.remove('hidden');
    }
  },

  // ==================== CREDENTIAL CACHE ====================
  cacheCredentials(usuario, senha, user, token) {
    const cached = {
      usuario: usuario.toLowerCase().trim(),
      senhaHash: this._simpleHash(senha),
      user: user,
      token: token,
      cachedAt: new Date().toISOString()
    };
    localStorage.setItem('offline_credentials', JSON.stringify(cached));
  },

  offlineLogin(usuario, senha) {
    const cached = localStorage.getItem('offline_credentials');
    if (!cached) return null;

    const cred = JSON.parse(cached);
    if (cred.usuario === usuario.toLowerCase().trim() && cred.senhaHash === this._simpleHash(senha)) {
      return { token: cred.token, user: cred.user };
    }
    return null;
  },

  hasCachedCredentials() {
    return !!localStorage.getItem('offline_credentials');
  },

  clearCredentials() {
    localStorage.removeItem('offline_credentials');
  },

  // Simple hash for offline credential comparison (not for security, just local matching)
  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  },

  // ==================== PONTO QUEUE ====================
  getQueue() {
    const queue = localStorage.getItem('offline_ponto_queue');
    return queue ? JSON.parse(queue) : [];
  },

  _saveQueue(queue) {
    localStorage.setItem('offline_ponto_queue', JSON.stringify(queue));
  },

  addToQueue(registro) {
    const queue = this.getQueue();
    registro.offline_id = `off_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    registro.created_at = new Date().toISOString();
    queue.push(registro);
    this._saveQueue(queue);
    return registro;
  },

  getQueueForDate(date) {
    const queue = this.getQueue();
    return queue.filter(r => r.data_hora && r.data_hora.startsWith(date));
  },

  getLastQueuedType(date) {
    const dayQueue = this.getQueueForDate(date);
    if (dayQueue.length === 0) return null;
    return dayQueue[dayQueue.length - 1].tipo;
  },

  getPendingCount() {
    return this.getQueue().length;
  },

  // ==================== SYNC ====================
  async _syncPendingRegistros() {
    if (this._syncInProgress) return;
    const queue = this.getQueue();
    if (queue.length === 0) return;

    this._syncInProgress = true;
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        this._syncInProgress = false;
        return;
      }

      const res = await fetch(`${API_BASE}/ponto/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ registros: queue })
      });

      if (res.ok) {
        const data = await res.json();
        // Remove synced and duplicated items from queue, keep errors for retry
        const failedIds = data.resultados
          .filter(r => r.status === 'erro')
          .map(r => r.id);

        if (failedIds.length > 0) {
          const remaining = queue.filter(r => failedIds.includes(r.offline_id));
          this._saveQueue(remaining);
        } else {
          this._saveQueue([]);
        }

        const syncCount = data.resultados.filter(r => r.status === 'sincronizado').length;
        const dupCount = data.resultados.filter(r => r.status === 'duplicado').length;

        if (syncCount > 0) {
          if (typeof toast === 'function') {
            toast(`${syncCount} registro(s) sincronizado(s) com sucesso!`, 'success');
          }
        }
        if (dupCount > 0 && syncCount === 0) {
          // All were duplicates, clear anyway
          if (typeof toast === 'function') {
            toast('Registros offline ja estavam sincronizados.', 'info');
          }
        }
      }
    } catch (err) {
      console.error('Erro ao sincronizar registros offline:', err);
    } finally {
      this._syncInProgress = false;
    }
  },

  // Force sync (called from UI)
  async forceSync() {
    if (!this._isOnline) {
      if (typeof toast === 'function') {
        toast('Sem conexao com a internet. Tente novamente mais tarde.', 'error');
      }
      return;
    }
    await this._syncPendingRegistros();
  }
};
