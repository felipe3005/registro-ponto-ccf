// ==================== STATE ====================
let currentPage = 'dashboard';
let currentUser = null;
let clockInterval = null;
let funcPage = 1;

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  OfflineManager.init();
  setupUpdateListener();

  const token = localStorage.getItem('token');
  if (token) {
    currentUser = api.getUser();
    if (currentUser) {
      showApp();
    } else {
      api.me().then(user => {
        currentUser = user;
        api.setUser(user);
        showApp();
      }).catch(() => {
        // Se offline e tem credenciais cacheadas, usa dados locais
        if (!OfflineManager.isOnline() && OfflineManager.hasCachedCredentials()) {
          const cached = JSON.parse(localStorage.getItem('offline_credentials'));
          if (cached && cached.user) {
            currentUser = cached.user;
            api.setUser(cached.user);
            showApp();
            return;
          }
        }
        showLogin();
      });
    }
  } else {
    showLogin();
  }
});

// ==================== AUTH ====================
let pendingPasswordChange = null; // guarda senha temporaria para troca

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
    // Cachear credenciais para uso offline
    OfflineManager.cacheCredentials(usuario, senha, data.user, data.token);

    // Verificar se senha é temporária
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
    // Se estiver online, o erro é real (credenciais inválidas etc)
    if (OfflineManager.isOnline()) {
      toast(err.message, 'error');
      return;
    }
  }

  // Tentar login offline
  const offlineResult = OfflineManager.offlineLogin(usuario, senha);
  if (offlineResult) {
    api.setToken(offlineResult.token);
    api.setUser(offlineResult.user);
    currentUser = offlineResult.user;
    showApp();
    toast('Login offline realizado. Os dados serao sincronizados quando a conexao voltar.', 'warning');
  } else {
    toast('Sem conexao com a internet. Faca login online pelo menos uma vez para habilitar o modo offline.', 'error');
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
    // Atualizar cache offline com nova senha
    OfflineManager.cacheCredentials(currentUser.usuario, novaSenha, currentUser, api.token);
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
}

