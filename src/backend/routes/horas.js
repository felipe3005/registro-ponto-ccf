const express = require('express');
const moment = require('moment');
const { pool } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Calcular horas trabalhadas no dia
router.get('/trabalhadas', authMiddleware, async (req, res) => {
  try {
    const data = req.query.data || moment().format('YYYY-MM-DD');
    const funcId = req.query.funcionario_id || req.user.id;

    const resultado = await calcularHorasDia(funcId, data);
    res.json(resultado);
  } catch (err) {
    console.error('Erro ao calcular horas:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Calcular horas extras
router.get('/extras', authMiddleware, async (req, res) => {
  try {
    const data = req.query.data || moment().format('YYYY-MM-DD');
    const funcId = req.query.funcionario_id || req.user.id;

    const horas = await calcularHorasDia(funcId, data);

    // Buscar jornada do funcionário
    const [func] = await pool.execute(
      'SELECT jornada_semanal FROM rp_funcionarios WHERE id = ?',
      [funcId]
    );
    const jornadaDiaria = (func[0].jornada_semanal / 5) * 60; // em minutos (considerando 5 dias)

    const extras = Math.max(0, horas.totalMinutos - jornadaDiaria);
    res.json({
      horasTrabalhadas: horas.totalFormatado,
      jornadaDiaria: formatarMinutos(jornadaDiaria),
      horasExtras: formatarMinutos(extras),
      minutosExtras: extras
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Calcular atrasos
router.get('/atrasos', authMiddleware, async (req, res) => {
  try {
    const data = req.query.data || moment().format('YYYY-MM-DD');
    const funcId = req.query.funcionario_id || req.user.id;

    const diaSemana = moment(data).day();

    // Buscar configuração de horário
    const [config] = await pool.execute(
      'SELECT * FROM rp_configuracoes_horario WHERE funcionario_id = ? AND dia_semana = ?',
      [funcId, diaSemana]
    );

    // Buscar tolerância
    const [tolConfig] = await pool.execute(
      "SELECT valor FROM rp_configuracoes WHERE chave = 'tolerancia_minutos'"
    );
    const tolerancia = parseInt(tolConfig[0]?.valor || '10');

    if (config.length === 0) {
      return res.json({ atraso: 0, atrasoFormatado: '00:00', mensagem: 'Sem horário configurado' });
    }

    // Buscar registro de entrada
    const [registros] = await pool.execute(
      `SELECT data_hora FROM rp_registros_ponto
       WHERE funcionario_id = ? AND DATE(data_hora) = ? AND tipo = 'entrada'`,
      [funcId, data]
    );

    if (registros.length === 0) {
      return res.json({ atraso: 0, atrasoFormatado: '00:00', mensagem: 'Sem registro de entrada' });
    }

    const horaEntrada = moment(registros[0].data_hora);
    const horaEsperada = moment(data + ' ' + config[0].hora_entrada);
    const diff = horaEntrada.diff(horaEsperada, 'minutes');
    const atraso = Math.max(0, diff - tolerancia);

    res.json({
      atraso,
      atrasoFormatado: formatarMinutos(atraso),
      horaEntrada: horaEntrada.format('HH:mm'),
      horaEsperada: moment(data + ' ' + config[0].hora_entrada).format('HH:mm'),
      tolerancia
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Banco de horas
router.get('/banco', authMiddleware, async (req, res) => {
  try {
    const funcId = req.query.funcionario_id || req.user.id;
    const mes = parseInt(req.query.mes) || moment().month() + 1;
    const ano = parseInt(req.query.ano) || moment().year();

    const [func] = await pool.execute(
      'SELECT jornada_semanal FROM rp_funcionarios WHERE id = ?',
      [funcId]
    );
    const jornadaDiaria = (func[0].jornada_semanal / 5) * 60;

    // Buscar todos os registros do período
    const [registros] = await pool.execute(
      `SELECT DATE(data_hora) as data, tipo, data_hora FROM rp_registros_ponto
       WHERE funcionario_id = ? AND MONTH(data_hora) = ? AND YEAR(data_hora) = ?
       ORDER BY data_hora ASC`,
      [funcId, mes, ano]
    );

    // Buscar feriados do período
    const [feriados] = await pool.execute(
      'SELECT data FROM rp_feriados WHERE MONTH(data) = ? AND YEAR(data) = ?',
      [mes, ano]
    );
    const feriadosSet = new Set(feriados.map(f => moment(f.data).format('YYYY-MM-DD')));

    // Buscar faltas e atestados
    const [faltas] = await pool.execute(
      'SELECT data FROM rp_faltas WHERE funcionario_id = ? AND MONTH(data) = ? AND YEAR(data) = ?',
      [funcId, mes, ano]
    );
    const faltasSet = new Set(faltas.map(f => moment(f.data).format('YYYY-MM-DD')));

    const [atestados] = await pool.execute(
      'SELECT data_inicio, data_fim FROM rp_atestados WHERE funcionario_id = ? AND MONTH(data_inicio) = ? AND YEAR(data_inicio) = ?',
      [funcId, mes, ano]
    );

    // Agrupar registros por dia
    const registrosPorDia = {};
    registros.forEach(r => {
      const dia = moment(r.data_hora).format('YYYY-MM-DD');
      if (!registrosPorDia[dia]) registrosPorDia[dia] = [];
      registrosPorDia[dia].push(r);
    });

    let saldoTotal = 0;
    const detalhes = [];

    // Iterar por cada dia do mês
    const diasNoMes = moment(`${ano}-${mes}`, 'YYYY-MM').daysInMonth();
    for (let d = 1; d <= diasNoMes; d++) {
      const dia = moment(`${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      const diaStr = dia.format('YYYY-MM-DD');

      if (dia.isAfter(moment())) break; // não calcular dias futuros

      const ehFimDeSemana = dia.day() === 0 || dia.day() === 6;
      const ehFeriado = feriadosSet.has(diaStr);
      const ehFalta = faltasSet.has(diaStr);

      if (ehFimDeSemana || ehFeriado) {
        // Se trabalhou em feriado/fim de semana, são horas extras
        if (registrosPorDia[diaStr]) {
          const horas = calcularMinutosDia(registrosPorDia[diaStr]);
          saldoTotal += horas;
          detalhes.push({ data: diaStr, trabalhado: horas, esperado: 0, saldo: horas, tipo: ehFeriado ? 'feriado' : 'fim_de_semana' });
        }
        continue;
      }

      if (ehFalta) {
        saldoTotal -= jornadaDiaria;
        detalhes.push({ data: diaStr, trabalhado: 0, esperado: jornadaDiaria, saldo: -jornadaDiaria, tipo: 'falta' });
        continue;
      }

      // Verificar atestado
      const temAtestado = atestados.some(a =>
        dia.isBetween(moment(a.data_inicio), moment(a.data_fim), 'day', '[]')
      );
      if (temAtestado) {
        detalhes.push({ data: diaStr, trabalhado: 0, esperado: jornadaDiaria, saldo: 0, tipo: 'atestado' });
        continue;
      }

      if (registrosPorDia[diaStr]) {
        const trabalhado = calcularMinutosDia(registrosPorDia[diaStr]);
        const saldo = trabalhado - jornadaDiaria;
        saldoTotal += saldo;
        detalhes.push({ data: diaStr, trabalhado, esperado: jornadaDiaria, saldo, tipo: 'normal' });
      } else {
        // Dia útil sem registro
        saldoTotal -= jornadaDiaria;
        detalhes.push({ data: diaStr, trabalhado: 0, esperado: jornadaDiaria, saldo: -jornadaDiaria, tipo: 'sem_registro' });
      }
    }

    res.json({
      funcionarioId: funcId,
      periodo: `${String(mes).padStart(2, '0')}/${ano}`,
      saldoTotal,
      saldoFormatado: formatarMinutos(Math.abs(saldoTotal)),
      saldoPositivo: saldoTotal >= 0,
      detalhes
    });
  } catch (err) {
    console.error('Erro ao calcular banco de horas:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Funções auxiliares
async function calcularHorasDia(funcId, data) {
  const [registros] = await pool.execute(
    `SELECT tipo, data_hora FROM rp_registros_ponto
     WHERE funcionario_id = ? AND DATE(data_hora) = ?
     ORDER BY data_hora ASC`,
    [funcId, data]
  );

  const totalMinutos = calcularMinutosDia(registros);

  return {
    registros,
    totalMinutos,
    totalFormatado: formatarMinutos(totalMinutos)
  };
}

function calcularMinutosDia(registros) {
  let total = 0;
  const tipos = {};
  registros.forEach(r => {
    tipos[r.tipo] = moment(r.data_hora);
  });

  // Período manhã: entrada -> saída almoço
  if (tipos.entrada && tipos.saida_almoco) {
    total += tipos.saida_almoco.diff(tipos.entrada, 'minutes');
  }
  // Período tarde: retorno almoço -> saída
  if (tipos.retorno_almoco && tipos.saida) {
    total += tipos.saida.diff(tipos.retorno_almoco, 'minutes');
  }
  // Caso sem almoço: entrada -> saída
  if (tipos.entrada && tipos.saida && !tipos.saida_almoco && !tipos.retorno_almoco) {
    total = tipos.saida.diff(tipos.entrada, 'minutes');
  }

  return Math.max(0, total);
}

function formatarMinutos(minutos) {
  const h = Math.floor(Math.abs(minutos) / 60);
  const m = Math.abs(minutos) % 60;
  return `${String(h).padStart(2, '0')}:${String(Math.round(m)).padStart(2, '0')}`;
}

module.exports = router;
