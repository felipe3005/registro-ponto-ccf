// ==================== STATE ====================
let currentPage = 'dashboard';
let currentUser = null;
let clockInterval = null;
let funcPage = 1;
let funcTab = 'colaboradores'; // 'colaboradores' | 'administradores'
let _funcFotoFile = null;
let _funcFotoRemover = false;

function _previewFotoFunc(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('Imagem muito grande. Máximo 2 MB.', 'error'); input.value = ''; return; }
  _funcFotoFile = file;
  _funcFotoRemover = false;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('func-foto-preview');
    preview.innerHTML = `<img src="${e.target.result}" alt="preview">`;
    document.getElementById('btn-remover-foto').style.display = '';
  };
  reader.readAsDataURL(file);
}

function _removerFotoPreview() {
  _funcFotoFile = null;
  _funcFotoRemover = true;
  const nome = document.getElementById('func-nome').value;
  const preview = document.getElementById('func-foto-preview');
  preview.innerHTML = nome ? nome.charAt(0).toUpperCase() : '?';
  document.getElementById('btn-remover-foto').style.display = 'none';
  document.getElementById('func-foto-input').value = '';
}

function _setFotoPreview(fotoUrl, nome) {
  const preview = document.getElementById('func-foto-preview');
  if (fotoUrl) {
    preview.innerHTML = `<img src="${fotoUrl}" alt="foto">`;
    document.getElementById('btn-remover-foto').style.display = '';
  } else {
    preview.innerHTML = nome ? nome.charAt(0).toUpperCase() : '?';
    document.getElementById('btn-remover-foto').style.display = 'none';
  }
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  OfflineManager.init();
  setupUpdateListener();
  loadAppVersion();

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.pwd-toggle');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '🙈' : '👁';
    btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  });

  // Firebase Auth observa o estado de login e recupera sessão automaticamente
  fbAuth.onAuthStateChanged(async (fbUser) => {
    if (fbUser) {
      try {
        currentUser = await api.me();
        api.setUser(currentUser);
        showApp();
      } catch (err) {
        // Perfil ausente / usuário excluído
        await fbAuth.signOut();
        api.setUser(null);
        currentUser = null;
        showLogin();
      }
    } else {
      api.setUser(null);
      currentUser = null;
      showLogin();
    }
  });
});

// ==================== AUTH ====================
let pendingPasswordChange = null; // guarda senha temporaria para troca

// Esqueci minha senha
document.getElementById('link-esqueci-senha').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('esqueci-usuario').value = document.getElementById('login-usuario').value.trim();
  document.getElementById('esqueci-resultado').innerHTML = '';
  document.getElementById('btn-esqueci-enviar').disabled = false;
  document.getElementById('btn-esqueci-enviar').textContent = 'Enviar link';
  openModal('modal-esqueci-senha');
});

document.getElementById('form-esqueci-senha').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const usuario = document.getElementById('esqueci-usuario').value.trim().toLowerCase();
  const resultadoEl = document.getElementById('esqueci-resultado');
  const btn = document.getElementById('btn-esqueci-enviar');
  if (!usuario) return;
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  resultadoEl.innerHTML = '';
  try {
    const fn = firebase.app().functions('us-central1').httpsCallable('solicitarResetSenha');
    const res = await fn({ usuario });
    const d = res.data || {};
    const msg = d.emailMascara
      ? `✓ Link enviado para <strong>${d.emailMascara}</strong>. Verifique sua caixa de entrada e spam. O link expira em 30 minutos.`
      : (d.message || 'Se o usuário existir e tiver e-mail cadastrado, um link foi enviado.');
    resultadoEl.innerHTML = `<div style="background:#e7f5ea;color:#1e5a2b;padding:12px;border-radius:6px;font-size:13px;border-left:4px solid #2e7d32;">${msg}</div>`;
    btn.textContent = 'Enviado';
  } catch (err) {
    resultadoEl.innerHTML = `<div style="background:#fdecea;color:#a02622;padding:12px;border-radius:6px;font-size:13px;border-left:4px solid #d32f2f;">${(err && err.message) || 'Erro ao solicitar redefinição.'}</div>`;
    btn.disabled = false;
    btn.textContent = 'Enviar link';
  }
});

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario = document.getElementById('login-usuario').value.trim().toLowerCase();
  const senha = document.getElementById('login-senha').value;

  // Tentar login online primeiro
  try {
    const data = await api.login(usuario, senha);
    api.setToken(data.token);
    api.setUser(data.user);
    currentUser = data.user;
  
    // Cachear credenciais (hash SHA-256 — sem texto puro)
    await OfflineManager.cacheCredentials(usuario, senha, data.user);

    if (data.senhaTemporaria) {
      pendingPasswordChange = senha;
      document.getElementById('troca-senha-atual').value = senha;
      openModal('modal-trocar-senha');
      return;
    }
    showApp();
    toast('Login realizado com sucesso!', 'success');
    return;
  } catch (err) {
    const isCredError = err.message !== 'Failed to fetch'
      && !err.message.includes('NetworkError')
      && err.message !== 'Sessão expirada';
    if (isCredError) {
      // Credencial errada: limpar cache deste usuário se existir
      if (OfflineManager.hasCachedCredentials(usuario)) OfflineManager.clearCredentials();
      toast('Usuário ou senha incorretos. Se esqueceu sua senha, use "Esqueci minha senha".', 'error');
      return;
    }
  }

  // Sem rede: tentar login offline com hash armazenado
  const offlineResult = await OfflineManager.offlineLogin(usuario, senha);
  if (offlineResult) {
    api.setUser(offlineResult.user);
    currentUser = offlineResult.user;
    showApp();
    toast('Modo offline ativo. Apenas registro de ponto está disponível.', 'warning');
  } else {
    toast('Sem conexão. Faça login online ao menos uma vez para habilitar o modo offline.', 'error');
  }
});

// Troca de senha obrigatória
document.getElementById('btn-confirmar-troca-senha').addEventListener('click', async () => {
  const senhaAtual = document.getElementById('troca-senha-atual').value;
  const novaSenha = document.getElementById('troca-nova-senha').value;
  const confirmar = document.getElementById('troca-confirmar-senha').value;

  if (!novaSenha || novaSenha.length < 6) {
    toast('A nova senha deve ter pelo menos 6 caracteres', 'error');
    return;
  }
  if (novaSenha !== confirmar) {
    toast('As senhas não conferem', 'error');
    return;
  }
  if (novaSenha === senhaAtual) {
    toast('A nova senha deve ser diferente da atual', 'error');
    return;
  }

  try {
    await api.alterarSenha(senhaAtual, novaSenha);
    pendingPasswordChange = null;
    // Atualizar hash offline com a nova senha
    await OfflineManager.updateCachedPassword(novaSenha);
    closeModal('modal-trocar-senha');
    toast('Senha alterada com sucesso!', 'success');
    showApp();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('btn-logout').addEventListener('click', () => {
  api.logout().catch(() => {});
  api.setToken(null);
  api.setUser(null);
  currentUser = null;
  // Não limpar credenciais offline no logout para permitir re-login offline
  showLogin();
});

function showLogin() {
  document.getElementById('page-login').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  if (clockInterval) clearInterval(clockInterval);
  // Desanexar listeners RTDB para evitar leak entre sessões
  if (_holeriteRef) { _holeriteRef.off(); _holeriteRef = null; }
  if (_holeriteAdminRef) { _holeriteAdminRef.off(); _holeriteAdminRef = null; }
  if (_pendingCounterRef) { _pendingCounterRef.off(); _pendingCounterRef = null; }
  if (_ausenciaAbertaRef) { _ausenciaAbertaRef.off(); _ausenciaAbertaRef = null; }
  if (_ausenciaAdminRef) { _ausenciaAdminRef.off(); _ausenciaAdminRef = null; }
  // Para o alarme de almoço e seu timer
  if (_alarmeCheckInterval) { clearInterval(_alarmeCheckInterval); _alarmeCheckInterval = null; }
  _alarmePararSom();
}

function showApp() {
  document.getElementById('page-login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // Configurar sidebar
  document.getElementById('user-name').textContent = currentUser.nome;
  document.getElementById('user-role').textContent = currentUser.cargo || (currentUser.role === 'admin' ? 'Administrador' : '');
  const _sidebarAvatar = document.getElementById('user-avatar');
  if (currentUser.foto_url) {
    _sidebarAvatar.innerHTML = `<img src="${currentUser.foto_url}" alt="${currentUser.nome}" style="width:46px;height:46px;object-fit:cover;border-radius:50%;">`;
    _sidebarAvatar.style.background = 'transparent';
  } else {
    _sidebarAvatar.textContent = currentUser.nome.charAt(0).toUpperCase();
    _sidebarAvatar.style.background = '';
  }

  // Esconder links admin / funcionário
  if (currentUser.role !== 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    document.getElementById('nav-admin-section').classList.add('hidden');
    document.querySelectorAll('.func-only').forEach(el => el.classList.remove('hidden'));
    // Listener em tempo real para badge de holerites não lidos
    if (_holeriteRef) _holeriteRef.off();
    _holeriteRef = fbDb.ref(`holerites/${currentUser.id}`);
    _holeriteRef.on('value', snap => {
      const data = snap.val() || {};
      const naoLidos = Object.values(data).filter(h => !h.lido).length;
      _updateSidebarBadgeHolerite(naoLidos);
    });
    // Listener em tempo real para ausência em aberto (só colaborador)
    if (_ausenciaAbertaRef) _ausenciaAbertaRef.off();
    _ausenciaAbertaRef = fbDb.ref('saidas_intermediarias').orderByChild('funcionario_uid').equalTo(currentUser.id);
    _ausenciaAbertaRef.on('value', () => {
      if (currentPage === 'ponto') loadRegistrosPonto();
    });
    // Inicia o alarme de almoço (só colaborador)
    _alarmeIniciar();
  } else {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    document.getElementById('nav-admin-section').classList.remove('hidden');
    // Admin não bate ponto - esconder links de ponto e espelho pessoal
    document.querySelectorAll('.func-only').forEach(el => el.classList.add('hidden'));
    if (_holeriteRef) { _holeriteRef.off(); _holeriteRef = null; }
    if (_ausenciaAbertaRef) { _ausenciaAbertaRef.off(); _ausenciaAbertaRef = null; }
    // Listener em tempo real para badge de ausências pendentes (admin)
    if (_ausenciaAdminRef) _ausenciaAdminRef.off();
    _ausenciaAdminRef = fbDb.ref('saidas_intermediarias');
    _ausenciaAdminRef.on('value', snap => {
      let count = 0;
      snap.forEach(c => {
        const v = c.val();
        if (v.hora_retorno && (v.status === 'pendente' || v.status === 'aguardando_atestado')) count++;
      });
      _updateSidebarBadgeAusencias(count);
    });
  }

  // Nav events
  document.querySelectorAll('.sidebar-nav a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      navigateTo(page);
    });
  });

  populateMonthSelectors();
  // Colaborador cai em Registrar Ponto, admin cai em Dashboard
  if (currentUser.role === 'admin') {
    navigateTo('dashboard');
  } else {
    navigateTo('ponto');
  }
}

// ==================== NAVIGATION ====================
function navigateTo(page) {
  // Desanexar listener de ajustes pendentes ao sair da dashboard
  if (page !== 'dashboard' && _pendingCounterRef) {
    _pendingCounterRef.off();
    _pendingCounterRef = null;
  }
  // Desanexar listener de holerites ao sair da página admin
  if (page !== 'holerites-admin' && _holeriteAdminRef) {
    _holeriteAdminRef.off();
    _holeriteAdminRef = null;
  }
  // Nota: _ausenciaAdminRef permanece ativo em toda a sessão admin para o badge funcionar
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.getElementById(`page-${page}`).classList.remove('hidden');
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  const activeLink = document.querySelector(`[data-page="${page}"]`);
  if (activeLink) activeLink.classList.add('active');

  // Load page data
  switch (page) {
    case 'dashboard': loadDashboard(); break;
    case 'ponto': loadPonto(); break;
    case 'meu-espelho': loadEspelho(_espelhoFuncId); break;
    case 'funcionarios': loadFuncionarios(); break;
    case 'ajustes-admin': loadAjustesPendentes(); break;
    case 'horas-extras-admin': loadHorasExtrasPendentes(); break;
    case 'relatorios': break;
    case 'configuracoes': loadConfiguracoes(); break;
    case 'meus-ajustes': loadMeusAjustes(); break;
    case 'meus-abonos': loadMeusAbonos(); break;
    case 'abonos-admin': loadAbonosAdmin(); break;
    case 'holerites-admin': loadHoleritesAdmin(); break;
    case 'meu-holerite': loadMeuHolerite(); break;
    case 'ausencias-admin': loadAusenciasAdmin(); break;
    case 'minhas-ausencias': loadMinhasAusencias(); break;
    case 'ajuda': break; // estático, sem carga de dados
  }
}

// ─── Exibe aviso offline dentro de um container e dispara toast ──────────────
function _offlinePage(containerId, titulo) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `
    <div style="text-align:center;padding:48px 24px;color:#888;">
      <div style="font-size:40px;margin-bottom:12px;">📵</div>
      <h3 style="color:#555;margin:0 0 8px;">${titulo || 'Sem conexão'}</h3>
      <p style="font-size:14px;margin:0;">Esta função requer conexão com a internet.<br>
      Você pode <strong>registrar ponto</strong> normalmente no modo offline.</p>
    </div>`;
  toast('Você está offline. Esta função está indisponível.', 'warning');
  return true;
}

// ==================== CHARTS STATE ====================
let chartPresenca = null;
let chartDepartamentos = null;
let chartStatusHoje = null;
let _presencaStore = {};   // uid → dados do colaborador no Quadro de Presença
let _presencaDate  = null; // data do quadro (YYYY-MM-DD)
let _espelhoFuncId = null; // uid do colaborador sendo visualizado no espelho
let _ajusteContexto = 'dashboard'; // 'dashboard' | 'espelho'
let _espelhoCache = null;
let _espelhoSaldoCache = null;
let _pendingCounterRef = null;  // listener tempo real do contador de ajustes pendentes
let _holeriteRef = null;        // listener tempo real do badge de holerites (colaborador)
let _holeriteAdminRef = null;   // listener tempo real do painel de holerites (admin)
let _ausenciaAdminRef = null;   // listener tempo real do contador de ausências intermediárias (admin)
let _ausenciaAbertaRef = null;  // listener tempo real da ausência em aberto do colaborador

// ==================== DASHBOARD ====================
async function loadDashboard() {
  const hoje = new Date();
  document.getElementById('dashboard-date').textContent = formatDateBR(hoje);

  if (currentUser.role === 'admin') {
    document.getElementById('dashboard-admin').classList.remove('hidden');
    document.getElementById('dashboard-func').classList.add('hidden');
    if (!OfflineManager.isOnline()) { _offlinePage('dashboard-stats-admin', 'Dashboard indisponível offline'); return; }
    await loadDashboardAdmin();
  } else {
    document.getElementById('dashboard-admin').classList.add('hidden');
    document.getElementById('dashboard-func').classList.remove('hidden');
    if (!OfflineManager.isOnline()) { _offlinePage('dashboard-stats-func', 'Dashboard indisponível offline'); return; }
    await loadDashboardFunc(hoje);
  }
}

async function loadDashboardFunc(hoje) {
  const hojeISO = formatDateISO(hoje);
  const mes = hoje.getMonth() + 1;
  const ano = hoje.getFullYear();

  // Saudação imediata (sem API)
  _renderDashGreeting(hoje);

  try {
    const [registros, horas, banco, espelho, ajustes, abonos, feriados] = await Promise.all([
      api.registrosDia(hojeISO),
      api.horasTrabalhadas(hojeISO).catch(() => ({ totalFormatado: '00:00' })),
      api.saldoAcumuladoHoras().catch(() => null),
      api.espelhoPonto(mes, ano).catch(() => null),
      api.meusAjustes().catch(() => []),
      api.meusAbonos().catch(() => []),
      api.listarFeriados(ano).catch(() => []),
    ]);

    _renderDashTimeline(registros, horas);
    _renderDashResumoMes(espelho, hojeISO);
    _renderDashStats(banco, espelho, horas);
    _renderDashAlertas(ajustes, abonos);
    _renderDashFeriado(feriados, hojeISO);
  } catch (err) {
    console.error('Erro ao carregar dashboard:', err);
  }
}

function _updateSidebarBadgeAjustes(count) {
  const badge = document.getElementById('sidebar-badge-ajustes');
  if (!badge) return;
  if (count > 0) { badge.textContent = count; badge.style.display = 'inline-block'; }
  else { badge.style.display = 'none'; }
}

function _updateSidebarBadgeHolerite(count) {
  const badge = document.getElementById('sidebar-badge-holerite');
  if (!badge) return;
  if (count > 0) { badge.textContent = count; badge.style.display = 'inline-block'; }
  else { badge.style.display = 'none'; }
}

function _updateSidebarBadgeAusencias(count) {
  const badge = document.getElementById('sidebar-badge-ausencias');
  if (!badge) return;
  if (count > 0) { badge.textContent = count; badge.style.display = 'inline-block'; }
  else { badge.style.display = 'none'; }
}

function _renderDashGreeting(hoje) {
  const h = hoje.getHours();
  const turno = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const emoji = h < 12 ? '☀️' : h < 18 ? '🌤️' : '🌙';
  const nome = (currentUser?.nome || '').split(' ')[0] || 'colaborador';
  const dias = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const hh = String(h).padStart(2,'0');
  const mm = String(hoje.getMinutes()).padStart(2,'0');
  document.getElementById('dash-greeting').innerHTML = `
    <div class="dash-greeting">
      <div class="dash-greeting-left">
        <h2>${turno}, ${nome}! 👋</h2>
        <p>${dias[hoje.getDay()]}, ${formatDateBR(hoje)}</p>
      </div>
      <div class="dash-greeting-right">
        <div class="dash-hora">${hh}:${mm}</div>
        <div class="dash-turno">${emoji} ${turno}</div>
      </div>
    </div>`;
}

function _renderDashTimeline(registros, horas) {
  const tiposMap = {};
  registros.forEach(r => { tiposMap[r.tipo] = r.data_hora; });
  const steps = [
    { tipo: 'entrada',        label: 'Entrada',       icon: '▶' },
    { tipo: 'saida_almoco',   label: 'Saída Almoço',  icon: '🍽' },
    { tipo: 'retorno_almoco', label: 'Retorno',        icon: '↩' },
    { tipo: 'saida',          label: 'Saída',          icon: '■' },
  ];
  const nextIdx = steps.findIndex(s => !tiposMap[s.tipo]);
  const html = steps.map((s, i) => {
    const hora = tiposMap[s.tipo] ? tiposMap[s.tipo].substring(11,16) : null;
    const done = !!hora;
    const isNext = i === nextIdx;
    const dotCls = done ? 'tl-done' : isNext ? 'tl-next' : '';
    const stepCls = done ? 'tl-done' : '';
    return `<div class="timeline-step ${stepCls}">
      <div class="timeline-dot ${dotCls}">${done ? '✓' : s.icon}</div>
      <div class="tl-label">${s.label}</div>
      <div class="tl-time ${hora ? '' : 'tl-pending'}">${hora || '--:--'}</div>
    </div>`;
  }).join('');
  document.getElementById('dash-timeline').innerHTML = `<div class="dash-timeline">${html}</div>`;
  document.getElementById('dash-horas-hoje').textContent = horas.totalFormatado || '00:00';
}