function showApp() {
  document.getElementById('page-login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // Configurar sidebar
  document.getElementById('user-name').textContent = currentUser.nome;
  document.getElementById('user-role').textContent = currentUser.role === 'admin' ? 'Administrador' : 'Colaborador';
  document.getElementById('user-avatar').textContent = currentUser.nome.charAt(0).toUpperCase();

  // Esconder links admin / funcionário
  if (currentUser.role !== 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    document.getElementById('nav-admin-section').classList.add('hidden');
    document.querySelectorAll('.func-only').forEach(el => el.classList.remove('hidden'));
  } else {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    document.getElementById('nav-admin-section').classList.remove('hidden');
    // Admin não bate ponto - esconder links de ponto e espelho pessoal
    document.querySelectorAll('.func-only').forEach(el => el.classList.add('hidden'));
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
  navigateTo('dashboard');
}

// ==================== NAVIGATION ====================
function navigateTo(page) {
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
    case 'meu-espelho': loadEspelho(); break;
    case 'funcionarios': loadFuncionarios(); break;
    case 'ajustes-admin': loadAjustesPendentes(); break;
    case 'relatorios': break;
    case 'inconsistencias': break;
    case 'configuracoes': loadConfiguracoes(); break;
    case 'meus-ajustes': loadMeusAjustes(); break;
    case 'holerites': loadHolerites(); break;
  }
}

// ==================== CHARTS STATE ====================
let chartPresenca = null;
let chartDepartamentos = null;
let chartStatusHoje = null;

// ==================== DASHBOARD ====================
async function loadDashboard() {
  const hoje = new Date();
  document.getElementById('dashboard-date').textContent = formatDateBR(hoje);

  if (currentUser.role === 'admin') {
    document.getElementById('dashboard-admin').classList.remove('hidden');
    document.getElementById('dashboard-func').classList.add('hidden');
    await loadDashboardAdmin();
  } else {
    document.getElementById('dashboard-admin').classList.add('hidden');
    document.getElementById('dashboard-func').classList.remove('hidden');
    await loadDashboardFunc(hoje);
  }
}

async function loadDashboardFunc(hoje) {
  try {
    const registros = await api.registrosDia(formatDateISO(hoje));
    const horas = await api.horasTrabalhadas(formatDateISO(hoje));
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();

    let statsHtml = `
      <div class="stat-card">
        <div class="stat-icon blue">&#9201;</div>
        <div class="stat-info"><h4>${horas.totalFormatado || '00:00'}</h4><p>Horas Hoje</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">&#9989;</div>
        <div class="stat-info"><h4>${registros.length}</h4><p>Registros Hoje</p></div>
      </div>
    `;

    try {
      const banco = await api.bancoHoras(mes, ano);
      statsHtml += `
        <div class="stat-card">
          <div class="stat-icon ${banco.saldoPositivo ? 'green' : 'red'}">&#128200;</div>
          <div class="stat-info">
            <h4>${banco.saldoPositivo ? '+' : '-'}${banco.saldoFormatado}</h4>
            <p>Banco de Horas (${String(mes).padStart(2, '0')}/${ano})</p>
          </div>
        </div>
      `;
    } catch (e) {}

    document.getElementById('dashboard-stats-func').innerHTML = statsHtml;
    document.getElementById('dashboard-registros-hoje').innerHTML = renderRegistrosDia(registros);
  } catch (err) {
    console.error('Erro ao carregar dashboard:', err);
  }
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
      <div class="stat-card">
        <div class="stat-icon yellow">&#128221;</div>
        <div class="stat-info"><h4>${data.ajustesPendentes}</h4><p>Ajustes Pendentes</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red">&#128683;</div>
        <div class="stat-info"><h4>${data.atrasados.length}</h4><p>Atrasados Hoje</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon yellow">&#9888;</div>
        <div class="stat-info"><h4>${data.inconsistenciasMes}</h4><p>Inconsist&ecirc;ncias no M&ecirc;s</p></div>
      </div>
    `;

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

    if (data.registrosHoje.length === 0) {
      document.getElementById('admin-presenca-body').innerHTML =
        '<tr><td colspan="8" class="text-center text-muted">Nenhum registro hoje</td></tr>';
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
        </tr>`;
      }).join('');
    }

  } catch (err) {
    console.error('Erro ao carregar dashboard admin:', err);
    toast('Erro ao carregar dashboard', 'error');
  }
}

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

  // Registros offline pendentes do dia
  const offlineHoje = OfflineManager.getQueueForDate(hoje);

  if (OfflineManager.isOnline()) {
    try {
      const data = await api.ultimoRegistro();

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

      let proximoTipo = null;
      if (tiposRegistrados.length === 0) {
        proximoTipo = 'entrada';
      } else {
        const ultimoTipo = tiposRegistrados[tiposRegistrados.length - 1];
        const idx = ORDEM_TIPOS.indexOf(ultimoTipo);
        proximoTipo = idx < ORDEM_TIPOS.length - 1 ? ORDEM_TIPOS[idx + 1] : null;
      }

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
  const tiposRegistrados = offlineHoje.map(r => r.tipo);
  let proximoTipo = null;
  if (tiposRegistrados.length === 0) {
    proximoTipo = 'entrada';
  } else {
    const ultimoTipo = tiposRegistrados[tiposRegistrados.length - 1];
    const idx = ORDEM_TIPOS.indexOf(ultimoTipo);
    proximoTipo = idx < ORDEM_TIPOS.length - 1 ? ORDEM_TIPOS[idx + 1] : null;
  }

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

  // Modo offline: salvar localmente
  const ORDEM_TIPOS = ['entrada', 'saida_almoco', 'retorno_almoco', 'saida'];
  const hoje = formatDateISO(new Date());
  const agora = new Date();

  // Determinar próximo tipo baseado na fila offline + dados cacheados
  let registrosHojeTipos = [];
  const offlineHoje = OfflineManager.getQueueForDate(hoje);
  registrosHojeTipos = offlineHoje.map(r => r.tipo);

  let proximoTipo;
  if (registrosHojeTipos.length === 0) {
    proximoTipo = 'entrada';
  } else {
    const ultimoTipo = registrosHojeTipos[registrosHojeTipos.length - 1];
    const idx = ORDEM_TIPOS.indexOf(ultimoTipo);
    if (idx === ORDEM_TIPOS.length - 1) {
      toast('Todos os registros do dia ja foram feitos', 'error');
      return;
    }
    proximoTipo = ORDEM_TIPOS[idx + 1];
  }

  OfflineManager.addToQueue({
    tipo: proximoTipo,
    data_hora: agora.toISOString(),
    funcionario_id: currentUser.id,
    ip: 'offline'
  });

  const labels = { 'entrada': 'Entrada', 'saida_almoco': 'Saida Almoco', 'retorno_almoco': 'Retorno Almoco', 'saida': 'Saida' };
  toast(`${labels[proximoTipo]} registrada offline! Sera sincronizada quando a conexao voltar.`, 'warning');
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

// ==================== ESPELHO DE PONTO ====================
async function loadEspelho(funcionarioId) {
  const mes = document.getElementById('espelho-mes').value;
  const ano = document.getElementById('espelho-ano').value;
  const funcId = funcionarioId || null;

  try {
    const data = await api.espelhoPonto(mes, ano, funcId);
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

    document.getElementById('espelho-body').innerHTML = data.dias.map(d => {
      const statusBadge = getStatusBadge(d.status);
      const dataFormatada = d.data.split('-').reverse().join('/');
      const dia = new Date(d.data + 'T12:00:00');
      const diaSemana = diasSemana[dia.toLocaleDateString('en', { weekday: 'short' })] || d.diaSemana;

      return `<tr class="${d.status === 'fim_de_semana' || d.status === 'feriado' ? 'text-muted' : ''}">
        <td>${dataFormatada}</td>
        <td>${diaSemana}</td>
        <td>${d.entrada || '-'}</td>
        <td>${d.saida_almoco || '-'}</td>
        <td>${d.retorno_almoco || '-'}</td>
        <td>${d.saida || '-'}</td>
        <td><strong>${d.trabalhado}</strong></td>
        <td>${statusBadge}${d.feriado ? ` <small>(${d.feriado})</small>` : ''}</td>
      </tr>`;
    }).join('');

    document.getElementById('espelho-resumo').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon blue">&#9201;</div>
          <div class="stat-info"><h4>${data.resumo.totalTrabalhado}</h4><p>Total Trabalhado</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">&#128200;</div>
          <div class="stat-info"><h4>${data.resumo.totalExtras}</h4><p>Horas Extras</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon red">&#10060;</div>
          <div class="stat-info"><h4>${data.resumo.totalFaltas}</h4><p>Faltas</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon yellow">&#128197;</div>
          <div class="stat-info"><h4>${data.resumo.jornadaMensal}</h4><p>Jornada Mensal Esperada</p></div>
        </div>
      </div>
    `;
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('btn-gerar-espelho').addEventListener('click', () => loadEspelho());

document.getElementById('btn-exportar-pdf').addEventListener('click', () => {
  const mes = document.getElementById('espelho-mes').value;
  const ano = document.getElementById('espelho-ano').value;
  window.open(`${API_BASE}/relatorios/exportar/pdf?mes=${mes}&ano=${ano}&funcionario_id=${currentUser.id}`, '_blank');
});

document.getElementById('btn-exportar-csv').addEventListener('click', () => {
  const mes = document.getElementById('espelho-mes').value;
  const ano = document.getElementById('espelho-ano').value;
  window.open(`${API_BASE}/relatorios/exportar/csv?mes=${mes}&ano=${ano}&funcionario_id=${currentUser.id}`, '_blank');
});

// ==================== FUNCIONÁRIOS ====================
async function loadFuncionarios() {
  try {
    const busca = document.getElementById('filtro-busca').value;
    const departamento = document.getElementById('filtro-depto').value;
    const ativo = document.getElementById('filtro-ativo').value;

    const data = await api.listarFuncionarios({ page: funcPage, limit: 15, busca, departamento, ativo });

    document.getElementById('funcionarios-body').innerHTML = data.funcionarios.map(f => `
      <tr>
        <td><strong>${f.nome}</strong></td>
        <td><code>${f.usuario || '-'}</code></td>
        <td>${f.cargo || '-'}</td>
        <td>${f.departamento || '-'}</td>
        <td>${f.jornada_semanal}h</td>
        <td><span class="badge ${f.role === 'admin' ? 'badge-info' : 'badge-gray'}">${f.role}</span></td>
        <td>
          <div class="btn-group">
            <button class="btn btn-sm btn-secondary" onclick="editarFuncionario(${f.id})">Editar</button>
            <button class="btn btn-sm btn-warning" onclick="resetarSenhaFuncionario(${f.id}, '${f.nome.replace(/'/g, "\\'")}', '${(f.usuario || '').replace(/'/g, "\\'")}')">Resetar Senha</button>
            ${f.ativo ?
              `<button class="btn btn-sm btn-danger" onclick="desativarFuncionario(${f.id})">Desativar</button>` :
              `<button class="btn btn-sm btn-success" onclick="reativarFuncionario(${f.id})">Reativar</button>`
            }
            <button class="btn btn-sm btn-primary" onclick="verEspelho(${f.id})">Espelho</button>
          </div>
        </td>
      </tr>
    `).join('');

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

document.getElementById('btn-novo-funcionario').addEventListener('click', () => {
  document.getElementById('modal-func-title').textContent = 'Novo Colaborador';
  document.getElementById('func-id').value = '';
  document.getElementById('func-nome').value = '';
  document.getElementById('func-usuario').value = '';
  document.getElementById('func-email').value = '';
  document.getElementById('func-senha').value = '';
  document.getElementById('func-cargo').value = '';
  document.getElementById('func-departamento').value = '';
  document.getElementById('func-jornada').value = '44';
  document.getElementById('func-role').value = 'funcionario';
  document.getElementById('func-usuario').readOnly = false;
  document.getElementById('func-senha-group').classList.remove('hidden');
  openModal('modal-funcionario');
});

async function editarFuncionario(id) {
  try {
    const func = await api.buscarFuncionario(id);
    document.getElementById('modal-func-title').textContent = 'Editar Colaborador';
    document.getElementById('func-id').value = func.id;
    document.getElementById('func-nome').value = func.nome;
    document.getElementById('func-usuario').value = func.usuario || '';
    document.getElementById('func-usuario').readOnly = true;
    document.getElementById('func-email').value = func.email || '';
    document.getElementById('func-senha').value = '';
    document.getElementById('func-cargo').value = func.cargo || '';
    document.getElementById('func-departamento').value = func.departamento || '';
    document.getElementById('func-jornada').value = func.jornada_semanal;
    document.getElementById('func-role').value = func.role;
    document.getElementById('func-senha-group').classList.add('hidden');
    openModal('modal-funcionario');
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('btn-salvar-funcionario').addEventListener('click', async () => {
  const id = document.getElementById('func-id').value;
  const dados = {
    nome: document.getElementById('func-nome').value,
    usuario: document.getElementById('func-usuario').value,
    email: document.getElementById('func-email').value,
    cargo: document.getElementById('func-cargo').value,
    departamento: document.getElementById('func-departamento').value,
    jornada_semanal: parseFloat(document.getElementById('func-jornada').value),
    role: document.getElementById('func-role').value
  };

  if (!id) {
    dados.senha = document.getElementById('func-senha').value;
    if (!dados.usuario) { toast('Usuário é obrigatório', 'error'); return; }
    if (!dados.senha) { toast('Senha inicial é obrigatória', 'error'); return; }
  }

  try {
    if (id) {
      await api.editarFuncionario(id, dados);
      toast('Colaborador atualizado!', 'success');
    } else {
      const result = await api.cadastrarFuncionario(dados);
      toast(`Colaborador cadastrado! Usuário: ${result.usuario}`, 'success');
    }
    closeModal('modal-funcionario');
    loadFuncionarios();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function desativarFuncionario(id) {
  if (!confirm('Deseja desativar este colaborador?')) return;
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

// Resetar senha de funcionário
let resetFuncId = null;
function resetarSenhaFuncionario(id, nome, usuario) {
  resetFuncId = id;
  document.getElementById('reset-func-nome').textContent = nome;
  document.getElementById('reset-func-usuario').textContent = usuario;
  document.getElementById('reset-nova-senha').value = '';
  openModal('modal-resetar-senha');
}

document.getElementById('btn-confirmar-reset-senha').addEventListener('click', async () => {
  if (!resetFuncId) return;
  const novaSenha = document.getElementById('reset-nova-senha').value.trim();

  try {
    const result = await api.resetarSenha(resetFuncId, novaSenha || null);
    closeModal('modal-resetar-senha');

    // Mostrar modal com resultado
    document.getElementById('gerada-usuario').textContent = result.usuario;
    document.getElementById('gerada-senha').textContent = result.novaSenha;
    openModal('modal-senha-gerada');

    resetFuncId = null;
  } catch (err) {
    toast(err.message, 'error');
  }
});

function verEspelho(funcionarioId) {
  navigateTo('meu-espelho');
  setTimeout(() => loadEspelho(funcionarioId), 100);
}

// ==================== AJUSTES ====================
document.getElementById('btn-solicitar-ajuste').addEventListener('click', () => {
  document.getElementById('ajuste-data').value = '';
  document.getElementById('ajuste-tipo').value = 'entrada';
  document.getElementById('ajuste-hora').value = '';
  document.getElementById('ajuste-motivo').value = '';
  openModal('modal-ajuste');
});

document.getElementById('btn-enviar-ajuste').addEventListener('click', async () => {
  const dados = {
    data: document.getElementById('ajuste-data').value,
    tipo: document.getElementById('ajuste-tipo').value,
    nova_hora: document.getElementById('ajuste-hora').value,
    motivo: document.getElementById('ajuste-motivo').value
  };

  try {
    await api.solicitarAjuste(dados);
    toast('Solicitação enviada!', 'success');
    closeModal('modal-ajuste');
    loadMeusAjustes();
  } catch (err) { toast(err.message, 'error'); }
});

async function loadMeusAjustes() {
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
  try {
    const ajustes = await api.ajustesPendentes();
    document.getElementById('ajustes-pendentes-body').innerHTML = ajustes.map(a => `
      <tr>
        <td><strong>${a.funcionario_nome}</strong></td>
        <td>${formatDateBR(new Date(a.data + 'T12:00:00'))}</td>
        <td>${a.tipo.replace(/_/g, ' ')}</td>
        <td>${a.nova_hora}</td>
        <td>${a.motivo}</td>
        <td>
          <div class="btn-group">
            <button class="btn btn-sm btn-success" onclick="aprovarAjuste(${a.id})">Aprovar</button>
            <button class="btn btn-sm btn-danger" onclick="rejeitarAjuste(${a.id})">Rejeitar</button>
          </div>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="text-center text-muted">Nenhum ajuste pendente</td></tr>';
  } catch (err) { toast(err.message, 'error'); }
}

