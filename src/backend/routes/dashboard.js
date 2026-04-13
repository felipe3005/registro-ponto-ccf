const express = require('express');
const moment = require('moment');
const { pool } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Dashboard admin — dados agregados
router.get('/admin', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const hoje = moment().format('YYYY-MM-DD');
    const mes = moment().month() + 1;
    const ano = moment().year();

    // 1) Total de funcionários ativos (excluindo admins)
    const [totalFunc] = await pool.execute(
      "SELECT COUNT(*) as total FROM rp_funcionarios WHERE ativo = 1 AND role = 'funcionario'"
    );

    // 2) Funcionários que registraram entrada hoje
    const [presentesHoje] = await pool.execute(
      `SELECT DISTINCT rp.funcionario_id, f.nome, f.cargo, f.departamento
       FROM rp_registros_ponto rp
       JOIN rp_funcionarios f ON rp.funcionario_id = f.id
       WHERE DATE(rp.data_hora) = ? AND f.role = 'funcionario'
       ORDER BY f.nome`,
      [hoje]
    );
    const idsPresentes = [...new Set(presentesHoje.map(p => p.funcionario_id))];

    // 3) Registros detalhados de hoje (quem bateu o quê)
    const [registrosHoje] = await pool.execute(
      `SELECT rp.funcionario_id, f.nome, f.cargo, f.departamento, rp.tipo,
              TIME_FORMAT(TIME(rp.data_hora), '%H:%i') as hora
       FROM rp_registros_ponto rp
       JOIN rp_funcionarios f ON rp.funcionario_id = f.id
       WHERE DATE(rp.data_hora) = ? AND f.role = 'funcionario'
       ORDER BY f.nome, rp.data_hora`,
      [hoje]
    );

    // Agrupar registros por funcionário
    const registrosPorFunc = {};
    registrosHoje.forEach(r => {
      if (!registrosPorFunc[r.funcionario_id]) {
        registrosPorFunc[r.funcionario_id] = {
          nome: r.nome, cargo: r.cargo, departamento: r.departamento, registros: {}
        };
      }
      registrosPorFunc[r.funcionario_id].registros[r.tipo] = r.hora;
    });

    // 4) Atrasados hoje (comparar entrada com horário configurado)
    const diaSemana = moment().day();
    const [configHorarios] = await pool.execute(
      `SELECT ch.funcionario_id, ch.hora_entrada, f.nome
       FROM rp_configuracoes_horario ch
       JOIN rp_funcionarios f ON ch.funcionario_id = f.id
       WHERE ch.dia_semana = ? AND f.ativo = 1 AND f.role = 'funcionario'`,
      [diaSemana]
    );
    const [tolConfig] = await pool.execute(
      "SELECT valor FROM rp_configuracoes WHERE chave = 'tolerancia_minutos'"
    );
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

    // 5) Ajustes pendentes
    const [ajustesPend] = await pool.execute(
      "SELECT COUNT(*) as total FROM rp_ajustes_ponto WHERE status = 'pendente'"
    );

    // 6) Horas por departamento no mês
    const [horasDepto] = await pool.execute(
      `SELECT f.departamento,
              SUM(TIMESTAMPDIFF(MINUTE,
                (SELECT MIN(rp2.data_hora) FROM rp_registros_ponto rp2
                 WHERE rp2.funcionario_id = f.id AND DATE(rp2.data_hora) = DATE(rp.data_hora) AND rp2.tipo = 'entrada'),
                (SELECT MAX(rp3.data_hora) FROM rp_registros_ponto rp3
                 WHERE rp3.funcionario_id = f.id AND DATE(rp3.data_hora) = DATE(rp.data_hora) AND rp3.tipo = 'saida')
              )) as total_minutos,
              COUNT(DISTINCT f.id) as total_funcionarios
       FROM rp_registros_ponto rp
       JOIN rp_funcionarios f ON rp.funcionario_id = f.id
       WHERE MONTH(rp.data_hora) = ? AND YEAR(rp.data_hora) = ?
         AND f.role = 'funcionario' AND f.departamento IS NOT NULL
       GROUP BY f.departamento`,
      [mes, ano]
    );

    // 7) Presença diária no mês (para gráfico de linha)
    const [presencaDiaria] = await pool.execute(
      `SELECT DATE(data_hora) as dia, COUNT(DISTINCT funcionario_id) as presentes
       FROM rp_registros_ponto rp
       JOIN rp_funcionarios f ON rp.funcionario_id = f.id
       WHERE MONTH(data_hora) = ? AND YEAR(data_hora) = ? AND tipo = 'entrada'
         AND f.role = 'funcionario'
       GROUP BY DATE(data_hora)
       ORDER BY dia`,
      [mes, ano]
    );

    // 8) Faltas no mês
    const [faltasMes] = await pool.execute(
      `SELECT COUNT(*) as total FROM rp_faltas
       WHERE MONTH(data) = ? AND YEAR(data) = ?`,
      [mes, ano]
    );

    // 9) Inconsistências do mês (registros incompletos)
    const [inconsistencias] = await pool.execute(
      `SELECT rp.funcionario_id, DATE(rp.data_hora) as dia, GROUP_CONCAT(DISTINCT rp.tipo) as tipos
       FROM rp_registros_ponto rp
       JOIN rp_funcionarios f ON rp.funcionario_id = f.id
       WHERE MONTH(rp.data_hora) = ? AND YEAR(rp.data_hora) = ? AND f.role = 'funcionario'
       GROUP BY rp.funcionario_id, DATE(rp.data_hora)
       HAVING NOT (FIND_IN_SET('entrada', tipos) AND FIND_IN_SET('saida', tipos))`,
      [mes, ano]
    );

    // 10) Top 5 funcionários com mais horas no mês
    const [topHoras] = await pool.execute(
      `SELECT f.id, f.nome, f.departamento,
              COUNT(DISTINCT DATE(rp.data_hora)) as dias_trabalhados
       FROM rp_registros_ponto rp
       JOIN rp_funcionarios f ON rp.funcionario_id = f.id
       WHERE MONTH(rp.data_hora) = ? AND YEAR(rp.data_hora) = ?
         AND f.role = 'funcionario' AND rp.tipo = 'entrada'
       GROUP BY f.id, f.nome, f.departamento
       ORDER BY dias_trabalhados DESC
       LIMIT 5`,
      [mes, ano]
    );

    res.json({
      totalFuncionarios: totalFunc[0].total,
      presentesHoje: idsPresentes.length,
      ausentesHoje: Math.max(0, totalFunc[0].total - idsPresentes.length),
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
    });
  } catch (err) {
    console.error('Erro no dashboard admin:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
