const express = require('express');
const { pool } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Solicitar abono (colaborador)
router.post('/solicitar', authMiddleware, async (req, res) => {
  try {
    const { tipo, data_inicio, data_fim, horas, motivo } = req.body;

    if (!tipo || !data_inicio || !data_fim || !motivo) {
      return res.status(400).json({ error: 'Tipo, data início, data fim e motivo são obrigatórios' });
    }

    const [result] = await pool.execute(
      `INSERT INTO rp_abonos (funcionario_id, tipo, data_inicio, data_fim, horas, motivo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, tipo, data_inicio, data_fim, horas || null, motivo]
    );

    res.status(201).json({ id: result.insertId, message: 'Solicitação de abono enviada com sucesso' });
  } catch (err) {
    console.error('Erro ao solicitar abono:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Meus abonos (colaborador)
router.get('/meus', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.*, adm.nome AS admin_nome
       FROM rp_abonos a
       LEFT JOIN rp_funcionarios adm ON a.admin_id = adm.id
       WHERE a.funcionario_id = ?
       ORDER BY a.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Abonos pendentes (admin)
router.get('/pendentes', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.*, f.nome AS funcionario_nome, f.departamento
       FROM rp_abonos a
       JOIN rp_funcionarios f ON a.funcionario_id = f.id
       WHERE a.status = 'pendente'
       ORDER BY a.created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Todos os abonos (admin) com filtros
router.get('/todos', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status, tipo, mes, ano } = req.query;
    let where = '1=1';
    const params = [];

    if (status) { where += ' AND a.status = ?'; params.push(status); }
    if (tipo) { where += ' AND a.tipo = ?'; params.push(tipo); }
    if (mes && ano) {
      where += ' AND (MONTH(a.data_inicio) = ? OR MONTH(a.data_fim) = ?) AND (YEAR(a.data_inicio) = ? OR YEAR(a.data_fim) = ?)';
      params.push(mes, mes, ano, ano);
    }

    const [rows] = await pool.execute(
      `SELECT a.*, f.nome AS funcionario_nome, f.departamento, adm.nome AS admin_nome
       FROM rp_abonos a
       JOIN rp_funcionarios f ON a.funcionario_id = f.id
       LEFT JOIN rp_funcionarios adm ON a.admin_id = adm.id
       WHERE ${where}
       ORDER BY a.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Aprovar abono (admin)
router.post('/:id/aprovar', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.execute(
      'UPDATE rp_abonos SET status = ?, admin_id = ? WHERE id = ?',
      ['aprovado', req.user.id, req.params.id]
    );
    res.json({ message: 'Abono aprovado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rejeitar abono (admin)
router.post('/:id/rejeitar', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { motivo } = req.body;
    await pool.execute(
      'UPDATE rp_abonos SET status = ?, admin_id = ?, motivo_rejeicao = ? WHERE id = ?',
      ['rejeitado', req.user.id, motivo || null, req.params.id]
    );
    res.json({ message: 'Abono rejeitado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