async function aprovarAjuste(id) {
  if (!confirm('Aprovar este ajuste?')) return;
  try {
    await api.aprovarAjuste(id);
    toast('Ajuste aprovado!', 'success');
    loadAjustesPendentes();
  } catch (err) { toast(err.message, 'error'); }
}

async function rejeitarAjuste(id) {
  const motivo = prompt('Motivo da rejeição:');
  if (motivo === null) return;
  try {
    await api.rejeitarAjuste(id, motivo);
    toast('Ajuste rejeitado', 'success');
    loadAjustesPendentes();
  } catch (err) { toast(err.message, 'error'); }
}

// ==================== RELATÓRIOS ====================
document.getElementById('btn-gerar-relatorio').addEventListener('click', async () => {
  const mes = document.getElementById('rel-mes').value;
  const ano = document.getElementById('rel-ano').value;

  try {
    const data = await api.relatorioGeral(mes, ano);
    document.getElementById('relatorio-body').innerHTML = data.resumos.map(r => `
      <tr>
        <td><strong>${r.funcionario.nome}</strong></td>
        <td>${r.funcionario.cargo || '-'}</td>
        <td>${r.funcionario.departamento || '-'}</td>
        <td>${r.totalHoras}</td>
        <td>${r.diasTrabalhados}</td>
        <td>${r.faltas}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="verEspelhoFunc(${r.funcionario.id}, ${mes}, ${ano})">Espelho</button>
          <button class="btn btn-sm btn-secondary" onclick="exportarPdfFunc(${r.funcionario.id}, ${mes}, ${ano})">PDF</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="text-center text-muted">Nenhum dado encontrado</td></tr>';
  } catch (err) { toast(err.message, 'error'); }
});

function verEspelhoFunc(funcId, mes, ano) {
  document.getElementById('espelho-mes').value = mes;
  document.getElementById('espelho-ano').value = ano;
  navigateTo('meu-espelho');
  setTimeout(() => loadEspelho(funcId), 100);
}

function exportarPdfFunc(funcId, mes, ano) {
  window.open(`${API_BASE}/relatorios/exportar/pdf?mes=${mes}&ano=${ano}&funcionario_id=${funcId}`, '_blank');
}

// ==================== INCONSISTÊNCIAS ====================
document.getElementById('btn-gerar-inconsistencias').addEventListener('click', async () => {
  const mes = document.getElementById('incon-mes').value;
  const ano = document.getElementById('incon-ano').value;

  try {
    const data = await api.inconsistencias(mes, ano);
    document.getElementById('inconsistencias-body').innerHTML = data.map(i => `
      <tr>
        <td><strong>${i.nome}</strong></td>
        <td>${formatDateBR(new Date(i.data + 'T12:00:00'))}</td>
        <td>${i.tipos.map(t => `<span class="badge badge-info">${t.replace(/_/g, ' ')}</span>`).join(' ')}</td>
        <td>${i.problemas.map(p => `<span class="badge badge-danger">${p}</span>`).join(' ')}</td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="text-center text-muted">Nenhuma inconsistência encontrada</td></tr>';
  } catch (err) { toast(err.message, 'error'); }
});

// ==================== CONFIGURAÇÕES ====================
async function loadConfiguracoes() {
  try {
    // Tolerância
    const tol = await api.buscarTolerancia();
    document.getElementById('config-tolerancia').value = tol.tolerancia;

    // Feriados
    const ano = new Date().getFullYear();
    const feriados = await api.listarFeriados(ano);
    document.getElementById('feriados-body').innerHTML = feriados.map(f => `
      <tr>
        <td>${formatDateBR(new Date(f.data + 'T12:00:00'))}</td>
        <td>${f.descricao}</td>
        <td><button class="btn btn-sm btn-danger" onclick="removerFeriado(${f.id})">Remover</button></td>
      </tr>
    `).join('') || '<tr><td colspan="3" class="text-center text-muted">Nenhum feriado cadastrado</td></tr>';

    // Colaboradors para horário
    const funcs = await api.listarFuncionarios({ limit: 100 });
    document.getElementById('config-funcionario').innerHTML =
      '<option value="">Selecione...</option>' +
      funcs.funcionarios.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');

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
  if (!confirm('Remover este feriado?')) return;
  try {
    await api.removerFeriado(id);
    toast('Feriado removido', 'success');
    loadConfiguracoes();
  } catch (err) { toast(err.message, 'error'); }
}

// Horários de trabalho
document.getElementById('config-funcionario').addEventListener('change', async (e) => {
  const funcId = e.target.value;
  if (!funcId) { document.getElementById('config-horarios-grid').innerHTML = ''; return; }

  try {
    const horarios = await api.buscarHorarios(funcId);
    const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const horariosMap = {};
    horarios.forEach(h => { horariosMap[h.dia_semana] = h; });

    document.getElementById('config-horarios-grid').innerHTML = `
      <table>
        <thead><tr><th>Dia</th><th>Entrada</th><th>Saída Almoço</th><th>Retorno Almoço</th><th>Saída</th></tr></thead>
        <tbody>
          ${dias.map((dia, i) => {
            const h = horariosMap[i] || {};
            return `<tr>
              <td><strong>${dia}</strong></td>
              <td><input type="time" class="form-control horario-input" data-dia="${i}" data-tipo="entrada" value="${h.hora_entrada || ''}"></td>
              <td><input type="time" class="form-control horario-input" data-dia="${i}" data-tipo="saida_almoco" value="${h.hora_saida_almoco || ''}"></td>
              <td><input type="time" class="form-control horario-input" data-dia="${i}" data-tipo="retorno_almoco" value="${h.hora_retorno_almoco || ''}"></td>
              <td><input type="time" class="form-control horario-input" data-dia="${i}" data-tipo="saida" value="${h.hora_saida || ''}"></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('btn-salvar-horarios').addEventListener('click', async () => {
  const funcId = document.getElementById('config-funcionario').value;
  if (!funcId) { toast('Selecione um colaborador', 'error'); return; }

  const inputs = document.querySelectorAll('.horario-input');
  const horariosMap = {};

  inputs.forEach(input => {
    const dia = parseInt(input.dataset.dia);
    const tipo = input.dataset.tipo;
    if (!horariosMap[dia]) horariosMap[dia] = { dia_semana: dia };
    const field = tipo === 'entrada' ? 'hora_entrada' :
                  tipo === 'saida_almoco' ? 'hora_saida_almoco' :
                  tipo === 'retorno_almoco' ? 'hora_retorno_almoco' : 'hora_saida';
    horariosMap[dia][field] = input.value || null;
  });

  const horarios = Object.values(horariosMap).filter(h =>
    h.hora_entrada || h.hora_saida_almoco || h.hora_retorno_almoco || h.hora_saida
  );

  try {
    await api.salvarHorarios(funcId, horarios);
    toast('Horários salvos!', 'success');
  } catch (err) { toast(err.message, 'error'); }
});

// ==================== HOLERITES (ESPELHO DO COLABORADOR) ====================
function loadHolerites() {
  // Apenas popula selectors, espera o usuario clicar em Gerar
}

document.getElementById('btn-gerar-holerite').addEventListener('click', async () => {
  const mes = document.getElementById('holerite-mes').value;
  const ano = document.getElementById('holerite-ano').value;

  try {
    const data = await api.espelhoPonto(mes, ano);
    const func = data.funcionario;
    const meses = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const diasSemana = { 'Sun': 'Dom', 'Mon': 'Seg', 'Tue': 'Ter', 'Wed': 'Qua', 'Thu': 'Qui', 'Fri': 'Sex', 'Sat': 'Sab' };

    let html = '<div class="espelho-header">';
    html += '<div style="text-align:center;margin-bottom:16px;">';
    html += '<h2 style="color:var(--ccf-blue);margin:0;">Espelho de Ponto</h2>';
    html += '<p class="text-muted">' + meses[parseInt(mes) - 1] + ' de ' + ano + '</p>';
    html += '</div>';
    html += '<div class="info-grid">';
    html += '<div class="info-item"><strong>Colaborador:</strong> ' + func.nome + '</div>';
    html += '<div class="info-item"><strong>Cargo:</strong> ' + (func.cargo || '-') + '</div>';
    html += '<div class="info-item"><strong>Departamento:</strong> ' + (func.departamento || '-') + '</div>';
    html += '<div class="info-item"><strong>Jornada:</strong> ' + func.jornada_semanal + 'h semanais</div>';
    html += '</div></div>';

    html += '<div class="table-container"><table><thead><tr>';
    html += '<th>Data</th><th>Dia</th><th>Entrada</th><th>Saida Almoco</th><th>Retorno</th><th>Saida</th><th>Total</th><th>Status</th>';
    html += '</tr></thead><tbody>';

    data.dias.forEach(function(d) {
      const dia = new Date(d.data + 'T12:00:00');
      const diaSemana = diasSemana[dia.toLocaleDateString('en', { weekday: 'short' })] || d.diaSemana;
      const dataFormatada = d.data.split('-').reverse().join('/');
      const statusBadge = getStatusBadge(d.status);
      const muted = (d.status === 'fim_de_semana' || d.status === 'feriado') ? ' class="text-muted"' : '';

      html += '<tr' + muted + '>';
      html += '<td>' + dataFormatada + '</td>';
      html += '<td>' + diaSemana + '</td>';
      html += '<td>' + (d.entrada || '-') + '</td>';
      html += '<td>' + (d.saida_almoco || '-') + '</td>';
      html += '<td>' + (d.retorno_almoco || '-') + '</td>';
      html += '<td>' + (d.saida || '-') + '</td>';
      html += '<td><strong>' + d.trabalhado + '</strong></td>';
      html += '<td>' + statusBadge + (d.feriado ? ' <small>(' + d.feriado + ')</small>' : '') + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';

    // Resumo
    html += '<div class="stats-grid mt-3">';
    html += '<div class="stat-card"><div class="stat-icon blue">&#9201;</div><div class="stat-info"><h4>' + data.resumo.totalTrabalhado + '</h4><p>Total Trabalhado</p></div></div>';
    html += '<div class="stat-card"><div class="stat-icon green">&#128200;</div><div class="stat-info"><h4>' + data.resumo.totalExtras + '</h4><p>Horas Extras</p></div></div>';
    html += '<div class="stat-card"><div class="stat-icon red">&#10060;</div><div class="stat-info"><h4>' + data.resumo.totalFaltas + '</h4><p>Faltas</p></div></div>';
    html += '<div class="stat-card"><div class="stat-icon yellow">&#128197;</div><div class="stat-info"><h4>' + data.resumo.jornadaMensal + '</h4><p>Jornada Mensal</p></div></div>';
    html += '</div>';

    document.getElementById('holerite-preview').innerHTML = html;
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('btn-holerite-pdf').addEventListener('click', () => {
  const mes = document.getElementById('holerite-mes').value;
  const ano = document.getElementById('holerite-ano').value;
  window.open(API_BASE + '/relatorios/exportar/pdf?mes=' + mes + '&ano=' + ano + '&funcionario_id=' + currentUser.id, '_blank');
});

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
        // Esconder apos 3s se nao tiver update
        setTimeout(function() {
          if (title.textContent === 'Verificando atualizacoes...') {
            banner.classList.add('hidden');
          }
        }, 3000);
        break;

      case 'available':
        banner.classList.remove('hidden');
        title.textContent = 'Nova versao disponivel!';
        message.textContent = data.message;
        progressBar.classList.remove('hidden');
        progressFill.style.width = '0%';
        break;

      case 'downloading':
        banner.classList.remove('hidden');
        title.textContent = 'Baixando atualizacao...';
        message.textContent = data.percent + '% concluido';
        progressBar.classList.remove('hidden');
        progressFill.style.width = data.percent + '%';
        break;

      case 'downloaded':
        banner.classList.remove('hidden');
        title.textContent = 'Atualizacao pronta!';
        message.textContent = 'O sistema sera reiniciado em instantes para aplicar a versao ' + (data.version || 'nova') + '.';
        progressBar.classList.add('hidden');
        break;

      case 'up-to-date':
        banner.classList.remove('hidden');
        title.textContent = 'Sistema atualizado';
        message.textContent = 'Voce ja esta na versao mais recente.';
        progressBar.classList.add('hidden');
        setTimeout(function() { banner.classList.add('hidden'); }, 3000);
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
    'fim_de_semana': '<span class="badge badge-gray">FDS</span>',
    'feriado': '<span class="badge badge-info">Feriado</span>',
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

  const mesSelectors = ['espelho-mes', 'rel-mes', 'incon-mes', 'holerite-mes'];
  const anoSelectors = ['espelho-ano', 'rel-ano', 'incon-ano', 'holerite-ano'];

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

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});