function _renderDashResumoMes(espelho, hojeISO) {
  if (!espelho) {
    document.getElementById('dash-resumo-mes').innerHTML =
      '<div style="padding:20px;text-align:center;color:#aaa;">Dados indisponíveis</div>';
    return;
  }
  const dias = espelho.dias || [];
  const uteis = dias.filter(d => d.status !== 'fim_de_semana' && d.status !== 'feriado');
  const passados = uteis.filter(d => d.data <= hojeISO);
  const trabalhados = passados.filter(d => ['completa','extras','atestado','abono_horas'].includes(d.status)).length;
  const faltas = passados.filter(d => d.status === 'falta').length;
  const totalUteis = uteis.length;
  const pct = passados.length > 0 ? Math.round(trabalhados / passados.length * 100) : 0;
  const totalH = espelho.resumo?.totalTrabalhado || '00:00';

  const nomesMes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const nomeMes = nomesMes[(espelho.mes || 1) - 1];

  document.getElementById('dash-resumo-mes').innerHTML = `
    <div class="dash-mes-grid">
      <div class="dash-mes-item">
        <div class="dash-mes-val">${trabalhados}<span style="font-size:14px;color:#aaa;">/${passados.length}</span></div>
        <div class="dash-mes-label">Dias presentes em ${nomeMes}</div>
        <div class="dash-mes-bar-wrap"><div class="dash-mes-bar" style="width:${pct}%"></div></div>
      </div>
      <div class="dash-mes-item">
        <div class="dash-mes-val">${totalUteis}</div>
        <div class="dash-mes-label">Dias úteis no mês</div>
      </div>
      <div class="dash-mes-item">
        <div class="dash-mes-val ${faltas > 0 ? 'neg' : ''}">${faltas}</div>
        <div class="dash-mes-label">Falta${faltas !== 1 ? 's' : ''} no mês</div>
      </div>
      <div class="dash-mes-item">
        <div class="dash-mes-val" style="font-size:20px;">${totalH}</div>
        <div class="dash-mes-label">Total trabalhado</div>
      </div>
    </div>`;
}

function _renderDashStats(banco, espelho, horas) {
  let html = '';

  // Banco de horas — card principal
  if (banco) {
    const sinal = banco.saldoMinutos > 0 ? '+' : banco.saldoMinutos < 0 ? '-' : '';
    const icon = banco.saldoMinutos > 0 ? '&#128077;' : banco.saldoMinutos < 0 ? '&#128078;' : '&#128200;';
    const cor = banco.saldoMinutos > 0 ? 'green' : banco.saldoMinutos < 0 ? 'red' : 'blue';
    const cls = banco.saldoMinutos > 0 ? 'banco-pos' : banco.saldoMinutos < 0 ? 'banco-neg' : 'banco-zero';
    html += `<div class="stat-card ${cls}">
      <div class="stat-icon ${cor}">${icon}</div>
      <div class="stat-info"><h4>${sinal}${banco.saldoFormatado}</h4><p>Banco de Horas (acumulado)</p></div>
    </div>`;
  }

  // Horas hoje
  html += `<div class="stat-card">
    <div class="stat-icon blue">&#9201;</div>
    <div class="stat-info"><h4>${horas.totalFormatado || '00:00'}</h4><p>Horas Trabalhadas Hoje</p></div>
  </div>`;

  // Abono de tolerância
  const abonoMin = currentUser?.abono_minutos;
  if (abonoMin > 0) {
    html += `<div class="stat-card">
      <div class="stat-icon yellow">&#9989;</div>
      <div class="stat-info"><h4>${abonoMin} min</h4><p>Abono de Tolerância</p></div>
    </div>`;
  }

  // Perfil de horário
  const perfilId = currentUser?.perfil_horario_id;
  if (espelho?.funcionario?.hora_entrada || perfilId) {
    const f = espelho?.funcionario || {};
    const entrada = (f.hora_entrada || '').substring(0,5);
    const saida = (f.hora_saida || '').substring(0,5);
    if (entrada && saida) {
      html += `<div class="stat-card">
        <div class="stat-icon blue">&#128336;</div>
        <div class="stat-info"><h4 style="font-size:15px;">${entrada} – ${saida}</h4><p>Horário de Trabalho</p></div>
      </div>`;
    }
  }

  document.getElementById('dashboard-stats-func').innerHTML = html;
}

function _renderDashAlertas(ajustes, abonos) {
  const ajPend = (ajustes || []).filter(a => a.status === 'pendente').length;
  const abPend = (abonos || []).filter(a => a.status === 'pendente').length;
  let html = '';
  if (ajPend > 0) {
    html += `<div class="dash-alerta">⏳ <span><strong>${ajPend} ajuste${ajPend > 1 ? 's' : ''} de ponto</strong> aguardando aprovação do administrador.</span></div>`;
  }
  if (abPend > 0) {
    html += `<div class="dash-alerta">📋 <span><strong>${abPend} solicitação${abPend > 1 ? 'ões' : ''} de abono</strong> aguardando aprovação do administrador.</span></div>`;
  }
  document.getElementById('dash-alertas').innerHTML = html;
}

function _renderDashFeriado(feriados, hojeISO) {
  const prox = (feriados || [])
    .filter(f => f.data > hojeISO)
    .sort((a,b) => (a.data||'').localeCompare(b.data||''))[0];
  if (!prox) { document.getElementById('dash-feriado-prox').innerHTML = ''; return; }
  const partes = prox.data.split('-');
  const dataFmt = `${partes[2]}/${partes[1]}/${partes[0]}`;
  const diff = Math.round((new Date(prox.data+'T12:00:00') - new Date(hojeISO+'T12:00:00')) / 86400000);
  const quando = diff === 1 ? 'amanhã' : `em ${diff} dias`;
  document.getElementById('dash-feriado-prox').innerHTML =
    `<div class="dash-feriado">🌴 <span><strong>Próximo feriado:</strong> ${prox.descricao} — ${dataFmt} (${quando})</span></div>`;
}

async function loadDashboardAdmin() {
  try {
    const data = await api.dashboardAdmin();

    // ---- Stats cards ----
    document.getElementById('dashboard-stats-admin').innerHTML = `
      <div class="stat-card">
        <div class="stat-icon blue">&#128101;</div>
        <div class="stat-info"><h4>${data.totalFuncionarios}</h4><p>Colaboradores Ativos</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">&#9989;</div>
        <div class="stat-info"><h4>${data.presentesHoje}</h4><p>Presentes Hoje</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red">&#10060;</div>
        <div class="stat-info"><h4>${data.ausentesHoje}</h4><p>Ausentes Hoje</p></div>
      </div>
      <div class="stat-card" id="card-ajustes-pendentes" onclick="navigateTo('ajustes-admin')" style="cursor:pointer;" title="Ver ajustes pendentes">
        <div class="stat-icon yellow">&#128221;</div>
        <div class="stat-info"><h4 id="val-ajustes-pendentes">${data.ajustesPendentes}</h4><p>Ajustes Pendentes</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red">&#128683;</div>
        <div class="stat-info"><h4>${data.atrasados.length}</h4><p>Atrasados Hoje</p></div>
      </div>
    `;

    // ---- Contador de ajustes pendentes: query dedicada + listener em tempo real ----
    // Atualiza imediatamente com a mesma query da página de ajustes (garante consistência)
    api.ajustesPendentes().then(arr => {
      const el = document.getElementById('val-ajustes-pendentes');
      if (el) el.textContent = arr.length;
      _updateSidebarBadgeAjustes(arr.length);
    }).catch(() => {});

    // Listener em tempo real para manter atualizado enquanto na dashboard
    if (_pendingCounterRef) _pendingCounterRef.off();
    _pendingCounterRef = fbDb.ref('ajustes');
    _pendingCounterRef.on('value', snap => {
      let count = 0;
      snap.forEach(c => { if (c.val()?.status === 'pendente') count++; });
      const el = document.getElementById('val-ajustes-pendentes');
      if (el) el.textContent = count;
      _updateSidebarBadgeAjustes(count);
    });

    // ---- Gráfico: Presença diária ----
    if (chartPresenca) chartPresenca.destroy();
    const ctxPresenca = document.getElementById('chart-presenca').getContext('2d');
    chartPresenca = new Chart(ctxPresenca, {
      type: 'line',
      data: {
        labels: data.presencaDiaria.map(d => d.dia),
        datasets: [{
          label: 'Colaboradors presentes',
          data: data.presencaDiaria.map(d => d.presentes),
          borderColor: '#0D2C64',
          backgroundColor: 'rgba(13, 44, 100, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#0D2C64'
        }, {
          label: 'Total colaboradores',
          data: data.presencaDiaria.map(() => data.totalFuncionarios),
          borderColor: '#d1d5db',
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16 } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    });

    // ---- Gráfico: Horas por departamento ----
    if (chartDepartamentos) chartDepartamentos.destroy();
    const ctxDepto = document.getElementById('chart-departamentos').getContext('2d');
    const deptoColors = ['#0D2C64', '#01AEEF', '#3b8af2', '#062b5b', '#0d58ba', '#6ba7f5', '#b3d1fa', '#444444'];
    chartDepartamentos = new Chart(ctxDepto, {
      type: 'bar',
      data: {
        labels: data.horasPorDepartamento.map(d => d.departamento),
        datasets: [{
          label: 'Horas no mês',
          data: data.horasPorDepartamento.map(d => Math.round(d.totalMinutos / 60)),
          backgroundColor: data.horasPorDepartamento.map((_, i) => deptoColors[i % deptoColors.length] + 'cc'),
          borderColor: data.horasPorDepartamento.map((_, i) => deptoColors[i % deptoColors.length]),
          borderWidth: 1,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const d = data.horasPorDepartamento[ctx.dataIndex];
                return `${ctx.parsed.y}h (${d.totalFuncionarios} func.)`;
              }
            }
          }
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Horas' } }
        }
      }
    });

    // ---- Gráfico: Status de hoje (donut) ----
    if (chartStatusHoje) chartStatusHoje.destroy();
    const ctxStatus = document.getElementById('chart-status-hoje').getContext('2d');
    chartStatusHoje = new Chart(ctxStatus, {
      type: 'doughnut',
      data: {
        labels: ['Presentes', 'Ausentes', 'Atrasados'],
        datasets: [{
          data: [
            Math.max(0, data.presentesHoje - data.atrasados.length),
            data.ausentesHoje,
            data.atrasados.length
          ],
          backgroundColor: ['#01AEEF', '#e2eefd', '#ed3c0d'],
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16 } }
        }
      }
    });

    // ---- Atrasados ----
    if (data.atrasados.length === 0) {
      document.getElementById('admin-atrasados').innerHTML =
        '<div class="empty-state"><div class="empty-icon">&#128077;</div><p>Nenhum atraso hoje</p></div>';
    } else {
      document.getElementById('admin-atrasados').innerHTML = data.atrasados.map(a => `
        <div class="atrasado-item">
          <div>
            <div class="atrasado-nome">${a.nome}</div>
            <div class="atrasado-detalhe">Esperado: ${a.horaEsperada} &mdash; Chegou: ${a.horaEntrada}</div>
          </div>
          <div class="atrasado-tempo">+${a.atrasoMinutos} min</div>
        </div>
      `).join('');
    }

    // ---- Quadro de presença ----
    document.getElementById('admin-presenca-count').textContent =
      `${data.presentesHoje} de ${data.totalFuncionarios} presentes`;

    // Armazena dados para uso no modal de ajuste
    _presencaStore = {};
    _presencaDate  = formatDateISO(new Date());
    data.registrosHoje.forEach(f => { _presencaStore[f.uid] = f; });

    if (data.registrosHoje.length === 0) {
      document.getElementById('admin-presenca-body').innerHTML =
        '<tr><td colspan="9" class="text-center text-muted">Nenhum registro hoje</td></tr>';
    } else {
      document.getElementById('admin-presenca-body').innerHTML = data.registrosHoje.map(f => {
        const r = f.registros;
        let statusHtml = '';
        if (r.saida) {
          statusHtml = '<span class="status-dot gray"></span>Encerrado';
        } else if (r.retorno_almoco) {
          statusHtml = '<span class="status-dot green"></span>Trabalhando';
        } else if (r.saida_almoco) {
          statusHtml = '<span class="status-dot yellow"></span>Almo&ccedil;o';
        } else if (r.entrada) {
          statusHtml = '<span class="status-dot green"></span>Trabalhando';
        }

        return `<tr>
          <td><strong>${f.nome}</strong></td>
          <td>${f.cargo || '-'}</td>
          <td>${f.departamento || '-'}</td>
          <td>${r.entrada || '-'}</td>
          <td>${r.saida_almoco || '-'}</td>
          <td>${r.retorno_almoco || '-'}</td>
          <td>${r.saida || '-'}</td>
          <td>${statusHtml}</td>
          <td><button class="btn btn-sm btn-secondary" onclick="abrirAjustePontoAdmin('${f.uid}')">Ajustar</button></td>
        </tr>`;
      }).join('');
    }

  } catch (err) {
    console.error('Erro ao carregar dashboard admin:', err);
    toast('Erro ao carregar dashboard', 'error');
  }
}

// ─── Ajuste de ponto pelo admin (via Quadro de Presença) ─────────────────────
function abrirAjustePontoAdmin(uid) {
  const f = _presencaStore[uid];
  if (!f) { toast('Colaborador não encontrado', 'error'); return; }
  const r = f.registros || {};
  const dataFmt = _presencaDate
    ? _presencaDate.split('-').reverse().join('/')
    : '-';

  document.getElementById('ajuste-ponto-uid').value   = uid;
  document.getElementById('ajuste-ponto-data').value  = _presencaDate || '';
  document.getElementById('ajuste-ponto-nome').textContent = f.nome;
  document.getElementById('ajuste-data-label').textContent = dataFmt;
  document.getElementById('ajuste-entrada').value        = r.entrada        || '';
  document.getElementById('ajuste-saida-almoco').value   = r.saida_almoco   || '';
  document.getElementById('ajuste-retorno-almoco').value = r.retorno_almoco || '';
  document.getElementById('ajuste-saida').value          = r.saida          || '';
  _ajusteContexto = 'dashboard';
  openModal('modal-ajuste-ponto-admin');
}

// ─── Inserir ponto em dia de falta (via Espelho — admin visualizando colaborador) ─
function abrirInserirFalta(uid, data, nome) {
  const dataFmt = data.split('-').reverse().join('/');
  document.getElementById('ajuste-ponto-uid').value          = uid;
  document.getElementById('ajuste-ponto-data').value         = data;
  document.getElementById('ajuste-ponto-nome').textContent   = nome + ' — ' + dataFmt;
  document.getElementById('ajuste-data-label').textContent   = dataFmt;
  document.getElementById('ajuste-entrada').value            = '';
  document.getElementById('ajuste-saida-almoco').value       = '';
  document.getElementById('ajuste-retorno-almoco').value     = '';
  document.getElementById('ajuste-saida').value              = '';
  _ajusteContexto = 'espelho';
  openModal('modal-ajuste-ponto-admin');
}

document.getElementById('btn-salvar-ajuste-ponto').addEventListener('click', async () => {
  const uid  = document.getElementById('ajuste-ponto-uid').value;
  const data = document.getElementById('ajuste-ponto-data').value;
  if (!uid || !data) { toast('Dados inválidos', 'error'); return; }

  const ajustes = {
    entrada:        document.getElementById('ajuste-entrada').value,
    saida_almoco:   document.getElementById('ajuste-saida-almoco').value,
    retorno_almoco: document.getElementById('ajuste-retorno-almoco').value,
    saida:          document.getElementById('ajuste-saida').value
  };

  // Detectar registros que existiam no modal e ficaram vazios (serão apagados)
  try {
    const regsAtuais = await api.registrosDia(data, uid);
    const tiposExistentes = new Set(regsAtuais.map(r => r.tipo));
    const apagar = Object.keys(ajustes).filter(tipo => tiposExistentes.has(tipo) && !ajustes[tipo]);
    if (apagar.length > 0) {
      const labels = { entrada: 'Entrada', saida_almoco: 'Saída Almoço', retorno_almoco: 'Retorno Almoço', saida: 'Saída' };
      const lista = apagar.map(t => labels[t] || t).join(', ');
      const okApagar = await showConfirm(`Os seguintes registros serão APAGADOS (campo em branco):\n\n${lista}`, { title: '⚠️ Confirmar exclusão', okText: 'Apagar', variant: 'danger' });
      if (!okApagar) return;
    }
  } catch (e) { /* segue mesmo se não conseguir checar */ }

  const btn = document.getElementById('btn-salvar-ajuste-ponto');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    await api.ajustarPontoAdmin(uid, data, ajustes);
    closeModal('modal-ajuste-ponto-admin');
    toast('Ponto inserido com sucesso!', 'success');
    if (_ajusteContexto === 'espelho') {
      loadEspelho(_espelhoFuncId);
    } else {
      loadDashboardAdmin();
    }
  } catch (err) {
    toast(err.message || 'Erro ao ajustar ponto', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar Ajuste';
  }
});

// ==================== PONTO ====================
function loadPonto() {
  updateClock();
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(updateClock, 1000);
  loadRegistrosPonto();
}

function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  document.getElementById('date-display').textContent = formatDateBRFull(now);
}

const ALMOCO_MINIMO_MINUTOS = 60;
let almocoLockInterval = null;

function aplicarTravaAlmoco(btn, info, proximoTipo, saidaAlmocoTs, labelRegistro, sufixoInfo) {
  // Limpa interval anterior
  if (almocoLockInterval) { clearInterval(almocoLockInterval); almocoLockInterval = null; }
  if (proximoTipo !== 'retorno_almoco' || !saidaAlmocoTs) return false;

  const saidaMs = new Date(saidaAlmocoTs).getTime();
  const liberaMs = saidaMs + ALMOCO_MINIMO_MINUTOS * 60 * 1000;

  function atualizar() {
    const agora = Date.now();
    const restanteMs = liberaMs - agora;
    if (restanteMs <= 0) {
      btn.disabled = false;
      btn.textContent = labelRegistro;
      info.textContent = `Próximo registro: retorno almoço${sufixoInfo}`;
      if (almocoLockInterval) { clearInterval(almocoLockInterval); almocoLockInterval = null; }
      return;
    }
    const totalSeg = Math.ceil(restanteMs / 1000);
    const min = Math.floor(totalSeg / 60);
    const seg = totalSeg % 60;
    btn.disabled = true;
    btn.textContent = `Aguarde ${pad(min)}:${pad(seg)} para retornar do almoço`;
    info.textContent = `🍽️ Almoço mínimo de ${ALMOCO_MINIMO_MINUTOS} minutos. Liberação em ${pad(min)}:${pad(seg)}${sufixoInfo}`;
  }

  atualizar();
  almocoLockInterval = setInterval(atualizar, 1000);
  return true;
}

