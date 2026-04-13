const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Listar funcionários (com paginação e filtros)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, busca, departamento, ativo = '1' } = req.query;
    const offset = (page - 1) * limit;

    let where = 'WHERE f.ativo = ?';
    const params = [parseInt(ativo)];

    if (busca) {
      where += ' AND (f.nome LIKE ? OR f.usuario LIKE ? OR f.email LIKE ? OR f.cargo LIKE ?)';
      const termo = `%${busca}%`;
      params.push(termo, termo, termo, termo);
    }
    if (departamento) {
      where += ' AND f.departamento = ?';
      params.push(departamento);
    }

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM rp_funcionarios f ${where}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT f.id, f.nome, f.usuario, f.email, f.cargo, f.departamento, f.jornada_semanal, f.perfil_horario_id, f.role, f.ativo, f.created_at,
              p.nome AS perfil_nome, p.hora_entrada AS perfil_entrada, p.hora_saida AS perfil_saida
       FROM rp_funcionarios f
       LEFT JOIN rp_perfis_horario p ON f.perfil_horario_id = p.id
       ${where}
       ORDER BY f.nome LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`,
      params
    );

    res.json({
      funcionarios: rows,
      total: countRows[0].total,
      page: parseInt(page),
      totalPages: Math.ceil(countRows[0].total / limit)
    });
  } catch (err) {
    console.error('Erro ao listar funcionários:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar funcionário por ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT f.id, f.nome, f.usuario, f.email, f.cargo, f.departamento, f.jornada_semanal, f.perfil_horario_id, f.role, f.ativo, f.created_at,
              p.nome AS perfil_nome
       FROM rp_funcionarios f
       LEFT JOIN rp_perfis_horario p ON f.perfil_horario_id = p.id
       WHERE f.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Colaborador não encontrado' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Cadastrar funcionário
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { nome, usuario, email, senha, cargo, departamento, jornada_semanal, perfil_horario_id, role } = req.body;
    if (!nome || !usuario || !senha) {
      return res.status(400).json({ error: 'Nome, usuário e senha são obrigatórios' });
    }

    const usuarioLower = usuario.toLowerCase().trim();

    const [existing] = await pool.execute('SELECT id FROM rp_funcionarios WHERE usuario = ?', [usuarioLower]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Usuário já cadastrado' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const [result] = await pool.execute(
      `INSERT INTO rp_funcionarios (nome, usuario, email, senha_hash, senha_temporaria, cargo, departamento, jornada_semanal, perfil_horario_id, role)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      [nome, usuarioLower, email || null, senhaHash, cargo || null, departamento || null, jornada_semanal || 44, perfil_horario_id || null, role || 'funcionario']
    );

    res.status(201).json({
      id: result.insertId,
      usuario: usuarioLower,
      message: `Colaborador cadastrado com sucesso. Usuário: ${usuarioLower}`
    });
  } catch (err) {
    console.error('Erro ao cadastrar funcionário:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Editar funcionário
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { nome, usuario, email, cargo, departamento, jornada_semanal, perfil_horario_id, role } = req.body;
    const fields = [];
    const values = [];

    if (nome) { fields.push('nome = ?'); values.push(nome); }
    if (usuario) {
      const usuarioLower = usuario.toLowerCase().trim();
      // Verificar se o usuario já existe em outro registro
      const [existing] = await pool.execute('SELECT id FROM rp_funcionarios WHERE usuario = ? AND id != ?', [usuarioLower, req.params.id]);
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Usuário já existe' });
      }
      fields.push('usuario = ?'); values.push(usuarioLower);
    }
    if (email !== undefined) { fields.push('email = ?'); values.push(email || null); }
    if (cargo !== undefined) { fields.push('cargo = ?'); values.push(cargo); }
    if (departamento !== undefined) { fields.push('departamento = ?'); values.push(departamento); }
    if (jornada_semanal) { fields.push('jornada_semanal = ?'); values.push(jornada_semanal); }
    if (perfil_horario_id !== undefined) { fields.push('perfil_horario_id = ?'); values.push(perfil_horario_id || null); }
    if (role) { fields.push('role = ?'); values.push(role); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    values.push(req.params.id);
    await pool.execute(`UPDATE rp_funcionarios SET ${fields.join(', ')} WHERE id = ?`, values);

    res.json({ message: 'Colaborador atualizado com sucesso' });
  } catch (err) {
    console.error('Erro ao editar funcionário:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Resetar senha (admin reseta a senha de um funcionário)
router.post('/:id/resetar-senha', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { novaSenha } = req.body;

    // Se não forneceu senha, gera uma aleatória
    const senha = novaSenha || Math.random().toString(36).slice(-8);
    const hash = await bcrypt.hash(senha, 10);

    await pool.execute(
      'UPDATE rp_funcionarios SET senha_hash = ?, senha_temporaria = 1 WHERE id = ?',
      [hash, req.params.id]
    );

    const [rows] = await pool.execute('SELECT nome, usuario FROM rp_funcionarios WHERE id = ?', [req.params.id]);

    res.json({
      message: `Senha resetada com sucesso para ${rows[0]?.nome}`,
      usuario: rows[0]?.usuario,
      novaSenha: senha
    });
  } catch (err) {
    console.error('Erro ao resetar senha:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Desativar funcionário (soft delete)
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.execute('UPDATE rp_funcionarios SET ativo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Colaborador desativado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Reativar funcionário
router.patch('/:id/reativar', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.execute('UPDATE rp_funcionarios SET ativo = 1 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Colaborador reativado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Excluir funcionário definitivamente (hard delete - limpa todos os dados relacionados)
router.delete('/:id/excluir-definitivo', authMiddleware, adminMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const funcionarioId = req.params.id;

    // Proteger: não permitir excluir a si mesmo
    if (parseInt(funcionarioId) === req.user.id) {
      conn.release();
      return res.status(400).json({ error: 'Você não pode excluir seu próprio usuário' });
    }

    // Verificar se existe
    const [exists] = await conn.execute('SELECT id, nome, usuario FROM rp_funcionarios WHERE id = ?', [funcionarioId]);
    if (exists.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Colaborador não encontrado' });
    }

    await conn.beginTransaction();

    // Limpar todas as tabelas relacionadas (ignora erros de tabelas que não existem)
    const tabelas = [
      'rp_registros_ponto',
      'rp_ajustes_ponto',
      'rp_abonos',
      'rp_atestados',
      'rp_faltas',
      'rp_configuracoes_horario'
    ];

    for (const tabela of tabelas) {
      try {
        await conn.execute(`DELETE FROM ${tabela} WHERE funcionario_id = ?`, [funcionarioId]);
      } catch (e) {
        // Tabela pode não existir em versões antigas - ignora
        console.warn(`Aviso ao limpar ${tabela}:`, e.message);
      }
    }

    // Finalmente, remover o funcionário
    await conn.execute('DELETE FROM rp_funcionarios WHERE id = ?', [funcionarioId]);

    await conn.commit();
    conn.release();

    res.json({
      message: `Colaborador ${exists[0].nome} excluído definitivamente com sucesso`,
      usuario: exists[0].usuario
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Erro ao excluir colaborador definitivamente:', err);
    res.status(500).json({ error: 'Erro ao excluir colaborador: ' + err.message });
  }
});

module.exports = router;
