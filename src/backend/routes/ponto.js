const express = require('express');
const moment = require('moment');
const { pool } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const ORDEM_TIPOS = ['entrada', 'saida_almoco', 'retorno_almoco', 'saida'];

// Registrar ponto
router.post('/registrar', authMiddleware, async (req, res) => {
  try {
    const funcionarioId = req.user.id;
    const agora = moment();
    const hoje = agora.format('YYYY-MM-DD');

    // Buscar último registro do dia
    const [registros] = await pool.execute(
      `SELECT tipo FROM rp_registros_ponto
       WHERE funcionario_id = ? AND DATE(data_hora) = ?
       ORDER BY data_hora ASC`,
      [funcionarioId, hoje]
    );

    // Determinar próximo tipo
    let proximoTipo;
    if (registros.length === 0) {
      proximoTipo = 'entrada';
    } else {
      const ultimoTipo = registros[registros.length - 1].tipo;
      const idx = ORDEM_TIPOS.indexOf(ultimoTipo);
      if (idx === ORDEM_TIPOS.length - 1) {
        return res.status(400).json({ error: 'Todos os registros do dia já foram feitos' });
      }
      proximoTipo = ORDEM_TIPOS[idx + 1];
    }

    // Verificar duplicado
    const jaRegistrado = registros.some(r => r.tipo === proximoTipo);
    if (jaRegistrado) {
      return res.status(400).json({ error: `Registro de ${proximoTipo} já existe para hoje` });
    }

    const ip = req.ip || req.connection.remoteAddress;
    await pool.execute(
      'INSERT INTO rp_registros_ponto (funcionario_id, tipo, data_hora, ip_origem) VALUES (?, ?, ?, ?)',
      [funcionarioId, proximoTipo, agora.format('YYYY-MM-DD HH:mm:ss'), ip]
    );

    res.status(201).json({
      message: `${proximoTipo.replace('_', ' ')} registrada com sucesso`,
      tipo: proximoTipo,
      data_hora: agora.format('YYYY-MM-DD HH:mm:ss')
    });
  } catch (err) {
    console.error('Erro ao registrar ponto:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar último registro do dia
router.get('/ultimo', authMiddleware, async (req, res) => {
  try {
    const hoje = moment().format('YYYY-MM-DD');
    const [rows] = await pool.execute(
      `SELECT * FROM rp_registros_ponto
       WHERE funcionario_id = ? AND DATE(data_hora) = ?
       ORDER BY data_hora DESC LIMIT 1`,
      [req.user.id, hoje]
    );

    let proximoTipo = 'entrada';
    if (rows.length > 0) {
      const idx = ORDEM_TIPOS.indexOf(rows[0].tipo);
      proximoTipo = idx < ORDEM_TIPOS.length - 1 ? ORDEM_TIPOS[idx + 1] : null;
    }

    res.json({
      ultimoRegistro: rows[0] || null,
      proximoTipo
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Obter registros do dia
router.get('/dia', authMiddleware, async (req, res) => {
  try {
    const data = req.query.data || moment().format('YYYY-MM-DD');
    const funcId = req.query.funcionario_id || req.user.id;

    const [rows] = await pool.execute(
      `SELECT * FROM rp_registros_ponto
       WHERE funcionario_id = ? AND DATE(data_hora) = ?
       ORDER BY data_hora ASC`,
      [funcId, data]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Obter registros do mês (para espelho de ponto)
router.get('/mes', authMiddleware, async (req, res) => {
  try {
    const { mes, ano, funcionario_id } = req.query;
    const funcId = funcionario_id || req.user.id;
    const mesNum = parseInt(mes) || moment().month() + 1;
    const anoNum = parseInt(ano) || moment().year();

    const [rows] = await pool.execute(
      `SELECT * FROM rp_registros_ponto
       WHERE funcionario_id = ? AND MONTH(data_hora) = ? AND YEAR(data_hora) = ?
       ORDER BY data_hora ASC`,
      [funcId, mesNum, anoNum]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
