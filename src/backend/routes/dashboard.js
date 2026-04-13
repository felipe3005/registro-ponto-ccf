const express = require('express');
const moment = require('moment');
const { pool } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Cache simples em memória para dashboard admin (TTL 30s)
const dashboardCache = { data: null, ts: 0 };
const DASHBOARD_TTL_MS = 30 * 1000;

// Dashboard admin — dados agregados
router.get('/admin', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // Cache hit
    if (req.query.refresh !== '1' && dashboardCache.data && (Date.now() - dashboardCache.ts) < DASHBOARD_TTL_MS) {
      return res.json(dashboardCache.data);
    }

    const hoje = moment().format('YYYY-MM-DD');
    const diaSemana = moment().day();
    const mes = moment().month() + 1;
    const ano = moment().year();
    // Range sargável (usa índice em data_hora)
    const inicioMes = moment().startOf('month').format('YYYY-MM-DD HH:mm:ss');
    const inicioProximoMes = moment().add(1, 'month').startOf('month').format('YYYY-MM-DD HH:mm:ss');
    const inicioHoje = hoje + ' 00:00:00';
    const inicioAmanha = moment().add(1, 'day').format('YYYY-MM-DD') + ' 00:00:00';

    // Executa todas as queries independentes em PARALELO
    const [
      [totalFunc],
      [registrosHoje],
      [configHorarios],
      [tolConfig],
      [ajustesPend],
      [horasDepto],
      [presencaDiaria],
      [faltasMes],
      [inconsistencias],
      [topHoras]
    ] = await Promise.all([
      // 1) Total de funcionários ativos
      pool.execute("SELECT COUNT(*) as total FROM rp_funcionarios WHERE ativo = 1 AND role = 'funcionario'"),

      // 2+3) Registros detalhados de hoje (serve também para "presentes")
      pool.execute(
        `SELECT rp.funcionario_id, f.nome, f.cargo, f.departamento, rp.tipo,
                TIME_FORMAT(TIME(rp.data_hora), '%H:%i') as hora
         FROM rp_registros_ponto rp
         JOIN rp_funcionarios f ON rp.funcionario_id = f.id
         WHERE rp.data_hora >= ? AND rp.data_hora < ? AND f.role = 'funcionario'
         ORDER BY f.nome, rp.data_hora`,
        [inicioHoje, inicioAmanha]
      ),

      // 4a) Config horários do dia
      pool.execute(
        `SELECT ch.funcionario_id, ch.hora_entrada, f.nome
         FROM rp_configuracoes_horario ch
         JOIN rp_funcionarios f ON ch.funcionario_id = f.id
         WHERE ch.dia_semana = ? AND f.ativo = 1 AND f.role = 'funcionario'`,
        [diaSemana]
      ),

      // 4b) Tolerância
      pool.execute("SELECT valor FROM rp_configuracoes WHERE chave = 'tolerancia_minutos'"),

      // 5) Ajustes pendentes
      pool.execute("SELECT COUNT(*) as total FROM rp_ajustes_ponto WHERE status = 'pendente'"),

      // 6) Horas por departamento no mês — REESCRITO sem subqueries correlacionadas
      pool.execute(
        `SELECT t.departamento,
                SUM(t.minutos) AS total_minutos,
                COUNT(DISTINCT t.funcionario_id) AS total_funcionarios
         FROM (
           SELECT f.id AS funcionario_id, f.departamento,
                  TIMESTAMPDIFF(MINUTE,
                    MIN(CASE WHEN rp.tipo='entrada' THEN rp.data_hora END),
                    MAX(CASE WHEN rp.tipo='saida' THEN rp.data_hora END)
                  ) AS minutos
           FROM rp_registros_ponto rp
           JOIN rp_funcionarios f ON rp.funcionario_id = f.id
           WHERE rp.data_hora >= ? AND rp.data_hora < ?
             AND f.role='funcionario' AND f.departamento IS NOT NULL
           GROUP BY f.id, f.departamento, DATE(rp.data_hora)
         ) t
         GROUP BY t.departamento`,
        [inicioMes, inicioProximoMes]
      ),

      // 7) Presença diária no mês
      pool.execute(
        `SELECT DATE(rp.data_hora) as dia, COUNT(DISTINCT rp.funcionario_id) as presentes
         FROM rp_registros_ponto rp
         JOIN rp_funcionarios f ON rp.funcionario_id = f.id
         WHERE rp.data_hora >= ? AND rp.data_hora < ? AND rp.tipo = 'entrada'
           AND f.role = 'funcionario'
         GROUP BY DATE(rp.data_hora)
         ORDER BY dia`,
        [inicioMes, inicioProximoMes]
      ),

      // 8) Faltas no mês
      pool.execute(
        "SELECT COUNT(*) as total FROM rp_faltas WHERE data >= ? AND data < ?",
        [moment().startOf('month').format('YYYY-MM-DD'), moment().add(1, 'month').startOf('month').format('YYYY-MM-DD')]
      ),

      // 9) Inconsistências do mês
      pool.execute(
        `SELECT rp.funcionario_id, DATE(rp.data_hora) as dia, GROUP_CONCAT(DISTINCT rp.tipo) as tipos
         FROM rp_registros_ponto rp
         JOIN rp_funcionarios f ON rp.funcionario_id = f.id
         WHERE rp.data_hora >= ? AND rp.data_hora < ? AND f.role = 'funcionario'
         GROUP BY rp.funcionario_id, DATE(rp.data_hora)
         HAVING NOT (FIND_IN_SET('entrada', tipos) AND FIND_IN_SET('saida', tipos))`,
        [inicioMes, inicioProximoMes]
      ),

      // 10) Top 5 funcionários com mais dias trabalhados no mês
      pool.execute(
        `SELECT f.id, f.nome, f.departamento,
                COUNT(DISTINCT DATE(rp.data_hora)) as dias_trabalhados
         FROM rp_registros_ponto rp
         JOIN rp_funcionarios f ON rp.funcionario_id = f.id
         WHERE rp.data_hora >= ? AND rp.data_hora < ?
           AND f.role = 'funcionario' AND rp.tipo = 'entrada'
         GROUP BY f.id, f.nome, f.departamento
         ORDER BY dias_trabalhados DESC
         LIMIT 5`,
        [inicioMes, inicioProximoMes]
      )
    ]);

    // Agrupar registros por funcionário (em memória, rápido)
    const registrosPorFunc = {};
    const idsPresentesSet = new Set();
    registrosHoje.forEach(r => {
      idsPresentesSet.add(r.funcionario_id);
      if (!registrosPorFunc[r.funcionario_id]) {
        registrosPorFunc[r.funcionario_id] = {
          nome: r.nome, cargo: r.cargo, departamento: r.departamento, registros: {}
        };
      }
      registrosPorFunc[r.funcionario_id].registros[r.tipo] = r.hora;
    });

    // Atrasados (processamento em memória)
    const tolerancia = parseInt(tolConfig[0]?.valor || '10');
    const atrasados = [];
    for (const cfg of configHorarios) {
      const regFunc = registrosPorFunc[cfg.funcionario_id];
      if (regFunc && regFunc.registros.entrada) {
        const entrada = moment(hoje + ' ' + regFunc.registros.entrada, 'YYYY-MM-DD HH:mm');
        const esperada = moment(hoje + ' ' + cfg.hora_entrada, 'YYYY-MM-DD HH:mm:ss');
        const diffMin = entrada.diff(esperada, 'minutes');
        if (diffMin > tolerancia) {
          atrasados.push({
            nome: cfg.nome,
            horaEntrada: regFunc.registros.entrada,
            horaEsperada: moment(cfg.hora_entrada, 'HH:mm:ss').format('HH:mm'),
            atrasoMinutos: diffMin
          });
        }
      }
    }

    const payload = {
      totalFuncionarios: totalFunc[0].total,
      presentesHoje: idsPresentesSet.size,
      ausentesHoje: Math.max(0, totalFunc[0].total - idsPresentesSet.size),
      ajustesPendentes: ajustesPend[0].total,
      faltasMes: faltasMes[0].total,
      inconsistenciasMes: inconsistencias.length,
      atrasados,
      registrosHoje: Object.values(registrosPorFunc),
      horasPorDepartamento: horasDepto.map(d => ({
        departamento: d.departamento || 'Sem Depto',
        totalMinutos: Math.max(0, parseInt(d.total_minutos) || 0),
        totalFuncionarios: d.total_funcionarios
      })),
      presencaDiaria: presencaDiaria.map(p => ({
        dia: moment(p.dia).format('DD/MM'),
        diaNum: moment(p.dia).date(),
        presentes: p.presentes
      })),
      topFuncionarios: topHoras,
      periodo: `${String(mes).padStart(2, '0')}/${ano}`
    };

    dashboardCache.data = payload;
    dashboardCache.ts = Date.now();
    res.json(payload);
  } catch (err) {
    console.error('Erro no dashboard admin:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
