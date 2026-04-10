const express = require('express');
const moment = require('moment');
const PDFDocument = require('pdfkit');
const { pool } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Espelho de ponto mensal
router.get('/espelho', authMiddleware, async (req, res) => {
  try {
    const funcId = req.query.funcionario_id || req.user.id;
    const mes = parseInt(req.query.mes) || moment().month() + 1;
    const ano = parseInt(req.query.ano) || moment().year();

    const [func] = await pool.execute(
      'SELECT id, nome, cargo, departamento, jornada_semanal FROM rp_funcionarios WHERE id = ?',
      [funcId]
    );
    if (func.length === 0) return res.status(404).json({ error: 'Funcionário não encontrado' });

    const [registros] = await pool.execute(
      `SELECT * FROM rp_registros_ponto
       WHERE funcionario_id = ? AND MONTH(data_hora) = ? AND YEAR(data_hora) = ?
       ORDER BY data_hora ASC`,
      [funcId, mes, ano]
    );

    const [feriados] = await pool.execute(
      'SELECT * FROM rp_feriados WHERE MONTH(data) = ? AND YEAR(data) = ?',
      [mes, ano]
    );
    const feriadosMap = {};
    feriados.forEach(f => { feriadosMap[moment(f.data).format('YYYY-MM-DD')] = f.descricao; });

    const [faltas] = await pool.execute(
      'SELECT * FROM rp_faltas WHERE funcionario_id = ? AND MONTH(data) = ? AND YEAR(data) = ?',
      [funcId, mes, ano]
    );
    const faltasMap = {};
    faltas.forEach(f => { faltasMap[moment(f.data).format('YYYY-MM-DD')] = f.justificativa; });

    const [atestados] = await pool.execute(
      'SELECT * FROM rp_atestados WHERE funcionario_id = ? AND ((MONTH(data_inicio) = ? AND YEAR(data_inicio) = ?) OR (MONTH(data_fim) = ? AND YEAR(data_fim) = ?))',
      [funcId, mes, ano, mes, ano]
    );

    // Agrupar por dia
    const registrosPorDia = {};
    registros.forEach(r => {
      const dia = moment(r.data_hora).format('YYYY-MM-DD');
      if (!registrosPorDia[dia]) registrosPorDia[dia] = {};
      registrosPorDia[dia][r.tipo] = moment(r.data_hora).format('HH:mm');
    });

    const jornadaDiaria = (func[0].jornada_semanal / 5) * 60;
    const diasNoMes = moment(`${ano}-${mes}`, 'YYYY-MM').daysInMonth();
    const dias = [];
    let totalTrabalhadoMes = 0;
    let totalExtrasMes = 0;
    let totalAtrasosMes = 0;
    let totalFaltas = 0;

    for (let d = 1; d <= diasNoMes; d++) {
      const dia = moment(`${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      const diaStr = dia.format('YYYY-MM-DD');
      const ehFds = dia.day() === 0 || dia.day() === 6;
      const ehFeriado = !!feriadosMap[diaStr];
      const ehFalta = !!faltasMap[diaStr];
      const temAtestado = atestados.some(a => dia.isBetween(moment(a.data_inicio), moment(a.data_fim), 'day', '[]'));

      const reg = registrosPorDia[diaStr] || {};
      let trabalhado = 0;

      if (reg.entrada && reg.saida_almoco) {
        trabalhado += moment(diaStr + ' ' + reg.saida_almoco).diff(moment(diaStr + ' ' + reg.entrada), 'minutes');
      }
      if (reg.retorno_almoco && reg.saida) {
        trabalhado += moment(diaStr + ' ' + reg.saida).diff(moment(diaStr + ' ' + reg.retorno_almoco), 'minutes');
      }
      if (reg.entrada && reg.saida && !reg.saida_almoco && !reg.retorno_almoco) {
        trabalhado = moment(diaStr + ' ' + reg.saida).diff(moment(diaStr + ' ' + reg.entrada), 'minutes');
      }

      trabalhado = Math.max(0, trabalhado);
      let status = 'normal';
      if (ehFds) status = 'fim_de_semana';
      else if (ehFeriado) status = 'feriado';
      else if (temAtestado) status = 'atestado';
      else if (ehFalta) { status = 'falta'; totalFaltas++; }
      else if (!reg.entrada && !ehFds && !ehFeriado && dia.isBefore(moment())) status = 'sem_registro';

      const extras = (!ehFds && !ehFeriado && !temAtestado && !ehFalta) ? Math.max(0, trabalhado - jornadaDiaria) : (trabalhado > 0 ? trabalhado : 0);

      totalTrabalhadoMes += trabalhado;
      if (!ehFds && !ehFeriado) totalExtrasMes += extras > 0 ? extras : 0;

      dias.push({
        data: diaStr,
        diaSemana: dia.format('ddd'),
        entrada: reg.entrada || null,
        saida_almoco: reg.saida_almoco || null,
        retorno_almoco: reg.retorno_almoco || null,
        saida: reg.saida || null,
        trabalhado: formatarMinutos(trabalhado),
        trabalhadoMinutos: trabalhado,
        status,
        feriado: feriadosMap[diaStr] || null
      });
    }

    res.json({
      funcionario: func[0],
      periodo: `${String(mes).padStart(2, '0')}/${ano}`,
      dias,
      resumo: {
        totalTrabalhado: formatarMinutos(totalTrabalhadoMes),
        totalExtras: formatarMinutos(totalExtrasMes),
        totalFaltas,
        jornadaMensal: formatarMinutos(jornadaDiaria * diasUteisNoMes(mes, ano, feriadosMap))
      }
    });
  } catch (err) {
    console.error('Erro ao gerar espelho:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Relatório geral (admin)
router.get('/geral', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const mes = parseInt(req.query.mes) || moment().month() + 1;
    const ano = parseInt(req.query.ano) || moment().year();

    const [funcionarios] = await pool.execute(
      'SELECT id, nome, cargo, departamento, jornada_semanal FROM rp_funcionarios WHERE ativo = 1 ORDER BY nome'
    );

    const resumos = [];
    for (const func of funcionarios) {
      const [registros] = await pool.execute(
        `SELECT tipo, data_hora FROM rp_registros_ponto
         WHERE funcionario_id = ? AND MONTH(data_hora) = ? AND YEAR(data_hora) = ?
         ORDER BY data_hora ASC`,
        [func.id, mes, ano]
      );

      // Agrupar por dia e calcular
      const porDia = {};
      registros.forEach(r => {
        const dia = moment(r.data_hora).format('YYYY-MM-DD');
        if (!porDia[dia]) porDia[dia] = {};
        porDia[dia][r.tipo] = moment(r.data_hora);
      });

      let totalMinutos = 0;
      Object.values(porDia).forEach(reg => {
        if (reg.entrada && reg.saida_almoco) totalMinutos += reg.saida_almoco.diff(reg.entrada, 'minutes');
        if (reg.retorno_almoco && reg.saida) totalMinutos += reg.saida.diff(reg.retorno_almoco, 'minutes');
        if (reg.entrada && reg.saida && !reg.saida_almoco && !reg.retorno_almoco) {
          totalMinutos = reg.saida.diff(reg.entrada, 'minutes');
        }
      });

      const [faltasCount] = await pool.execute(
        'SELECT COUNT(*) as total FROM rp_faltas WHERE funcionario_id = ? AND MONTH(data) = ? AND YEAR(data) = ?',
        [func.id, mes, ano]
      );

      resumos.push({
        funcionario: func,
        totalHoras: formatarMinutos(Math.max(0, totalMinutos)),
        diasTrabalhados: Object.keys(porDia).length,
        faltas: faltasCount[0].total
      });
    }

    res.json({ periodo: `${String(mes).padStart(2, '0')}/${ano}`, resumos });
  } catch (err) {
    console.error('Erro ao gerar relatório geral:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Inconsistências
router.get('/inconsistencias', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const mes = parseInt(req.query.mes) || moment().month() + 1;
    const ano = parseInt(req.query.ano) || moment().year();

    const [registros] = await pool.execute(
      `SELECT rp.funcionario_id, f.nome, DATE(rp.data_hora) as data, rp.tipo, rp.data_hora
       FROM rp_registros_ponto rp
       JOIN rp_funcionarios f ON rp.funcionario_id = f.id
       WHERE MONTH(rp.data_hora) = ? AND YEAR(rp.data_hora) = ?
       ORDER BY rp.funcionario_id, rp.data_hora`,
      [mes, ano]
    );

    // Agrupar por funcionário/dia
    const agrupado = {};
    registros.forEach(r => {
      const key = `${r.funcionario_id}_${moment(r.data_hora).format('YYYY-MM-DD')}`;
      if (!agrupado[key]) agrupado[key] = { funcionarioId: r.funcionario_id, nome: r.nome, data: moment(r.data_hora).format('YYYY-MM-DD'), tipos: [] };
      agrupado[key].tipos.push(r.tipo);
    });

    const inconsistencias = [];
    Object.values(agrupado).forEach(dia => {
      const problemas = [];
      if (dia.tipos.includes('entrada') && !dia.tipos.includes('saida')) {
        problemas.push('Sem registro de saída');
      }
      if (!dia.tipos.includes('entrada') && dia.tipos.length > 0) {
        problemas.push('Sem registro de entrada');
      }
      if (dia.tipos.includes('saida_almoco') && !dia.tipos.includes('retorno_almoco')) {
        problemas.push('Sem retorno do almoço');
      }
      if (dia.tipos.length === 1 && dia.tipos[0] !== 'entrada') {
        problemas.push('Registro incompleto - apenas ' + dia.tipos[0]);
      }

      if (problemas.length > 0) {
        inconsistencias.push({ ...dia, problemas });
      }
    });

    res.json(inconsistencias);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Exportar relatório em PDF
router.get('/exportar/pdf', authMiddleware, async (req, res) => {
  try {
    const funcId = req.query.funcionario_id || req.user.id;
    const mes = parseInt(req.query.mes) || moment().month() + 1;
    const ano = parseInt(req.query.ano) || moment().year();

    const [func] = await pool.execute(
      'SELECT nome, cargo, departamento FROM rp_funcionarios WHERE id = ?',
      [funcId]
    );

    const [registros] = await pool.execute(
      `SELECT * FROM rp_registros_ponto
       WHERE funcionario_id = ? AND MONTH(data_hora) = ? AND YEAR(data_hora) = ?
       ORDER BY data_hora ASC`,
      [funcId, mes, ano]
    );

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=espelho_ponto_${mes}_${ano}.pdf`);
    doc.pipe(res);

    // Cabeçalho
    doc.fontSize(18).text('Espelho de Ponto', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Funcionário: ${func[0].nome}`);
    doc.text(`Cargo: ${func[0].cargo || '-'} | Departamento: ${func[0].departamento || '-'}`);
    doc.text(`Período: ${String(mes).padStart(2, '0')}/${ano}`);
    doc.moveDown();

    // Cabeçalho tabela
    const tableTop = doc.y;
    const col = { data: 40, entrada: 130, saidaAlm: 210, retornoAlm: 300, saida: 400, total: 480 };

    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Data', col.data, tableTop);
    doc.text('Entrada', col.entrada, tableTop);
    doc.text('Saída Almoço', col.saidaAlm, tableTop);
    doc.text('Retorno Alm.', col.retornoAlm, tableTop);
    doc.text('Saída', col.saida, tableTop);
    doc.text('Total', col.total, tableTop);
    doc.moveTo(40, tableTop + 15).lineTo(555, tableTop + 15).stroke();

    // Registros
    const porDia = {};
    registros.forEach(r => {
      const dia = moment(r.data_hora).format('YYYY-MM-DD');
      if (!porDia[dia]) porDia[dia] = {};
      porDia[dia][r.tipo] = moment(r.data_hora).format('HH:mm');
    });

    doc.font('Helvetica').fontSize(9);
    let y = tableTop + 22;
    let totalGeralMin = 0;

    const diasOrdenados = Object.keys(porDia).sort();
    diasOrdenados.forEach(dia => {
      if (y > 750) { doc.addPage(); y = 40; }

      const reg = porDia[dia];
      let minutos = 0;
      if (reg.entrada && reg.saida_almoco) minutos += moment(dia + ' ' + reg.saida_almoco).diff(moment(dia + ' ' + reg.entrada), 'minutes');
      if (reg.retorno_almoco && reg.saida) minutos += moment(dia + ' ' + reg.saida).diff(moment(dia + ' ' + reg.retorno_almoco), 'minutes');
      if (reg.entrada && reg.saida && !reg.saida_almoco && !reg.retorno_almoco) minutos = moment(dia + ' ' + reg.saida).diff(moment(dia + ' ' + reg.entrada), 'minutes');

      minutos = Math.max(0, minutos);
      totalGeralMin += minutos;

      doc.text(moment(dia).format('DD/MM'), col.data, y);
      doc.text(reg.entrada || '-', col.entrada, y);
      doc.text(reg.saida_almoco || '-', col.saidaAlm, y);
      doc.text(reg.retorno_almoco || '-', col.retornoAlm, y);
      doc.text(reg.saida || '-', col.saida, y);
      doc.text(formatarMinutos(minutos), col.total, y);
      y += 16;
    });

    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`Total de horas no período: ${formatarMinutos(totalGeralMin)}`, 40, y + 10);

    doc.moveDown(4);
    doc.fontSize(9).font('Helvetica');
    doc.text('_________________________________', 60, doc.y);
    doc.text('Assinatura do Funcionário', 85, doc.y + 5);
    doc.text('_________________________________', 350, doc.y - 5);
    doc.text('Assinatura do Responsável', 375, doc.y + 5);

    doc.end();
  } catch (err) {
    console.error('Erro ao exportar PDF:', err);
    res.status(500).json({ error: 'Erro ao gerar PDF' });
  }
});

// Exportar CSV
router.get('/exportar/csv', authMiddleware, async (req, res) => {
  try {
    const funcId = req.query.funcionario_id || req.user.id;
    const mes = parseInt(req.query.mes) || moment().month() + 1;
    const ano = parseInt(req.query.ano) || moment().year();

    const [func] = await pool.execute('SELECT nome FROM rp_funcionarios WHERE id = ?', [funcId]);
    const [registros] = await pool.execute(
      `SELECT * FROM rp_registros_ponto
       WHERE funcionario_id = ? AND MONTH(data_hora) = ? AND YEAR(data_hora) = ?
       ORDER BY data_hora ASC`,
      [funcId, mes, ano]
    );

    const porDia = {};
    registros.forEach(r => {
      const dia = moment(r.data_hora).format('YYYY-MM-DD');
      if (!porDia[dia]) porDia[dia] = {};
      porDia[dia][r.tipo] = moment(r.data_hora).format('HH:mm');
    });

    let csv = 'Data,Entrada,Saída Almoço,Retorno Almoço,Saída,Total Horas\n';
    Object.keys(porDia).sort().forEach(dia => {
      const reg = porDia[dia];
      let minutos = 0;
      if (reg.entrada && reg.saida_almoco) minutos += moment(dia + ' ' + reg.saida_almoco).diff(moment(dia + ' ' + reg.entrada), 'minutes');
      if (reg.retorno_almoco && reg.saida) minutos += moment(dia + ' ' + reg.saida).diff(moment(dia + ' ' + reg.retorno_almoco), 'minutes');
      if (reg.entrada && reg.saida && !reg.saida_almoco && !reg.retorno_almoco) minutos = moment(dia + ' ' + reg.saida).diff(moment(dia + ' ' + reg.entrada), 'minutes');
      csv += `${moment(dia).format('DD/MM/YYYY')},${reg.entrada || '-'},${reg.saida_almoco || '-'},${reg.retorno_almoco || '-'},${reg.saida || '-'},${formatarMinutos(Math.max(0, minutos))}\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=ponto_${func[0].nome}_${mes}_${ano}.csv`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gerar CSV' });
  }
});

function formatarMinutos(minutos) {
  const h = Math.floor(Math.abs(minutos) / 60);
  const m = Math.abs(minutos) % 60;
  return `${String(h).padStart(2, '0')}:${String(Math.round(m)).padStart(2, '0')}`;
}

function diasUteisNoMes(mes, ano, feriadosMap) {
  let count = 0;
  const total = moment(`${ano}-${mes}`, 'YYYY-MM').daysInMonth();
  for (let d = 1; d <= total; d++) {
    const dia = moment(`${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    if (dia.day() !== 0 && dia.day() !== 6 && !feriadosMap[dia.format('YYYY-MM-DD')]) count++;
  }
  return count;
}

module.exports = router;
