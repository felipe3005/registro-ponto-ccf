// ==================== STATE ====================
let currentPage = 'dashboard';
let currentUser = null;
let clockInterval = null;
let funcPage = 1;

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
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
      }).catch(() => showLogin());
    }
  } else {
    showLogin();
  }
});

// ==================== AUTH ====================
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const senha = document.getElementById('login-senha').value;

  try {
    const data = await api.login(email, senha);
    api.setToken(data.token);
    api.setUser(data.user);
    currentUser = data.user;
    showApp();
    toast('Login realizado com sucesso!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('btn-logout').addEventListener('click', () => {
  api.logout().catch(() => {});
  api.setToken(null);
  api.setUser(null);
  currentUser = null;
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
  document.getElementById('user-role').textContent = currentUser.role === 'admin' ? 'Administrador' : 'Funcionário';
  document.getElementById('user-avatar').textContent = currentUser.nome.charAt(0).toUpperCase();

  // Esconder links admin
  if (currentUser.role !== 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    document.getElementById('nav-admin-section').classList.add('hidden');
  } else {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    document.getElementById('nav-admin-section').classList.remove('hidden');
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
  }
}

// ==================== DASHBOARD ====================
async function loadDashboard() {
  const hoje = new Date();
  document.getElementById('dashboard-date').textContent = formatDateBR(hoje);

  try {
    // Stats
    const registros = await api.registrosDia(formatDateISO(hoje));
    const horas = await api.horasTrabalhadas(formatDateISO(hoje));

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

    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();
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

    if (currentUser.role === 'admin') {
      try {
        const ajustes = await api.ajustesPendentes();
        statsHtml += `
          <div class="stat-card">
            <div class="stat-icon yellow">&#128221;</div>
            <div class="stat-info"><h4>${ajustes.length}</h4><p>Ajustes Pendentes</p></div>
          </div>
        `;
      } catch (e) {}
    }

    document.getElementById('dashboard-stats').innerHTML = statsHtml;

    // Registros de hoje
    document.getElementById('dashboard-registros-hoje').innerHTML = renderRegistrosDia(registros);
  } catch (err) {
    console.error('Erro ao carregar dashboard:', err);
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
  try {
    const data = await api.ultimoRegistro();
    const btn = document.getElementById('btn-registrar-ponto');
    const info = document.getElementById('ponto-tipo-info');

    btn.className = 'btn-ponto';
    if (!data.proximoTipo) {
      btn.textContent = 'Todos os registros feitos';
      btn.disabled = true;
      info.textContent = 'Você já registrou todos os pontos de hoje.';
    } else {
      const labels = {
        'entrada': 'Registrar Entrada',
        'saida_almoco': 'Registrar Saída Almoço',
        'retorno_almoco': 'Registrar Retorno Almoço',
        'saida': 'Registrar Saída'
      };
      btn.textContent = labels[data.proximoTipo];
      btn.disabled = false;
      btn.classList.add(data.proximoTipo);
      info.textContent = `Próximo registro: ${data.proximoTipo.replace(/_/g, ' ')}`;
    }

    // Registros do dia
    const registros = await api.registrosDia(formatDateISO(new Date()));
    document.getElementById('ponto-registros-hoje').innerHTML = renderRegistrosDia(registros);
  } catch (err) {
    console.error('Erro ao carregar ponto:', err);
  }
}

document.getElementById('btn-registrar-ponto').addEventListener('click', async () => {
  try {
    const result = await api.registrarPonto();
    toast(result.message, 'success');
    loadRegistrosPonto();
  } catch (err) {
    toast(err.message, 'error');
  }
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
      return `<div class="registro-item">
        <div class="label">${info.icon} ${info.label}</div>
        <div class="hora ${reg ? '' : 'pending'}">${hora}</div>
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
        <td>${f.email}</td>
        <td>${f.cargo || '-'}</td>
        <td>${f.departamento || '-'}</td>
        <td>${f.jornada_semanal}h</td>
        <td><span class="badge ${f.role === 'admin' ? 'badge-info' : 'badge-gray'}">${f.role}</span></td>
        <td>
          <div class="btn-group">
            <button class="btn btn-sm btn-secondary" onclick="editarFuncionario(${f.id})">Editar</button>
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
  document.getElementById('modal-func-title').textContent = 'Novo Funcionário';
  document.getElementById('func-id').value = '';
  document.getElementById('func-nome').value = '';
  document.getElementById('func-email').value = '';
  document.getElementById('func-senha').value = '';
  document.getElementById('func-cargo').value = '';
  document.getElementById('func-departamento').value = '';
  document.getElementById('func-jornada').value = '44';
  document.getElementById('func-role').value = 'funcionario';
  document.getElementById('func-senha-group').classList.remove('hidden');
  openModal('modal-funcionario');
});

async function editarFuncionario(id) {
  try {
    const func = await api.buscarFuncionario(id);
    document.getElementById('modal-func-title').textContent = 'Editar Funcionário';
    document.getElementById('func-id').value = func.id;
    document.getElementById('func-nome').value = func.nome;
    document.getElementById('func-email').value = func.email;
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
    email: document.getElementById('func-email').value,
    cargo: document.getElementById('func-cargo').value,
    departamento: document.getElementById('func-departamento').value,
    jornada_semanal: parseFloat(document.getElementById('func-jornada').value),
    role: document.getElementById('func-role').value
  };

  if (!id) {
    dados.senha = document.getElementById('func-senha').value;
    if (!dados.senha) { toast('Senha é obrigatória', 'error'); return; }
  }

  try {
    if (id) {
      await api.editarFuncionario(id, dados);
      toast('Funcionário atualizado!', 'success');
    } else {
      await api.cadastrarFuncionario(dados);
      toast('Funcionário cadastrado!', 'success');
    }
    closeModal('modal-funcionario');
    loadFuncionarios();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function desativarFuncionario(id) {
  if (!confirm('Deseja desativar este funcionário?')) return;
  try {
    await api.desativarFuncionario(id);
    toast('Funcionário desativado', 'success');
    loadFuncionarios();
  } catch (err) { toast(err.message, 'error'); }
}

async function reativarFuncionario(id) {
  try {
    await api.reativarFuncionario(id);
    toast('Funcionário reativado', 'success');
    loadFuncionarios();
  } catch (err) { toast(err.message, 'error'); }
}

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

    // Funcionários para horário
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
  if (!funcId) { toast('Selecione um funcionário', 'error'); return; }

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

  const mesSelectors = ['espelho-mes', 'rel-mes', 'incon-mes'];
  const anoSelectors = ['espelho-ano', 'rel-ano', 'incon-ano'];

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
