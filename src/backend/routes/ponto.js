const express = require('express');
const moment = require('moment');
const { pool } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const ORDEM_TIPOS = ['entrada', 'saida_almoco', 'retorno_almoco', 'saida'];
const ALMOCO_MINIMO_MINUTOS = 60;

// Registrar ponto
router.post('/registrar', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Administradores não registram ponto' });
    }
    const funcionarioId = req.user.id;
    const agora = moment();
    const hoje = agora.format('YYYY-MM-DD');

    // Buscar último registro do dia
    const [registros] = await pool.execute(
      `SELECT tipo, data_hora FROM rp_registros_ponto
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

    // Trava: retorno do almoço só após ALMOCO_MINIMO_MINUTOS
    if (proximoTipo === 'retorno_almoco') {
      const saidaAlmoco = registros.find(r => r.tipo === 'saida_almoco');
      if (saidaAlmoco) {
        const minutosDecorridos = agora.diff(moment(saidaAlmoco.data_hora), 'minutes');
        if (minutosDecorridos < ALMOCO_MINIMO_MINUTOS) {
          const faltam = ALMOCO_MINIMO_MINUTOS - minutosDecorridos;
          return res.status(400).json({
            error: `O almoço deve ter no mínimo ${ALMOCO_MINIMO_MINUTOS} minutos. Aguarde mais ${faltam} minuto(s) para registrar o retorno.`
          });
        }
      }
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

    // Info do almoço para trava de 1h
    const [almocoRows] = await pool.execute(
      `SELECT data_hora FROM rp_registros_ponto
       WHERE funcionario_id = ? AND DATE(data_hora) = ? AND tipo = 'saida_almoco'
       LIMIT 1`,
      [req.user.id, hoje]
    );

    res.json({
      ultimoRegistro: rows[0] || null,
      proximoTipo,
      saidaAlmoco: almocoRows[0] ? almocoRows[0].data_hora : null,
      almocoMinimoMinutos: ALMOCO_MINIMO_MINUTOS
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

// Sincronizar registros offline
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Administradores não registram ponto' });
    }

    const { registros } = req.body;
    if (!registros || !Array.isArray(registros) || registros.length === 0) {
      return res.status(400).json({ error: 'Nenhum registro para sincronizar' });
    }

    const resultados = [];
    const funcionarioId = req.user.id;

    for (const reg of registros) {
      try {
        const dataHora = moment(reg.data_hora);
        const dia = dataHora.format('YYYY-MM-DD');

        // Verificar se já existe esse tipo nesse dia
        const [existente] = await pool.execute(
          `SELECT id FROM rp_registros_ponto
           WHERE funcionario_id = ? AND DATE(data_hora) = ? AND tipo = ?`,
          [funcionarioId, dia, reg.tipo]
        );

        if (existente.length > 0) {
          resultados.push({ id: reg.offline_id, status: 'duplicado', tipo: reg.tipo, data: dia });
          continue;
        }

        // Trava: retorno do almoço só após ALMOCO_MINIMO_MINUTOS
        if (reg.tipo === 'retorno_almoco') {
          const [saidaAlm] = await pool.execute(
            `SELECT data_hora FROM rp_registros_ponto
             WHERE funcionario_id = ? AND DATE(data_hora) = ? AND tipo = 'saida_almoco'
             LIMIT 1`,
            [funcionarioId, dia]
          );
          if (saidaAlm.length > 0) {
            const diff = dataHora.diff(moment(saidaAlm[0].data_hora), 'minutes');
            if (diff < ALMOCO_MINIMO_MINUTOS) {
              resultados.push({
                id: reg.offline_id,
                status: 'erro',
                erro: `Almoço inferior a ${ALMOCO_MINIMO_MINUTOS} minutos (${diff} min)`
              });
              continue;
            }
          }
        }

        await pool.execute(
          'INSERT INTO rp_registros_ponto (funcionario_id, tipo, data_hora, ip_origem) VALUES (?, ?, ?, ?)',
          [funcionarioId, reg.tipo, dataHora.format('YYYY-MM-DD HH:mm:ss'), reg.ip || 'offline']
        );

        resultados.push({ id: reg.offline_id, status: 'sincronizado', tipo: reg.tipo, data: dia });
      } catch (errReg) {
        resultados.push({ id: reg.offline_id, status: 'erro', erro: errReg.message });
      }
    }

    res.json({
      message: `Sincronização concluída: ${resultados.filter(r => r.status === 'sincronizado').length} registros sincronizados`,
      resultados
    });
  } catch (err) {
    console.error('Erro ao sincronizar ponto:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
