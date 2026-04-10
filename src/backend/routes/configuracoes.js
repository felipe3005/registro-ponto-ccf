const express = require('express');
const { pool } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Definir horário de trabalho de um funcionário
router.post('/horario', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { funcionario_id, horarios } = req.body;
    // horarios = [{ dia_semana: 1, hora_entrada: '08:00', hora_saida_almoco: '12:00', hora_retorno_almoco: '13:00', hora_saida: '17:00' }, ...]

    for (const h of horarios) {
      await pool.execute(
        `INSERT INTO rp_configuracoes_horario (funcionario_id, dia_semana, hora_entrada, hora_saida_almoco, hora_retorno_almoco, hora_saida)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE hora_entrada = ?, hora_saida_almoco = ?, hora_retorno_almoco = ?, hora_saida = ?`,
        [funcionario_id, h.dia_semana, h.hora_entrada, h.hora_saida_almoco, h.hora_retorno_almoco, h.hora_saida,
         h.hora_entrada, h.hora_saida_almoco, h.hora_retorno_almoco, h.hora_saida]
      );
    }

    res.json({ message: 'Horários configurados com sucesso' });
  } catch (err) {
    console.error('Erro ao configurar horário:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar horário de um funcionário
router.get('/horario/:funcionario_id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM rp_configuracoes_horario WHERE funcionario_id = ? ORDER BY dia_semana',
      [req.params.funcionario_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Cadastrar feriado
router.post('/feriados', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { data, descricao } = req.body;
    await pool.execute(
      'INSERT INTO rp_feriados (data, descricao) VALUES (?, ?) ON DUPLICATE KEY UPDATE descricao = ?',
      [data, descricao, descricao]
    );
    res.status(201).json({ message: 'Feriado cadastrado' });
  } catch (err) {
    console.error('Erro ao cadastrar feriado:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Listar feriados
router.get('/feriados', authMiddleware, async (req, res) => {
  try {
    const ano = req.query.ano || new Date().getFullYear();
    const [rows] = await pool.execute(
      'SELECT * FROM rp_feriados WHERE YEAR(data) = ? ORDER BY data',
      [ano]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Remover feriado
router.delete('/feriados/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.execute('DELETE FROM rp_feriados WHERE id = ?', [req.params.id]);
    res.json({ message: 'Feriado removido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Definir tolerância
router.post('/tolerancia', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { minutos } = req.body;
    await pool.execute(
      "UPDATE rp_configuracoes SET valor = ? WHERE chave = 'tolerancia_minutos'",
      [String(minutos)]
    );
    res.json({ message: `Tolerância definida para ${minutos} minutos` });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar tolerância
router.get('/tolerancia', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT valor FROM rp_configuracoes WHERE chave = 'tolerancia_minutos'"
    );
    res.json({ tolerancia: parseInt(rows[0]?.valor || '10') });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
