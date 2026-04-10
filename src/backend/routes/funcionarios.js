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

    let where = 'WHERE ativo = ?';
    const params = [parseInt(ativo)];

    if (busca) {
      where += ' AND (nome LIKE ? OR email LIKE ? OR cargo LIKE ?)';
      const termo = `%${busca}%`;
      params.push(termo, termo, termo);
    }
    if (departamento) {
      where += ' AND departamento = ?';
      params.push(departamento);
    }

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM rp_funcionarios ${where}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT id, nome, email, cargo, departamento, jornada_semanal, role, ativo, created_at
       FROM rp_funcionarios ${where} ORDER BY nome LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`,
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
      'SELECT id, nome, email, cargo, departamento, jornada_semanal, role, ativo, created_at FROM rp_funcionarios WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Funcionário não encontrado' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Cadastrar funcionário
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { nome, email, senha, cargo, departamento, jornada_semanal, role } = req.body;
    if (!nome || !email || !senha) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    const [existing] = await pool.execute('SELECT id FROM rp_funcionarios WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const [result] = await pool.execute(
      `INSERT INTO rp_funcionarios (nome, email, senha_hash, cargo, departamento, jornada_semanal, role)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nome, email, senhaHash, cargo || null, departamento || null, jornada_semanal || 44, role || 'funcionario']
    );

    res.status(201).json({ id: result.insertId, message: 'Funcionário cadastrado com sucesso' });
  } catch (err) {
    console.error('Erro ao cadastrar funcionário:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Editar funcionário
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { nome, email, cargo, departamento, jornada_semanal, role } = req.body;
    const fields = [];
    const values = [];

    if (nome) { fields.push('nome = ?'); values.push(nome); }
    if (email) { fields.push('email = ?'); values.push(email); }
    if (cargo !== undefined) { fields.push('cargo = ?'); values.push(cargo); }
    if (departamento !== undefined) { fields.push('departamento = ?'); values.push(departamento); }
    if (jornada_semanal) { fields.push('jornada_semanal = ?'); values.push(jornada_semanal); }
    if (role) { fields.push('role = ?'); values.push(role); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    values.push(req.params.id);
    await pool.execute(`UPDATE rp_funcionarios SET ${fields.join(', ')} WHERE id = ?`, values);

    res.json({ message: 'Funcionário atualizado com sucesso' });
  } catch (err) {
    console.error('Erro ao editar funcionário:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Desativar funcionário (soft delete)
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.execute('UPDATE rp_funcionarios SET ativo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Funcionário desativado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Reativar funcionário
router.patch('/:id/reativar', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.execute('UPDATE rp_funcionarios SET ativo = 1 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Funcionário reativado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
