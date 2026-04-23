// ==================== API FIREBASE ====================
// Camada de compatibilidade: preserva as mesmas assinaturas da API antiga,
// mas agora sobre Firebase Auth + Realtime Database + Storage.
// Estratégia de economia:
//  - Reads narrow (queries por data/indexOn), cache em memória curto
//  - .once() ao invés de .on() sempre que possível
//  - Offline automático via RTDB local cache

// Datas em horario LOCAL (evita bug de UTC mostrando +3h no Brasil)
function _pad(n) { return String(n).padStart(2, '0'); }
function _now() {
  const d = new Date();
  return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())} ${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`;
}
function _today() {
  const d = new Date();
  return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`;
}
function _nowIso() {
  const d = new Date();
  return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`;
}
// Extrai HH:MM de uma string data_hora gravada (suporta ISO com Z herdado e ISO local novo)
function _hhmm(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(11, 16);
  return `${_pad(d.getHours())}:${_pad(d.getMinutes())}`;
}
function _monthRange(mes, ano) {
  const m = String(mes).padStart(2, '0');
  const start = ano + '-' + m + '-01';
  const nextMonth = mes === 12 ? 1 : mes + 1;
  const nextAno = mes === 12 ? ano + 1 : ano;
  const end = nextAno + '-' + String(nextMonth).padStart(2, '0') + '-01';
  return { start, end };
}

class Api {
  constructor() {
    this._currentUid = null;
    this._currentUserData = null;
    this._userCache = new Map();
    this._perfilCache = null;
    this._perfilCacheTs = 0;
  }

  // ==== Helpers internos ====
  // RTDB proíbe . # $ [ ] / em chaves; codifica para preservar username original no perfil
  _encodeKey(u) {
    return String(u || '').replace(/\./g, ',').replace(/#/g, '%23').replace(/\$/g, '%24').replace(/\[/g, '%5B').replace(/\]/g, '%5D').replace(/\//g, '%2F');
  }
  async _requireAdmin() {
    if (!this._currentUserData || this._currentUserData.role !== 'admin') {
      throw new Error('Acesso restrito a administradores');
    }
  }
  async _loadUser(uid) {
    if (this._userCache.has(uid)) return this._userCache.get(uid);
    const snap = await fbDb.ref('users/' + uid).once('value');
    const u = snap.val();
    if (u) {
      u.id = uid;
      this._userCache.set(uid, u);
    }
    return u;
  }
  _invalidateUserCache() {
    this._userCache.clear();
  }

  // ==== Compat legado ====
  setToken(t) { /* no-op (Firebase gerencia token) */ }
  setUser(u) {
    if (u) localStorage.setItem('user', JSON.stringify(u));
    else localStorage.removeItem('user');
  }
  getUser() {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  }
  get token() { return this._currentUid; }

  // ==================== AUTH ====================
  async login(usuario, senha) {
    usuario = (usuario || '').toLowerCase().trim();

    // 1) Lookup usuario -> uid (leve, 1 read)
    // Email sintetico deterministico - evita read em /users antes do auth (rules exigem auth)
    const email = usuario + '@ccf.local';

    // 2) Firebase Auth
    let cred;
    try {
      cred = await fbAuth.signInWithEmailAndPassword(email, senha);
    } catch (err) {
      const code = err.code || '';
      if (code.includes('wrong-password') || code.includes('invalid-credential') || code.includes('user-not-found') || code.includes('INVALID_LOGIN_CREDENTIALS')) {
        throw new Error('Usuário ou senha incorretos');
      }
      throw new Error(err.message || 'Erro de autenticação');
    }

    this._currentUid = cred.user.uid;

    // 3) Buscar perfil /users/{uid}
    const userData = await this._loadUser(cred.user.uid);
    if (!userData) {
      await fbAuth.signOut();
      throw new Error('Perfil do usuário não encontrado. Contate o administrador.');
    }
    if (userData.ativo === false || userData.ativo === 0) {
      await fbAuth.signOut();
      throw new Error('Usuário desativado');
    }

    this._currentUserData = userData;

    return {
      token: cred.user.uid,
      user: {
        id: cred.user.uid,
        nome: userData.nome,
        usuario: userData.usuario,
        email: userData.email || null,
        role: userData.role || 'funcionario',
        departamento: userData.departamento || null,
        cargo: userData.cargo || null,
        perfil_horario_id: userData.perfil_horario_id || null,
        abono_minutos: userData.abono_minutos || 0
      },
      senhaTemporaria: !!userData.senha_temporaria
    };
  }

  async logout() {
    this._currentUid = null;
    this._currentUserData = null;
    this._invalidateUserCache();
    await fbAuth.signOut();
  }

  async me() {
    const user = fbAuth.currentUser;
    if (!user) throw new Error('Sessão expirada');
    this._currentUid = user.uid;
    const data = await this._loadUser(user.uid);
    if (!data) throw new Error('Perfil não encontrado');
    this._currentUserData = data;
    return {
      id: user.uid,
      nome: data.nome,
      usuario: data.usuario,
      email: data.email || null,
      role: data.role || 'funcionario',
      departamento: data.departamento || null,
      cargo: data.cargo || null,
      perfil_horario_id: data.perfil_horario_id || null,
      abono_minutos: data.abono_minutos || 0,
      foto_url: data.foto_url || null
    };
  }

  async alterarSenha(senhaAtual, novaSenha) {
    const user = fbAuth.currentUser;
    if (!user) throw new Error('Sessão expirada');
    // Re-autentica antes de trocar (exigência do Firebase Auth)
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, senhaAtual);
    await user.reauthenticateWithCredential(cred);
    await user.updatePassword(novaSenha);
    // Limpa flag de senha temporaria
    await fbDb.ref('users/' + user.uid + '/senha_temporaria').set(false);
    this._invalidateUserCache();
    return { message: 'Senha alterada com sucesso' };
  }

  async resetarSenha(funcionarioId, novaSenha) {
    await this._requireAdmin();
    const u = await this._loadUser(funcionarioId);
    if (!u) throw new Error('Colaborador não encontrado');

    // Sem Admin SDK, não dá pra resetar a senha Firebase Auth de outro usuário
    // Estratégia: se o colaborador tem email real cadastrado, enviamos email de reset.
    // Caso contrário, instrui o admin a excluir e recriar.
    if (u.email && u.email.includes('@') && !u.email.endsWith('@ccf.local')) {
      await fbAuth.sendPasswordResetEmail(u.email);
      return {
        message: 'Email de reset enviado para ' + u.email,
        usuario: u.usuario,
        novaSenha: '(via email)'
      };
    }
    throw new Error('Colaborador não tem email cadastrado. Para resetar a senha sem email, exclua e recrie o colaborador.');
  }

  // ==================== FUNCIONÁRIOS ====================
  async listarFuncionarios(params = {}) {
    const { page = 1, limit = 20, busca, departamento, ativo = '1', role } = params;
    const snap = await fbDb.ref('users').once('value');
    const all = [];
    snap.forEach(child => {
      const v = child.val();
      v.id = child.key;
      v.perfil_nome = null;
      all.push(v);
    });

    let filtered = all.filter(f => {
      const isAtivo = f.ativo !== false && f.ativo !== 0;
      if (String(ativo) === '1' && !isAtivo) return false;
      if (String(ativo) === '0' && isAtivo) return false;
      if (busca) {
        const t = busca.toLowerCase();
        if (!((f.nome || '').toLowerCase().includes(t) ||
              (f.usuario || '').toLowerCase().includes(t) ||
              (f.email || '').toLowerCase().includes(t) ||
              (f.cargo || '').toLowerCase().includes(t))) return false;
      }
      if (departamento && f.departamento !== departamento) return false;
      if (role && (f.role || 'funcionario') !== role) return false;
      return true;
    });

    filtered.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

    // Enriquecer com perfil_nome (cache)
    const perfis = await this.listarPerfisHorario();
    const perfilMap = {};
    perfis.forEach(p => perfilMap[p.id] = p);
    filtered.forEach(f => {
      if (f.perfil_horario_id && perfilMap[f.perfil_horario_id]) {
        const p = perfilMap[f.perfil_horario_id];
        f.perfil_nome = p.nome;
        f.perfil_entrada = p.hora_entrada;
        f.perfil_saida = p.hora_saida;
      }
    });

    const total = filtered.length;
    const offset = (page - 1) * limit;
    const pageData = filtered.slice(offset, offset + limit);

    return {
      funcionarios: pageData,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit) || 1
    };
  }

  async buscarFuncionario(id) {
    this._invalidateUserCache();
    const u = await this._loadUser(id);
    if (!u) throw new Error('Colaborador não encontrado');
    if (u.perfil_horario_id) {
      const perfis = await this.listarPerfisHorario();
      const p = perfis.find(x => x.id === u.perfil_horario_id);
      if (p) u.perfil_nome = p.nome;
    }
    return u;
  }

  async cadastrarFuncionario(dados) {
    await this._requireAdmin();
    const { nome, usuario, email, senha, cargo, departamento, jornada_semanal, perfil_horario_id, abono_minutos, role } = dados;
    if (!nome || !usuario || !senha) throw new Error('Nome, usuário e senha são obrigatórios');

    const usuarioLower = usuario.toLowerCase().trim();
    // Verifica duplicidade
    const usuarioKey = this._encodeKey(usuarioLower);
    const mapSnap = await fbDb.ref('usuario_to_uid/' + usuarioKey).once('value');
    if (mapSnap.exists()) throw new Error('Usuário já cadastrado');

    const emailLogin = usuarioLower + '@ccf.local';
    // Cria Auth no app secundário (não desloga o admin)
    const secAuth = fbSecondaryApp.auth();
    let newCred;
    try {
      newCred = await secAuth.createUserWithEmailAndPassword(emailLogin, senha);
    } catch (err) {
      throw new Error('Erro ao criar usuário: ' + (err.message || err.code));
    }
    const newUid = newCred.user.uid;

    await fbDb.ref('users/' + newUid).set({
      nome,
      usuario: usuarioLower,
      email: email || null,
      email_login: emailLogin,
      cargo: cargo || null,
      departamento: departamento || null,
      jornada_semanal: jornada_semanal || 44,
      perfil_horario_id: perfil_horario_id || null,
      abono_minutos: abono_minutos || 0,
      role: role || 'funcionario',
      ativo: true,
      senha_temporaria: true,
      created_at: _now()
    });
    await fbDb.ref('usuario_to_uid/' + usuarioKey).set(newUid);

    await secAuth.signOut();
    this._invalidateUserCache();

    return { id: newUid, usuario: usuarioLower, message: 'Colaborador cadastrado com sucesso. Usuário: ' + usuarioLower };
  }

  async editarFuncionario(id, dados) {
    await this._requireAdmin();
    const updates = {};
    const fields = ['nome', 'email', 'cargo', 'departamento', 'jornada_semanal', 'perfil_horario_id', 'abono_minutos', 'role', 'foto_url'];
    fields.forEach(f => {
      if (dados[f] !== undefined) updates[f] = dados[f] === null ? null : (dados[f] || null);
    });
    if (Object.keys(updates).length === 0) throw new Error('Nenhum campo para atualizar');
    await fbDb.ref('users/' + id).update(updates);
    this._invalidateUserCache();
    return { message: 'Colaborador atualizado com sucesso' };
  }

  async desativarFuncionario(id) {
    await this._requireAdmin();
    await fbDb.ref('users/' + id + '/ativo').set(false);
    this._invalidateUserCache();
    return { message: 'Colaborador desativado' };
  }

  async reativarFuncionario(id) {
    await this._requireAdmin();
    await fbDb.ref('users/' + id + '/ativo').set(true);
    this._invalidateUserCache();
    return { message: 'Colaborador reativado' };
  }

  async excluirFuncionarioDefinitivo(id) {
    await this._requireAdmin();
    if (id === this._currentUid) throw new Error('Você não pode excluir seu próprio usuário');
    const u = await this._loadUser(id);
    if (!u) throw new Error('Colaborador não encontrado');

    // Remove dados relacionados do RTDB
    const updates = {};
    updates['users/' + id] = null;
    updates['usuario_to_uid/' + this._encodeKey(u.usuario)] = null;
    updates['registros/' + id] = null;
    updates['configuracoes_horario/' + id] = null;
    updates['holerites/' + id] = null;
    await fbDb.ref().update(updates);

    // Limpa nós indexados por funcionario_uid em paralelo
    const [ajSnap, abSnap, heSnap, siSnap] = await Promise.all([
      fbDb.ref('ajustes').orderByChild('funcionario_uid').equalTo(id).once('value'),
      fbDb.ref('abonos').orderByChild('funcionario_uid').equalTo(id).once('value'),
      fbDb.ref('horas_extras').orderByChild('funcionario_uid').equalTo(id).once('value'),
      fbDb.ref('saidas_intermediarias').orderByChild('funcionario_uid').equalTo(id).once('value')
    ]);
    const deleteUpdates = {};
    ajSnap.forEach(c => { deleteUpdates['ajustes/' + c.key] = null; });
    abSnap.forEach(c => { deleteUpdates['abonos/' + c.key] = null; });
    heSnap.forEach(c => { deleteUpdates['horas_extras/' + c.key] = null; });
    siSnap.forEach(c => { deleteUpdates['saidas_intermediarias/' + c.key] = null; });
    if (Object.keys(deleteUpdates).length) await fbDb.ref().update(deleteUpdates);

    // Tenta remover arquivos do Storage (best-effort: foto de perfil e holerites)
    try {
      if (u.foto_url) {
        await fbStorage.refFromURL(u.foto_url).delete().catch(() => {});
      }
      // Holerites PDFs — não sabemos chaves exatas sem leitura prévia, então tentar listar
      const holPath = fbStorage.ref('holerites/' + id);
      const lista = await holPath.listAll().catch(() => ({ items: [] }));
      await Promise.all((lista.items || []).map(it => it.delete().catch(() => {})));
    } catch (e) { /* best-effort */ }

    this._invalidateUserCache();
    // NOTA: o usuário ainda existe no Firebase Auth (sem Admin SDK não conseguimos deletar).
    // O login dele falhará pois /users/{uid} não existe mais.
    return { message: 'Colaborador ' + u.nome + ' excluído definitivamente', usuario: u.usuario };
  }

  // ==================== PONTO ====================
  async _ultimosRegistrosDia(uid, data) {
    const snap = await fbDb.ref('registros/' + uid)
      .orderByChild('data').equalTo(data).once('value');
    const arr = [];
    snap.forEach(c => { const v = c.val(); v.id = c.key; arr.push(v); });
    arr.sort((a, b) => (a.data_hora || '').localeCompare(b.data_hora || ''));
    return arr;
  }

  async registrarPonto() {
    if (this._currentUserData?.role === 'admin') throw new Error('Administradores não registram ponto');
    const uid = this._currentUid;
    const ORDEM = ['entrada', 'saida_almoco', 'retorno_almoco', 'saida'];
    const hoje = _today();
    const registros = await this._ultimosRegistrosDia(uid, hoje);

    const tiposRegistrados = new Set(registros.map(r => r.tipo));
    const proximoTipo = ORDEM.find(t => !tiposRegistrados.has(t));
    if (!proximoTipo) throw new Error('Todos os registros do dia já foram feitos');

    // Trava de 1h para retorno_almoco
    if (proximoTipo === 'retorno_almoco') {
      const saida = registros.find(r => r.tipo === 'saida_almoco');
      if (saida) {
        const diff = Math.floor((Date.now() - new Date(saida.data_hora).getTime()) / 60000);
        if (diff < 60) throw new Error('O almoço deve ter no mínimo 60 minutos. Aguarde mais ' + (60 - diff) + ' minuto(s).');
      }
    }

    const dataHoraLocal = _nowIso();
    const ref = fbDb.ref('registros/' + uid).push();
    await ref.set({
      tipo: proximoTipo,
      data_hora: dataHoraLocal,
      data: hoje,
      ip_origem: 'web',
      created_at: dataHoraLocal
    });
    return { message: proximoTipo.replace('_', ' ') + ' registrada com sucesso', tipo: proximoTipo, data_hora: dataHoraLocal };
  }

  async sincronizarPonto(registros) {
    // Com RTDB offline, não precisa de sync manual. Mantido para compat.
    const resultados = [];
    for (const r of (registros || [])) {
      resultados.push({ id: r.offline_id, status: 'sincronizado', tipo: r.tipo, data: (r.data_hora || '').slice(0, 10) });
    }
    return { message: 'OK', resultados };
  }

  async ultimoRegistro() {
    const uid = this._currentUid;
    if (!uid) return { ultimoRegistro: null, proximoTipo: 'entrada', saidaAlmoco: null, almocoMinimoMinutos: 60 };
    const registros = await this._ultimosRegistrosDia(uid, _today());
    const ORDEM = ['entrada', 'saida_almoco', 'retorno_almoco', 'saida'];
    const tiposRegistrados = new Set(registros.map(r => r.tipo));
    const proximoTipo = ORDEM.find(t => !tiposRegistrados.has(t)) || null;
    const saidaAlmoco = registros.find(r => r.tipo === 'saida_almoco');
    return {
      ultimoRegistro: registros[registros.length - 1] || null,
      proximoTipo,
      saidaAlmoco: saidaAlmoco ? saidaAlmoco.data_hora : null,
      almocoMinimoMinutos: 60
    };
  }

  async registrosDia(data, funcionarioId) {
    const uid = funcionarioId || this._currentUid;
    return await this._ultimosRegistrosDia(uid, data);
  }

  async _registrosMes(uid, mes, ano) {
    const { start, end } = _monthRange(mes, ano);
    const snap = await fbDb.ref('registros/' + uid)
      .orderByChild('data').startAt(start).endBefore(end).once('value');
    const arr = [];
    snap.forEach(c => { const v = c.val(); v.id = c.key; arr.push(v); });
    return arr;
  }

  // ==================== HORAS ====================
  async horasTrabalhadas(data, funcionarioId) {
    const uid = funcionarioId || this._currentUid;
    const regs = await this._ultimosRegistrosDia(uid, data);
    const byTipo = {};
    regs.forEach(r => byTipo[r.tipo] = r);
    let minutos = 0;
    if (byTipo.entrada && byTipo.saida) {
      minutos = Math.floor((new Date(byTipo.saida.data_hora) - new Date(byTipo.entrada.data_hora)) / 60000);
      if (byTipo.saida_almoco && byTipo.retorno_almoco) {
        minutos -= Math.floor((new Date(byTipo.retorno_almoco.data_hora) - new Date(byTipo.saida_almoco.data_hora)) / 60000);
      }
    }
    // Descontar ausências intermediárias já encerradas (com retorno registrado)
    const siSnap = await fbDb.ref('saidas_intermediarias')
      .orderByChild('funcionario_uid').equalTo(uid).once('value');
    let ausenciasDia = 0;
    siSnap.forEach(c => {
      const v = c.val();
      if (v.data === data && v.hora_retorno) ausenciasDia += (v.minutos || 0);
    });
    minutos -= ausenciasDia;
    const totalMin = Math.max(0, minutos);
    const totalFmt = `${String(Math.floor(totalMin/60)).padStart(2,'0')}:${String(totalMin%60).padStart(2,'0')}`;
    return { totalMinutos: totalMin, totalHoras: (totalMin / 60).toFixed(2), totalFormatado: totalFmt };
  }

  async bancoHoras(mes, ano, funcionarioId) {
    const uid = funcionarioId || this._currentUid;
    mes = parseInt(mes, 10);
    ano = parseInt(ano, 10);
    const regs = await this._registrosMes(uid, mes, ano);
    const porDia = {};
    regs.forEach(r => {
      if (!porDia[r.data]) porDia[r.data] = {};
      porDia[r.data][r.tipo] = r.data_hora;
    });
    const userData = await this._loadUser(uid);
    const jornadaSemanal = (userData && userData.jornada_semanal) || 44;
    const jornadaDiariaMin = Math.round((jornadaSemanal / 5) * 60);
    const abonoMin = (userData && userData.abono_minutos) || 0;

    // Feriados, horas extras aprovadas e saídas intermediárias
    const [feriadosSnap, heSnap, saidasPorDia] = await Promise.all([
      fbDb.ref('feriados').once('value'),
      fbDb.ref('horas_extras').orderByChild('funcionario_uid').equalTo(uid).once('value'),
      this._saidasIntermediariasPorDia(uid, mes, ano)
    ]);
    const feriadosMap = {};
    feriadosSnap.forEach(c => { const v = c.val(); if (v && v.data) feriadosMap[v.data] = true; });
    const heAprovadasMap = {};
    heSnap.forEach(c => { const v = c.val(); if (v && v.status === 'aprovado' && v.data) heAprovadasMap[v.data] = true; });

    // Saldo = soma de (deficits sempre) + (extras so se aprovadas)
    const diasNoMes = new Date(ano, mes, 0).getDate();
    let saldoMin = 0;
    let totalMin = 0;
    const dias = [];
    for (let d = 1; d <= diasNoMes; d++) {
      const dataStr = `${ano}-${String(mes).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dow = new Date(ano, mes - 1, d).getDay();
      if (dow === 0 || dow === 6 || feriadosMap[dataStr]) continue;
      const t = porDia[dataStr] || {};
      let min = 0;
      if (t.entrada && t.saida) {
        min = Math.floor((new Date(t.saida) - new Date(t.entrada)) / 60000);
        if (t.saida_almoco && t.retorno_almoco) min -= Math.floor((new Date(t.retorno_almoco) - new Date(t.saida_almoco)) / 60000);
      }
      min = Math.max(0, min);

      // Descontar ausências intermediárias encerradas
      const ausencias = (saidasPorDia[dataStr] || []).filter(a => a.hora_retorno);
      const ausTotal = ausencias.reduce((s, a) => s + (a.minutos || 0), 0);
      const ausAbonada = ausencias.filter(a => a.status === 'abonado').reduce((s, a) => s + (a.minutos || 0), 0);
      const ausBanco = ausencias.filter(a => a.status === 'usar_banco').reduce((s, a) => s + (a.minutos || 0), 0);
      min = Math.max(0, min - ausTotal);

      // Tolerância como janela: déficit ≤ abonoMin → dia completo (não infla os minutos)
      totalMin += min;
      // abonado cobre déficit (não infla); usar_banco também cobre déficit mas debita separado do banco
      const minCoberto = min + ausAbonada + ausBanco;
      const rawDiff = minCoberto - jornadaDiariaMin;
      const effDiff = rawDiff >= 0 ? rawDiff : Math.min(0, rawDiff + abonoMin);
      if (effDiff < 0) saldoMin += effDiff;
      else if (effDiff > 0 && heAprovadasMap[dataStr]) saldoMin += effDiff;
      // Horas usadas do banco: debita do saldo
      if (ausBanco > 0) saldoMin -= ausBanco;
      dias.push({ data: dataStr, minutos: min, minutosBrutos: min + ausTotal, diffMinutos: effDiff, ausenciaMinutos: ausTotal });
    }

    const saldoAbs = Math.abs(saldoMin);
    const saldoFormatado = `${String(Math.floor(saldoAbs/60)).padStart(2,'0')}:${String(saldoAbs%60).padStart(2,'0')}`;

    return {
      totalMinutos: totalMin,
      totalHoras: (totalMin / 60).toFixed(2),
      saldoMinutos: saldoMin,
      saldoPositivo: saldoMin >= 0,
      saldoFormatado,
      dias
    };
  }

  // ==================== HORAS EXTRAS ====================
  async solicitarHorasExtras(data) {
    const uid = this._currentUid;
    // Verifica se ja existe
    const existSnap = await fbDb.ref('horas_extras').orderByChild('funcionario_uid').equalTo(uid).once('value');
    let jaExiste = null;
    existSnap.forEach(c => { const v = c.val(); if (v.data === data) jaExiste = c.key; });
    if (jaExiste) throw new Error('Solicitação já existe para este dia');

    // Calcula minutos extras a partir dos registros do dia
    const dayRegs = await this._ultimosRegistrosDia(uid, data);
    const t = {};
    dayRegs.forEach(r => { t[r.tipo] = r.data_hora; });
    let min = 0;
    if (t.entrada && t.saida) {
      min = Math.floor((new Date(t.saida) - new Date(t.entrada)) / 60000);
      if (t.saida_almoco && t.retorno_almoco) min -= Math.floor((new Date(t.retorno_almoco) - new Date(t.saida_almoco)) / 60000);
    }
    const userData = this._currentUserData || await this._loadUser(uid);
    const jornadaDiariaMin = Math.round(((userData?.jornada_semanal || 44) / 5) * 60);
    const minutosExtras = min - jornadaDiariaMin;
    if (minutosExtras <= 0) throw new Error('Não há horas extras neste dia');

    const ref = fbDb.ref('horas_extras').push();
    await ref.set({
      funcionario_uid: uid,
      funcionario_nome: userData?.nome || null,
      data,
      minutos_extras: minutosExtras,
      status: 'pendente',
      created_at: _now()
    });
    return { id: ref.key, message: 'Solicitação de horas extras enviada' };
  }

  async horasExtrasPendentes() {
    await this._requireAdmin();
    const snap = await fbDb.ref('horas_extras').orderByChild('status').equalTo('pendente').once('value');
    const arr = [];
    snap.forEach(c => { const v = c.val(); v.id = c.key; arr.push(v); });
    arr.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    return arr;
  }

  async aprovarHorasExtrasAdmin(uid, data) {
    await this._requireAdmin();
    // Verifica se já existe registro para este dia
    const existSnap = await fbDb.ref('horas_extras').orderByChild('funcionario_uid').equalTo(uid).once('value');
    let existeId = null;
    existSnap.forEach(c => { const v = c.val(); if (v.data === data) existeId = c.key; });

    if (existeId) {
      // Já existe (pendente ou rejeitado) → apenas aprova
      await fbDb.ref('horas_extras/' + existeId).update({ status: 'aprovado', admin_uid: this._currentUid, aprovado_em: _now() });
      return { message: 'Horas Positivas aprovadas' };
    }

    // Não existe → calcula e cria já aprovado
    const dayRegs = await this._ultimosRegistrosDia(uid, data);
    const t = {};
    dayRegs.forEach(r => { t[r.tipo] = r.data_hora; });
    let min = 0;
    if (t.entrada && t.saida) {
      min = Math.floor((new Date(t.saida) - new Date(t.entrada)) / 60000);
      if (t.saida_almoco && t.retorno_almoco) min -= Math.floor((new Date(t.retorno_almoco) - new Date(t.saida_almoco)) / 60000);
    }
    const userData = await this._loadUser(uid);
    const jornadaDiariaMin = Math.round(((userData?.jornada_semanal || 44) / 5) * 60);
    const minutosExtras = min - jornadaDiariaMin;
    if (minutosExtras <= 0) throw new Error('Não há horas extras neste dia');

    const ref = fbDb.ref('horas_extras').push();
    await ref.set({
      funcionario_uid: uid,
      funcionario_nome: userData?.nome || null,
      data,
      minutos_extras: minutosExtras,
      status: 'aprovado',
      admin_uid: this._currentUid,
      aprovado_em: _now(),
      created_at: _now()
    });
    return { message: 'Horas Positivas aprovadas' };
  }

  async aprovarHorasExtras(id) {
    await this._requireAdmin();
    await fbDb.ref('horas_extras/' + id).update({ status: 'aprovado', admin_uid: this._currentUid, aprovado_em: _now() });
    return { message: 'Horas extras aprovadas' };
  }

  async rejeitarHorasExtras(id, motivo) {
    await this._requireAdmin();
    await fbDb.ref('horas_extras/' + id).update({ status: 'rejeitado', admin_uid: this._currentUid, motivo_rejeicao: motivo || '', rejeitado_em: _now() });
    return { message: 'Horas extras rejeitadas' };
  }

  // ==================== AJUSTES ====================
  async solicitarAjuste(dados) {
    // Janela: não permite ajuste > 30 dias no passado
    const hojeMs = Date.now();
    const dataMs = new Date(dados.data + 'T12:00:00').getTime();
    const diasAtras = Math.floor((hojeMs - dataMs) / 86400000);
    if (diasAtras > 30) throw new Error('Ajustes só são permitidos até 30 dias anteriores à data atual. Fale com o administrador.');
    if (diasAtras < 0) throw new Error('Não é possível solicitar ajuste para uma data futura.');

    const ref = fbDb.ref('ajustes').push();
    await ref.set({
      funcionario_uid: this._currentUid,
      funcionario_nome: this._currentUserData?.nome || null,
      data: dados.data,
      tipo: dados.tipo,
      nova_hora: dados.nova_hora,
      motivo: dados.motivo,
      status: 'pendente',
      created_at: _now()
    });
    return { id: ref.key, message: 'Ajuste solicitado' };
  }

  async meusAjustes() {
    const snap = await fbDb.ref('ajustes').orderByChild('funcionario_uid').equalTo(this._currentUid).once('value');
    const arr = [];
    snap.forEach(c => { const v = c.val(); v.id = c.key; arr.push(v); });
    arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return arr;
  }

  async ajustesPendentes() {
    await this._requireAdmin();
    const snap = await fbDb.ref('ajustes').orderByChild('status').equalTo('pendente').once('value');
    const arr = [];
    snap.forEach(c => { const v = c.val(); v.id = c.key; arr.push(v); });
    return arr;
  }

  async aprovarAjuste(id) {
    await this._requireAdmin();

    // Busca os dados do ajuste para aplicar o horário no registro de ponto
    const ajusteSnap = await fbDb.ref('ajustes/' + id).once('value');
    const ajuste = ajusteSnap.val();
    if (!ajuste) throw new Error('Ajuste não encontrado');

    const { funcionario_uid, data, tipo, nova_hora } = ajuste;

    // Busca o registro existente do mesmo tipo/data para atualizar ou criar
    const regSnap = await fbDb.ref('registros/' + funcionario_uid)
      .orderByChild('data').equalTo(data).once('value');

    let existingKey = null;
    regSnap.forEach(c => { if (c.val().tipo === tipo) existingKey = c.key; });

    const dataHora = data + 'T' + nova_hora + ':00';
    const updates = {};

    if (existingKey) {
      updates['registros/' + funcionario_uid + '/' + existingKey + '/data_hora'] = dataHora;
      updates['registros/' + funcionario_uid + '/' + existingKey + '/ip_origem'] = 'ajuste-aprovado';
    } else {
      const newKey = fbDb.ref('registros/' + funcionario_uid).push().key;
      updates['registros/' + funcionario_uid + '/' + newKey] = {
        tipo, data_hora: dataHora, data, ip_origem: 'ajuste-aprovado', created_at: dataHora
      };
    }

    updates['ajustes/' + id + '/status'] = 'aprovado';
    updates['ajustes/' + id + '/admin_uid'] = this._currentUid;
    updates['ajustes/' + id + '/aprovado_em'] = _now();

    await fbDb.ref().update(updates);
    return { message: 'Ajuste aprovado' };
  }

  async rejeitarAjuste(id, motivo) {
    await this._requireAdmin();
    await fbDb.ref('ajustes/' + id).update({ status: 'rejeitado', admin_uid: this._currentUid, motivo_rejeicao: motivo || '', rejeitado_em: _now() });
    return { message: 'Ajuste rejeitado' };
  }

  // ==================== ABONOS ====================
  async solicitarAbono(dados) {
    // Validações
    if (!dados.data_inicio || !dados.data_fim) throw new Error('Datas são obrigatórias');
    if (dados.data_inicio > dados.data_fim) throw new Error('Data final deve ser maior ou igual à data inicial');

    // Janela: data_inicio não pode ser > 30 dias atrás
    const hojeMs = Date.now();
    const iniMs = new Date(dados.data_inicio + 'T12:00:00').getTime();
    const diasAtras = Math.floor((hojeMs - iniMs) / 86400000);
    if (diasAtras > 30) throw new Error('Solicitações só são permitidas até 30 dias anteriores. Fale com o administrador.');

    const ref = fbDb.ref('abonos').push();
    await ref.set({
      funcionario_uid: this._currentUid,
      funcionario_nome: this._currentUserData?.nome || null,
      tipo: dados.tipo,
      data_inicio: dados.data_inicio,
      data_fim: dados.data_fim,
      hora_inicio: dados.hora_inicio || null,
      hora_fim: dados.hora_fim || null,
      horas: dados.horas || null,
      motivo: dados.motivo,
      arquivo_url: dados.arquivo_url || null,
      status: 'pendente',
      created_at: _now()
    });
    return { id: ref.key, message: 'Abono solicitado' };
  }

  async meusAbonos() {
    const snap = await fbDb.ref('abonos').orderByChild('funcionario_uid').equalTo(this._currentUid).once('value');
    const arr = [];
    snap.forEach(c => { const v = c.val(); v.id = c.key; arr.push(v); });
    arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return arr;
  }

  async abonosPendentes() {
    await this._requireAdmin();
    const snap = await fbDb.ref('abonos').orderByChild('status').equalTo('pendente').once('value');
    const arr = [];
    snap.forEach(c => { const v = c.val(); v.id = c.key; arr.push(v); });
    return arr;
  }

  async todosAbonos(params = {}) {
    await this._requireAdmin();
    const snap = await fbDb.ref('abonos').once('value');
    let arr = [];
    snap.forEach(c => { const v = c.val(); v.id = c.key; arr.push(v); });
    if (params.status) arr = arr.filter(a => a.status === params.status);
    if (params.tipo) arr = arr.filter(a => a.tipo === params.tipo);
    if (params.mes && params.ano) {
      const { start, end } = _monthRange(parseInt(params.mes), parseInt(params.ano));
      arr = arr.filter(a => a.data_inicio >= start && a.data_inicio < end);
    }
    arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return arr;
  }

  async aprovarAbono(id) {
    await this._requireAdmin();
    await fbDb.ref('abonos/' + id).update({ status: 'aprovado', admin_uid: this._currentUid, aprovado_em: _now() });
    return { message: 'Abono aprovado' };
  }

  async rejeitarAbono(id, motivo) {
    await this._requireAdmin();
    await fbDb.ref('abonos/' + id).update({ status: 'rejeitado', admin_uid: this._currentUid, motivo_rejeicao: motivo || '', rejeitado_em: _now() });
    return { message: 'Abono rejeitado' };
  }

  async excluirAbono(id, arquivoUrl) {
    await this._requireAdmin();
    if (arquivoUrl) {
      try { await fbStorage.refFromURL(arquivoUrl).delete(); } catch (e) {}
    }
    await fbDb.ref('abonos/' + id).remove();
    return { message: 'Abono excluído' };
  }

  // ==================== SAÍDAS INTERMEDIÁRIAS ====================
  // Fluxo híbrido: colaborador registra saída/retorno, admin classifica depois.
  // Status: pendente | abonado | descontar | usar_banco | aguardando_atestado
  async registrarSaidaIntermediaria(motivo) {
    const uid = this._currentUid;
    if (!uid) throw new Error('Sessão expirada');
    if (this._currentUserData?.role === 'admin') throw new Error('Administradores não registram saída intermediária');
    if (!motivo || !motivo.trim()) throw new Error('Motivo é obrigatório');

    const hoje = _today();
    // Exige estar trabalhando: entrada registrada e saida não
    const regs = await this._ultimosRegistrosDia(uid, hoje);
    const tipos = new Set(regs.map(r => r.tipo));
    if (!tipos.has('entrada')) throw new Error('Registre a entrada antes de sair.');
    if (tipos.has('saida')) throw new Error('Jornada encerrada — não é possível registrar saída intermediária.');
    if (tipos.has('saida_almoco') && !tipos.has('retorno_almoco')) {
      throw new Error('Você está no horário de almoço — registre o retorno antes.');
    }

    // Não permite nova saída se já existe uma aberta no dia
    const abertaSnap = await fbDb.ref('saidas_intermediarias')
      .orderByChild('funcionario_uid').equalTo(uid).once('value');
    let aberta = null;
    abertaSnap.forEach(c => {
      const v = c.val();
      if (v.data === hoje && !v.hora_retorno) aberta = { id: c.key, ...v };
    });
    if (aberta) throw new Error('Você já tem uma saída intermediária aberta. Registre o retorno primeiro.');

    const agora = new Date();
    const horaSaida = `${_pad(agora.getHours())}:${_pad(agora.getMinutes())}`;
    const ref = fbDb.ref('saidas_intermediarias').push();
    await ref.set({
      funcionario_uid: uid,
      funcionario_nome: this._currentUserData?.nome || null,
      data: hoje,
      hora_saida: horaSaida,
      motivo: motivo.trim(),
      status: 'pendente',
      created_at: _now()
    });
    return { id: ref.key, hora_saida: horaSaida, message: 'Saída intermediária registrada' };
  }

  async registrarRetornoIntermediario(id) {
    const uid = this._currentUid;
    if (!uid) throw new Error('Sessão expirada');

    const snap = await fbDb.ref('saidas_intermediarias/' + id).once('value');
    const v = snap.val();
    if (!v) throw new Error('Registro não encontrado');
    if (v.funcionario_uid !== uid) throw new Error('Registro de outro colaborador');
    if (v.hora_retorno) throw new Error('Retorno já registrado');

    const agora = new Date();
    const horaRetorno = `${_pad(agora.getHours())}:${_pad(agora.getMinutes())}`;
    const [hi, mi] = v.hora_saida.split(':').map(Number);
    const [hf, mf] = horaRetorno.split(':').map(Number);
    const minutos = Math.max(0, (hf * 60 + mf) - (hi * 60 + mi));

    await fbDb.ref('saidas_intermediarias/' + id).update({
      hora_retorno: horaRetorno,
      minutos,
      retornado_em: _now()
    });
    return { hora_retorno: horaRetorno, minutos, message: 'Retorno registrado' };
  }

  async saidaIntermediariaAberta() {
    const uid = this._currentUid;
    if (!uid) return null;
    const hoje = _today();
    const snap = await fbDb.ref('saidas_intermediarias')
      .orderByChild('funcionario_uid').equalTo(uid).once('value');
    let aberta = null;
    snap.forEach(c => {
      const v = c.val();
      if (v.data === hoje && !v.hora_retorno) aberta = { id: c.key, ...v };
    });
    return aberta;
  }

  async minhasSaidasIntermediarias() {
    const uid = this._currentUid;
    if (!uid) return [];
    const snap = await fbDb.ref('saidas_intermediarias')
      .orderByChild('funcionario_uid').equalTo(uid).once('value');
    const arr = [];
    snap.forEach(c => { const v = c.val(); v.id = c.key; arr.push(v); });
    arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return arr;
  }

  async todasSaidasIntermediarias(params = {}) {
    await this._requireAdmin();
    const snap = await fbDb.ref('saidas_intermediarias').once('value');
    let arr = [];
    snap.forEach(c => { const v = c.val(); v.id = c.key; arr.push(v); });
    if (params.status) arr = arr.filter(a => a.status === params.status);
    if (params.uid) arr = arr.filter(a => a.funcionario_uid === params.uid);
    if (params.mes && params.ano) {
      const { start, end } = _monthRange(parseInt(params.mes), parseInt(params.ano));
      arr = arr.filter(a => a.data >= start && a.data < end);
    }
    arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return arr;
  }

  async classificarSaidaIntermediaria(id, status, observacao) {
    await this._requireAdmin();
    const permitidos = ['pendente', 'abonado', 'descontar', 'usar_banco', 'aguardando_atestado'];
    if (!permitidos.includes(status)) throw new Error('Status inválido');
    const snap = await fbDb.ref('saidas_intermediarias/' + id).once('value');
    const v = snap.val();
    if (!v) throw new Error('Registro não encontrado');
    if (!v.hora_retorno) throw new Error('Colaborador ainda não registrou retorno — classifique somente após.');
    await fbDb.ref('saidas_intermediarias/' + id).update({
      status,
      observacao: observacao || null,
      classificado_por: this._currentUid,
      classificado_em: _now()
    });
    return { message: 'Classificação atualizada' };
  }

  async excluirSaidaIntermediaria(id) {
    await this._requireAdmin();
    await fbDb.ref('saidas_intermediarias/' + id).remove();
    return { message: 'Registro excluído' };
  }

  // Admin cria uma ausência retroativa (quando o colaborador esqueceu de registrar)
  async criarSaidaIntermediariaAdmin(dados) {
    await this._requireAdmin();
    const { funcionario_uid, data, hora_saida, hora_retorno, motivo, status, observacao } = dados;
    if (!funcionario_uid) throw new Error('Colaborador é obrigatório');
    if (!data) throw new Error('Data é obrigatória');
    if (!hora_saida || !hora_retorno) throw new Error('Hora de saída e retorno são obrigatórias');
    if (hora_saida >= hora_retorno) throw new Error('Hora de retorno deve ser maior que hora de saída');
    if (!motivo || !motivo.trim()) throw new Error('Motivo é obrigatório');
    const permitidos = ['pendente', 'abonado', 'descontar', 'usar_banco', 'aguardando_atestado'];
    const st = permitidos.includes(status) ? status : 'descontar';

    const [hi, mi] = hora_saida.split(':').map(Number);
    const [hf, mf] = hora_retorno.split(':').map(Number);
    const minutos = Math.max(0, (hf * 60 + mf) - (hi * 60 + mi));

    const user = await this._loadUser(funcionario_uid);
    const ref = fbDb.ref('saidas_intermediarias').push();
    await ref.set({
      funcionario_uid,
      funcionario_nome: user?.nome || null,
      data,
      hora_saida,
      hora_retorno,
      minutos,
      motivo: motivo.trim(),
      status: st,
      observacao: observacao || null,
      criado_por_admin: this._currentUid,
      classificado_por: this._currentUid,
      classificado_em: _now(),
      created_at: _now()
    });
    return { id: ref.key, minutos, message: 'Ausência registrada retroativamente' };
  }

  async _saidasIntermediariasPorDia(uid, mes, ano) {
    const { start, end } = _monthRange(mes, ano);
    const snap = await fbDb.ref('saidas_intermediarias')
      .orderByChild('funcionario_uid').equalTo(uid).once('value');
    const porDia = {};
    snap.forEach(c => {
      const v = c.val(); v.id = c.key;
      if (v.data >= start && v.data < end) {
        (porDia[v.data] = porDia[v.data] || []).push(v);
      }
    });
    return porDia;
  }

  async _todasSaidasIntermediariasUid(uid) {
    const snap = await fbDb.ref('saidas_intermediarias')
      .orderByChild('funcionario_uid').equalTo(uid).once('value');
    const porDia = {};
    snap.forEach(c => {
      const v = c.val(); v.id = c.key;
      (porDia[v.data] = porDia[v.data] || []).push(v);
    });
    return porDia;
  }

  async contarSaidasIntermediariasPendentes() {
    await this._requireAdmin();
    const snap = await fbDb.ref('saidas_intermediarias').once('value');
    let count = 0;
    snap.forEach(c => {
      const v = c.val();
      // pendentes: ainda sem retorno, ou com retorno e status pendente/aguardando_atestado
      if (!v.hora_retorno) return; // ainda aberta, não classificável
      if (v.status === 'pendente' || v.status === 'aguardando_atestado') count++;
    });
    return count;
  }

  // ==================== PERFIS DE HORÁRIO ====================
  async listarPerfisHorario() {
    if (this._perfilCache && (Date.now() - this._perfilCacheTs) < 60000) return this._perfilCache;
    const snap = await fbDb.ref('perfis_horario').once('value');
    const arr = [];
    snap.forEach(c => { const v = c.val(); v.id = c.key; arr.push(v); });
    arr.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    this._perfilCache = arr;
    this._perfilCacheTs = Date.now();
    return arr;
  }

  async buscarPerfilHorario(id) {
    const snap = await fbDb.ref('perfis_horario/' + id).once('value');
    const v = snap.val();
    if (!v) throw new Error('Perfil não encontrado');
    v.id = id;
    return v;
  }

  async criarPerfilHorario(dados) {
    await this._requireAdmin();
    const ref = fbDb.ref('perfis_horario').push();
    await ref.set({ ...dados, created_at: _now() });
    this._perfilCache = null;
    return { id: ref.key, message: 'Perfil criado' };
  }

  async editarPerfilHorario(id, dados) {
    await this._requireAdmin();
    await fbDb.ref('perfis_horario/' + id).update(dados);
    this._perfilCache = null;
    return { message: 'Perfil atualizado' };
  }

  async excluirPerfilHorario(id) {
    await this._requireAdmin();
    // Desvincular funcionarios que usam esse perfil
    const usersSnap = await fbDb.ref('users').once('value');
    const updates = {};
    usersSnap.forEach(c => {
      if (c.val().perfil_horario_id === id) updates['users/' + c.key + '/perfil_horario_id'] = null;
    });
    updates['perfis_horario/' + id] = null;
    await fbDb.ref().update(updates);
    this._perfilCache = null;
    this._invalidateUserCache();
    return { message: 'Perfil excluído' };
  }

  // ==================== CONFIGURAÇÕES ====================
  async buscarHorarios(funcionarioId) {
    const snap = await fbDb.ref('configuracoes_horario/' + funcionarioId).once('value');
    const arr = [];
    snap.forEach(c => { const v = c.val(); v.dia_semana = parseInt(c.key); arr.push(v); });
    return arr;
  }

  async salvarHorarios(funcionarioId, horarios) {
    await this._requireAdmin();
    const updates = {};
    horarios.forEach(h => {
      updates['configuracoes_horario/' + funcionarioId + '/' + h.dia_semana] = {
        hora_entrada: h.hora_entrada || null,
        hora_saida_almoco: h.hora_saida_almoco || null,
        hora_retorno_almoco: h.hora_retorno_almoco || null,
        hora_saida: h.hora_saida || null
      };
    });
    await fbDb.ref().update(updates);
    return { message: 'Horários salvos' };
  }

  async listarFeriados(ano) {
    const snap = await fbDb.ref('feriados').once('value');
    const arr = [];
    snap.forEach(c => {
      const v = c.val(); v.id = c.key;
      if (!ano || (v.data && v.data.startsWith(String(ano)))) arr.push(v);
    });
    arr.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
    return arr;
  }

  async verificarFeriado(data) {
    const snap = await fbDb.ref('feriados').once('value');
    let feriado = null;
    snap.forEach(c => { const v = c.val(); if (v?.data === data) { feriado = { ...v, id: c.key }; } });
    return feriado;
  }

  async cadastrarFeriado(data, descricao) {
    await this._requireAdmin();
    const ref = fbDb.ref('feriados').push();
    await ref.set({ data, descricao });
    return { id: ref.key, message: 'Feriado cadastrado' };
  }

  async removerFeriado(id) {
    await this._requireAdmin();
    await fbDb.ref('feriados/' + id).remove();
    return { message: 'Feriado removido' };
  }

  async buscarTolerancia() {
    const snap = await fbDb.ref('configuracoes/tolerancia_minutos').once('value');
    return { minutos: parseInt(snap.val() || '10') };
  }

  async salvarTolerancia(minutos) {
    await this._requireAdmin();
    await fbDb.ref('configuracoes/tolerancia_minutos').set(parseInt(minutos));
    return { message: 'Tolerância salva' };
  }

  // ==================== HORAS POSITIVAS ====================
  async saldoHorasPositivas(uid) {
    const targetUid = uid || this._currentUid;
    const [heSnap, abSnap] = await Promise.all([
      fbDb.ref('horas_extras').orderByChild('funcionario_uid').equalTo(targetUid).once('value'),
      fbDb.ref('abonos').orderByChild('funcionario_uid').equalTo(targetUid).once('value')
    ]);
    let totalExtrasMin = 0;
    heSnap.forEach(c => {
      const v = c.val();
      if (v.status === 'aprovado') totalExtrasMin += (v.minutos_extras || 0);
    });
    let totalUsadoMin = 0;
    abSnap.forEach(c => {
      const v = c.val();
      if (v.tipo === 'abono_horas' && v.status === 'aprovado') {
        if (v.hora_inicio && v.hora_fim) {
          const [hi, mi] = v.hora_inicio.split(':').map(Number);
          const [hf, mf] = v.hora_fim.split(':').map(Number);
          totalUsadoMin += Math.max(0, (hf * 60 + mf) - (hi * 60 + mi));
        } else if (v.horas) {
          totalUsadoMin += Math.round(parseFloat(v.horas) * 60);
        }
      }
    });
    const saldoMin = Math.max(0, totalExtrasMin - totalUsadoMin);
    const fmtMin = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
    return { saldoMinutos: saldoMin, saldoFormatado: fmtMin(saldoMin), totalExtrasMin, totalUsadoMin };
  }

  // ==================== SALDO ACUMULADO (todos os meses) ====================
  async saldoAcumuladoHoras(uid) {
    const targetUid = uid || this._currentUid;
    const userData = await this._loadUser(targetUid);
    const jornadaDiariaMin = Math.round(((userData?.jornada_semanal || 44) / 5) * 60);
    const abonoMin = (userData?.abono_minutos) || 0;

    // Primeiro registro para saber a data de início
    const firstSnap = await fbDb.ref('registros/' + targetUid)
      .orderByChild('data').limitToFirst(1).once('value');
    let firstDate = null;
    firstSnap.forEach(c => { firstDate = c.val().data; });
    if (!firstDate) return { saldoMinutos: 0, saldoFormatado: '00:00', negativo: false };

    const today = _today();

    // Todos os dados em paralelo (uma única leitura cada)
    const [regsSnap, feriadosSnap, heSnap, abonosSnap, saidasPorDia] = await Promise.all([
      fbDb.ref('registros/' + targetUid).once('value'),
      fbDb.ref('feriados').once('value'),
      fbDb.ref('horas_extras').orderByChild('funcionario_uid').equalTo(targetUid).once('value'),
      fbDb.ref('abonos').orderByChild('funcionario_uid').equalTo(targetUid).once('value'),
      this._todasSaidasIntermediariasUid(targetUid)
    ]);

    const porDia = {};
    regsSnap.forEach(c => {
      const v = c.val();
      if (!porDia[v.data]) porDia[v.data] = {};
      porDia[v.data][v.tipo] = v.data_hora;
    });

    const feriadosSet = new Set();
    feriadosSnap.forEach(c => { const v = c.val(); if (v?.data) feriadosSet.add(v.data); });

    // Armazena minutos_extras aprovados por data (usado diretamente no saldo)
    const heAprovMap = {};
    heSnap.forEach(c => { const v = c.val(); if (v?.status === 'aprovado' && v.data) heAprovMap[v.data] = v.minutos_extras || 0; });

    const atestados = [], abonoHorasList = [];
    abonosSnap.forEach(c => {
      const v = c.val();
      if (v.status === 'aprovado') {
        if (v.tipo === 'atestado') atestados.push(v);
        else if (v.tipo === 'abono_horas') abonoHorasList.push(v);
      }
    });

    // Itera todos os dias úteis desde o primeiro registro até hoje (inclui hoje se a saída já foi registrada)
    const dtStart = new Date(firstDate + 'T12:00:00');
    const dtEnd = new Date(today + 'T12:00:00');
    let totalSaldo = 0;

    for (let dt = new Date(dtStart); dt <= dtEnd; dt.setDate(dt.getDate() + 1)) {
      const dataStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      const dow = dt.getDay();
      if (dow === 0 || dow === 6 || feriadosSet.has(dataStr)) continue;

      const t = porDia[dataStr] || {};
      // Hoje sem saída = dia ainda em andamento, não conta
      if (dataStr === today && !t.saida) continue;
      let min = 0;
      if (t.entrada && t.saida) {
        min = Math.floor((new Date(t.saida) - new Date(t.entrada)) / 60000);
        if (t.saida_almoco && t.retorno_almoco) min -= Math.floor((new Date(t.retorno_almoco) - new Date(t.saida_almoco)) / 60000);
      }
      min = Math.max(0, min);

      // Saídas intermediárias encerradas do dia
      const ausencias = (saidasPorDia[dataStr] || []).filter(a => a.hora_retorno);
      const ausTotal = ausencias.reduce((s, a) => s + (a.minutos || 0), 0);
      const ausAbonada = ausencias.filter(a => a.status === 'abonado').reduce((s, a) => s + (a.minutos || 0), 0);
      const ausBanco = ausencias.filter(a => a.status === 'usar_banco').reduce((s, a) => s + (a.minutos || 0), 0);
      min = Math.max(0, min - ausTotal);

      // Atestado
      const atDia = atestados.filter(a => dataStr >= a.data_inicio && dataStr <= a.data_fim);
      let atMin = 0;
      for (const at of atDia) {
        if (at.hora_inicio && at.hora_fim) {
          const [hi, mi] = at.hora_inicio.split(':').map(Number);
          const [hf, mf] = at.hora_fim.split(':').map(Number);
          atMin += Math.max(0, (hf*60+mf) - (hi*60+mi));
        } else { atMin += Math.max(0, jornadaDiariaMin - min); }
      }
      const atEfetivo = Math.min(atMin, Math.max(0, jornadaDiariaMin - min));

      // Abono de Horas
      const abDia = abonoHorasList.filter(a => dataStr >= a.data_inicio && dataStr <= a.data_fim);
      let abMin = 0;
      for (const ab of abDia) {
        if (ab.hora_inicio && ab.hora_fim) {
          const [hi, mi] = ab.hora_inicio.split(':').map(Number);
          const [hf, mf] = ab.hora_fim.split(':').map(Number);
          abMin += Math.max(0, (hf*60+mf) - (hi*60+mi));
        } else { abMin += Math.max(0, jornadaDiariaMin - min - atEfetivo); }
      }
      const abEfetivo = Math.min(abMin, Math.max(0, jornadaDiariaMin - min - atEfetivo));

      const minTotal = min + atEfetivo + abEfetivo + ausAbonada + ausBanco;
      const diffComAbono = minTotal - jornadaDiariaMin;
      const effDiff = diffComAbono >= 0 ? diffComAbono : Math.min(0, diffComAbono + abonoMin);

      // Déficit sempre entra; extras apenas se aprovados (usa minutos_extras do registro oficial)
      if (effDiff < 0) totalSaldo += effDiff;
      else if (dataStr in heAprovMap) totalSaldo += heAprovMap[dataStr];
      // Horas usadas do banco: debita do saldo (separado do déficit)
      if (ausBanco > 0) totalSaldo -= ausBanco;
    }

    const absMin = Math.abs(totalSaldo);
    const fmt = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
    return { saldoMinutos: totalSaldo, saldoFormatado: fmt(absMin), negativo: totalSaldo < 0 };
  }

  // ==================== RELATÓRIOS ====================
  async espelhoPonto(mes, ano, funcionarioId) {
    const uid = funcionarioId || this._currentUid;
    mes = parseInt(mes, 10);
    ano = parseInt(ano, 10);
    const regs = await this._registrosMes(uid, mes, ano);
    const porDia = {};
    regs.forEach(r => {
      if (!porDia[r.data]) porDia[r.data] = {};
      porDia[r.data][r.tipo] = r.data_hora;
    });
    const user = await this._loadUser(uid);
    const jornadaSemanal = (user && user.jornada_semanal) || 44;
    const jornadaDiariaMin = Math.round((jornadaSemanal / 5) * 60);
    const abonoMin = (user && user.abono_minutos) || 0;

    // Feriados do mes
    const feriadosSnap = await fbDb.ref('feriados').once('value');
    const feriadosMap = {};
    feriadosSnap.forEach(c => { const v = c.val(); if (v && v.data) feriadosMap[v.data] = v.descricao || v.nome || 'Feriado'; });

    // Solicitacoes de horas extras do colaborador (por data)
    const heSnap = await fbDb.ref('horas_extras').orderByChild('funcionario_uid').equalTo(uid).once('value');
    const heMap = {};
    heSnap.forEach(c => { const v = c.val(); v.id = c.key; if (v.data) heMap[v.data] = v; });

    // Abonos aprovados do colaborador no período
    const atSnap = await fbDb.ref('abonos').orderByChild('funcionario_uid').equalTo(uid).once('value');
    const atestados = [], abonoHorasList = [], compensacaoList = [];
    atSnap.forEach(c => {
      const v = c.val(); v.id = c.key;
      if (v.status === 'aprovado') {
        if (v.tipo === 'atestado') atestados.push(v);
        else if (v.tipo === 'abono_horas') abonoHorasList.push(v);
        else if (v.tipo === 'compensacao') compensacaoList.push(v);
      }
    });

    // Saídas intermediárias do mês
    const saidasPorDia = await this._saidasIntermediariasPorDia(uid, mes, ano);

    const fmt = (m) => {
      const abs = Math.abs(m);
      return `${String(Math.floor(abs/60)).padStart(2,'0')}:${String(abs%60).padStart(2,'0')}`;
    };

    const diasNoMes = new Date(ano, mes, 0).getDate();
    const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const dias = [];
    let totalTrabMin = 0, totalExtrasMin = 0, totalFaltasMin = 0, diasUteis = 0;

    for (let d = 1; d <= diasNoMes; d++) {
      const dataStr = `${ano}-${String(mes).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dt = new Date(ano, mes - 1, d);
      const dow = dt.getDay();
      const t = porDia[dataStr] || {};
      let min = 0;
      if (t.entrada && t.saida) {
        min = Math.floor((new Date(t.saida) - new Date(t.entrada)) / 60000);
        if (t.saida_almoco && t.retorno_almoco) min -= Math.floor((new Date(t.retorno_almoco) - new Date(t.saida_almoco)) / 60000);
      }
      min = Math.max(0, min);

      // Ausências intermediárias encerradas do dia
      const ausenciasDia = (saidasPorDia[dataStr] || []).filter(a => a.hora_retorno);
      const ausenciasTodas = saidasPorDia[dataStr] || []; // inclui abertas (sem retorno)
      const ausTotalMin = ausenciasDia.reduce((s, a) => s + (a.minutos || 0), 0);
      const ausAbonadaMin = ausenciasDia.filter(a => a.status === 'abonado').reduce((s, a) => s + (a.minutos || 0), 0);
      const ausBancoMin = ausenciasDia.filter(a => a.status === 'usar_banco').reduce((s, a) => s + (a.minutos || 0), 0);
      const ausPendenteMin = ausenciasDia.filter(a => a.status === 'pendente' || a.status === 'aguardando_atestado').reduce((s, a) => s + (a.minutos || 0), 0);
      const ausDescontarMin = ausenciasDia.filter(a => a.status === 'descontar').reduce((s, a) => s + (a.minutos || 0), 0);
      min = Math.max(0, min - ausTotalMin);

      // Atestados aprovados que cobrem este dia
      const atestadoDia = atestados.filter(a => dataStr >= a.data_inicio && dataStr <= a.data_fim);
      let atestadoMin = 0;
      let atestadoDiaInteiro = false;
      if (atestadoDia.length > 0) {
        for (const at of atestadoDia) {
          if (at.hora_inicio && at.hora_fim) {
            const [hi, mi2] = at.hora_inicio.split(':').map(Number);
            const [hf, mf] = at.hora_fim.split(':').map(Number);
            atestadoMin += Math.max(0, (hf * 60 + mf) - (hi * 60 + mi2));
          } else {
            atestadoDiaInteiro = true;
            atestadoMin += Math.max(0, jornadaDiariaMin - min);
          }
        }
      }
      // Atestado cobre apenas o déficit (não gera extras)
      const atestadoEfetivo = Math.min(atestadoMin, Math.max(0, jornadaDiariaMin - min));

      // Abono de Horas aprovado que cobre este dia (cobre déficit restante após atestado)
      const abHoraDia = abonoHorasList.filter(a => dataStr >= a.data_inicio && dataStr <= a.data_fim);
      let abHoraMin = 0;
      for (const ab of abHoraDia) {
        if (ab.hora_inicio && ab.hora_fim) {
          const [hi3, mi3] = ab.hora_inicio.split(':').map(Number);
          const [hf3, mf3] = ab.hora_fim.split(':').map(Number);
          abHoraMin += Math.max(0, (hf3 * 60 + mf3) - (hi3 * 60 + mi3));
        } else {
          abHoraMin += Math.max(0, jornadaDiariaMin - min - atestadoEfetivo);
        }
      }
      const abHoraEfetivo = Math.min(abHoraMin, Math.max(0, jornadaDiariaMin - min - atestadoEfetivo));

      const minComAtestado = min + atestadoEfetivo + abHoraEfetivo + ausAbonadaMin + ausBancoMin;

      // Compensação aprovada que cobre este dia
      const temCompensacao = compensacaoList.some(a => dataStr >= a.data_inicio && dataStr <= a.data_fim);

      // Tolerância como janela: déficit ≤ abonoMin → completa (não infla minutos)
      const diffComAtestado = minComAtestado - jornadaDiariaMin;
      const effDiff = diffComAtestado >= 0 ? diffComAtestado : Math.min(0, diffComAtestado + abonoMin);

      let status;
      const feriadoNome = feriadosMap[dataStr];
      const he = heMap[dataStr] || null;
      if (feriadoNome) status = 'feriado';
      else if (dow === 0 || dow === 6) status = 'fim_de_semana';
      else if (min === 0 && atestadoEfetivo === 0 && abHoraEfetivo === 0) status = 'falta';
      else if (abHoraEfetivo > 0 && effDiff >= 0) status = 'abono_horas';
      else if (atestadoEfetivo > 0 && effDiff >= 0) status = 'atestado';
      else if (effDiff < 0) status = 'incompleto';
      else if (effDiff > 0) status = 'extras';
      else status = 'completa';

      totalTrabMin += minComAtestado;
      if (status !== 'feriado' && status !== 'fim_de_semana') {
        diasUteis++;
        if (status === 'incompleto') totalFaltasMin += Math.abs(effDiff);
        if (effDiff > 0 && he && he.status === 'aprovado') totalExtrasMin += effDiff;
      }

      dias.push({
        data: dataStr,
        diaSemana: diasSemana[dow],
        entrada: _hhmm(t.entrada),
        saida_almoco: _hhmm(t.saida_almoco),
        retorno_almoco: _hhmm(t.retorno_almoco),
        saida: _hhmm(t.saida),
        totalMinutos: minComAtestado,
        minutosBrutos: min,
        abonoMinutos: min > 0 ? abonoMin : 0,
        atestadoMinutos: atestadoEfetivo,
        atestadoDiaInteiro,
        temAtestado: atestadoDia.length > 0,
        abHoraMinutos: abHoraEfetivo,
        temAbono: abHoraDia.length > 0,
        temCompensacao,
        trabalhado: fmt(minComAtestado),
        totalComAbono: fmt(minComAtestado + (min > 0 ? abonoMin : 0)),
        trabalhadoBruto: fmt(min),
        status,
        feriado: feriadoNome || null,
        diffMinutos: effDiff,
        diffFormatado: fmt(Math.abs(effDiff)),
        diffBruto: diffComAtestado,
        diffBrutoFormatado: fmt(Math.abs(diffComAtestado)),
        extrasStatus: he ? he.status : null,
        extrasId: he ? he.id : null,
        extrasMotivoRejeicao: he ? (he.motivo_rejeicao || null) : null,
        ausencias: ausenciasTodas.map(a => ({
          id: a.id,
          hora_saida: a.hora_saida,
          hora_retorno: a.hora_retorno || null,
          motivo: a.motivo,
          minutos: a.minutos || 0,
          status: a.status
        })),
        ausenciaTotalMinutos: ausTotalMin,
        ausenciaAbonadaMinutos: ausAbonadaMin,
        ausenciaBancoMinutos: ausBancoMin,
        ausenciaPendenteMinutos: ausPendenteMin,
        ausenciaDescontarMinutos: ausDescontarMin
      });
    }

    const jornadaMensalMin = jornadaDiariaMin * diasUteis;
    const hoje = _today();
    const totalAbonoConced = dias.filter(d => d.data <= hoje).reduce((s, d) => s + (d.abonoMinutos || 0), 0);
    const nomesMes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const periodo = `${nomesMes[mes - 1]}/${ano}`;

    return {
      funcionario: user,
      mes, ano, periodo,
      abonoMinutosDiario: abonoMin,
      dias,
      totalMinutos: totalTrabMin,
      resumo: {
        totalTrabalhado: fmt(totalTrabMin),
        totalExtras: fmt(totalExtrasMin),
        totalFaltas: fmt(totalFaltasMin),
        jornadaMensal: fmt(jornadaMensalMin),
        abonoTotal: '00:00',
        abonoMinutos: 0,
        totalAbonoConced: fmt(totalAbonoConced)
      }
    };
  }

  async bancoHorasNegativasMes(mes, ano) {
    await this._requireAdmin();
    const usersSnap = await fbDb.ref('users').once('value');
    const usuarios = [];
    usersSnap.forEach(c => { const v = c.val(); v.id = c.key; if (v.role === 'funcionario' && v.ativo !== false) usuarios.push(v); });
    const result = [];
    for (const u of usuarios) {
      const saldo = await this.saldoAcumuladoHoras(u.id);
      if (saldo.saldoMinutos < 0) {
        result.push({ id: u.id, nome: u.nome, departamento: u.departamento || null, saldoMin: saldo.saldoMinutos });
      }
    }
    result.sort((a, b) => a.saldoMin - b.saldoMin);
    return result;
  }

  async relatorioGeral(mes, ano) {
    await this._requireAdmin();
    const usersSnap = await fbDb.ref('users').once('value');
    const usuarios = [];
    usersSnap.forEach(c => { const v = c.val(); v.id = c.key; if (v.role === 'funcionario' && v.ativo !== false) usuarios.push(v); });

    const fmt = (m) => {
      const abs = Math.abs(m);
      return `${String(Math.floor(abs/60)).padStart(2,'0')}:${String(abs%60).padStart(2,'0')}`;
    };

    const resumos = [];
    for (const u of usuarios) {
      // Usa espelhoPonto que já contém todas as regras unificadas (status por dia)
      const esp = await this.espelhoPonto(mes, ano, u.id);
      const diasTrabalhados = esp.dias.filter(d => ['completa','extras','atestado','abono_horas','incompleto'].includes(d.status)).length;
      const faltas = esp.dias.filter(d => d.status === 'falta').length;
      resumos.push({
        funcionario: {
          id: u.id,
          nome: u.nome,
          cargo: u.cargo || null,
          departamento: u.departamento || null
        },
        totalMinutos: esp.totalMinutos,
        totalHoras: fmt(esp.totalMinutos),
        diasTrabalhados,
        faltas
      });
    }
    resumos.sort((a, b) => (a.funcionario.nome || '').localeCompare(b.funcionario.nome || ''));
    return { mes, ano, resumos };
  }

  async inconsistencias(mes, ano) {
    await this._requireAdmin();
    const usersSnap = await fbDb.ref('users').once('value');
    const usuarios = [];
    usersSnap.forEach(c => { const v = c.val(); v.id = c.key; if (v.role === 'funcionario' && v.ativo !== false) usuarios.push(v); });
    const result = [];
    for (const u of usuarios) {
      const regs = await this._registrosMes(u.id, mes, ano);
      const porDia = {};
      regs.forEach(r => { (porDia[r.data] = porDia[r.data] || []).push(r.tipo); });
      Object.keys(porDia).forEach(d => {
        const tipos = porDia[d];
        if (!tipos.includes('entrada') || !tipos.includes('saida')) {
          result.push({ funcionario_id: u.id, nome: u.nome, data: d, tipos });
        }
      });
    }
    return result;
  }

  // ==================== DASHBOARD ====================
  async dashboardAdmin() {
    await this._requireAdmin();
    const hoje = _today();
    const mes = new Date().getMonth() + 1;
    const ano = new Date().getFullYear();
    const { start, end } = _monthRange(mes, ano);

    const usersSnap = await fbDb.ref('users').once('value');
    const funcionarios = [];
    usersSnap.forEach(c => { const v = c.val(); v.id = c.key; if (v.role === 'funcionario' && v.ativo !== false) funcionarios.push(v); });
    const totalFunc = funcionarios.length;

    // Registros de hoje (varredura em paralelo)
    const regsHojeAll = await Promise.all(funcionarios.map(f => this._ultimosRegistrosDia(f.id, hoje).then(r => ({ f, r }))));
    const registrosPorFunc = {};
    const presentesSet = new Set();
    regsHojeAll.forEach(({ f, r }) => {
      if (r.length > 0) {
        presentesSet.add(f.id);
        registrosPorFunc[f.id] = { uid: f.id, nome: f.nome, cargo: f.cargo, departamento: f.departamento, registros: {} };
        r.forEach(reg => { registrosPorFunc[f.id].registros[reg.tipo] = _hhmm(reg.data_hora); });
      }
    });

    // Atrasados hoje: compara entrada registrada com hora_entrada do perfil_horario (+ tolerância do abono_minutos)
    const perfisSnap = await fbDb.ref('perfis_horario').once('value');
    const perfisMap = {};
    perfisSnap.forEach(c => { perfisMap[c.key] = c.val(); });
    const atrasados = [];
    for (const f of funcionarios) {
      const reg = registrosPorFunc[f.id];
      if (!reg || !reg.registros.entrada) continue;
      const perfil = f.perfil_horario_id ? perfisMap[f.perfil_horario_id] : null;
      const horaEsperada = perfil?.hora_entrada;
      if (!horaEsperada) continue;
      const toMin = (t) => { const p = t.split(':'); return parseInt(p[0]) * 60 + parseInt(p[1]); };
      const esperadaMin = toMin(horaEsperada);
      const entradaMin = toMin(reg.registros.entrada);
      const tolerancia = (f.abono_minutos || 0);
      const atraso = entradaMin - esperadaMin - tolerancia;
      if (atraso > 0) {
        atrasados.push({
          uid: f.id,
          nome: f.nome,
          horaEsperada: horaEsperada.substring(0, 5),
          horaEntrada: reg.registros.entrada,
          atrasoMinutos: atraso
        });
      }
    }
    atrasados.sort((a, b) => b.atrasoMinutos - a.atrasoMinutos);

    // Ajustes e abonos pendentes
    const [ajPSnap, tolSnap, feriadosSnap] = await Promise.all([
      fbDb.ref('ajustes').orderByChild('status').equalTo('pendente').once('value'),
      fbDb.ref('configuracoes/tolerancia_minutos').once('value'),
      fbDb.ref('feriados').once('value')
    ]);
    let ajustesPendentes = 0;
    ajPSnap.forEach(() => ajustesPendentes++);

    // Presença diária no mês + horas por depto (paralelo por usuário)
    const regsMesAll = await Promise.all(funcionarios.map(f => this._registrosMes(f.id, mes, ano).then(r => ({ f, r }))));
    const presencaMap = {};
    const horasPorDepto = {};
    const diasPorFunc = {};
    regsMesAll.forEach(({ f, r }) => {
      const porDia = {};
      r.forEach(reg => {
        (porDia[reg.data] = porDia[reg.data] || {})[reg.tipo] = reg.data_hora;
        if (reg.tipo === 'entrada') presencaMap[reg.data] = (presencaMap[reg.data] || new Set()).add(f.id);
      });
      Object.keys(porDia).forEach(d => {
        const t = porDia[d];
        if (t.entrada && t.saida) {
          let min = Math.floor((new Date(t.saida) - new Date(t.entrada)) / 60000);
          if (t.saida_almoco && t.retorno_almoco) min -= Math.floor((new Date(t.retorno_almoco) - new Date(t.saida_almoco)) / 60000);
          if (f.departamento) {
            if (!horasPorDepto[f.departamento]) horasPorDepto[f.departamento] = { minutos: 0, funcs: new Set() };
            horasPorDepto[f.departamento].minutos += Math.max(0, min);
            horasPorDepto[f.departamento].funcs.add(f.id);
          }
          diasPorFunc[f.id] = (diasPorFunc[f.id] || 0) + 1;
        }
      });
    });

    const presencaDiaria = Object.keys(presencaMap).sort().map(d => ({
      dia: d.slice(8, 10) + '/' + d.slice(5, 7),
      diaNum: parseInt(d.slice(8, 10)),
      presentes: presencaMap[d].size
    }));

    const horasPorDepartamento = Object.keys(horasPorDepto).map(dep => ({
      departamento: dep,
      totalMinutos: horasPorDepto[dep].minutos,
      totalFuncionarios: horasPorDepto[dep].funcs.size
    }));

    const topFuncionarios = funcionarios
      .map(f => ({ id: f.id, nome: f.nome, departamento: f.departamento, dias_trabalhados: diasPorFunc[f.id] || 0 }))
      .sort((a, b) => b.dias_trabalhados - a.dias_trabalhados)
      .slice(0, 5);

    return {
      totalFuncionarios: totalFunc,
      presentesHoje: presentesSet.size,
      ausentesHoje: Math.max(0, totalFunc - presentesSet.size),
      ajustesPendentes,
      faltasMes: 0,
      inconsistenciasMes: 0,
      atrasados,
      registrosHoje: Object.values(registrosPorFunc),
      horasPorDepartamento,
      presencaDiaria,
      topFuncionarios,
      periodo: String(mes).padStart(2, '0') + '/' + ano
    };
  }

  // Ajuste direto de ponto pelo admin (cria, atualiza ou remove registros do dia)
  async ajustarPontoAdmin(uid, data, ajustes) {
    await this._requireAdmin();
    if (!uid || !data) throw new Error('Dados inválidos');

    // Buscar registros existentes do dia para este colaborador
    const snap = await fbDb.ref('registros/' + uid).orderByChild('data').equalTo(data).once('value');
    const existentes = {}; // tipo -> { key }
    snap.forEach(c => { existentes[c.val().tipo] = c.key; });

    const tipos = ['entrada', 'saida_almoco', 'retorno_almoco', 'saida'];
    const updates = {};

    tipos.forEach(tipo => {
      const hhmm = (ajustes[tipo] || '').trim();
      const key = existentes[tipo];
      if (hhmm) {
        const dataHora = data + 'T' + hhmm + ':00';
        if (key) {
          // Atualiza existente
          updates['registros/' + uid + '/' + key + '/data_hora'] = dataHora;
          updates['registros/' + uid + '/' + key + '/ip_origem'] = 'admin-ajuste';
        } else {
          // Cria novo
          const newKey = fbDb.ref('registros/' + uid).push().key;
          updates['registros/' + uid + '/' + newKey] = {
            tipo, data_hora: dataHora, data,
            ip_origem: 'admin-ajuste', created_at: dataHora
          };
        }
      } else if (key) {
        // Remove se o campo foi apagado
        updates['registros/' + uid + '/' + key] = null;
      }
    });

    if (Object.keys(updates).length > 0) {
      await fbDb.ref().update(updates);
    }
  }
  // ==================== HOLERITES ====================

  async uploadHolerite(uid, ano, mes, file) {
    await this._requireAdmin();
    const key = `${ano}-${String(mes).padStart(2, '0')}`;
    const path = `holerites/${uid}/${key}.pdf`;
    const storageRef = fbStorage.ref(path);
    await storageRef.put(file, { contentType: 'application/pdf' });
    const url = await storageRef.getDownloadURL();
    await fbDb.ref(`holerites/${uid}/${key}`).set({
      url,
      mes: Number(mes),
      ano: Number(ano),
      uploaded_at: _nowIso(),
      lido: false
    });
    return { url, key };
  }

  async listarHoleritesAdmin(filtroUid, filtroAno) {
    await this._requireAdmin();
    let snap;
    if (filtroUid) {
      snap = await fbDb.ref(`holerites/${filtroUid}`).once('value');
      const data = snap.val() || {};
      return Object.entries(data)
        .map(([key, v]) => ({ uid: filtroUid, key, ...v }))
        .filter(h => !filtroAno || h.ano === Number(filtroAno))
        .sort((a, b) => b.key.localeCompare(a.key));
    }
    snap = await fbDb.ref('holerites').once('value');
    const data = snap.val() || {};
    const result = [];
    for (const [uid, meses] of Object.entries(data)) {
      for (const [key, v] of Object.entries(meses)) {
        result.push({ uid, key, ...v });
      }
    }
    return result
      .filter(h => !filtroAno || h.ano === Number(filtroAno))
      .sort((a, b) => b.key.localeCompare(a.key));
  }

  async excluirHolerite(uid, key) {
    await this._requireAdmin();
    try {
      await fbStorage.ref(`holerites/${uid}/${key}.pdf`).delete();
    } catch (_) {}
    await fbDb.ref(`holerites/${uid}/${key}`).remove();
  }

  async meusHolerites() {
    const uid = this._currentUid;
    if (!uid) throw new Error('Sessão expirada');
    const snap = await fbDb.ref(`holerites/${uid}`).once('value');
    const data = snap.val() || {};
    return Object.entries(data)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }

  async marcarHoleriteComoLido(key) {
    const uid = this._currentUid;
    if (!uid) throw new Error('Sessão expirada');
    await fbDb.ref(`holerites/${uid}/${key}/lido`).set(true);
  }

  async contarHoleritesNaoLidos() {
    const uid = this._currentUid;
    if (!uid) return 0;
    const snap = await fbDb.ref(`holerites/${uid}`).once('value');
    const data = snap.val() || {};
    return Object.values(data).filter(h => !h.lido).length;
  }
}

const api = new Api();
