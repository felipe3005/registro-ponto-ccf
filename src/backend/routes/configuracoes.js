const express = require('express');
const { pool } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// ==================== PERFIS DE HORÁRIO ====================

// Listar perfis
router.get('/perfis-horario', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM rp_perfis_horario ORDER BY nome');
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar perfis:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar perfil por ID
router.get('/perfis-horario/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM rp_perfis_horario WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Perfil não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Criar perfil
router.post('/perfis-horario', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { nome, hora_entrada, hora_saida_almoco, hora_retorno_almoco, hora_saida, dias_trabalho } = req.body;
    if (!nome || !hora_entrada || !hora_saida) {
      return res.status(400).json({ error: 'Nome, hora de entrada e hora de saída são obrigatórios' });
    }

    const [result] = await pool.execute(
      `INSERT INTO rp_perfis_horario (nome, hora_entrada, hora_saida_almoco, hora_retorno_almoco, hora_saida, dias_trabalho)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nome, hora_entrada, hora_saida_almoco || null, hora_retorno_almoco || null, hora_saida, dias_trabalho || '1,2,3,4,5']
    );

    res.status(201).json({ id: result.insertId, message: 'Perfil criado com sucesso' });
  } catch (err) {
    console.error('Erro ao criar perfil:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Editar perfil
router.put('/perfis-horario/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { nome, hora_entrada, hora_saida_almoco, hora_retorno_almoco, hora_saida, dias_trabalho } = req.body;

    await pool.execute(
      `UPDATE rp_perfis_horario SET nome = ?, hora_entrada = ?, hora_saida_almoco = ?, hora_retorno_almoco = ?, hora_saida = ?, dias_trabalho = ? WHERE id = ?`,
      [nome, hora_entrada, hora_saida_almoco || null, hora_retorno_almoco || null, hora_saida, dias_trabalho || '1,2,3,4,5', req.params.id]
    );

    res.json({ message: 'Perfil atualizado com sucesso' });
  } catch (err) {
    console.error('Erro ao editar perfil:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Excluir perfil
router.delete('/perfis-horario/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // Desvincular colaboradores que usam este perfil
    await pool.execute('UPDATE rp_funcionarios SET perfil_horario_id = NULL WHERE perfil_horario_id = ?', [req.params.id]);
    await pool.execute('DELETE FROM rp_perfis_horario WHERE id = ?', [req.params.id]);
    res.json({ message: 'Perfil removido com sucesso' });
  } catch (err) {
    console.error('Erro ao remover perfil:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==================== HORÁRIOS POR FUNCIONÁRIO (legado) ====================

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
