// ==================== API FIREBASE ====================
// Camada de compatibilidade: preserva as mesmas assinaturas da API antiga,
// mas agora sobre Firebase Auth + Realtime Database + Storage.
// Estratégia de economia:
//  - Reads narrow (queries por data/indexOn), cache em memória curto
//  - .once() ao invés de .on() sempre que possível
//  - Offline automático via RTDB local cache

function _now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function _today() { return new Date().toISOString().slice(0, 10); }
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
        cargo: userData.cargo || null
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
      cargo: data.cargo || null
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
    const { page = 1, limit = 20, busca, departamento, ativo = '1' } = params;
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
    const { nome, usuario, email, senha, cargo, departamento, jornada_semanal, perfil_horario_id, role } = dados;
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
    const fields = ['nome', 'email', 'cargo', 'departamento', 'jornada_semanal', 'perfil_horario_id', 'role'];
    fields.forEach(f => {
      if (dados[f] !== undefined) updates[f] = dados[f] || null;
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

    // Remove dados relacionados
    const updates = {};
    updates['users/' + id] = null;
    updates['usuario_to_uid/' + this._encodeKey(u.usuario)] = null;
    updates['registros/' + id] = null;
    updates['configuracoes_horario/' + id] = null;
    await fbDb.ref().update(updates);

    // Limpa ajustes e abonos do funcionário (queries separadas por indexOn)
    const [ajSnap, abSnap] = await Promise.all([
      fbDb.ref('ajustes').orderByChild('funcionario_uid').equalTo(id).once('value'),
      fbDb.ref('abonos').orderByChild('funcionario_uid').equalTo(id).once('value')
    ]);
    const deleteUpdates = {};
    ajSnap.forEach(c => { deleteUpdates['ajustes/' + c.key] = null; });
    abSnap.forEach(c => { deleteUpdates['abonos/' + c.key] = null; });
    if (Object.keys(deleteUpdates).length) await fbDb.ref().update(deleteUpdates);

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

    let proximoTipo;
    if (registros.length === 0) proximoTipo = 'entrada';
    else {
      const ultimo = registros[registros.length - 1].tipo;
      const idx = ORDEM.indexOf(ultimo);
      if (idx === ORDEM.length - 1) throw new Error('Todos os registros do dia já foram feitos');
      proximoTipo = ORDEM[idx + 1];
    }
    if (registros.some(r => r.tipo === proximoTipo)) throw new Error('Registro de ' + proximoTipo + ' já existe para hoje');

    // Trava de 1h para retorno_almoco
    if (proximoTipo === 'retorno_almoco') {
      const saida = registros.find(r => r.tipo === 'saida_almoco');
      if (saida) {
        const diff = Math.floor((Date.now() - new Date(saida.data_hora).getTime()) / 60000);
        if (diff < 60) throw new Error('O almoço deve ter no mínimo 60 minutos. Aguarde mais ' + (60 - diff) + ' minuto(s).');
      }
    }

    const now = new Date();
    const ref = fbDb.ref('registros/' + uid).push();
    await ref.set({
      tipo: proximoTipo,
      data_hora: now.toISOString(),
      data: hoje,
      ip_origem: 'web',
      created_at: now.toISOString()
    });
    return { message: proximoTipo.replace('_', ' ') + ' registrada com sucesso', tipo: proximoTipo, data_hora: now.toISOString() };
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
    let proximoTipo = 'entrada';
    if (registros.length > 0) {
      const idx = ORDEM.indexOf(registros[registros.length - 1].tipo);
      proximoTipo = idx < ORDEM.length - 1 ? ORDEM[idx + 1] : null;
    }
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
    return { totalMinutos: Math.max(0, minutos), totalHoras: (Math.max(0, minutos) / 60).toFixed(2) };
  }

  async bancoHoras(mes, ano, funcionarioId) {
    const uid = funcionarioId || this._currentUid;
    const regs = await this._registrosMes(uid, mes, ano);
    const porDia = {};
    regs.forEach(r => {
      if (!porDia[r.data]) porDia[r.data] = {};
      porDia[r.data][r.tipo] = r.data_hora;
    });
    let totalMin = 0;
    const dias = [];
    Object.keys(porDia).sort().forEach(d => {
      const t = porDia[d];
      let min = 0;
      if (t.entrada && t.saida) {
        min = Math.floor((new Date(t.saida) - new Date(t.entrada)) / 60000);
        if (t.saida_almoco && t.retorno_almoco) {
          min -= Math.floor((new Date(t.retorno_almoco) - new Date(t.saida_almoco)) / 60000);
        }
      }
      totalMin += Math.max(0, min);
      dias.push({ data: d, minutos: Math.max(0, min) });
    });

    // Esperado = (jornada_semanal/5) * dias uteis (seg-sex) do mes
    const userData = await this._loadUser(uid);
    const jornadaSemanal = (userData && userData.jornada_semanal) || 44;
    const diasNoMes = new Date(ano, mes, 0).getDate();
    let diasUteis = 0;
    for (let d = 1; d <= diasNoMes; d++) {
      const dow = new Date(ano, mes - 1, d).getDay();
      if (dow >= 1 && dow <= 5) diasUteis++;
    }
    const esperadoMin = Math.round((jornadaSemanal / 5) * diasUteis * 60);
    const saldoMin = totalMin - esperadoMin;
    const saldoAbs = Math.abs(saldoMin);
    const hh = Math.floor(saldoAbs / 60);
    const mm = saldoAbs % 60;
    const saldoFormatado = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

    return {
      totalMinutos: totalMin,
      totalHoras: (totalMin / 60).toFixed(2),
      esperadoMinutos: esperadoMin,
      saldoMinutos: saldoMin,
      saldoPositivo: saldoMin >= 0,
      saldoFormatado,
      dias
    };
  }

  // ==================== AJUSTES ====================
  async solicitarAjuste(dados) {
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
    await fbDb.ref('ajustes/' + id).update({ status: 'aprovado', admin_uid: this._currentUid, aprovado_em: _now() });
    return { message: 'Ajuste aprovado' };
  }

  async rejeitarAjuste(id, motivo) {
    await this._requireAdmin();
    await fbDb.ref('ajustes/' + id).update({ status: 'rejeitado', admin_uid: this._currentUid, motivo_rejeicao: motivo || '', rejeitado_em: _now() });
    return { message: 'Ajuste rejeitado' };
  }

  // ==================== ABONOS ====================
  async solicitarAbono(dados) {
    const ref = fbDb.ref('abonos').push();
    await ref.set({
      funcionario_uid: this._currentUid,
      funcionario_nome: this._currentUserData?.nome || null,
      tipo: dados.tipo,
      data_inicio: dados.data_inicio,
      data_fim: dados.data_fim,
      horas: dados.horas || null,
      motivo: dados.motivo,
      arquivo_path: dados.arquivo_path || null,
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

    // Feriados do mes
    const feriadosSnap = await fbDb.ref('feriados').once('value');
    const feriadosMap = {};
    feriadosSnap.forEach(c => { const v = c.val(); if (v && v.data) feriadosMap[v.data] = v.descricao || v.nome || 'Feriado'; });

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

      let status;
      const feriadoNome = feriadosMap[dataStr];
      if (feriadoNome) status = 'feriado';
      else if (dow === 0 || dow === 6) status = 'fim_de_semana';
      else if (min === 0) status = 'falta';
      else if (min < jornadaDiariaMin) status = 'incompleto';
      else status = 'ok';

      totalTrabMin += min;
      if (status !== 'feriado' && status !== 'fim_de_semana') {
        diasUteis++;
        const diff = min - jornadaDiariaMin;
        if (diff > 0) totalExtrasMin += diff;
        if (status === 'falta') totalFaltasMin += jornadaDiariaMin;
      }

      dias.push({
        data: dataStr,
        diaSemana: diasSemana[dow],
        entrada: t.entrada ? t.entrada.slice(11,16) : null,
        saida_almoco: t.saida_almoco ? t.saida_almoco.slice(11,16) : null,
        retorno_almoco: t.retorno_almoco ? t.retorno_almoco.slice(11,16) : null,
        saida: t.saida ? t.saida.slice(11,16) : null,
        totalMinutos: min,
        trabalhado: fmt(min),
        status,
        feriado: feriadoNome || null
      });
    }

    const jornadaMensalMin = jornadaDiariaMin * diasUteis;
    const nomesMes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const periodo = `${nomesMes[mes - 1]}/${ano}`;

    return {
      funcionario: user,
      mes, ano, periodo,
      dias,
      totalMinutos: totalTrabMin,
      resumo: {
        totalTrabalhado: fmt(totalTrabMin),
        totalExtras: fmt(totalExtrasMin),
        totalFaltas: fmt(totalFaltasMin),
        jornadaMensal: fmt(jornadaMensalMin)
      }
    };
  }

  async relatorioGeral(mes, ano) {
    await this._requireAdmin();
    const usersSnap = await fbDb.ref('users').once('value');
    const usuarios = [];
    usersSnap.forEach(c => { const v = c.val(); v.id = c.key; if (v.role === 'funcionario' && v.ativo !== false) usuarios.push(v); });
    const result = [];
    for (const u of usuarios) {
      const banco = await this.bancoHoras(mes, ano, u.id);
      result.push({ id: u.id, nome: u.nome, departamento: u.departamento, totalMinutos: banco.totalMinutos, totalHoras: banco.totalHoras });
    }
    return result;
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
        registrosPorFunc[f.id] = { nome: f.nome, cargo: f.cargo, departamento: f.departamento, registros: {} };
        r.forEach(reg => { registrosPorFunc[f.id].registros[reg.tipo] = reg.data_hora.slice(11, 16); });
      }
    });

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
      atrasados: [],
      registrosHoje: Object.values(registrosPorFunc),
      horasPorDepartamento,
      presencaDiaria,
      topFuncionarios,
      periodo: String(mes).padStart(2, '0') + '/' + ano
    };
  }
}

const api = new Api();