async function loadRegistrosPonto() {
  const ORDEM_TIPOS = ['entrada', 'saida_almoco', 'retorno_almoco', 'saida'];
  const labels = {
    'entrada': 'Registrar Entrada',
    'saida_almoco': 'Registrar Saída Almoço',
    'retorno_almoco': 'Registrar Retorno Almoço',
    'saida': 'Registrar Saída'
  };
  const btn = document.getElementById('btn-registrar-ponto');
  const info = document.getElementById('ponto-tipo-info');
  const hoje = formatDateISO(new Date());

  // Renderiza seção de saída intermediária (e ausências do dia) em paralelo
  _renderSaidaIntermediariaPonto().catch(() => {});

  // Registros offline pendentes do dia
  const offlineHoje = OfflineManager.getQueueForDate(hoje);

  if (OfflineManager.isOnline()) {
    try {
      const feriadoHoje = await api.verificarFeriado(hoje);
      if (feriadoHoje) {
        btn.className = 'btn-ponto';
        btn.textContent = '🌴 Feriado';
        btn.disabled = true;
        info.textContent = `Hoje é feriado: ${feriadoHoje.descricao || 'Feriado'}. Registro de ponto bloqueado.`;
        document.getElementById('ponto-registros-hoje').innerHTML =
          `<div class="alert alert-info" style="margin-top:12px;text-align:center;">🌴 <strong>${feriadoHoje.descricao || 'Feriado'}</strong> — Registro de ponto indisponível neste dia.</div>`;
        return;
      }
      const data = await api.ultimoRegistro();
      console.log('Último registro do servidor:', data);
      // Merge: tipos do servidor + tipos da fila offline
      const tiposRegistrados = [];
      if (data.ultimoRegistro) {
        // Pegar todos registros do servidor
        const registrosServidor = await api.registrosDia(hoje);
        registrosServidor.forEach(r => tiposRegistrados.push(r.tipo));
      }
      offlineHoje.forEach(r => {
        if (!tiposRegistrados.includes(r.tipo)) tiposRegistrados.push(r.tipo);
      });

      const tiposSet = new Set(tiposRegistrados);
      const proximoTipo = ORDEM_TIPOS.find(t => !tiposSet.has(t)) || null;

      btn.className = 'btn-ponto';
      if (!proximoTipo) {
        btn.textContent = 'Todos os registros feitos';
        btn.disabled = true;
        info.textContent = 'Você já registrou todos os pontos de hoje.';
      } else {
        btn.textContent = labels[proximoTipo];
        btn.disabled = false;
        btn.classList.add(proximoTipo);
        info.textContent = `Próximo registro: ${proximoTipo.replace(/_/g, ' ')}`;

        // Trava de 1h de almoço (busca saida_almoco do servidor ou fila offline)
        let saidaAlmocoTs = data.saidaAlmoco || null;
        if (!saidaAlmocoTs) {
          const off = offlineHoje.find(r => r.tipo === 'saida_almoco');
          if (off) saidaAlmocoTs = off.data_hora;
        }
        aplicarTravaAlmoco(btn, info, proximoTipo, saidaAlmocoTs, labels[proximoTipo], '');
      }

      // Registros do dia (servidor + offline)
      const registros = await api.registrosDia(hoje);
      // Adicionar registros offline que ainda não estão no servidor
      offlineHoje.forEach(offReg => {
        const exists = registros.some(r => r.tipo === offReg.tipo);
        if (!exists) {
          registros.push({ tipo: offReg.tipo, data_hora: offReg.data_hora, _offline: true });
        }
      });
      document.getElementById('ponto-registros-hoje').innerHTML = renderRegistrosDia(registros);

      // Mostrar alerta de registros pendentes
      const pendingCount = OfflineManager.getPendingCount();
      if (pendingCount > 0) {
        info.textContent += ` | ${pendingCount} registro(s) pendente(s) de sincronização`;
      }
      return;
    } catch (err) {
      console.error('Erro ao carregar ponto:', err);
    }
  }

  // Modo offline: mostrar só os registros da fila local
  const tiposOfflineSet = new Set(offlineHoje.map(r => r.tipo));
  const proximoTipo = ORDEM_TIPOS.find(t => !tiposOfflineSet.has(t)) || null;

  btn.className = 'btn-ponto';
  if (!proximoTipo) {
    btn.textContent = 'Todos os registros feitos';
    btn.disabled = true;
    info.textContent = 'Todos os pontos de hoje registrados (offline).';
  } else {
    btn.textContent = labels[proximoTipo];
    btn.disabled = false;
    btn.classList.add(proximoTipo);
    info.textContent = `Próximo registro: ${proximoTipo.replace(/_/g, ' ')} (offline)`;

    // Trava de 1h de almoço no modo offline
    const offSaida = offlineHoje.find(r => r.tipo === 'saida_almoco');
    if (offSaida) {
      aplicarTravaAlmoco(btn, info, proximoTipo, offSaida.data_hora, labels[proximoTipo], ' (offline)');
    }
  }

  // Renderizar registros offline
  const registros = offlineHoje.map(r => ({ tipo: r.tipo, data_hora: r.data_hora, _offline: true }));
  document.getElementById('ponto-registros-hoje').innerHTML = renderRegistrosDia(registros);

  const pendingCount = OfflineManager.getPendingCount();
  if (pendingCount > 0) {
    info.textContent += ` | ${pendingCount} registro(s) aguardando sincronização`;
  }
}

document.getElementById('btn-registrar-ponto').addEventListener('click', async () => {
  // Se online, tentar normalmente
  if (OfflineManager.isOnline()) {
    try {
      const result = await api.registrarPonto();
      toast(result.message, 'success');
      loadRegistrosPonto();
      return;
    } catch (err) {
      // Se falhou por problemas de rede, cai no modo offline
      if (!OfflineManager.isOnline()) {
        // continua abaixo para salvar offline
      } else {
        toast(err.message, 'error');
        return;
      }
    }
  }

  // Modo offline: usar apenas fila local
  const ORDEM_TIPOS = ['entrada', 'saida_almoco', 'retorno_almoco', 'saida'];
  const hoje = formatDateISO(new Date());
  const agora = new Date();
  const offlineHoje = OfflineManager.getQueueForDate(hoje);

  const tiposHojeSet = new Set(offlineHoje.map(r => r.tipo));
  const proximoTipo = ORDEM_TIPOS.find(t => !tiposHojeSet.has(t)) || null;
  if (!proximoTipo) {
    toast('Todos os registros do dia já foram feitos', 'error');
    return;
  }

  // Trava: retorno do almoço só após 1h
  if (proximoTipo === 'retorno_almoco') {
    const saidaOff = offlineHoje.find(r => r.tipo === 'saida_almoco');
    if (saidaOff) {
      const diffMin = Math.floor((agora.getTime() - new Date(saidaOff.data_hora).getTime()) / 60000);
      if (diffMin < ALMOCO_MINIMO_MINUTOS) {
        toast(`Almoço mínimo de ${ALMOCO_MINIMO_MINUTOS} minutos. Aguarde mais ${ALMOCO_MINIMO_MINUTOS - diffMin} min.`, 'error');
        return;
      }
    }
  }

  const pad = n => String(n).padStart(2, '0');
  const dataHora = `${agora.getFullYear()}-${pad(agora.getMonth()+1)}-${pad(agora.getDate())}T${pad(agora.getHours())}:${pad(agora.getMinutes())}:${pad(agora.getSeconds())}`;
  OfflineManager.addToQueue({
    uid:       currentUser.id || currentUser.uid,
    tipo:      proximoTipo,
    data_hora: dataHora,
    data:      hoje
  });

  const labels = { entrada: 'Entrada', saida_almoco: 'Saída Almoço', retorno_almoco: 'Retorno Almoço', saida: 'Saída' };
  toast(`${labels[proximoTipo]} registrada offline! Será sincronizada quando a conexão voltar.`, 'warning');
  loadRegistrosPonto();
});

