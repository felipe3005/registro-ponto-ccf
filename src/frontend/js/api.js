const API_BASE = 'http://localhost:3131/api';

class Api {
  constructor() {
    this.token = localStorage.getItem('token');
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  getUser() {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  }

  setUser(user) {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('user');
    }
  }

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const opts = { method, headers };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, opts);

    if (res.status === 401) {
      this.setToken(null);
      this.setUser(null);
      window.location.reload();
      throw new Error('Sessão expirada');
    }

    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na requisição');
      return data;
    }

    if (!res.ok) throw new Error('Erro na requisição');
    return res;
  }

  // Auth
  login(email, senha) { return this.request('POST', '/auth/login', { email, senha }); }
  logout() { return this.request('POST', '/auth/logout'); }
  me() { return this.request('GET', '/auth/me'); }
  alterarSenha(senhaAtual, novaSenha) { return this.request('POST', '/auth/alterar-senha', { senhaAtual, novaSenha }); }

  // Funcionários
  listarFuncionarios(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request('GET', `/funcionarios?${qs}`);
  }
  buscarFuncionario(id) { return this.request('GET', `/funcionarios/${id}`); }
  cadastrarFuncionario(dados) { return this.request('POST', '/funcionarios', dados); }
  editarFuncionario(id, dados) { return this.request('PUT', `/funcionarios/${id}`, dados); }
  desativarFuncionario(id) { return this.request('DELETE', `/funcionarios/${id}`); }
  reativarFuncionario(id) { return this.request('PATCH', `/funcionarios/${id}/reativar`); }

  // Ponto
  registrarPonto() { return this.request('POST', '/ponto/registrar'); }
  ultimoRegistro() { return this.request('GET', '/ponto/ultimo'); }
  registrosDia(data, funcionarioId) {
    const params = new URLSearchParams({ data });
    if (funcionarioId) params.set('funcionario_id', funcionarioId);
    return this.request('GET', `/ponto/dia?${params}`);
  }

  // Horas
  horasTrabalhadas(data, funcionarioId) {
    const params = new URLSearchParams({ data });
    if (funcionarioId) params.set('funcionario_id', funcionarioId);
    return this.request('GET', `/horas/trabalhadas?${params}`);
  }
  bancoHoras(mes, ano, funcionarioId) {
    const params = new URLSearchParams({ mes, ano });
    if (funcionarioId) params.set('funcionario_id', funcionarioId);
    return this.request('GET', `/horas/banco?${params}`);
  }

  // Ajustes
  solicitarAjuste(dados) { return this.request('POST', '/ajustes/solicitar', dados); }
  meusAjustes() { return this.request('GET', '/ajustes/meus'); }
  ajustesPendentes() { return this.request('GET', '/ajustes/pendentes'); }
  aprovarAjuste(id) { return this.request('POST', `/ajustes/${id}/aprovar`); }
  rejeitarAjuste(id, motivo) { return this.request('POST', `/ajustes/${id}/rejeitar`, { motivo }); }

  // Relatórios
  espelhoPonto(mes, ano, funcionarioId) {
    const params = new URLSearchParams({ mes, ano });
    if (funcionarioId) params.set('funcionario_id', funcionarioId);
    return this.request('GET', `/relatorios/espelho?${params}`);
  }
  relatorioGeral(mes, ano) {
    return this.request('GET', `/relatorios/geral?mes=${mes}&ano=${ano}`);
  }
  inconsistencias(mes, ano) {
    return this.request('GET', `/relatorios/inconsistencias?mes=${mes}&ano=${ano}`);
  }

  // Configurações
  buscarHorarios(funcionarioId) { return this.request('GET', `/configuracoes/horario/${funcionarioId}`); }
  salvarHorarios(funcionarioId, horarios) { return this.request('POST', '/configuracoes/horario', { funcionario_id: funcionarioId, horarios }); }
  listarFeriados(ano) { return this.request('GET', `/configuracoes/feriados?ano=${ano}`); }
  cadastrarFeriado(data, descricao) { return this.request('POST', '/configuracoes/feriados', { data, descricao }); }
  removerFeriado(id) { return this.request('DELETE', `/configuracoes/feriados/${id}`); }
  buscarTolerancia() { return this.request('GET', '/configuracoes/tolerancia'); }
  salvarTolerancia(minutos) { return this.request('POST', '/configuracoes/tolerancia', { minutos }); }
}

const api = new Api();
