const express = require('express');
const multer = require('multer');
const path = require('path');
const moment = require('moment');
const { pool } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Configurar upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../../uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Solicitar ajuste de ponto
router.post('/solicitar', authMiddleware, async (req, res) => {
  try {
    const { data, tipo, nova_hora, motivo } = req.body;
    if (!data || !tipo || !nova_hora || !motivo) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }

    await pool.execute(
      `INSERT INTO rp_ajustes_ponto (funcionario_id, data, tipo, nova_hora, motivo)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, data, tipo, nova_hora, motivo]
    );

    res.status(201).json({ message: 'Solicitação de ajuste enviada' });
  } catch (err) {
    console.error('Erro ao solicitar ajuste:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Listar ajustes pendentes (admin)
router.get('/pendentes', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.*, f.nome as funcionario_nome
       FROM rp_ajustes_ponto a
       JOIN rp_funcionarios f ON a.funcionario_id = f.id
       WHERE a.status = 'pendente'
       ORDER BY a.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Listar meus ajustes
router.get('/meus', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM rp_ajustes_ponto WHERE funcionario_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Aprovar ajuste
router.post('/:id/aprovar', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [ajuste] = await pool.execute('SELECT * FROM rp_ajustes_ponto WHERE id = ? AND status = ?', [req.params.id, 'pendente']);
    if (ajuste.length === 0) {
      return res.status(404).json({ error: 'Ajuste não encontrado ou já processado' });
    }

    const aj = ajuste[0];

    // Verificar se já existe registro desse tipo no dia
    const [existing] = await pool.execute(
      `SELECT id FROM rp_registros_ponto
       WHERE funcionario_id = ? AND DATE(data_hora) = ? AND tipo = ?`,
      [aj.funcionario_id, aj.data, aj.tipo]
    );

    const dataHora = `${moment(aj.data).format('YYYY-MM-DD')} ${aj.nova_hora}`;

    if (existing.length > 0) {
      await pool.execute(
        'UPDATE rp_registros_ponto SET data_hora = ? WHERE id = ?',
        [dataHora, existing[0].id]
      );
    } else {
      await pool.execute(
        'INSERT INTO rp_registros_ponto (funcionario_id, tipo, data_hora, ip_origem) VALUES (?, ?, ?, ?)',
        [aj.funcionario_id, aj.tipo, dataHora, 'ajuste-admin']
      );
    }

    await pool.execute(
      'UPDATE rp_ajustes_ponto SET status = ?, admin_id = ? WHERE id = ?',
      ['aprovado', req.user.id, req.params.id]
    );

    res.json({ message: 'Ajuste aprovado e registro atualizado' });
  } catch (err) {
    console.error('Erro ao aprovar ajuste:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rejeitar ajuste
router.post('/:id/rejeitar', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { motivo } = req.body;
    await pool.execute(
      'UPDATE rp_ajustes_ponto SET status = ?, admin_id = ?, motivo_rejeicao = ? WHERE id = ? AND status = ?',
      ['rejeitado', req.user.id, motivo || '', req.params.id, 'pendente']
    );
    res.json({ message: 'Ajuste rejeitado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Registrar atestado
router.post('/atestado', authMiddleware, upload.single('arquivo'), async (req, res) => {
  try {
    const { funcionario_id, data_inicio, data_fim } = req.body;
    const funcId = funcionario_id || req.user.id;
    const arquivoPath = req.file ? req.file.filename : null;

    await pool.execute(
      'INSERT INTO rp_atestados (funcionario_id, data_inicio, data_fim, arquivo_path) VALUES (?, ?, ?, ?)',
      [funcId, data_inicio, data_fim, arquivoPath]
    );

    res.status(201).json({ message: 'Atestado registrado com sucesso' });
  } catch (err) {
    console.error('Erro ao registrar atestado:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Listar atestados
router.get('/atestados', authMiddleware, async (req, res) => {
  try {
    const funcId = req.query.funcionario_id || req.user.id;
    const [rows] = await pool.execute(
      'SELECT * FROM rp_atestados WHERE funcionario_id = ? ORDER BY data_inicio DESC',
      [funcId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Registrar falta
router.post('/falta', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { funcionario_id, data, justificativa } = req.body;
    await pool.execute(
      'INSERT INTO rp_faltas (funcionario_id, data, justificativa) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE justificativa = ?',
      [funcionario_id, data, justificativa || null, justificativa || null]
    );
    res.status(201).json({ message: 'Falta registrada' });
  } catch (err) {
    console.error('Erro ao registrar falta:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Listar faltas
router.get('/faltas', authMiddleware, async (req, res) => {
  try {
    const funcId = req.query.funcionario_id || req.user.id;
    const [rows] = await pool.execute(
      'SELECT * FROM rp_faltas WHERE funcionario_id = ? ORDER BY data DESC',
      [funcId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