function renderRegistrosDia(registros) {
  const tipos = {
    'entrada': { label: 'Entrada', icon: '&#x2600;' },
    'saida_almoco': { label: 'Saída Almoço', icon: '&#127860;' },
    'retorno_almoco': { label: 'Retorno Almoço', icon: '&#9749;' },
    'saida': { label: 'Saída', icon: '&#127769;' }
  };

  const regs = {};
  registros.forEach(r => { regs[r.tipo] = r; });

  return `<div class="registros-hoje">
    ${Object.entries(tipos).map(([tipo, info]) => {
      const reg = regs[tipo];
      const hora = reg ? new Date(reg.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
      const offlineTag = reg && reg._offline ? ' <span class="badge badge-warning" style="font-size:10px;">offline</span>' : '';
      return `<div class="registro-item">
        <div class="label">${info.icon} ${info.label}</div>
        <div class="hora ${reg ? '' : 'pending'}">${hora}${offlineTag}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// ==================== SAÍDA INTERMEDIÁRIA ====================
const AUSENCIA_STATUS_LABEL = {
  pendente: { label: '⏳ Pendente', cls: 'badge-warning' },
  abonado: { label: '✓ Abonada', cls: 'badge-success' },
  descontar: { label: '✕ Descontada', cls: 'badge-danger' },
  usar_banco: { label: '↻ Usa banco', cls: 'badge-info' },
  aguardando_atestado: { label: '📎 Aguarda atestado', cls: 'badge-warning' }
};

async function _renderSaidaIntermediariaPonto() {
  const wrap = document.getElementById('ponto-saida-intermediaria-wrap');
  const listWrap = document.getElementById('ponto-ausencias-hoje');
  if (!wrap) return;

  if (!OfflineManager.isOnline()) {
    wrap.innerHTML = '';
    if (listWrap) listWrap.innerHTML = '';
    return;
  }

  try {
    const aberta = await api.saidaIntermediariaAberta();
    const hoje = formatDateISO(new Date());
    const regs = await api.registrosDia(hoje);
    const tipos = new Set(regs.map(r => r.tipo));

    // Só mostrar botão de saída se estiver "trabalhando"
    // Trabalhando = entrada sim, saida não, e não está no almoço
    const trabalhando = tipos.has('entrada') && !tipos.has('saida')
      && !(tipos.has('saida_almoco') && !tipos.has('retorno_almoco'));

    if (aberta) {
      const desde = aberta.hora_saida;
      wrap.innerHTML = `
        <div style="background:#fff4e5;border-left:4px solid #ff9800;padding:12px 14px;border-radius:6px;margin-bottom:10px;">
          <div style="font-size:13px;color:#7a4a00;margin-bottom:8px;">
            🚶 Você está fora desde <strong>${desde}</strong> — motivo: <em>${aberta.motivo}</em>
          </div>
          <button class="btn btn-sm btn-primary" id="btn-registrar-retorno-intermediario" data-id="${aberta.id}">↩ Registrar Retorno</button>
        </div>`;
      const btn = document.getElementById('btn-registrar-retorno-intermediario');
      btn.addEventListener('click', () => _registrarRetornoIntermediario(aberta.id));
    } else if (trabalhando) {
      wrap.innerHTML = `
        <button class="btn btn-sm btn-secondary" id="btn-abrir-saida-intermediaria" style="width:100%;padding:10px;">
          🚶 Registrar Saída Intermediária (compromisso)
        </button>`;
      document.getElementById('btn-abrir-saida-intermediaria').addEventListener('click', _abrirModalSaidaIntermediaria);
    } else {
      wrap.innerHTML = '';
    }

    // Listar ausências do dia
    const minhas = await api.minhasSaidasIntermediarias();
    const hojeList = minhas.filter(a => a.data === hoje);
    if (listWrap) {
      if (hojeList.length === 0) {
        listWrap.innerHTML = '';
      } else {
        listWrap.innerHTML = `
          <div class="card" style="padding:14px;">
            <h4 style="margin:0 0 10px;font-size:14px;color:#555;">Saídas intermediárias de hoje</h4>
            ${hojeList.map(a => {
              const s = AUSENCIA_STATUS_LABEL[a.status] || { label: a.status, cls: 'badge-gray' };
              const dur = a.minutos
                ? `${Math.floor(a.minutos/60) > 0 ? Math.floor(a.minutos/60)+'h' : ''}${a.minutos%60}min`
                : 'em andamento';
              return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:13px;">
                <span><strong>${a.hora_saida}</strong> → <strong>${a.hora_retorno || '--:--'}</strong> · ${a.motivo}</span>
                <span><span class="badge ${s.cls}" style="font-size:11px;">${s.label}</span> <span style="color:#888;margin-left:6px;">${dur}</span></span>
              </div>`;
            }).join('')}
          </div>`;
      }
    }
  } catch (err) {
    console.error('Erro ao renderizar saída intermediária:', err);
    wrap.innerHTML = '';
  }
}

function _abrirModalSaidaIntermediaria() {
  document.getElementById('saida-interm-motivo').value = '';
  openModal('modal-saida-intermediaria');
  setTimeout(() => document.getElementById('saida-interm-motivo').focus(), 100);
}

document.getElementById('btn-confirmar-saida-intermediaria').addEventListener('click', async () => {
  const motivo = document.getElementById('saida-interm-motivo').value.trim();
  if (!motivo) { toast('Informe o motivo', 'error'); return; }
  const btn = document.getElementById('btn-confirmar-saida-intermediaria');
  btn.disabled = true; btn.textContent = 'Registrando...';
  try {
    const res = await api.registrarSaidaIntermediaria(motivo);
    toast(`Saída registrada às ${res.hora_saida}. Boa ida!`, 'success');
    closeModal('modal-saida-intermediaria');
    loadRegistrosPonto();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar Saída';
  }
});

async function _registrarRetornoIntermediario(id) {
  const ok = await showConfirm('Confirmar retorno do compromisso agora?', { title: '↩ Registrar Retorno', okText: 'Confirmar' });
  if (!ok) return;
  try {
    const res = await api.registrarRetornoIntermediario(id);
    const dur = `${Math.floor(res.minutos/60) > 0 ? Math.floor(res.minutos/60)+'h' : ''}${res.minutos%60}min`;
    toast(`Retorno registrado às ${res.hora_retorno} (${dur} de ausência).`, 'success');
    loadRegistrosPonto();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadMinhasAusencias() {
  if (!OfflineManager.isOnline()) { _offlinePage('minhas-ausencias-body', 'Saídas indisponível offline'); return; }
  try {
    const lista = await api.minhasSaidasIntermediarias();
    const tbody = document.getElementById('minhas-ausencias-body');
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Nenhuma saída intermediária registrada.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(a => {
      const s = AUSENCIA_STATUS_LABEL[a.status] || { label: a.status, cls: 'badge-gray' };
      const dataFmt = a.data.split('-').reverse().join('/');
      const dur = a.minutos
        ? `${Math.floor(a.minutos/60) > 0 ? Math.floor(a.minutos/60)+'h' : ''}${a.minutos%60}min`
        : '—';
      return `<tr>
        <td>${dataFmt}</td>
        <td>${a.hora_saida}</td>
        <td>${a.hora_retorno || '<em style="color:#999;">em andamento</em>'}</td>
        <td>${dur}</td>
        <td>${a.motivo}</td>
        <td><span class="badge ${s.cls}">${s.label}</span>${a.observacao ? `<br><small class="text-muted">${a.observacao}</small>` : ''}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ==================== AUSÊNCIAS ADMIN ====================
async function loadAusenciasAdmin() {
  if (!OfflineManager.isOnline()) { _offlinePage('ausencias-admin-body', 'Ausências indisponível offline'); return; }
  const tbody = document.getElementById('ausencias-admin-body');
  tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Carregando...</td></tr>';
  try {
    const filtro = document.getElementById('ausencias-filtro-status').value;
    let lista = await api.todasSaidasIntermediarias();
    if (filtro === 'em_aberto') {
      lista = lista.filter(a => !a.hora_retorno);
    } else if (filtro) {
      lista = lista.filter(a => a.hora_retorno && a.status === filtro);
    }

    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Nenhuma ausência nesta classificação.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(a => {
      const s = AUSENCIA_STATUS_LABEL[a.status] || { label: a.status, cls: 'badge-gray' };
      const dataFmt = a.data.split('-').reverse().join('/');
      const dur = a.minutos
        ? `${Math.floor(a.minutos/60) > 0 ? Math.floor(a.minutos/60)+'h' : ''}${a.minutos%60}min`
        : '—';
      const aberta = !a.hora_retorno;
      const acoes = aberta
        ? `<span class="text-muted" style="font-size:12px;">Aguardando retorno</span>
           <button class="btn btn-sm btn-danger" onclick="excluirAusenciaAdmin('${a.id}')" title="Excluir">&#128465;</button>`
        : `<button class="btn btn-sm btn-primary" onclick="abrirClassificarAusencia('${a.id}')">Classificar</button>
           <button class="btn btn-sm btn-danger" onclick="excluirAusenciaAdmin('${a.id}')" title="Excluir">&#128465;</button>`;
      return `<tr>
        <td><strong>${a.funcionario_nome || a.funcionario_uid}</strong></td>
        <td>${dataFmt}</td>
        <td>${a.hora_saida}</td>
        <td>${a.hora_retorno || '<em style="color:#c62828;">em aberto</em>'}</td>
        <td>${dur}</td>
        <td>${a.motivo}</td>
        <td>${aberta ? '<span class="badge badge-warning">Em andamento</span>' : `<span class="badge ${s.cls}">${s.label}</span>`}${a.observacao ? `<br><small class="text-muted">${a.observacao}</small>` : ''}</td>
        <td>${acoes}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">${err.message}</td></tr>`;
  }
}

document.getElementById('ausencias-filtro-status').addEventListener('change', loadAusenciasAdmin);

function abrirClassificarAusencia(id) {
  api.todasSaidasIntermediarias().then(lista => {
    const a = lista.find(x => x.id === id);
    if (!a) { toast('Registro não encontrado', 'error'); return; }
    document.getElementById('classificar-ausencia-id').value = id;
    document.getElementById('classificar-ausencia-status').value = (a.status === 'pendente' || a.status === 'aguardando_atestado') ? 'abonado' : a.status;
    document.getElementById('classificar-ausencia-obs').value = a.observacao || '';
    const dataFmt = a.data.split('-').reverse().join('/');
    const dur = a.minutos ? `${Math.floor(a.minutos/60) > 0 ? Math.floor(a.minutos/60)+'h' : ''}${a.minutos%60}min` : '—';
    document.getElementById('classificar-ausencia-info').innerHTML = `
      <div><strong>${a.funcionario_nome || a.funcionario_uid}</strong></div>
      <div style="font-size:12px;color:#555;">${dataFmt} · ${a.hora_saida} → ${a.hora_retorno} · <strong>${dur}</strong></div>
      <div style="font-size:12px;color:#555;margin-top:4px;"><em>${a.motivo}</em></div>
    `;
    openModal('modal-classificar-ausencia');
  });
}

document.getElementById('btn-salvar-classificar-ausencia').addEventListener('click', async () => {
  const id = document.getElementById('classificar-ausencia-id').value;
  const status = document.getElementById('classificar-ausencia-status').value;
  const obs = document.getElementById('classificar-ausencia-obs').value.trim();
  const btn = document.getElementById('btn-salvar-classificar-ausencia');
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    await api.classificarSaidaIntermediaria(id, status, obs || null);
    toast('Classificação salva.', 'success');
    closeModal('modal-classificar-ausencia');
    loadAusenciasAdmin();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar';
  }
});

// ---- Inserir ausência retroativa (admin) ----
document.getElementById('btn-nova-ausencia-admin').addEventListener('click', async () => {
  document.getElementById('nova-aus-data').value = new Date().toISOString().substring(0, 10);
  document.getElementById('nova-aus-hora-saida').value = '';
  document.getElementById('nova-aus-hora-retorno').value = '';
  document.getElementById('nova-aus-motivo').value = '';
  document.getElementById('nova-aus-obs').value = '';
  document.getElementById('nova-aus-status').value = 'descontar';
  const sel = document.getElementById('nova-aus-colab');
  sel.innerHTML = '<option value="">Carregando...</option>';
  openModal('modal-nova-ausencia-admin');
  try {
    const data = await api.listarFuncionarios({ page: 1, limit: 200, ativo: '1', role: 'funcionario' });
    const lista = data.funcionarios || [];
    sel.innerHTML = '<option value="">Selecione o colaborador...</option>' +
      lista.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
  } catch (err) {
    sel.innerHTML = `<option value="">${err.message}</option>`;
  }
});

document.getElementById('btn-salvar-nova-ausencia-admin').addEventListener('click', async () => {
  const dados = {
    funcionario_uid: document.getElementById('nova-aus-colab').value,
    data: document.getElementById('nova-aus-data').value,
    hora_saida: document.getElementById('nova-aus-hora-saida').value,
    hora_retorno: document.getElementById('nova-aus-hora-retorno').value,
    motivo: document.getElementById('nova-aus-motivo').value.trim(),
    status: document.getElementById('nova-aus-status').value,
    observacao: document.getElementById('nova-aus-obs').value.trim() || null
  };
  const btn = document.getElementById('btn-salvar-nova-ausencia-admin');
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    const res = await api.criarSaidaIntermediariaAdmin(dados);
    const dur = res.minutos ? `${Math.floor(res.minutos/60) > 0 ? Math.floor(res.minutos/60)+'h' : ''}${res.minutos%60}min` : '';
    toast(`Ausência registrada (${dur}).`, 'success');
    closeModal('modal-nova-ausencia-admin');
    loadAusenciasAdmin();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Registrar ausência';
  }
});

async function excluirAusenciaAdmin(id) {
  const ok = await showConfirm('Excluir este registro de ausência? Esta ação é irreversível.', { title: '🗑️ Excluir ausência', okText: 'Excluir', variant: 'danger' });
  if (!ok) return;
  try {
    await api.excluirSaidaIntermediaria(id);
    toast('Registro excluído.', 'success');
    loadAusenciasAdmin();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ==================== ESPELHO DE PONTO ====================
async function loadEspelho(funcionarioId) {
  if (!OfflineManager.isOnline()) { _offlinePage('espelho-header', 'Espelho indisponível offline'); return; }
  const mes = document.getElementById('espelho-mes').value;
  const ano = document.getElementById('espelho-ano').value;
  const funcId = funcionarioId || null;
  _espelhoFuncId = funcId;

  try {
    const [data, saldoBanco] = await Promise.all([
      api.espelhoPonto(mes, ano, funcId),
      api.saldoAcumuladoHoras(funcId || undefined).catch(() => ({ saldoMinutos: 0, saldoFormatado: '00:00', negativo: false }))
    ]);
    const func = data.funcionario;

    document.getElementById('espelho-header').innerHTML = `
      <div class="info-grid">
        <div class="info-item"><strong>Nome:</strong> ${func.nome}</div>
        <div class="info-item"><strong>Cargo:</strong> ${func.cargo || '-'}</div>
        <div class="info-item"><strong>Departamento:</strong> ${func.departamento || '-'}</div>
        <div class="info-item"><strong>Período:</strong> ${data.periodo}</div>
      </div>
    `;

    const diasSemana = { 'Sun': 'Dom', 'Mon': 'Seg', 'Tue': 'Ter', 'Wed': 'Qua', 'Thu': 'Qui', 'Fri': 'Sex', 'Sat': 'Sáb' };

    const isAdmin = currentUser && currentUser.role === 'admin';
    const isOwnEspelho = !funcId || funcId === currentUser.id;
    const todayISO = formatDateISO(new Date());

    document.getElementById('espelho-body').innerHTML = data.dias.map(d => {
      const dataFormatada = d.data.split('-').reverse().join('/');
      const dia = new Date(d.data + 'T12:00:00');
      const diaSemana = diasSemana[dia.toLocaleDateString('en', { weekday: 'short' })] || d.diaSemana;

      let statusCell = '';
      if (d.status === 'feriado') statusCell = `<span class="badge badge-info">🌴 Feriado</span>${d.feriado ? ` <small>(${d.feriado})</small>` : ''}`;
      else if (d.status === 'fim_de_semana') statusCell = `<span class="badge badge-gray">☀️ Fim de semana</span>`;
      else if (d.status === 'atestado') {
        const atMin = d.atestadoMinutos || 0;
        const atFmt = atMin >= 60 ? `${Math.floor(atMin/60)}h${atMin%60>0?atMin%60+'min':''}` : `${atMin}min`;
        statusCell = `<span class="badge badge-lilac">&#127973; Atestado Médico</span> <small class="text-muted">(+${atFmt} abonado)</small>`;
        // Mostra extras aprovados mesmo em dia com atestado
        if (d.extrasId) {
          const hh = String(Math.floor(Math.abs(d.diffMinutos)/60)).padStart(2,'0');
          const mm = String(Math.abs(d.diffMinutos)%60).padStart(2,'0');
          const qtd = `+${hh}:${mm}`;
          if (isAdmin && !isOwnEspelho) {
            if (d.extrasStatus === 'aprovado') statusCell += ` <span class="badge badge-info">${qtd} &#10003;</span>`;
            else if (d.extrasStatus === 'pendente') statusCell += ` <span class="badge badge-warning">${qtd} Pendente</span>`;
            else if (d.extrasStatus === 'rejeitado') statusCell += ` <span class="badge badge-danger">${qtd} Rejeitado</span>`;
          } else if (isOwnEspelho && !isAdmin) {
            if (d.extrasStatus === 'aprovado') statusCell += ` <span class="badge badge-info">Aprovado</span>`;
            else if (d.extrasStatus === 'pendente') statusCell += ` <span class="badge badge-warning">Pendente</span>`;
            else if (d.extrasStatus === 'rejeitado') statusCell += ` <span class="badge badge-danger">Rejeitado</span>`;
            else statusCell += ` <button class="btn btn-xs btn-primary" style="transform:scale(0.7);transform-origin:left center;" onclick="solicitarHorasExtras('${d.data}')">Solicitar ${qtd}</button>`;
          }
        }
      }
      else if (d.status === 'abono_horas') {
        const abMin = d.abHoraMinutos || 0;
        const abFmt = abMin >= 60 ? `${Math.floor(abMin/60)}h${abMin%60>0?abMin%60+'min':''}` : `${abMin}min`;
        statusCell = `<span class="badge badge-info">&#9989; Abono de Horas</span> <small class="text-muted">(+${abFmt} abonado)</small>`;
        if (d.temAtestado) statusCell += ` <span class="badge badge-lilac">&#127973; Atestado</span>`;
      }
      else if (d.status === 'falta') {
        if (d.data >= todayISO) {
          statusCell = `<span class="badge badge-info">&#128640; Jornada Futura</span>`;
        } else {
          statusCell = `<span class="badge badge-danger">Falta</span>`;
          if (isAdmin && !isOwnEspelho) {
            statusCell += ` <button class="btn btn-xs btn-secondary" onclick="abrirInserirFalta('${funcId}','${d.data}','${func.nome}')">Inserir</button>`;
          }
        }
      }
      else if (d.status === 'incompleto') statusCell = `<span class="badge badge-danger">&#10006; Jornada incompleta: -${d.diffFormatado}${d.diffFormatado.startsWith('00:') ? 'm' : 'h'}</span>`;
      else if (d.status === 'completa') {
        statusCell = `<span class="badge badge-success">&#10003; Jornada Conclu&#237;da</span>`;
        if (isAdmin && !isOwnEspelho && d.diffBruto > 0) {
          statusCell += ` <small style="color:#2e7d32;font-weight:600;">+${d.diffBrutoFormatado}m</small>`;
        }
      }
      else if (d.status === 'extras') {
        const extrasLabel = `<span class="badge badge-success">&#10003; Jornada Conclu&#237;da</span>`;
        const hh = String(Math.floor(Math.abs(d.diffMinutos)/60)).padStart(2,'0');
        const mm = String(Math.abs(d.diffMinutos)%60).padStart(2,'0');
        const qtdBadge = `+${hh}:${mm}`;
        let acao = '';
        if (isAdmin && !isOwnEspelho) {
          // Admin: apenas exibe quantidade, sem botões
          if (d.extrasStatus === 'aprovado') acao = ` <span class="badge badge-info">${qtdBadge} &#10003;</span>`;
          else if (d.extrasStatus === 'pendente') acao = ` <span class="badge badge-warning">${qtdBadge} Pendente</span>`;
          else if (d.extrasStatus === 'rejeitado') acao = ` <span class="badge badge-danger" title="${d.extrasMotivoRejeicao || ''}">${qtdBadge} Rejeitado</span>`;
          else acao = ` <span class="badge badge-success">${qtdBadge}</span>`;
        } else if (isOwnEspelho && !isAdmin) {
          // Colaborador: botão solicitar
          if (d.extrasStatus === 'aprovado') acao = ` <span class="badge badge-info">Aprovado</span>`;
          else if (d.extrasStatus === 'pendente') acao = ` <span class="badge badge-warning">Pendente</span>`;
          else if (d.extrasStatus === 'rejeitado') acao = ` <span class="badge badge-danger" title="${d.extrasMotivoRejeicao || ''}">Rejeitado</span>`;
          else acao = ` <button class="btn btn-xs btn-primary" style="transform:scale(0.7);transform-origin:left center;" onclick="solicitarHorasExtras('${d.data}')">Solicitar +${hh}:${mm}</button>`;
        }
        statusCell = extrasLabel + acao;
      }

      // Se tem atestado aprovado mas o status não é 'atestado' (ex: trabalhou mais que a jornada), indica no status
      if (d.temAtestado && d.status !== 'atestado' && d.status !== 'abono_horas') {
        statusCell += ` <span class="badge badge-lilac">&#127973; Atestado</span>`;
      }
      // Se tem abono_horas aprovado mas o status não é 'abono_horas' (ex: trabalhou mais que a jornada)
      if (d.temAbono && d.status !== 'abono_horas') {
        statusCell += ` <span class="badge badge-info">&#9989; Abono</span>`;
      }
      // Compensação aprovada: indica que o colaborador comprometeu horas extras neste dia
      if (d.temCompensacao) {
        statusCell += ` <span class="badge badge-warning">&#8635; Compensação</span>`;
      }
      // Ausências intermediárias: mostra contagem e tempo
      if (d.ausencias && d.ausencias.length > 0) {
        const qtd = d.ausencias.length;
        const totMin = d.ausenciaTotalMinutos || 0;
        const totFmt = totMin >= 60 ? `${Math.floor(totMin/60)}h${totMin%60>0?totMin%60+'min':''}` : `${totMin}min`;
        const detalhes = d.ausencias.map(a => {
          const s = AUSENCIA_STATUS_LABEL[a.status] || { label: a.status, cls: 'badge-gray' };
          const dur = a.minutos ? `${Math.floor(a.minutos/60) > 0 ? Math.floor(a.minutos/60)+'h' : ''}${a.minutos%60}min` : 'aberta';
          return `${a.hora_saida}→${a.hora_retorno || '?'} (${dur}) · ${a.motivo} · ${s.label}`;
        }).join(' | ');
        statusCell += ` <span class="badge badge-warning" title="${detalhes}" style="cursor:help;">🚶 ${qtd} saída${qtd > 1 ? 's' : ''} −${totFmt}</span>`;
      }

      const isDescanso = d.status === 'fim_de_semana' || d.status === 'feriado';
      const descansoCell = `<span style="color:#aaa;font-style:italic;">Descanso</span>`;
      const atestadoCell = `<span style="color:#b45309;font-style:italic;font-size:12px;">Atestado</span>`;
      const isHoje = d.data === todayISO;
      const _col = (val) => isDescanso ? descansoCell : (d.atestadoDiaInteiro ? atestadoCell : (val || '-'));

      const horasTrabalhadasCell = isDescanso ? descansoCell : `<strong>${d.trabalhado}</strong>`;
      const abonoCell = isDescanso ? descansoCell : (d.abonoMinutos > 0
        ? `<small style="color:#2e7d32;font-weight:600;">+${d.abonoMinutos}min</small>`
        : '-');
      const totalCell = isDescanso ? descansoCell : `<strong>${d.totalComAbono || d.trabalhado}</strong>`;

      const isFeriado = d.status === 'feriado';
      const isFimDeSemana = d.status === 'fim_de_semana';
      let trClass = isHoje ? 'espelho-hoje' : isFimDeSemana ? 'espelho-descanso' : isFeriado ? 'espelho-feriado' : '';
      return `<tr class="${trClass}">
        <td>${dataFormatada}</td>
        <td>${diaSemana}</td>
        <td>${_col(d.entrada)}</td>
        <td>${_col(d.saida_almoco)}</td>
        <td>${_col(d.retorno_almoco)}</td>
        <td>${_col(d.saida)}</td>
        <td>${horasTrabalhadasCell}</td>
        <td>${abonoCell}</td>
        <td>${totalCell}</td>
        <td class="espelho-status">${statusCell}</td>
      </tr>`;
    }).join('');

    const bancoSinal = saldoBanco.saldoMinutos > 0 ? '+' : saldoBanco.saldoMinutos < 0 ? '-' : '';
    const bancoIcon = saldoBanco.saldoMinutos > 0 ? '&#128077;' : saldoBanco.saldoMinutos < 0 ? '&#128078;' : '&#128200;';
    const bancoCor = saldoBanco.saldoMinutos > 0 ? 'green' : saldoBanco.saldoMinutos < 0 ? 'red' : 'blue';
    document.getElementById('espelho-resumo').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon yellow">&#129321;</div>
          <div class="stat-info"><h4>${data.resumo.totalAbonoConced || '00:00'}</h4><p>Total Horas Concedidas</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon blue">&#9201;</div>
          <div class="stat-info"><h4>${data.resumo.totalTrabalhado}</h4><p>Total Trabalhado</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon ${bancoCor}">${bancoIcon}</div>
          <div class="stat-info"><h4>${bancoSinal}${saldoBanco.saldoFormatado}</h4><p>Banco de Horas (acumulado)</p></div>
        </div>
      </div>
    `;
    _espelhoCache = data;
    _espelhoSaldoCache = saldoBanco;
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('btn-gerar-espelho').addEventListener('click', () => loadEspelho());

document.getElementById('btn-exportar-pdf').addEventListener('click', () => gerarEspelhoPDF());

// ==================== FUNCIONÁRIOS ====================
async function loadFuncionarios() {
  if (!OfflineManager.isOnline()) { _offlinePage('funcionarios-body', 'Colaboradores indisponível offline'); return; }
  try {
    const busca = document.getElementById('filtro-busca').value;
    const departamento = document.getElementById('filtro-depto').value;
    const ativo = document.getElementById('filtro-ativo').value;

    const data = await api.listarFuncionarios({ page: funcPage, limit: 15, busca, departamento, ativo, role: 'funcionario' });

    document.getElementById('funcionarios-body').innerHTML = data.funcionarios.map(f => {
      const perfilInfo = f.perfil_nome ? `<span class="badge badge-info">${f.perfil_nome}</span>` :
        `<span class="badge badge-gray">Sem perfil</span>`;
      const avatarHtml = f.foto_url
        ? `<span class="table-avatar"><img src="${f.foto_url}" alt="${f.nome}"></span>`
        : `<span class="table-avatar">${(f.nome || '?').charAt(0).toUpperCase()}</span>`;
      return `<tr>
        <td>${avatarHtml}<strong>${f.nome}</strong></td>
        <td><code>${f.usuario || '-'}</code></td>
        <td>${f.cargo || '-'}</td>
        <td>${f.departamento || '-'}</td>
        <td>${perfilInfo}</td>
        <td>${f.jornada_semanal}h</td>
        <td>
          <div class="btn-group">
            <button class="btn btn-sm btn-secondary" onclick="editarFuncionario('${f.id}')">Editar</button>
            <button class="btn btn-sm btn-warning" onclick="enviarResetSenha('${(f.usuario || '').replace(/'/g, "\\'")}', '${f.nome.replace(/'/g, "\\'")}')">Resetar Senha</button>
            ${f.ativo ?
              `<button class="btn btn-sm btn-danger" onclick="desativarFuncionario('${f.id}')">Desativar</button>` :
              `<button class="btn btn-sm btn-success" onclick="reativarFuncionario('${f.id}')">Reativar</button>`
            }
            <button class="btn btn-sm btn-primary" onclick="verEspelho('${f.id}')">Espelho</button>
            <button class="btn btn-sm btn-danger" onclick="excluirFuncionarioDefinitivo('${f.id}', '${f.nome.replace(/'/g, "\\'")}')" title="Excluir definitivamente">🗑️ Excluir</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    // Pagination
    let pagHtml = '';
    if (data.totalPages > 1) {
      pagHtml += `<button ${funcPage <= 1 ? 'disabled' : ''} onclick="funcPage--;loadFuncionarios();">&laquo;</button>`;
      for (let i = 1; i <= data.totalPages; i++) {
        pagHtml += `<button class="${i === funcPage ? 'active' : ''}" onclick="funcPage=${i};loadFuncionarios();">${i}</button>`;
      }
      pagHtml += `<button ${funcPage >= data.totalPages ? 'disabled' : ''} onclick="funcPage++;loadFuncionarios();">&raquo;</button>`;
    }
    document.getElementById('funcionarios-pagination').innerHTML = pagHtml;
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('filtro-busca').addEventListener('input', debounce(() => { funcPage = 1; loadFuncionarios(); }, 300));
document.getElementById('filtro-ativo').addEventListener('change', () => { funcPage = 1; loadFuncionarios(); });

function switchFuncTab(tab) {
  funcTab = tab;
  document.getElementById('tab-colaboradores').classList.toggle('active', tab === 'colaboradores');
  document.getElementById('tab-administradores').classList.toggle('active', tab === 'administradores');
  document.getElementById('tab-panel-colaboradores').classList.toggle('hidden', tab !== 'colaboradores');
  document.getElementById('tab-panel-administradores').classList.toggle('hidden', tab !== 'administradores');
  document.getElementById('btn-novo-funcionario').classList.toggle('hidden', tab !== 'colaboradores');
  document.getElementById('btn-novo-administrador').classList.toggle('hidden', tab !== 'administradores');
  if (tab === 'colaboradores') loadFuncionarios();
  else loadAdministradores();
}

async function loadAdministradores() {
  if (!OfflineManager.isOnline()) { _offlinePage('administradores-body', 'Indisponível offline'); return; }
  try {
    const data = await api.listarFuncionarios({ limit: 100, ativo: 'todos', role: 'admin' });
    document.getElementById('administradores-body').innerHTML = data.funcionarios.length === 0
      ? '<tr><td colspan="4" style="text-align:center;color:#888;">Nenhum administrador cadastrado.</td></tr>'
      : data.funcionarios.map(f => `<tr>
          <td><strong>${f.nome}</strong></td>
          <td><code>${f.usuario || '-'}</code></td>
          <td>${f.email || '-'}</td>
          <td>
            <div class="btn-group">
              <button class="btn btn-sm btn-secondary" onclick="editarAdministrador('${f.id}')">Editar</button>
              <button class="btn btn-sm btn-warning" onclick="enviarResetSenha('${(f.usuario || '').replace(/'/g, "\\'")}', '${f.nome.replace(/'/g, "\\'")}')">Resetar Senha</button>
              <button class="btn btn-sm btn-danger" onclick="excluirFuncionarioDefinitivo('${f.id}', '${f.nome.replace(/'/g, "\\'")}')" title="Excluir definitivamente">🗑️ Excluir</button>
            </div>
          </td>
        </tr>`).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('btn-novo-funcionario').addEventListener('click', async () => {
  document.getElementById('modal-func-title').textContent = 'Novo Colaborador';
  document.getElementById('func-id').value = '';
  document.getElementById('func-nome').value = '';
  document.getElementById('func-usuario').value = '';
  document.getElementById('func-email').value = '';
  document.getElementById('func-senha').value = '';
  document.getElementById('func-cargo').value = '';
  document.getElementById('func-departamento').value = '';
  document.getElementById('func-perfil-horario').value = '';
  document.getElementById('func-perfil-info').textContent = '';
  document.getElementById('func-jornada').value = '44';
  document.getElementById('func-role').value = 'funcionario';
  document.getElementById('func-abono').value = '0';
  document.getElementById('func-usuario').readOnly = false;
  document.getElementById('func-senha-group').classList.remove('hidden');
  document.getElementById('func-jornada-fields').classList.remove('hidden');
  document.getElementById('func-foto-section').classList.add('hidden');
  _funcFotoFile = null; _funcFotoRemover = false;
  await populatePerfilDropdowns();
  openModal('modal-funcionario');
});

document.getElementById('btn-novo-administrador').addEventListener('click', async () => {
  document.getElementById('modal-func-title').textContent = 'Novo Administrador';
  document.getElementById('func-id').value = '';
  document.getElementById('func-nome').value = '';
  document.getElementById('func-usuario').value = '';
  document.getElementById('func-email').value = '';
  document.getElementById('func-senha').value = '';
  document.getElementById('func-cargo').value = '';
  document.getElementById('func-departamento').value = '';
  document.getElementById('func-role').value = 'admin';
  document.getElementById('func-usuario').readOnly = false;
  document.getElementById('func-senha-group').classList.remove('hidden');
  document.getElementById('func-jornada-fields').classList.add('hidden');
  document.getElementById('func-foto-section').classList.add('hidden');
  _funcFotoFile = null; _funcFotoRemover = false;
  openModal('modal-funcionario');
});

async function editarFuncionario(id) {
  try {
    const func = await api.buscarFuncionario(id);
    await populatePerfilDropdowns();
    document.getElementById('modal-func-title').textContent = 'Editar Colaborador';
    document.getElementById('func-id').value = func.id;
    document.getElementById('func-nome').value = func.nome;
    document.getElementById('func-usuario').value = func.usuario || '';
    document.getElementById('func-usuario').readOnly = true;
    document.getElementById('func-email').value = func.email || '';
    document.getElementById('func-senha').value = '';
    document.getElementById('func-cargo').value = func.cargo || '';
    document.getElementById('func-departamento').value = func.departamento || '';
    document.getElementById('func-perfil-horario').value = func.perfil_horario_id || '';
    document.getElementById('func-perfil-info').textContent = func.perfil_nome || '';
    document.getElementById('func-jornada').value = func.jornada_semanal;
    document.getElementById('func-role').value = 'funcionario';
    document.getElementById('func-abono').value = func.abono_minutos || 0;
    document.getElementById('func-senha-group').classList.add('hidden');
    document.getElementById('func-jornada-fields').classList.remove('hidden');
    document.getElementById('func-foto-section').classList.remove('hidden');
    document.getElementById('func-foto-input').value = '';
    _funcFotoFile = null; _funcFotoRemover = false;
    _setFotoPreview(func.foto_url || null, func.nome);
    openModal('modal-funcionario');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function editarAdministrador(id) {
  try {
    const func = await api.buscarFuncionario(id);
    document.getElementById('modal-func-title').textContent = 'Editar Administrador';
    document.getElementById('func-id').value = func.id;
    document.getElementById('func-nome').value = func.nome;
    document.getElementById('func-usuario').value = func.usuario || '';
    document.getElementById('func-usuario').readOnly = true;
    document.getElementById('func-email').value = func.email || '';
    document.getElementById('func-senha').value = '';
    document.getElementById('func-cargo').value = func.cargo || '';
    document.getElementById('func-departamento').value = func.departamento || '';
    document.getElementById('func-role').value = 'admin';
    document.getElementById('func-senha-group').classList.add('hidden');
    document.getElementById('func-jornada-fields').classList.add('hidden');
    document.getElementById('func-foto-section').classList.remove('hidden');
    document.getElementById('func-foto-input').value = '';
    _funcFotoFile = null; _funcFotoRemover = false;
    _setFotoPreview(func.foto_url || null, func.nome);
    openModal('modal-funcionario');
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('btn-salvar-funcionario').addEventListener('click', async () => {
  const id = document.getElementById('func-id').value;
  const role = document.getElementById('func-role').value;
  const isAdmin = role === 'admin';
  const perfilVal = isAdmin ? null : document.getElementById('func-perfil-horario').value;

  const dados = {
    nome: document.getElementById('func-nome').value,
    usuario: document.getElementById('func-usuario').value,
    email: document.getElementById('func-email').value,
    cargo: document.getElementById('func-cargo').value,
    departamento: document.getElementById('func-departamento').value,
    role
  };

  if (!isAdmin) {
    dados.jornada_semanal = parseFloat(document.getElementById('func-jornada').value);
    dados.perfil_horario_id = perfilVal || null;
    dados.abono_minutos = parseInt(document.getElementById('func-abono').value) || 0;
  }

  if (!id) {
    dados.senha = document.getElementById('func-senha').value;
    if (!dados.usuario) { toast('Usuário é obrigatório', 'error'); return; }
    if (!dados.senha) { toast('Senha inicial é obrigatória', 'error'); return; }
  }

  const btn = document.getElementById('btn-salvar-funcionario');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    if (id) {
      if (_funcFotoFile) {
        btn.textContent = 'Enviando foto...';
        const ext = _funcFotoFile.name.split('.').pop().toLowerCase() || 'jpg';
        const path = `fotos_perfil/${id}/foto.${ext}`;
        const storageRef = fbStorage.ref(path);
        await storageRef.put(_funcFotoFile);
        dados.foto_url = await storageRef.getDownloadURL();
      } else if (_funcFotoRemover) {
        dados.foto_url = null;
      }
      btn.textContent = 'Salvando...';
      await api.editarFuncionario(id, dados);
      toast(isAdmin ? 'Administrador atualizado!' : 'Colaborador atualizado!', 'success');
    } else {
      const result = await api.cadastrarFuncionario(dados);
      toast(`${isAdmin ? 'Administrador' : 'Colaborador'} cadastrado! Usuário: ${result.usuario}`, 'success');
    }
    closeModal('modal-funcionario');
    if (isAdmin) loadAdministradores(); else loadFuncionarios();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
});

async function desativarFuncionario(id) {
  const ok = await showConfirm('Deseja desativar este colaborador?', { title: 'Desativar colaborador', okText: 'Desativar', variant: 'danger' });
  if (!ok) return;
  try {
    await api.desativarFuncionario(id);
    toast('Colaborador desativado', 'success');
    loadFuncionarios();
  } catch (err) { toast(err.message, 'error'); }
}

async function reativarFuncionario(id) {
  try {
    await api.reativarFuncionario(id);
    toast('Colaborador reativado', 'success');
    loadFuncionarios();
  } catch (err) { toast(err.message, 'error'); }
}

async function excluirFuncionarioDefinitivo(id, nome) {
  const msg = `Esta ação é IRREVERSÍVEL!\n\nVocê vai excluir DEFINITIVAMENTE o colaborador "${nome}" e todos os seus dados:\n• Registros de ponto\n• Ajustes, abonos, faltas\n• Saídas intermediárias\n• Holerites e foto de perfil\n\nDigite EXCLUIR para confirmar:`;
  const resposta = await showPrompt(msg, { title: '⚠️ Excluir definitivamente', placeholder: 'Digite EXCLUIR', okText: 'Excluir' });
  if (resposta === null) return;
  if (resposta !== 'EXCLUIR') {
    toast('Exclusão cancelada — texto não confere.', 'info');
    return;
  }
  try {
    const result = await api.excluirFuncionarioDefinitivo(id);
    // Limpar credenciais offline em cache (caso este usuário estivesse cacheado)
    if (typeof OfflineManager !== 'undefined' && result.usuario) {
      const cached = localStorage.getItem('offline_credentials');
      if (cached) {
        try {
          const cred = JSON.parse(cached);
          if (cred.usuario === result.usuario) {
            OfflineManager.clearCredentials();
          }
        } catch (e) {}
      }
    }
    toast(result.message || 'Colaborador excluído definitivamente', 'success');
    loadFuncionarios();
  } catch (err) { toast(err.message, 'error'); }
}

function verEspelho(funcionarioId) {
  _espelhoFuncId = funcionarioId || null;
  navigateTo('meu-espelho');
}

async function enviarResetSenha(usuario, nome) {
  if (!usuario) { toast('Colaborador sem usuário definido', 'error'); return; }
  const ok = await showConfirm(`Enviar link de redefinição de senha para ${nome}?\nO link será enviado ao e-mail cadastrado e expira em 30 minutos.`, { title: '🔑 Reset de senha', okText: 'Enviar link' });
  if (!ok) return;
  try {
    const fn = firebase.app().functions('us-central1').httpsCallable('solicitarResetSenha');
    const res = await fn({ usuario });
    const d = res.data || {};
    if (d.emailMascara) {
      toast(`Link enviado para ${d.emailMascara}`, 'success');
    } else {
      toast(d.message || 'Se o usuário tiver e-mail cadastrado, um link foi enviado.', 'info');
    }
  } catch (err) {
    toast((err && err.message) || 'Erro ao enviar link de reset', 'error');
  }
}

// ==================== AJUSTES ====================
async function _validarDataAjuste(input) {
  const aviso = document.getElementById('ajuste-data-aviso');
  const btn = document.getElementById('btn-enviar-ajuste');
  if (!input.value) { aviso.style.display = 'none'; btn.disabled = false; return; }
  const dow = new Date(input.value + 'T12:00:00').getDay();
  if (dow === 0 || dow === 6) {
    aviso.textContent = '⚠️ Final de semana — ajuste não permitido.';
    aviso.style.display = 'block'; btn.disabled = true; return;
  }
  // Janela de 30 dias
  const diasAtras = Math.floor((Date.now() - new Date(input.value + 'T12:00:00').getTime()) / 86400000);
  if (diasAtras > 30) {
    aviso.textContent = '⚠️ Ajustes só são permitidos até 30 dias anteriores. Fale com o administrador.';
    aviso.style.display = 'block'; btn.disabled = true; return;
  }
  if (diasAtras < 0) {
    aviso.textContent = '⚠️ Não é possível solicitar ajuste para data futura.';
    aviso.style.display = 'block'; btn.disabled = true; return;
  }
  try {
    const feriado = await api.verificarFeriado(input.value);
    if (feriado) {
      aviso.textContent = `⚠️ Feriado: ${feriado.descricao || 'Feriado'} — ajuste não permitido.`;
      aviso.style.display = 'block'; btn.disabled = true; return;
    }
  } catch (e) {}
  aviso.style.display = 'none'; btn.disabled = false;
}

document.getElementById('btn-solicitar-ajuste').addEventListener('click', () => {
  document.getElementById('ajuste-data').value = '';
  document.getElementById('ajuste-hora-entrada').value = '';
  document.getElementById('ajuste-hora-saida-almoco').value = '';
  document.getElementById('ajuste-hora-retorno-almoco').value = '';
  document.getElementById('ajuste-hora-saida').value = '';
  document.getElementById('ajuste-motivo').value = '';
  openModal('modal-ajuste');
});

document.getElementById('btn-enviar-ajuste').addEventListener('click', async () => {
  const data = document.getElementById('ajuste-data').value;
  const motivo = document.getElementById('ajuste-motivo').value.trim();

  if (!data) { toast('Informe a data', 'error'); return; }
  if (!motivo) { toast('Informe o motivo', 'error'); return; }

  // Bloquear finais de semana
  const dow = new Date(data + 'T12:00:00').getDay();
  if (dow === 0 || dow === 6) {
    toast('Não é possível solicitar ajuste em finais de semana.', 'error'); return;
  }

  // Bloquear feriados
  try {
    const feriado = await api.verificarFeriado(data);
    if (feriado) {
      toast(`Não é possível solicitar ajuste em feriado: ${feriado.descricao || 'Feriado'}.`, 'error'); return;
    }
  } catch (e) {}

  const periodos = [
    { tipo: 'entrada',        hora: document.getElementById('ajuste-hora-entrada').value },
    { tipo: 'saida_almoco',   hora: document.getElementById('ajuste-hora-saida-almoco').value },
    { tipo: 'retorno_almoco', hora: document.getElementById('ajuste-hora-retorno-almoco').value },
    { tipo: 'saida',          hora: document.getElementById('ajuste-hora-saida').value },
  ].filter(p => p.hora);

  if (!periodos.length) { toast('Preencha ao menos um horário para ajuste', 'error'); return; }

  const btn = document.getElementById('btn-enviar-ajuste');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    await Promise.all(periodos.map(p => api.solicitarAjuste({ data, tipo: p.tipo, nova_hora: p.hora, motivo })));
    const qtd = periodos.length;
    toast(`${qtd} solicita${qtd > 1 ? 'ções enviadas' : 'ção enviada'}!`, 'success');
    closeModal('modal-ajuste');
    loadMeusAjustes();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar Solicitação';
  }
});

async function loadMeusAjustes() {
  if (!OfflineManager.isOnline()) { _offlinePage('meus-ajustes-body', 'Ajustes indisponível offline'); return; }
  try {
    const ajustes = await api.meusAjustes();
    document.getElementById('meus-ajustes-body').innerHTML = ajustes.map(a => `
      <tr>
        <td>${formatDateBR(new Date(a.data + 'T12:00:00'))}</td>
        <td>${a.tipo.replace(/_/g, ' ')}</td>
        <td>${a.nova_hora}</td>
        <td>${a.motivo}</td>
        <td>${getStatusBadge(a.status)}${a.motivo_rejeicao ? `<br><small class="text-danger">${a.motivo_rejeicao}</small>` : ''}</td>
      </tr>
    `).join('') || '<tr><td colspan="5" class="text-center text-muted">Nenhum ajuste solicitado</td></tr>';
  } catch (err) { toast(err.message, 'error'); }
}

async function loadAjustesPendentes() {
  if (!OfflineManager.isOnline()) { _offlinePage('ajustes-pendentes-body', 'Ajustes indisponível offline'); return; }
  try {
    const ajustes = await api.ajustesPendentes();
    const tipoLabel = { entrada: 'Entrada', saida_almoco: 'Saída Almoço', retorno_almoco: 'Retorno Almoço', saida: 'Saída' };
    document.getElementById('ajustes-pendentes-body').innerHTML = ajustes.map(a => {
      const dataEnc = encodeURIComponent(a.data);
      const nomeEnc = encodeURIComponent(a.funcionario_nome || '');
      const tipoEnc = encodeURIComponent(a.tipo);
      const horaEnc = encodeURIComponent(a.nova_hora);
      const motivoEnc = encodeURIComponent(a.motivo || '');
      return `<tr>
        <td><strong>${a.funcionario_nome}</strong></td>
        <td>${formatDateBR(new Date(a.data + 'T12:00:00'))}</td>
        <td>${tipoLabel[a.tipo] || a.tipo.replace(/_/g,' ')}</td>
        <td>${a.nova_hora}</td>
        <td>${a.motivo}</td>
        <td>
          <div class="btn-group">
            <button class="btn btn-sm btn-success" onclick="abrirConfirmarAjuste('aprovar','${a.id}',decodeURIComponent('${nomeEnc}'),decodeURIComponent('${dataEnc}'),decodeURIComponent('${tipoEnc}'),decodeURIComponent('${horaEnc}'),decodeURIComponent('${motivoEnc}'))">Aprovar</button>
            <button class="btn btn-sm btn-danger"  onclick="abrirConfirmarAjuste('rejeitar','${a.id}',decodeURIComponent('${nomeEnc}'),decodeURIComponent('${dataEnc}'),decodeURIComponent('${tipoEnc}'),decodeURIComponent('${horaEnc}'),decodeURIComponent('${motivoEnc}'))">Rejeitar</button>
          </div>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="text-center text-muted">Nenhum ajuste pendente</td></tr>';
  } catch (err) { toast(err.message, 'error'); }
}

async function loadHorasExtrasPendentes() {
  if (!OfflineManager.isOnline()) { _offlinePage('horas-extras-pendentes-body', 'Banco de Horas indisponível offline'); return; }
  // Pre-fill mes/ano selects
  const now = new Date();
  const mesEl = document.getElementById('banco-horas-mes');
  const anoEl = document.getElementById('banco-horas-ano');
  if (mesEl && !mesEl.value) mesEl.value = now.getMonth() + 1;
  if (anoEl && !anoEl.value) anoEl.value = now.getFullYear();
  try {
    const arr = await api.horasExtrasPendentes();
    const fmt = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
    document.getElementById('horas-extras-pendentes-body').innerHTML = arr.map(h => `
      <tr>
        <td>${h.funcionario_nome || h.funcionario_uid}</td>
        <td>${(h.data || '').split('-').reverse().join('/')}</td>
        <td><strong>+${fmt(h.minutos_extras || 0)}</strong></td>
        <td>${(h.created_at || '').slice(0, 16).replace('T', ' ')}</td>
        <td>
          <button class="btn btn-sm btn-success" onclick="aprovarHorasExtras('${h.id}')">Aprovar</button>
          <button class="btn btn-sm btn-danger" onclick="rejeitarHorasExtras('${h.id}')">Rejeitar</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="5" class="text-center text-muted">Nenhuma solicitação de Horas Positivas pendente</td></tr>';
  } catch (err) { toast(err.message, 'error'); }
}

async function loadHorasNegativas() {
  const mes = parseInt(document.getElementById('banco-horas-mes').value, 10);
  const ano = parseInt(document.getElementById('banco-horas-ano').value, 10);
  if (!mes || !ano) { toast('Selecione mês e ano', 'error'); return; }
  const tbody = document.getElementById('horas-negativas-body');
  tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Carregando...</td></tr>';
  try {
    const fmt = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
    const resultado = await api.bancoHorasNegativasMes(mes, ano);
    if (!resultado.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Nenhum colaborador com horas negativas neste mês</td></tr>';
      return;
    }
    tbody.innerHTML = resultado.map(r => `
      <tr>
        <td><strong>${r.nome}</strong></td>
        <td>${r.departamento || '-'}</td>
        <td><span class="badge badge-danger">&#10006; -${fmt(Math.abs(r.saldoMin))}</span></td>
      </tr>
    `).join('');
  } catch (err) { toast(err.message, 'error'); }
}

async function solicitarHorasExtras(data) {
  const ok = await showConfirm('Solicitar aprovação das Horas Positivas deste dia?', { title: '⏰ Horas Positivas', okText: 'Solicitar' });
  if (!ok) return;
  try {
    await api.solicitarHorasExtras(data);
    toast('Solicitação enviada ao administrador', 'success');
    loadEspelho();
  } catch (err) { toast(err.message, 'error'); }
}

async function aprovarHorasExtrasAdmin(uid, data) {
  const ok = await showConfirm('Aprovar as Horas Positivas deste dia para o colaborador?', { title: '✓ Aprovar horas', okText: 'Aprovar' });
  if (!ok) return;
  try {
    await api.aprovarHorasExtrasAdmin(uid, data);
    toast('Horas Positivas aprovadas!', 'success');
    loadEspelho(_espelhoFuncId);
  } catch (err) { toast(err.message, 'error'); }
}

async function aprovarHorasExtras(id) {
  const ok = await showConfirm('Aprovar estas horas extras?', { title: '✓ Aprovar horas extras', okText: 'Aprovar' });
  if (!ok) return;
  try {
    await api.aprovarHorasExtras(id);
    toast('Horas extras aprovadas', 'success');
    if (typeof loadHorasExtrasPendentes === 'function') loadHorasExtrasPendentes();
    if (document.getElementById('espelho-body')) loadEspelho();
  } catch (err) { toast(err.message, 'error'); }
}

async function rejeitarHorasExtras(id) {
  const motivo = await showPrompt('Informe o motivo da rejeição:', { title: '✕ Rejeitar horas extras', okText: 'Rejeitar' });
  if (motivo === null) return;
  try {
    await api.rejeitarHorasExtras(id, motivo);
    toast('Horas extras rejeitadas', 'success');
    if (typeof loadHorasExtrasPendentes === 'function') loadHorasExtrasPendentes();
    if (document.getElementById('espelho-body')) loadEspelho();
  } catch (err) { toast(err.message, 'error'); }
}

let _ajusteAcaoPendente = null;

function abrirConfirmarAjuste(acao, id, nome, data, tipo, hora, motivo) {
  _ajusteAcaoPendente = { acao, id };

  const tipoLabel = { entrada: 'Entrada', saida_almoco: 'Saída Almoço', retorno_almoco: 'Retorno Almoço', saida: 'Saída' };
  const dataFmt = data ? data.split('-').reverse().join('/') : '-';
  const isAprovar = acao === 'aprovar';

  const header = document.getElementById('confirmar-ajuste-header');
  header.className = `modal-header ${isAprovar ? 'header-success' : 'header-danger'}`;
  document.getElementById('confirmar-ajuste-titulo').innerHTML =
    `${isAprovar ? '✅' : '❌'} ${isAprovar ? 'Aprovar' : 'Rejeitar'} Ajuste`;

  document.getElementById('confirmar-ajuste-info').innerHTML = `
    <div class="ajuste-confirm-row"><span class="aci-label">Colaborador</span><span class="aci-val">${nome}</span></div>
    <div class="ajuste-confirm-row"><span class="aci-label">Data</span><span class="aci-val">${dataFmt}</span></div>
    <div class="ajuste-confirm-row"><span class="aci-label">Período</span><span class="aci-val">${tipoLabel[tipo] || tipo}</span></div>
    <div class="ajuste-confirm-row"><span class="aci-label">Novo horário</span><span class="aci-val">${hora}</span></div>
    <div class="ajuste-confirm-row"><span class="aci-label">Motivo</span><span class="aci-val" style="font-weight:400;color:#555;">${motivo}</span></div>
  `;

  const motivoWrap = document.getElementById('confirmar-ajuste-motivo-wrap');
  motivoWrap.style.display = isAprovar ? 'none' : 'block';
  document.getElementById('confirmar-ajuste-motivo').value = '';

  const btn = document.getElementById('confirmar-ajuste-btn');
  btn.textContent = isAprovar ? '✓ Confirmar Aprovação' : '✕ Confirmar Rejeição';
  btn.className = `btn ${isAprovar ? 'btn-success' : 'btn-danger'}`;

  openModal('modal-confirmar-ajuste');
}

document.getElementById('confirmar-ajuste-btn').addEventListener('click', async () => {
  if (!_ajusteAcaoPendente) return;
  const { acao, id } = _ajusteAcaoPendente;
  const btn = document.getElementById('confirmar-ajuste-btn');

  if (acao === 'rejeitar') {
    const motivo = document.getElementById('confirmar-ajuste-motivo').value.trim();
    if (!motivo) { toast('Informe o motivo da rejeição', 'error'); return; }
  }

  btn.disabled = true;
  btn.textContent = 'Processando...';

  try {
    if (acao === 'aprovar') {
      await api.aprovarAjuste(id);
      toast('Ajuste aprovado com sucesso!', 'success');
    } else {
      const motivo = document.getElementById('confirmar-ajuste-motivo').value.trim();
      await api.rejeitarAjuste(id, motivo);
      toast('Ajuste rejeitado.', 'info');
    }
    closeModal('modal-confirmar-ajuste');
    _ajusteAcaoPendente = null;
    loadAjustesPendentes();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

async function aprovarAjuste(id) {
  // mantida por compatibilidade — fluxo migrado para abrirConfirmarAjuste
  abrirConfirmarAjuste('aprovar', id, '-', '-', '-', '-', '-');
}
async function rejeitarAjuste(id) {
  abrirConfirmarAjuste('rejeitar', id, '-', '-', '-', '-', '-');
}

// ==================== RELATÓRIOS ====================
document.getElementById('btn-gerar-relatorio').addEventListener('click', async () => {
  const mes = document.getElementById('rel-mes').value;
  const ano = document.getElementById('rel-ano').value;

  try {
    const data = await api.relatorioGeral(mes, ano);
    const resumos = data.resumos || [];
    document.getElementById('relatorio-body').innerHTML = resumos.map(r => `
      <tr>
        <td><strong>${r.funcionario.nome}</strong></td>
        <td>${r.funcionario.cargo || '-'}</td>
        <td>${r.funcionario.departamento || '-'}</td>
        <td>${r.totalHoras}</td>
        <td>${r.diasTrabalhados}</td>
        <td>${r.faltas}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="verEspelhoFunc('${r.funcionario.id}', ${mes}, ${ano})">Espelho</button>
          <button class="btn btn-sm btn-secondary" onclick="exportarPdfFunc('${r.funcionario.id}', ${mes}, ${ano})">PDF</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="text-center text-muted">Nenhum dado encontrado</td></tr>';
  } catch (err) { toast(err.message, 'error'); }
});

function verEspelhoFunc(funcId, mes, ano) {
  document.getElementById('espelho-mes').value = mes;
  document.getElementById('espelho-ano').value = ano;
  _espelhoFuncId = funcId || null;
  navigateTo('meu-espelho');
}

function exportarPdfFunc(funcId, mes, ano) {
  gerarEspelhoPDF(funcId, mes, ano);
}

async function _getLogoBase64() {
  return new Promise(resolve => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = 'images/logo-420x110.png?' + Date.now();
  });
}

async function gerarEspelhoPDF(inputFuncId, inputMes, inputAno) {
  let data, saldoBanco;

  if (inputFuncId) {
    const mes = inputMes || document.getElementById('espelho-mes').value;
    const ano = inputAno || document.getElementById('espelho-ano').value;
    document.getElementById('modal-espelho-pdf-body').innerHTML =
      `<div style="padding:40px;color:#666;text-align:center;">&#9203; Carregando dados...</div>`;
    openModal('modal-espelho-pdf');
    try {
      [data, saldoBanco] = await Promise.all([
        api.espelhoPonto(mes, ano, inputFuncId),
        api.saldoAcumuladoHoras(inputFuncId).catch(() => ({ saldoMinutos: 0, saldoFormatado: '00:00', negativo: false }))
      ]);
    } catch (e) {
      document.getElementById('modal-espelho-pdf-body').innerHTML =
        `<div style="padding:24px;color:#c00;text-align:center;">Erro ao carregar dados: ${e.message}</div>`;
      return;
    }
  } else {
    if (!_espelhoCache) { toast('Gere o espelho primeiro.', 'info'); return; }
    data = _espelhoCache;
    saldoBanco = _espelhoSaldoCache || { saldoMinutos: 0, saldoFormatado: '00:00', negativo: false };
    document.getElementById('modal-espelho-pdf-body').innerHTML =
      `<div style="padding:40px;color:#666;text-align:center;">&#9203; Gerando PDF...</div>`;
    openModal('modal-espelho-pdf');
  }

  try {
    const logoB64 = await _getLogoBase64();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const now = new Date();

    // ── Cabeçalho branco com logo ──
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageW, 28, 'F');

    if (logoB64) {
      doc.addImage(logoB64, 'PNG', 10, 4, 52, 13.6);
    }

    // Título alinhado ao centro-direito
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(10, 45, 95);
    doc.text('RELATÓRIO DE PONTO', pageW / 2 + 20, 13, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(80, 120, 180);
    doc.text('Crédito Casa Financiamentos', pageW / 2 + 20, 20, { align: 'center' });

    const genDate = `Emitido em ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    doc.setFontSize(7);
    doc.setTextColor(140, 140, 140);
    doc.text(genDate, pageW - 10, 25, { align: 'right' });

    // Faixa azul na base do cabeçalho
    doc.setFillColor(10, 45, 95);
    doc.rect(0, 28, pageW, 3.5, 'F');
    // Linha dourada
    doc.setFillColor(193, 154, 73);
    doc.rect(0, 31.5, pageW, 1, 'F');

    // ── Box de dados do colaborador ──
    const func = data.funcionario;
    doc.setFillColor(240, 245, 252);
    doc.setDrawColor(180, 200, 230);
    doc.setLineWidth(0.3);
    doc.roundedRect(10, 36, pageW - 20, 18, 2, 2, 'FD');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(10, 45, 95);
    doc.text('DADOS DO COLABORADOR', 14, 42);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(50, 50, 50);
    const iy = 50;
    const cols = [
      [`Nome:`, func.nome],
      [`Cargo:`, func.cargo || '-'],
      [`Departamento:`, func.departamento || '-'],
      [`Período:`, data.periodo],
    ];
    const colW = (pageW - 20) / 4;
    cols.forEach(([label, val], i) => {
      const x = 14 + i * colW;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(10, 45, 95);
      doc.text(label, x, iy);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);
      doc.text(val, x + doc.getTextWidth(label) + 1.5, iy);
    });

    // ── Tabela ──
    const diasSemana = { 'Sun': 'Dom', 'Mon': 'Seg', 'Tue': 'Ter', 'Wed': 'Qua', 'Thu': 'Qui', 'Fri': 'Sex', 'Sat': 'Sáb' };

    const statusTexto = (d) => {
      if (d.status === 'feriado') return d.feriado ? `Feriado: ${d.feriado}` : 'Feriado';
      if (d.status === 'fim_de_semana') return 'Fim de semana';
      if (d.status === 'atestado') {
        const atMin = d.atestadoMinutos || 0;
        const atFmt = atMin >= 60 ? `${Math.floor(atMin/60)}h${atMin%60>0?atMin%60+'min':''}` : atMin > 0 ? `${atMin}min` : '';
        return 'Atestado Médico' + (atFmt ? ` (+${atFmt})` : '');
      }
      if (d.status === 'abono_horas') return 'Abono de Horas';
      if (d.status === 'falta') return 'Falta';
      if (d.status === 'incompleto') return `-${d.diffFormatado}`;
      if (d.status === 'completa') return 'Concluída';
      if (d.status === 'extras') {
        const hh = String(Math.floor(Math.abs(d.diffMinutos) / 60)).padStart(2, '0');
        const mm = String(Math.abs(d.diffMinutos) % 60).padStart(2, '0');
        const extSt = d.extrasStatus === 'aprovado' ? ' ✓' : d.extrasStatus === 'pendente' ? ' (pend.)' : '';
        return `Concluída +${hh}:${mm}${extSt}`;
      }
      return d.status || '-';
    };

    const rowFill = (d) => {
      if (d.status === 'feriado') return [220, 236, 255];
      if (d.status === 'fim_de_semana') return [235, 235, 235];
      if (d.status === 'falta') return [255, 228, 230];
      if (d.status === 'incompleto') return [255, 245, 200];
      if (d.status === 'atestado') return [240, 228, 255];
      if (d.status === 'abono_horas') return [220, 245, 225];
      if (d.status === 'completa' || d.status === 'extras') return [225, 245, 228];
      return null;
    };

    const tableRows = data.dias.map(d => {
      const isDescanso = d.status === 'fim_de_semana' || d.status === 'feriado';
      const dia = new Date(d.data + 'T12:00:00');
      const ds = diasSemana[dia.toLocaleDateString('en', { weekday: 'short' })] || '-';
      const dash = '-';
      return [
        d.data.split('-').reverse().join('/'),
        ds,
        isDescanso ? dash : (d.entrada || dash),
        isDescanso ? dash : (d.saida_almoco || dash),
        isDescanso ? dash : (d.retorno_almoco || dash),
        isDescanso ? dash : (d.saida || dash),
        isDescanso ? dash : (d.trabalhado || dash),
        isDescanso ? dash : (d.abonoMinutos > 0 ? `+${d.abonoMinutos}min` : dash),
        isDescanso ? dash : (d.totalComAbono || d.trabalhado || dash),
        statusTexto(d),
      ];
    });

    doc.autoTable({
      startY: 57,
      head: [['Data', 'Dia', 'Entrada', 'S. Almoço', 'Ret. Almoço', 'Saída', 'Trabalhado', 'Abono', 'Total', 'Status']],
      body: tableRows,
      styles: { fontSize: 7.8, cellPadding: 2.2, valign: 'middle', lineColor: [210, 218, 230], lineWidth: 0.2 },
      headStyles: {
        fillColor: [10, 45, 95],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center',
        fontSize: 8,
        cellPadding: 3,
      },
      columnStyles: {
        0: { cellWidth: 22, halign: 'center' },
        1: { cellWidth: 11, halign: 'center' },
        2: { cellWidth: 19, halign: 'center' },
        3: { cellWidth: 19, halign: 'center' },
        4: { cellWidth: 21, halign: 'center' },
        5: { cellWidth: 19, halign: 'center' },
        6: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
        7: { cellWidth: 18, halign: 'center' },
        8: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
        9: { cellWidth: 'auto', halign: 'left' },
      },
      didParseCell: (h) => {
        if (h.section === 'body') {
          const d = data.dias[h.row.index];
          if (d) {
            const fill = rowFill(d);
            if (fill) h.cell.styles.fillColor = fill;
          }
        }
      },
      didDrawPage: (h) => {
        if (h.pageNumber > 1) {
          doc.setFillColor(255, 255, 255);
          doc.rect(0, 0, pageW, 12, 'F');
          doc.setFillColor(10, 45, 95);
          doc.rect(0, 12, pageW, 2.5, 'F');
          doc.setFillColor(193, 154, 73);
          doc.rect(0, 14.5, pageW, 0.7, 'F');
          doc.setTextColor(10, 45, 95);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.text('RELATÓRIO DE PONTO — Crédito Casa Financiamentos', pageW / 2, 8, { align: 'center' });
        }
      },
      margin: { left: 10, right: 10 },
      alternateRowStyles: { fillColor: [250, 251, 254] },
    });

    // ── Resumo ──
    const finalY = doc.lastAutoTable.finalY + 4;
    if (finalY + 12 < pageH - 10) {
      doc.setFillColor(240, 245, 252);
      doc.setDrawColor(180, 200, 230);
      doc.roundedRect(10, finalY, pageW - 20, 11, 2, 2, 'FD');

      const diasUteis = data.dias.filter(d => d.status !== 'fim_de_semana' && d.status !== 'feriado').length;
      const faltas = data.dias.filter(d => d.status === 'falta').length;
      const bancoSinal = saldoBanco.saldoMinutos > 0 ? '+' : saldoBanco.saldoMinutos < 0 ? '-' : '';
      const bancoColor = saldoBanco.saldoMinutos >= 0 ? [0, 120, 0] : [180, 0, 0];

      const items = [
        [`Dias Úteis:`, `${diasUteis}`],
        [`Faltas:`, `${faltas}`],
        [`Total Trabalhado:`, data.resumo.totalTrabalhado || '-'],
        [`Horas Concedidas:`, data.resumo.totalAbonoConced || '00:00'],
        [`Banco de Horas:`, `${bancoSinal}${saldoBanco.saldoFormatado}`],
      ];

      const lineY = finalY + 7;
      const iW = (pageW - 20) / items.length;
      items.forEach(([label, val], i) => {
        const x = 14 + i * iW;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(80, 80, 80);
        doc.text(label, x, lineY);
        const labelW = doc.getTextWidth(label);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        if (i === items.length - 1) doc.setTextColor(...bancoColor);
        else doc.setTextColor(10, 45, 95);
        doc.text(val, x + labelW + 1.5, lineY);
      });
    }

    // ── Rodapé em todas as páginas ──
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(160, 160, 160);
      doc.setFont('helvetica', 'normal');
      doc.line(10, pageH - 8, pageW - 10, pageH - 8);
      doc.text(
        `Crédito Casa Financiamentos  |  Relatório gerado automaticamente em ${now.toLocaleDateString('pt-BR')}  |  Página ${i} de ${pageCount}`,
        pageW / 2, pageH - 4, { align: 'center' }
      );
    }

    // ── Exibir no modal ──
    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);
    const fileName = `Espelho_${func.nome.replace(/\s+/g, '_')}_${data.periodo.replace(/\//g, '-')}.pdf`;

    document.getElementById('modal-espelho-pdf-body').innerHTML =
      `<iframe src="${blobUrl}" style="width:100%;height:75vh;border:none;display:block;"></iframe>`;

    const btnBaixar = document.getElementById('btn-baixar-espelho-pdf');
    btnBaixar.href = blobUrl;
    btnBaixar.download = fileName;

  } catch (e) {
    console.error('Erro ao gerar PDF:', e);
    document.getElementById('modal-espelho-pdf-body').innerHTML =
      `<div style="padding:24px;color:#c00;text-align:center;">Erro ao gerar PDF: ${e.message}</div>`;
  }
}


// ==================== CONFIGURAÇÕES ====================
async function loadConfiguracoes() {
  if (!OfflineManager.isOnline()) { _offlinePage('page-configuracoes', 'Configurações indisponível offline'); return; }
  try {
    // Tolerância
    const tol = await api.buscarTolerancia();
    document.getElementById('config-tolerancia').value = tol.minutos;

    // Feriados
    const ano = new Date().getFullYear();
    const feriados = await api.listarFeriados(ano);
    document.getElementById('feriados-body').innerHTML = feriados.map(f => {
      const dataStr = typeof f.data === 'string' ? f.data.substring(0, 10) : new Date(f.data).toISOString().substring(0, 10);
      const parts = dataStr.split('-');
      const dataFormatada = parts[2] + '/' + parts[1] + '/' + parts[0];
      return `<tr>
        <td>${dataFormatada}</td>
        <td>${f.descricao}</td>
        <td><button class="btn btn-sm btn-danger" onclick="removerFeriado('${f.id}')">Remover</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="3" class="text-center text-muted">Nenhum feriado cadastrado</td></tr>';

    // Perfis de horário
    await loadPerfisHorario();

  } catch (err) { toast(err.message, 'error'); }
}

document.getElementById('btn-salvar-tolerancia').addEventListener('click', async () => {
  try {
    const min = parseInt(document.getElementById('config-tolerancia').value);
    await api.salvarTolerancia(min);
    toast('Tolerância atualizada!', 'success');
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('btn-novo-feriado').addEventListener('click', () => {
  document.getElementById('feriado-data').value = '';
  document.getElementById('feriado-descricao').value = '';
  openModal('modal-feriado');
});

document.getElementById('btn-salvar-feriado').addEventListener('click', async () => {
  try {
    await api.cadastrarFeriado(
      document.getElementById('feriado-data').value,
      document.getElementById('feriado-descricao').value
    );
    toast('Feriado cadastrado!', 'success');
    closeModal('modal-feriado');
    loadConfiguracoes();
  } catch (err) { toast(err.message, 'error'); }
});

async function removerFeriado(id) {
  const ok = await showConfirm('Remover este feriado?', { title: '🗑️ Remover feriado', okText: 'Remover', variant: 'danger' });
  if (!ok) return;
  try {
    await api.removerFeriado(id);
    toast('Feriado removido', 'success');
    loadConfiguracoes();
  } catch (err) { toast(err.message, 'error'); }
}

// ==================== PERFIS DE HORÁRIO ====================
async function loadPerfisHorario() {
  try {
    const perfis = await api.listarPerfisHorario();
    const tbody = document.getElementById('perfis-horario-body');
    if (!tbody) return;

    tbody.innerHTML = perfis.map(p => {
      const entrada = (p.hora_entrada || '').substring(0, 5);
      const saidaAlm = (p.hora_saida_almoco || '').substring(0, 5);
      const retornoAlm = (p.hora_retorno_almoco || '').substring(0, 5);
      const saida = (p.hora_saida || '').substring(0, 5);
      const jornada = calcJornadaPerfil(p);
      return `<tr>
        <td><strong>${p.nome}</strong></td>
        <td>${entrada}</td>
        <td>${saidaAlm || '-'}</td>
        <td>${retornoAlm || '-'}</td>
        <td>${saida}</td>
        <td>${jornada}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="editarPerfil('${p.id}')">Editar</button>
          <button class="btn btn-sm btn-danger" onclick="excluirPerfil('${p.id}')">Excluir</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="text-center text-muted">Nenhum perfil cadastrado</td></tr>';

    // Atualizar dropdowns de perfil em outros lugares
    await populatePerfilDropdowns(perfis);
  } catch (err) { toast(err.message, 'error'); }
}

function calcJornadaPerfil(p) {
  if (!p.hora_entrada || !p.hora_saida) return '-';
  const toMin = (t) => { const parts = t.split(':'); return parseInt(parts[0]) * 60 + parseInt(parts[1]); };
  const entrada = toMin(p.hora_entrada);
  const saida = toMin(p.hora_saida);
  let totalMin = saida - entrada;
  if (p.hora_saida_almoco && p.hora_retorno_almoco) {
    totalMin -= (toMin(p.hora_retorno_almoco) - toMin(p.hora_saida_almoco));
  }
  const dias = p.dias_trabalho ? p.dias_trabalho.split(',').length : 5;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const semanal = ((totalMin * dias) / 60).toFixed(1);
  return `${h}h${m > 0 ? m + 'min' : ''}/dia (${semanal}h/sem)`;
}

async function populatePerfilDropdowns(perfis) {
  if (!perfis) perfis = await api.listarPerfisHorario();
  const selects = document.querySelectorAll('#func-perfil-horario');
  selects.forEach(sel => {
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">Nenhum (definir manualmente)</option>' +
      perfis.map(p => `<option value="${p.id}">${p.nome} (${(p.hora_entrada||'').substring(0,5)} - ${(p.hora_saida||'').substring(0,5)})</option>`).join('');
    if (currentVal) sel.value = currentVal;
  });
}

document.getElementById('btn-novo-perfil').addEventListener('click', () => {
  document.getElementById('modal-perfil-title').textContent = 'Novo Perfil de Horário';
  document.getElementById('perfil-id').value = '';
  document.getElementById('perfil-nome').value = '';
  document.getElementById('perfil-entrada').value = '';
  document.getElementById('perfil-saida-almoco').value = '';
  document.getElementById('perfil-retorno-almoco').value = '';
  document.getElementById('perfil-saida').value = '';
  document.getElementById('perfil-jornada-calc').textContent = '-';
  // Reset dias: marcar seg-sex
  document.querySelectorAll('#perfil-dias input').forEach(cb => {
    cb.checked = ['1','2','3','4','5'].includes(cb.value);
  });
  openModal('modal-perfil-horario');
});

async function editarPerfil(id) {
  try {
    const p = await api.buscarPerfilHorario(id);
    document.getElementById('modal-perfil-title').textContent = 'Editar Perfil de Horário';
    document.getElementById('perfil-id').value = p.id;
    document.getElementById('perfil-nome').value = p.nome;
    document.getElementById('perfil-entrada').value = (p.hora_entrada || '').substring(0, 5);
    document.getElementById('perfil-saida-almoco').value = (p.hora_saida_almoco || '').substring(0, 5);
    document.getElementById('perfil-retorno-almoco').value = (p.hora_retorno_almoco || '').substring(0, 5);
    document.getElementById('perfil-saida').value = (p.hora_saida || '').substring(0, 5);
    const diasAtivos = (p.dias_trabalho || '1,2,3,4,5').split(',');
    document.querySelectorAll('#perfil-dias input').forEach(cb => {
      cb.checked = diasAtivos.includes(cb.value);
    });
    updatePerfilJornadaCalc();
    openModal('modal-perfil-horario');
  } catch (err) { toast(err.message, 'error'); }
}

async function excluirPerfil(id) {
  const ok = await showConfirm('Excluir este perfil? Os colaboradores vinculados ficarão sem perfil.', { title: '🗑️ Excluir perfil', okText: 'Excluir', variant: 'danger' });
  if (!ok) return;
  try {
    await api.excluirPerfilHorario(id);
    toast('Perfil removido', 'success');
    loadPerfisHorario();
  } catch (err) { toast(err.message, 'error'); }
}

document.getElementById('btn-salvar-perfil').addEventListener('click', async () => {
  const id = document.getElementById('perfil-id').value;
  const diasChecked = [];
  document.querySelectorAll('#perfil-dias input:checked').forEach(cb => diasChecked.push(cb.value));

  const dados = {
    nome: document.getElementById('perfil-nome').value,
    hora_entrada: document.getElementById('perfil-entrada').value,
    hora_saida_almoco: document.getElementById('perfil-saida-almoco').value || null,
    hora_retorno_almoco: document.getElementById('perfil-retorno-almoco').value || null,
    hora_saida: document.getElementById('perfil-saida').value,
    dias_trabalho: diasChecked.join(',')
  };

  if (!dados.nome || !dados.hora_entrada || !dados.hora_saida) {
    toast('Nome, entrada e saída são obrigatórios', 'error');
    return;
  }

  try {
    if (id) {
      await api.editarPerfilHorario(id, dados);
      toast('Perfil atualizado!', 'success');
    } else {
      await api.criarPerfilHorario(dados);
      toast('Perfil criado!', 'success');
    }
    closeModal('modal-perfil-horario');
    loadPerfisHorario();
  } catch (err) { toast(err.message, 'error'); }
});

function updatePerfilJornadaCalc() {
  const entrada = document.getElementById('perfil-entrada').value;
  const saida = document.getElementById('perfil-saida').value;
  const saidaAlm = document.getElementById('perfil-saida-almoco').value;
  const retornoAlm = document.getElementById('perfil-retorno-almoco').value;
  const diasChecked = document.querySelectorAll('#perfil-dias input:checked').length;
  const el = document.getElementById('perfil-jornada-calc');

  if (!entrada || !saida) { el.textContent = '-'; return; }
  const calc = calcJornadaPerfil({
    hora_entrada: entrada, hora_saida: saida,
    hora_saida_almoco: saidaAlm, hora_retorno_almoco: retornoAlm,
    dias_trabalho: Array.from(document.querySelectorAll('#perfil-dias input:checked')).map(c => c.value).join(',')
  });
  el.textContent = calc;
}

['perfil-entrada', 'perfil-saida', 'perfil-saida-almoco', 'perfil-retorno-almoco'].forEach(id => {
  document.getElementById(id).addEventListener('change', updatePerfilJornadaCalc);
});
document.querySelectorAll('#perfil-dias input').forEach(cb => {
  cb.addEventListener('change', updatePerfilJornadaCalc);
});

// Dropdown de perfil no form de colaborador
document.getElementById('func-perfil-horario').addEventListener('change', async (e) => {
  const perfilId = e.target.value;
  const info = document.getElementById('func-perfil-info');
  if (!perfilId) { info.textContent = ''; return; }
  try {
    const p = await api.buscarPerfilHorario(perfilId);
    const jornada = calcJornadaPerfil(p);
    info.textContent = `${(p.hora_entrada||'').substring(0,5)} - ${(p.hora_saida||'').substring(0,5)} | ${jornada}`;
    // Atualizar jornada semanal automaticamente
    if (p.hora_entrada && p.hora_saida) {
      const toMin = (t) => { const parts = t.split(':'); return parseInt(parts[0]) * 60 + parseInt(parts[1]); };
      let totalMin = toMin(p.hora_saida) - toMin(p.hora_entrada);
      if (p.hora_saida_almoco && p.hora_retorno_almoco) {
        totalMin -= (toMin(p.hora_retorno_almoco) - toMin(p.hora_saida_almoco));
      }
      const dias = p.dias_trabalho ? p.dias_trabalho.split(',').length : 5;
      document.getElementById('func-jornada').value = ((totalMin * dias) / 60).toFixed(1);
    }
  } catch (err) { info.textContent = ''; }
});

// ==================== ABONOS ====================
const ABONO_TIPOS = {
  'atestado': 'Atestado Médico',
  'abono_horas': 'Abono de Horas',
  'compensacao': 'Compensação'
};

function formatAbonoPeriodo(a) {
  const ini = typeof a.data_inicio === 'string' ? a.data_inicio.substring(0, 10) : new Date(a.data_inicio).toISOString().substring(0, 10);
  const fim = typeof a.data_fim === 'string' ? a.data_fim.substring(0, 10) : new Date(a.data_fim).toISOString().substring(0, 10);
  const iniF = ini.split('-').reverse().join('/');
  const fimF = fim.split('-').reverse().join('/');
  return ini === fim ? iniF : iniF + ' a ' + fimF;
}

function formatAbonoHoras(a) {
  if (a.hora_inicio && a.hora_fim) {
    const [hi, mi] = a.hora_inicio.split(':').map(Number);
    const [hf, mf] = a.hora_fim.split(':').map(Number);
    const diffMin = (hf * 60 + mf) - (hi * 60 + mi);
    const h = Math.floor(Math.abs(diffMin) / 60);
    const m = Math.abs(diffMin) % 60;
    const diff = h > 0 ? `${h}h${m > 0 ? m + 'min' : ''}` : `${m}min`;
    return `${a.hora_inicio}–${a.hora_fim} <small class="text-muted">(${diff})</small>`;
  }
  if (a.horas) return a.horas + 'h';
  return 'Dia inteiro';
}

// Meus Abonos (colaborador)
async function loadMeusAbonos() {
  if (!OfflineManager.isOnline()) { _offlinePage('meus-abonos-body', 'Abonos indisponível offline'); return; }
  try {
    const abonos = await api.meusAbonos();
    document.getElementById('meus-abonos-body').innerHTML = abonos.map(a => {
      const docCell = a.arquivo_url
        ? `<button class="btn btn-xs btn-secondary" onclick="verDocumentoAbono('${a.arquivo_url.replace(/'/g, "\\'")}')">&#128196; Ver</button>`
        : '-';
      return `
      <tr>
        <td><span class="badge badge-info">${ABONO_TIPOS[a.tipo] || a.tipo}</span></td>
        <td>${formatAbonoPeriodo(a)}</td>
        <td>${formatAbonoHoras(a)}</td>
        <td>${a.motivo}</td>
        <td>${docCell}</td>
        <td>${getStatusBadge(a.status)}${a.motivo_rejeicao ? '<br><small class="text-danger">' + a.motivo_rejeicao + '</small>' : ''}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="text-center text-muted">Nenhum abono solicitado</td></tr>';
  } catch (err) { toast(err.message, 'error'); }
}

async function _toggleAbanoArquivo() {
  const tipo = document.getElementById('abono-tipo').value;
  const group = document.getElementById('abono-arquivo-group');
  const saldoGroup = document.getElementById('abono-horas-saldo-group');
  const saldoCard = document.getElementById('abono-saldo-card');
  const saldoLabel = document.getElementById('abono-saldo-label');
  const saldoHint = document.getElementById('abono-saldo-hint');
  const saldoDisplay = document.getElementById('abono-horas-saldo-display');
  const fmt = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

  if (tipo === 'atestado') group.classList.remove('hidden');
  else group.classList.add('hidden');

  if (tipo === 'abono_horas') {
    saldoGroup.classList.remove('hidden');
    if (saldoDisplay) { saldoDisplay.textContent = '...'; saldoDisplay.dataset.minutos = '0'; }
    try {
      const banco = await api.saldoAcumuladoHoras();
      const sinal = banco.saldoMinutos > 0 ? '+' : banco.saldoMinutos < 0 ? '-' : '';
      if (saldoCard) {
        saldoCard.style.background = banco.saldoMinutos >= 0 ? '#f0fdf4' : '#fff5f5';
        saldoCard.style.borderColor = banco.saldoMinutos >= 0 ? '#bbf7d0' : '#fca5a5';
      }
      if (saldoLabel) {
        saldoLabel.textContent = banco.saldoMinutos >= 0 ? 'Banco de Horas (saldo positivo)' : 'Banco de Horas (saldo negativo)';
        saldoLabel.style.color = banco.saldoMinutos >= 0 ? '#166534' : '#9a1212';
      }
      if (saldoHint) {
        saldoHint.textContent = banco.saldoMinutos > 0
          ? 'Você tem horas no banco. Pode solicitar para usar como descanso.'
          : banco.saldoMinutos < 0
            ? 'Você está com horas negativas. Solicite ao admin para abonar.'
            : 'Seu banco de horas está zerado.';
      }
      if (saldoDisplay) {
        saldoDisplay.style.color = banco.saldoMinutos >= 0 ? '#166534' : '#c62828';
        saldoDisplay.textContent = sinal + banco.saldoFormatado;
        saldoDisplay.dataset.minutos = banco.saldoMinutos;
      }
    } catch(e) { if (saldoDisplay) saldoDisplay.textContent = '00:00'; }
  } else {
    saldoGroup.classList.add('hidden');
  }
}

document.getElementById('abono-tipo').addEventListener('change', _toggleAbanoArquivo);

document.getElementById('abono-arquivo').addEventListener('change', () => {
  const file = document.getElementById('abono-arquivo').files[0];
  const preview = document.getElementById('abono-arquivo-preview');
  if (!file) { preview.classList.add('hidden'); preview.innerHTML = ''; return; }
  preview.classList.remove('hidden');
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${url}" style="max-width:100%;max-height:200px;border-radius:6px;border:1px solid #ddd;">`;
  } else {
    preview.innerHTML = `<span style="font-size:13px;color:#555;">&#128196; ${file.name}</span>`;
  }
});

document.getElementById('btn-solicitar-abono').addEventListener('click', () => {
  document.getElementById('abono-tipo').value = 'atestado';
  document.getElementById('abono-data-inicio').value = '';
  document.getElementById('abono-data-fim').value = '';
  document.getElementById('abono-hora-inicio').value = '';
  document.getElementById('abono-hora-fim').value = '';
  document.getElementById('abono-motivo').value = '';
  document.getElementById('abono-arquivo').value = '';
  document.getElementById('abono-arquivo-preview').innerHTML = '';
  document.getElementById('abono-arquivo-preview').classList.add('hidden');
  _toggleAbanoArquivo();
  openModal('modal-abono');
});

document.getElementById('btn-salvar-abono').addEventListener('click', async () => {
  const tipo = document.getElementById('abono-tipo').value;
  const data_inicio = document.getElementById('abono-data-inicio').value;
  const data_fim = document.getElementById('abono-data-fim').value;
  const hora_inicio = document.getElementById('abono-hora-inicio').value;
  const hora_fim = document.getElementById('abono-hora-fim').value;
  const motivo = document.getElementById('abono-motivo').value;

  // Calcular diferença em horas decimais se ambos os campos preenchidos
  let horas = null;
  if (hora_inicio && hora_fim) {
    const [hi, mi] = hora_inicio.split(':').map(Number);
    const [hf, mf] = hora_fim.split(':').map(Number);
    const diffMin = (hf * 60 + mf) - (hi * 60 + mi);
    if (diffMin <= 0) { toast('Hora fim deve ser maior que hora início', 'error'); return; }
    horas = +(diffMin / 60).toFixed(2);
  }

  if (!data_inicio || !data_fim || !motivo) {
    toast('Preencha data início, data fim e motivo', 'error');
    return;
  }

  // Abono de Horas: banco zerado não faz sentido solicitar
  if (tipo === 'abono_horas') {
    const saldoEl = document.getElementById('abono-horas-saldo-display');
    const saldoMin = parseInt(saldoEl && saldoEl.dataset.minutos || '0', 10);
    if (saldoMin === 0) { toast('Seu banco de horas está zerado. Não há nada a abonar.', 'error'); return; }
  }

  const btn = document.getElementById('btn-salvar-abono');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    let arquivo_url = null;
    if (tipo === 'atestado') {
      const file = document.getElementById('abono-arquivo').files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) { toast('Arquivo muito grande. Máximo 5 MB.', 'error'); return; }
        btn.textContent = 'Enviando documento...';
        const uid = currentUser && currentUser.id;
        const ext = file.name.split('.').pop();
        const path = `atestados/${uid}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const ref = fbStorage.ref(path);
        await ref.put(file);
        arquivo_url = await ref.getDownloadURL();
      }
    }
    await api.solicitarAbono({ tipo, data_inicio, data_fim, hora_inicio: hora_inicio || null, hora_fim: hora_fim || null, horas: horas || null, motivo, arquivo_url });
    toast('Solicitação de abono enviada!', 'success');
    closeModal('modal-abono');
    loadMeusAbonos();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar Solicitação';
  }
});

// Abonos Admin
async function loadAbonosAdmin() {
  if (!OfflineManager.isOnline()) { _offlinePage('abonos-admin-body', 'Abonos indisponível offline'); return; }
  try {
    const status = document.getElementById('abonos-filtro-status').value;
    const tipo = document.getElementById('abonos-filtro-tipo').value;
    const abonos = await api.todosAbonos({ status, tipo });

    document.getElementById('abonos-admin-body').innerHTML = abonos.map(a => {
      const arquivoEscapado = (a.arquivo_url || '').replace(/'/g, "\\'");
      const acoes = `<div class="btn-group">
        ${a.status === 'pendente' ? `
          <button class="btn btn-sm btn-success" onclick="aprovarAbono('${a.id}')">Aprovar</button>
          <button class="btn btn-sm btn-danger" onclick="abrirRejeicaoAbono('${a.id}')">Rejeitar</button>` : ''}
        <button class="btn btn-sm btn-danger" onclick="excluirAbono('${a.id}','${arquivoEscapado}')" title="Excluir registro">&#128465; Excluir</button>
      </div>`;

      const docCell = a.arquivo_url
        ? `<button class="btn btn-xs btn-secondary" onclick="verDocumentoAbono('${a.arquivo_url.replace(/'/g, "\\'")}')">&#128196; Ver</button>`
        : '-';

      return `<tr>
        <td><strong>${a.funcionario_nome}</strong><br><small class="text-muted">${a.departamento || ''}</small></td>
        <td><span class="badge badge-info">${ABONO_TIPOS[a.tipo] || a.tipo}</span></td>
        <td>${formatAbonoPeriodo(a)}</td>
        <td>${formatAbonoHoras(a)}</td>
        <td>${a.motivo}</td>
        <td>${docCell}</td>
        <td>${getStatusBadge(a.status)}${a.motivo_rejeicao ? '<br><small class="text-danger">' + a.motivo_rejeicao + '</small>' : ''}</td>
        <td>${acoes}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="text-center text-muted">Nenhum abono encontrado</td></tr>';
  } catch (err) { toast(err.message, 'error'); }
}

async function aprovarAbono(id) {
  const ok = await showConfirm('Aprovar este abono?', { title: '✓ Aprovar abono', okText: 'Aprovar' });
  if (!ok) return;
  try {
    await api.aprovarAbono(id);
    toast('Abono aprovado!', 'success');
    loadAbonosAdmin();
  } catch (err) { toast(err.message, 'error'); }
}

function abrirRejeicaoAbono(id) {
  document.getElementById('rejeitar-abono-id').value = id;
  document.getElementById('rejeitar-abono-motivo').value = '';
  openModal('modal-rejeitar-abono');
}

function verDocumentoAbono(url) {
  const body = document.getElementById('modal-documento-body');
  const isImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url);
  if (isImage) {
    body.innerHTML = `<div style="text-align:center;background:#f5f5f5;padding:16px;">
      <img src="${url}" style="max-width:100%;max-height:75vh;border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,.15);">
    </div>`;
  } else {
    body.innerHTML = `<iframe src="${url}" style="width:100%;height:75vh;border:none;display:block;"></iframe>`;
  }
  document.getElementById('btn-baixar-documento').href = url;
  openModal('modal-ver-documento');
}

async function excluirAbono(id, arquivoUrl) {
  const ok = await showConfirm('Excluir este registro de abono? A ação é irreversível e remove o documento anexado.', { title: '🗑️ Excluir abono', okText: 'Excluir', variant: 'danger' });
  if (!ok) return;
  try {
    await api.excluirAbono(id, arquivoUrl || null);
    toast('Abono excluído com sucesso.', 'success');
    loadAbonosAdmin();
  } catch (err) {
    toast(err.message || 'Erro ao excluir abono', 'error');
  }
}

document.getElementById('btn-confirmar-rejeitar-abono').addEventListener('click', async () => {
  const id = document.getElementById('rejeitar-abono-id').value;
  const motivo = document.getElementById('rejeitar-abono-motivo').value;
  try {
    await api.rejeitarAbono(id, motivo);
    toast('Abono rejeitado', 'success');
    closeModal('modal-rejeitar-abono');
    loadAbonosAdmin();
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('abonos-filtro-status').addEventListener('change', loadAbonosAdmin);
document.getElementById('abonos-filtro-tipo').addEventListener('change', loadAbonosAdmin);

// ==================== APP VERSION ====================
const APP_VERSION = '2.3.0';

async function loadAppVersion() {
  const el = document.getElementById('app-version');
  if (el) el.textContent = 'v' + APP_VERSION;
}

function showUpdateProgress(label, pct) {
  const wrap = document.getElementById('update-progress-wrap');
  const lbl = document.getElementById('update-progress-label');
  const fill = document.getElementById('update-progress-fill');
  const pctEl = document.getElementById('update-progress-pct');
  if (!wrap) return;
  wrap.classList.remove('hidden');
  if (lbl) lbl.textContent = label;
  if (fill) fill.style.width = (pct || 0) + '%';
  if (pctEl) pctEl.textContent = Math.round(pct || 0) + '%';
}

function hideUpdateProgress() {
  const wrap = document.getElementById('update-progress-wrap');
  if (wrap) wrap.classList.add('hidden');
}

// ==================== AUTO UPDATE UI ====================
function setupUpdateListener() {
  window.addEventListener('update-status', function(e) {
    var data = e.detail;
    var banner = document.getElementById('update-banner');
    var title = document.getElementById('update-title');
    var message = document.getElementById('update-message');
    var progressBar = document.getElementById('update-progress-bar');
    var progressFill = document.getElementById('update-progress-fill');

    if (!banner) return;

    switch (data.status) {
      case 'checking':
        banner.classList.remove('hidden');
        title.textContent = 'Verificando atualizacoes...';
        message.textContent = '';
        progressBar.classList.add('hidden');
        showUpdateProgress('Verificando atualizações...', 0);
        // Esconder apos 3s se nao tiver update
        setTimeout(function() {
          if (title.textContent === 'Verificando atualizacoes...') {
            banner.classList.add('hidden');
            hideUpdateProgress();
          }
        }, 3000);
        break;

      case 'available':
        banner.classList.remove('hidden');
        title.textContent = 'Nova versao disponivel!';
        message.textContent = data.message;
        progressBar.classList.remove('hidden');
        progressFill.style.width = '0%';
        showUpdateProgress('Baixando v' + (data.version || '') + '...', 0);
        break;

      case 'downloading':
        banner.classList.remove('hidden');
        title.textContent = 'Baixando atualizacao...';
        message.textContent = data.percent + '% concluido';
        progressBar.classList.remove('hidden');
        progressFill.style.width = data.percent + '%';
        showUpdateProgress('Baixando atualização... ' + data.percent + '%', data.percent);
        break;

      case 'downloaded':
        banner.classList.remove('hidden');
        title.textContent = 'Atualizacao pronta!';
        message.textContent = 'O sistema sera reiniciado em instantes para aplicar a versao ' + (data.version || 'nova') + '.';
        progressBar.classList.add('hidden');
        showUpdateProgress('Instalando v' + (data.version || '') + '...', 100);
        break;

      case 'installing':
        showUpdateProgress('Instalando atualização... ' + (data.percent || 0) + '%', data.percent || 0);
        break;

      case 'up-to-date':
        banner.classList.remove('hidden');
        title.textContent = 'Sistema atualizado';
        message.textContent = 'Voce ja esta na versao mais recente.';
        progressBar.classList.add('hidden');
        hideUpdateProgress();
        setTimeout(function() { banner.classList.add('hidden'); }, 3000);
        break;

      case 'error':
        hideUpdateProgress();
        break;
    }
  });
}

// ==================== HELPERS ====================
function pad(n) { return String(n).padStart(2, '0'); }

function formatDateISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateBR(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateBRFull(d) {
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${dias[d.getDay()]}, ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

function getStatusBadge(status) {
  const badges = {
    'normal': '',
    'fim_de_semana': '<span class="badge badge-gray">\u{1F334} Final de Semana</span>',
    'feriado': '<span class="badge badge-info">\u{1F334} Feriado</span>',
    'falta': '<span class="badge badge-danger">Falta</span>',
    'atestado': '<span class="badge badge-warning">Atestado</span>',
    'sem_registro': '<span class="badge badge-danger">Sem Registro</span>',
    'pendente': '<span class="badge badge-warning">Pendente</span>',
    'aprovado': '<span class="badge badge-success">Aprovado</span>',
    'rejeitado': '<span class="badge badge-danger">Rejeitado</span>'
  };
  return badges[status] || '';
}

function populateMonthSelectors() {
  const now = new Date();
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const mesSelectors = ['espelho-mes', 'rel-mes'];
  const anoSelectors = ['espelho-ano', 'rel-ano'];

  mesSelectors.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = meses.map((m, i) =>
      `<option value="${i + 1}" ${i === now.getMonth() ? 'selected' : ''}>${m}</option>`
    ).join('');
  });

  anoSelectors.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) {
      sel.innerHTML += `<option value="${y}" ${y === now.getFullYear() ? 'selected' : ''}>${y}</option>`;
    }
  });
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// Modal de confirmação: substitui window.confirm
// Uso: const ok = await showConfirm('Texto', { title, okText, cancelText, variant: 'danger'|'primary' })
function showConfirm(message, options = {}) {
  return new Promise((resolve) => {
    const titulo = options.title || 'Confirmar';
    const okText = options.okText || 'Confirmar';
    const cancelText = options.cancelText || 'Cancelar';
    const variant = options.variant || 'primary';

    document.getElementById('confirmar-generico-titulo').textContent = titulo;
    document.getElementById('confirmar-generico-mensagem').textContent = message;
    const btnOk = document.getElementById('btn-confirmar-generico-ok');
    const btnCancel = document.getElementById('btn-confirmar-generico-cancelar');
    btnOk.textContent = okText;
    btnCancel.textContent = cancelText;
    btnOk.className = variant === 'danger' ? 'btn btn-danger' : 'btn btn-primary';

    const cleanup = () => {
      btnOk.onclick = null;
      btnCancel.onclick = null;
      closeModal('modal-confirmar-generico');
    };
    btnOk.onclick = () => { cleanup(); resolve(true); };
    btnCancel.onclick = () => { cleanup(); resolve(false); };
    openModal('modal-confirmar-generico');
  });
}

// Modal de prompt: substitui window.prompt — resolve com string ou null (cancelado)
function showPrompt(message, options = {}) {
  return new Promise((resolve) => {
    const titulo = options.title || 'Informe';
    const okText = options.okText || 'OK';
    const cancelText = options.cancelText || 'Cancelar';
    const placeholder = options.placeholder || '';
    const defaultVal = options.default || '';

    document.getElementById('prompt-generico-titulo').textContent = titulo;
    document.getElementById('prompt-generico-mensagem').textContent = message;
    const input = document.getElementById('prompt-generico-input');
    input.value = defaultVal;
    input.placeholder = placeholder;
    const btnOk = document.getElementById('btn-prompt-generico-ok');
    const btnCancel = document.getElementById('btn-prompt-generico-cancelar');
    btnOk.textContent = okText;
    btnCancel.textContent = cancelText;

    const cleanup = () => {
      btnOk.onclick = null;
      btnCancel.onclick = null;
      input.onkeydown = null;
      closeModal('modal-prompt-generico');
    };
    btnOk.onclick = () => { const val = input.value; cleanup(); resolve(val); };
    btnCancel.onclick = () => { cleanup(); resolve(null); };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); btnOk.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); btnCancel.click(); }
    };
    openModal('modal-prompt-generico');
    setTimeout(() => input.focus(), 60);
  });
}

function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = msg;
  container.appendChild(el);
  setTimeout(() => { el.remove(); }, 4000);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ==================== HOLERITES ====================
const MESES_NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ---- ADMIN ----
let _holeriteColabsCache = null;

async function _carregarColaboradoresHolerite() {
  if (_holeriteColabsCache) return _holeriteColabsCache;
  const data = await api.listarFuncionarios({ page: 1, limit: 200, ativo: '1', role: 'funcionario' });
  _holeriteColabsCache = data.funcionarios || [];
  return _holeriteColabsCache;
}

async function loadHoleritesAdmin() {
  if (!navigator.onLine) { _offlinePage('holerites-admin-body', 'Holerites'); return; }
  const tbody = document.getElementById('holerites-admin-body');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Carregando...</td></tr>';

  try {
    const colabs = await _carregarColaboradoresHolerite();

    // Popular filtros (só uma vez)
    const filtroColab = document.getElementById('holerite-filtro-colab');
    const filtroAno = document.getElementById('holerite-filtro-ano');
    if (filtroColab.options.length <= 1) {
      colabs.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.nome;
        filtroColab.appendChild(opt);
      });
    }
    if (filtroAno.options.length <= 1) {
      const anoAtual = new Date().getFullYear();
      for (let a = anoAtual; a >= anoAtual - 3; a--) {
        const opt = document.createElement('option');
        opt.value = a; opt.textContent = a;
        filtroAno.appendChild(opt);
      }
    }

    // Mapa uid → nome
    const nomeMap = {};
    colabs.forEach(c => { nomeMap[c.id] = c.nome; });

    function _renderHoleritesAdmin(holerites) {
      if (!holerites.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Nenhum holerite encontrado.</td></tr>';
        return;
      }
      tbody.innerHTML = holerites.map(h => {
        const nomeMes = MESES_NOMES[(h.mes || 1) - 1];
        const nomeColab = nomeMap[h.uid] || h.uid;
        const enviadoEm = h.uploaded_at ? new Date(h.uploaded_at).toLocaleString('pt-BR') : '-';
        const lido = h.lido ? '<span class="badge badge-success">Visto</span>' : '<span class="badge badge-warning">Novo</span>';
        return `<tr>
          <td>${nomeColab}</td>
          <td><strong>${nomeMes} ${h.ano}</strong></td>
          <td>${enviadoEm}</td>
          <td class="holerite-status-cell" data-uid="${h.uid}" data-key="${h.key}">${lido}</td>
          <td>
            <a href="${h.url}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary">&#128196; Ver</a>
            <button class="btn btn-sm btn-danger" onclick="excluirHolerite('${h.uid}','${h.key}','${nomeColab}','${nomeMes} ${h.ano}')">Excluir</button>
          </td>
        </tr>`;
      }).join('');
    }

    // Carga inicial
    const filtroColabVal = filtroColab.value;
    const filtroAnoVal = filtroAno.value;
    const initial = await api.listarHoleritesAdmin(filtroColabVal || null, filtroAnoVal || null);
    _renderHoleritesAdmin(initial);

    // Listener em tempo real — atualiza células de status quando colaborador visualiza
    if (_holeriteAdminRef) _holeriteAdminRef.off();
    _holeriteAdminRef = fbDb.ref('holerites');
    _holeriteAdminRef.on('value', snap => {
      if (currentPage !== 'holerites-admin') return;
      const data = snap.val() || {};
      document.querySelectorAll('.holerite-status-cell').forEach(cell => {
        const uid = cell.dataset.uid;
        const key = cell.dataset.key;
        const lido = data[uid]?.[key]?.lido;
        cell.innerHTML = lido
          ? '<span class="badge badge-success">Visto</span>'
          : '<span class="badge badge-warning">Novo</span>';
      });
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">${err.message}</td></tr>`;
  }
}

document.getElementById('holerite-filtro-colab').addEventListener('change', () => loadHoleritesAdmin());
document.getElementById('holerite-filtro-ano').addEventListener('change', () => loadHoleritesAdmin());

document.getElementById('btn-novo-holerite').addEventListener('click', async () => {
  document.getElementById('holerite-colaborador').innerHTML = '<option value="">Carregando...</option>';
  document.getElementById('holerite-arquivo').value = '';
  document.getElementById('holerite-upload-info').classList.add('hidden');
  document.getElementById('holerite-upload-info').textContent = '';
  const anoAtual = new Date().getFullYear();
  document.getElementById('holerite-ano').value = anoAtual;
  const mesAtual = new Date().getMonth() + 1;
  document.getElementById('holerite-mes').value = mesAtual;
  openModal('modal-holerite');

  try {
    const colabs = await _carregarColaboradoresHolerite();
    const sel = document.getElementById('holerite-colaborador');
    sel.innerHTML = '<option value="">Selecione o colaborador...</option>';
    colabs.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.nome;
      sel.appendChild(opt);
    });
  } catch (err) {
    document.getElementById('holerite-colaborador').innerHTML = `<option value="">${err.message}</option>`;
  }
});

document.getElementById('btn-salvar-holerite').addEventListener('click', async () => {
  const uid = document.getElementById('holerite-colaborador').value;
  const mes = document.getElementById('holerite-mes').value;
  const ano = document.getElementById('holerite-ano').value;
  const fileInput = document.getElementById('holerite-arquivo');
  const file = fileInput.files[0];

  if (!uid) { toast('Selecione o colaborador.', 'error'); return; }
  if (!mes || !ano) { toast('Informe mês e ano.', 'error'); return; }
  if (!file) { toast('Selecione o arquivo PDF.', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Arquivo muito grande. Máximo 5 MB.', 'error'); return; }

  const btn = document.getElementById('btn-salvar-holerite');
  btn.disabled = true; btn.textContent = 'Enviando...';
  const info = document.getElementById('holerite-upload-info');
  info.classList.remove('hidden');
  info.textContent = 'Fazendo upload do PDF...';

  try {
    await api.uploadHolerite(uid, Number(ano), Number(mes), file);
    const nomeMes = MESES_NOMES[Number(mes) - 1];
    toast(`Holerite de ${nomeMes} ${ano} enviado com sucesso!`, 'success');
    closeModal('modal-holerite');
    loadHoleritesAdmin();
  } catch (err) {
    toast(err.message, 'error');
    info.textContent = 'Erro: ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar Holerite';
  }
});

async function excluirHolerite(uid, key, nomeColab, periodo) {
  const ok = await showConfirm(`Excluir o holerite de ${periodo} de ${nomeColab}?\nEsta ação não pode ser desfeita.`, { title: '🗑️ Excluir holerite', okText: 'Excluir', variant: 'danger' });
  if (!ok) return;
  try {
    await api.excluirHolerite(uid, key);
    toast('Holerite excluído.', 'success');
    loadHoleritesAdmin();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---- COLABORADOR ----
async function loadMeuHolerite() {
  if (!navigator.onLine) { _offlinePage('meu-holerite-lista', 'Meu Holerite'); return; }
  const container = document.getElementById('meu-holerite-lista');
  container.innerHTML = '<div class="text-center text-muted" style="padding:32px;">Carregando...</div>';

  try {
    const holerites = await api.meusHolerites();
    if (!holerites.length) {
      container.innerHTML = `
        <div class="card">
          <div style="text-align:center;padding:48px 24px;color:#888;">
            <div style="font-size:48px;margin-bottom:12px;">&#128178;</div>
            <h3 style="color:#555;margin:0 0 8px;">Nenhum holerite disponível</h3>
            <p style="font-size:14px;margin:0;">Seus holerites aparecerão aqui quando forem enviados pelo administrador.</p>
          </div>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="card">
        <div class="table-container">
          <table>
            <thead>
              <tr><th>M&ecirc;s / Ano</th><th>Disponível desde</th><th>Status</th><th>A&ccedil;&atilde;o</th></tr>
            </thead>
            <tbody>
              ${holerites.map(h => {
                const nomeMes = MESES_NOMES[(h.mes || 1) - 1];
                const desde = h.uploaded_at ? new Date(h.uploaded_at).toLocaleDateString('pt-BR') : '-';
                const badge = h.lido
                  ? '<span class="badge badge-success">Visto</span>'
                  : '<span class="badge badge-danger">Novo!</span>';
                const label = `Holerite ${nomeMes} ${h.ano}`;
                return `<tr>
                  <td><strong>&#128176; ${nomeMes} ${h.ano}</strong></td>
                  <td>${desde}</td>
                  <td>${badge}</td>
                  <td><button class="btn btn-sm btn-primary" onclick="verMeuHolerite('${h.key}','${h.url}','${label}')">&#128196; Visualizar</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (err) {
    container.innerHTML = `<div class="text-center text-muted" style="padding:32px;">${err.message}</div>`;
  }
}

async function verMeuHolerite(key, url, label) {
  // Abre o modal imediatamente, sem esperar o RTDB
  document.getElementById('modal-ver-documento-title').textContent = `💰 ${label || 'Holerite'}`;
  const body = document.getElementById('modal-documento-body');
  body.innerHTML = `<iframe src="${url}" style="width:100%;height:75vh;border:none;display:block;"></iframe>`;
  document.getElementById('btn-baixar-documento').href = url;
  openModal('modal-ver-documento');

  // Marca como lido e atualiza badge + lista em background
  try {
    await api.marcarHoleriteComoLido(key);
    // Atualiza badge explicitamente (sem depender só do listener)
    const snap = await fbDb.ref(`holerites/${currentUser.id}`).once('value');
    const data = snap.val() || {};
    const naoLidos = Object.values(data).filter(h => !h.lido).length;
    _updateSidebarBadgeHolerite(naoLidos);
    loadMeuHolerite();
  } catch (_) {}
}

// ==================== ALARME DE ALMOÇO ====================
// Toca o áudio quando faltar 1 minuto para o fim dos 60 min mínimos de almoço,
// e continua tocando em loop até o colaborador registrar o retorno ou silenciar.

const ALARME_STORAGE_KEY = 'alarme_almoco_ativo';
let _alarmeCheckInterval = null;
let _alarmeTocando = false;
let _alarmeSilenciadoRegId = null; // se usuário silenciar, memoriza até novo ciclo

function _alarmeAtivo() {
  return localStorage.getItem(ALARME_STORAGE_KEY) === '1';
}

function _alarmeSetAtivo(ativo) {
  if (ativo) localStorage.setItem(ALARME_STORAGE_KEY, '1');
  else localStorage.removeItem(ALARME_STORAGE_KEY);
  _alarmeAtualizarSwitch();
}

function _alarmeAtualizarSwitch() {
  const sw = document.getElementById('nav-switch-alarme');
  if (!sw) return;
  sw.classList.toggle('on', _alarmeAtivo());
}

function _alarmePararSom() {
  const audio = document.getElementById('alarme-almoco-audio');
  if (audio) { audio.pause(); audio.currentTime = 0; }
  const banner = document.getElementById('alarme-banner');
  if (banner) banner.classList.add('hidden');
  _alarmeTocando = false;
}

async function _alarmeTocarSom() {
  if (_alarmeTocando) return;
  const audio = document.getElementById('alarme-almoco-audio');
  if (!audio) return;
  try {
    audio.currentTime = 0;
    await audio.play();
    _alarmeTocando = true;
    document.getElementById('alarme-banner').classList.remove('hidden');
  } catch (err) {
    // Autoplay pode ser bloqueado se o usuário ainda não interagiu com a página.
    // Mostramos um toast pedindo para clicar na tela.
    toast('🔔 Hora de bater o retorno do almoço! Clique em qualquer lugar para ouvir o alarme.', 'warning');
  }
}

async function _alarmeVerificar() {
  if (!currentUser || currentUser.role === 'admin') return;
  if (!_alarmeAtivo()) { _alarmePararSom(); return; }
  if (!OfflineManager.isOnline()) return;

  try {
    const hoje = formatDateISO(new Date());
    const regs = await api.registrosDia(hoje).catch(() => []);
    const saidaAlm = regs.find(r => r.tipo === 'saida_almoco');
    const retornoAlm = regs.find(r => r.tipo === 'retorno_almoco');

    // Já voltou do almoço → parar alarme
    if (!saidaAlm || retornoAlm) {
      _alarmePararSom();
      _alarmeSilenciadoRegId = null;
      return;
    }

    // Ignora se o usuário silenciou este ciclo (mesma batida de saída)
    if (_alarmeSilenciadoRegId === (saidaAlm.id || saidaAlm.data_hora)) return;

    const saidaMs = new Date(saidaAlm.data_hora).getTime();
    const agoraMs = Date.now();
    const decorrido = (agoraMs - saidaMs) / 60000; // minutos

    // Dispara a partir de 59 min (1 min antes de completar 60) — continua tocando até voltar.
    if (decorrido >= 59) {
      _alarmeTocarSom();
    }
  } catch (err) { /* silencioso: evita poluir logs */ }
}

function _alarmeIniciar() {
  _alarmeAtualizarSwitch();
  // Desbloqueia autoplay no primeiro clique do usuário (uma vez)
  const desbloquear = () => {
    const audio = document.getElementById('alarme-almoco-audio');
    if (!audio) return;
    // Toca muito rapidamente e pausa: gesto do usuário autoriza áudio posterior.
    const origVol = audio.volume;
    audio.volume = 0;
    audio.play().then(() => {
      audio.pause(); audio.currentTime = 0; audio.volume = origVol;
    }).catch(() => { audio.volume = origVol; });
    document.removeEventListener('click', desbloquear);
  };
  document.addEventListener('click', desbloquear, { once: true });

  if (_alarmeCheckInterval) clearInterval(_alarmeCheckInterval);
  // Verifica a cada 15 segundos. Quando falta 1 min, a precisão é suficiente.
  _alarmeCheckInterval = setInterval(_alarmeVerificar, 15000);
  _alarmeVerificar();
}

document.getElementById('toggle-alarme-almoco').addEventListener('click', async () => {
  const novoEstado = !_alarmeAtivo();
  _alarmeSetAtivo(novoEstado);
  if (novoEstado) {
    const audio = document.getElementById('alarme-almoco-audio');
    if (audio) {
      const origVol = audio.volume;
      audio.volume = 0;
      try { await audio.play(); audio.pause(); audio.currentTime = 0; } catch (e) {}
      audio.volume = origVol;
    }
    toast('Alarme de almoço ativado. Vai tocar faltando 1 minuto para completar os 60 min.', 'success');
    _alarmeVerificar();
  } else {
    _alarmePararSom();
    _alarmeSilenciadoRegId = null;
    toast('Alarme de almoço desativado.', 'error');
  }
});

// Botão silenciar no banner
document.getElementById('btn-alarme-silenciar').addEventListener('click', async () => {
  _alarmePararSom();
  // Marca este ciclo como silenciado (não toca de novo para esta mesma saída)
  try {
    const hoje = formatDateISO(new Date());
    const regs = await api.registrosDia(hoje).catch(() => []);
    const saidaAlm = regs.find(r => r.tipo === 'saida_almoco');
    if (saidaAlm) _alarmeSilenciadoRegId = saidaAlm.id || saidaAlm.data_hora;
  } catch (e) {}
  toast('Alarme silenciado. Lembre-se de bater o retorno do almoço!', 'warning');
});

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});
