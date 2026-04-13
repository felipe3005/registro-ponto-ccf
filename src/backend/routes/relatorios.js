const express = require('express');
const moment = require('moment');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { pool } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Dados da empresa
const EMPRESA = {
  nome: 'Credito Casa Financiamentos',
  cnpj: '08.225.652/0001-36',
  endereco: 'Empresarial Torre do Castelo - Sala 21',
  rua: 'R. Francisco Otaviano - no 60',
  bairro: 'Jardim Chapadao',
  cep: 'CEP 13070-056 - Campinas/SP'
};

const LOGO_PATH = path.join(__dirname, '../../frontend/images/logo-420x110.png');

// Espelho de ponto mensal
router.get('/espelho', authMiddleware, async (req, res) => {
  try {
    const funcId = req.query.funcionario_id || req.user.id;
    const mes = parseInt(req.query.mes) || moment().month() + 1;
    const ano = parseInt(req.query.ano) || moment().year();

    const [func] = await pool.execute(
      'SELECT id, nome, usuario, cargo, departamento, jornada_semanal FROM rp_funcionarios WHERE id = ?',
      [funcId]
    );
    if (func.length === 0) return res.status(404).json({ error: 'Colaborador nao encontrado' });

    const [registros] = await pool.execute(
      'SELECT * FROM rp_registros_ponto WHERE funcionario_id = ? AND MONTH(data_hora) = ? AND YEAR(data_hora) = ? ORDER BY data_hora ASC',
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

    const registrosPorDia = {};
    registros.forEach(r => {
      const dia = moment(r.data_hora).format('YYYY-MM-DD');
      if (!registrosPorDia[dia]) registrosPorDia[dia] = {};
      registrosPorDia[dia][r.tipo] = moment(r.data_hora).format('HH:mm');
    });

    const jornadaDiaria = (func[0].jornada_semanal / 5) * 60;
    const diasNoMes = moment(ano + '-' + mes, 'YYYY-MM').daysInMonth();
    const dias = [];
    let totalTrabalhadoMes = 0;
    let totalExtrasMes = 0;
    let totalFaltas = 0;

    for (let d = 1; d <= diasNoMes; d++) {
      const dia = moment(ano + '-' + String(mes).padStart(2, '0') + '-' + String(d).padStart(2, '0'));
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
        data: diaStr, diaSemana: dia.format('ddd'),
        entrada: reg.entrada || null, saida_almoco: reg.saida_almoco || null,
        retorno_almoco: reg.retorno_almoco || null, saida: reg.saida || null,
        trabalhado: formatarMinutos(trabalhado), trabalhadoMinutos: trabalhado,
        status, feriado: feriadosMap[diaStr] || null
      });
    }

    res.json({
      funcionario: func[0],
      periodo: String(mes).padStart(2, '0') + '/' + ano,
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

// Relatorio geral (admin)
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
        'SELECT tipo, data_hora FROM rp_registros_ponto WHERE funcionario_id = ? AND MONTH(data_hora) = ? AND YEAR(data_hora) = ? ORDER BY data_hora ASC',
        [func.id, mes, ano]
      );

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

    res.json({ periodo: String(mes).padStart(2, '0') + '/' + ano, resumos });
  } catch (err) {
    console.error('Erro ao gerar relatorio geral:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Inconsistencias
router.get('/inconsistencias', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const mes = parseInt(req.query.mes) || moment().month() + 1;
    const ano = parseInt(req.query.ano) || moment().year();

    const [registros] = await pool.execute(
      'SELECT rp.funcionario_id, f.nome, DATE(rp.data_hora) as data, rp.tipo, rp.data_hora FROM rp_registros_ponto rp JOIN rp_funcionarios f ON rp.funcionario_id = f.id WHERE MONTH(rp.data_hora) = ? AND YEAR(rp.data_hora) = ? ORDER BY rp.funcionario_id, rp.data_hora',
      [mes, ano]
    );

    const agrupado = {};
    registros.forEach(r => {
      const key = r.funcionario_id + '_' + moment(r.data_hora).format('YYYY-MM-DD');
      if (!agrupado[key]) agrupado[key] = { funcionarioId: r.funcionario_id, nome: r.nome, data: moment(r.data_hora).format('YYYY-MM-DD'), tipos: [] };
      agrupado[key].tipos.push(r.tipo);
    });

    const inconsistencias = [];
    Object.values(agrupado).forEach(dia => {
      const problemas = [];
      if (dia.tipos.includes('entrada') && !dia.tipos.includes('saida')) problemas.push('Sem registro de saida');
      if (!dia.tipos.includes('entrada') && dia.tipos.length > 0) problemas.push('Sem registro de entrada');
      if (dia.tipos.includes('saida_almoco') && !dia.tipos.includes('retorno_almoco')) problemas.push('Sem retorno do almoco');
      if (dia.tipos.length === 1 && dia.tipos[0] !== 'entrada') problemas.push('Registro incompleto');
      if (problemas.length > 0) inconsistencias.push({ ...dia, problemas });
    });

    res.json(inconsistencias);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==================== PDF PROFISSIONAL ====================
router.get('/exportar/pdf', authMiddleware, async (req, res) => {
  try {
    const funcId = req.query.funcionario_id || req.user.id;
    const mes = parseInt(req.query.mes) || moment().month() + 1;
    const ano = parseInt(req.query.ano) || moment().year();

    const [func] = await pool.execute(
      'SELECT nome, usuario, cargo, departamento, jornada_semanal FROM rp_funcionarios WHERE id = ?',
      [funcId]
    );
    if (func.length === 0) return res.status(404).json({ error: 'Colaborador nao encontrado' });

    const [registros] = await pool.execute(
      'SELECT * FROM rp_registros_ponto WHERE funcionario_id = ? AND MONTH(data_hora) = ? AND YEAR(data_hora) = ? ORDER BY data_hora ASC',
      [funcId, mes, ano]
    );

    const [feriados] = await pool.execute(
      'SELECT * FROM rp_feriados WHERE MONTH(data) = ? AND YEAR(data) = ?',
      [mes, ano]
    );
    const feriadosMap = {};
    feriados.forEach(f => { feriadosMap[moment(f.data).format('YYYY-MM-DD')] = f.descricao; });

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=espelho_ponto_' + func[0].nome.replace(/\s/g, '_') + '_' + mes + '_' + ano + '.pdf');
    doc.pipe(res);

    const pageWidth = 515;
    const mesesNome = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    // ===== CABECALHO COM LOGO E DADOS DA EMPRESA =====
    var logoExists = fs.existsSync(LOGO_PATH);
    if (logoExists) {
      doc.image(LOGO_PATH, 40, 35, { width: 140 });
    }

    var headerX = logoExists ? 195 : 40;
    doc.fontSize(11).font('Helvetica-Bold').text(EMPRESA.nome, headerX, 38);
    doc.fontSize(8).font('Helvetica');
    doc.text('CNPJ: ' + EMPRESA.cnpj, headerX, 53);
    doc.text(EMPRESA.endereco, headerX, 63);
    doc.text(EMPRESA.rua, headerX, 73);
    doc.text(EMPRESA.bairro + ' - ' + EMPRESA.cep, headerX, 83);

    // Linha separadora
    doc.moveTo(40, 100).lineTo(555, 100).lineWidth(1.5).strokeColor('#0D2C64').stroke();

    // ===== TITULO =====
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0D2C64');
    doc.text('ESPELHO DE PONTO', 40, 110, { align: 'center', width: pageWidth });
    doc.fontSize(10).font('Helvetica').fillColor('#333333');
    doc.text('Periodo: ' + mesesNome[mes - 1] + ' de ' + ano, 40, 128, { align: 'center', width: pageWidth });

    // ===== DADOS DO COLABORADOR =====
    var infoY = 148;
    doc.moveTo(40, infoY).lineTo(555, infoY).lineWidth(0.5).strokeColor('#cccccc').stroke();

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#333333');
    doc.text('Colaborador:', 42, infoY + 6);
    doc.font('Helvetica').text(func[0].nome, 110, infoY + 6);

    doc.font('Helvetica-Bold').text('Cargo:', 320, infoY + 6);
    doc.font('Helvetica').text(func[0].cargo || '-', 358, infoY + 6);

    doc.font('Helvetica-Bold').text('Departamento:', 42, infoY + 20);
    doc.font('Helvetica').text(func[0].departamento || '-', 124, infoY + 20);

    doc.font('Helvetica-Bold').text('Jornada Semanal:', 320, infoY + 20);
    doc.font('Helvetica').text(func[0].jornada_semanal + 'h', 418, infoY + 20);

    doc.moveTo(40, infoY + 35).lineTo(555, infoY + 35).lineWidth(0.5).strokeColor('#cccccc').stroke();

    // ===== TABELA DE REGISTROS =====
    var tableTop = infoY + 45;
    var colPos = { data: 42, dia: 90, entrada: 135, saidaAlm: 195, retornoAlm: 270, saida: 345, total: 410, status: 465 };

    // Cabecalho da tabela
    doc.rect(40, tableTop, pageWidth, 16).fill('#0D2C64');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('Data', colPos.data, tableTop + 4);
    doc.text('Dia', colPos.dia, tableTop + 4);
    doc.text('Entrada', colPos.entrada, tableTop + 4);
    doc.text('Saida Alm.', colPos.saidaAlm, tableTop + 4);
    doc.text('Retorno Alm.', colPos.retornoAlm, tableTop + 4);
    doc.text('Saida', colPos.saida, tableTop + 4);
    doc.text('Total', colPos.total, tableTop + 4);
    doc.text('Status', colPos.status, tableTop + 4);

    // Registros por dia
    var porDia = {};
    registros.forEach(function(r) {
      var dia = moment(r.data_hora).format('YYYY-MM-DD');
      if (!porDia[dia]) porDia[dia] = {};
      porDia[dia][r.tipo] = moment(r.data_hora).format('HH:mm');
    });

    var jornadaDiaria = (func[0].jornada_semanal / 5) * 60;
    var diasNoMes = moment(ano + '-' + mes, 'YYYY-MM').daysInMonth();
    var diasSemana = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sab' };

    var y = tableTop + 18;
    var totalGeralMin = 0;
    var totalExtras = 0;
    var totalFaltasPdf = 0;
    var rowIdx = 0;

    for (var d = 1; d <= diasNoMes; d++) {
      if (y > 720) {
        doc.addPage();
        y = 40;
      }

      var diaM = moment(ano + '-' + String(mes).padStart(2, '0') + '-' + String(d).padStart(2, '0'));
      var diaStr = diaM.format('YYYY-MM-DD');
      var ehFds = diaM.day() === 0 || diaM.day() === 6;
      var ehFeriado = !!feriadosMap[diaStr];
      var reg = porDia[diaStr] || {};

      var minutos = 0;
      if (reg.entrada && reg.saida_almoco) minutos += moment(diaStr + ' ' + reg.saida_almoco).diff(moment(diaStr + ' ' + reg.entrada), 'minutes');
      if (reg.retorno_almoco && reg.saida) minutos += moment(diaStr + ' ' + reg.saida).diff(moment(diaStr + ' ' + reg.retorno_almoco), 'minutes');
      if (reg.entrada && reg.saida && !reg.saida_almoco && !reg.retorno_almoco) minutos = moment(diaStr + ' ' + reg.saida).diff(moment(diaStr + ' ' + reg.entrada), 'minutes');
      minutos = Math.max(0, minutos);
      totalGeralMin += minutos;

      if (!ehFds && !ehFeriado) {
        var extra = Math.max(0, minutos - jornadaDiaria);
        totalExtras += extra;
      }

      var statusText = '';
      if (ehFds) statusText = 'FDS';
      else if (ehFeriado) statusText = 'Feriado';
      else if (!reg.entrada && diaM.isBefore(moment())) { statusText = 'Sem Registro'; totalFaltasPdf++; }

      // Fundo alternado
      if (rowIdx % 2 === 0) {
        doc.rect(40, y - 1, pageWidth, 13).fill('#f5f8fc');
      }

      var textColor = (ehFds || ehFeriado) ? '#999999' : '#333333';
      doc.fontSize(7.5).font('Helvetica').fillColor(textColor);

      doc.text(diaM.format('DD/MM'), colPos.data, y + 1);
      doc.text(diasSemana[diaM.day()], colPos.dia, y + 1);
      doc.text(reg.entrada || '-', colPos.entrada, y + 1);
      doc.text(reg.saida_almoco || '-', colPos.saidaAlm, y + 1);
      doc.text(reg.retorno_almoco || '-', colPos.retornoAlm, y + 1);
      doc.text(reg.saida || '-', colPos.saida, y + 1);
      doc.text(minutos > 0 ? formatarMinutos(minutos) : '-', colPos.total, y + 1);

      if (statusText) {
        var statusColor = statusText === 'FDS' ? '#999999' : statusText === 'Feriado' ? '#01AEEF' : '#ed3c0d';
        doc.font('Helvetica-Bold').fillColor(statusColor);
        doc.text(statusText, colPos.status, y + 1);
      }

      y += 13;
      rowIdx++;
    }

    // Linha final da tabela
    doc.moveTo(40, y + 2).lineTo(555, y + 2).lineWidth(0.5).strokeColor('#0D2C64').stroke();

    // ===== RESUMO =====
    var resumoY = y + 12;
    doc.rect(40, resumoY, pageWidth, 45).lineWidth(1).strokeColor('#0D2C64').stroke();

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#0D2C64');
    doc.text('RESUMO DO PERIODO', 50, resumoY + 5);

    doc.fontSize(8).font('Helvetica').fillColor('#333333');
    var jornadaMensal = jornadaDiaria * diasUteisNoMes(mes, ano, feriadosMap);

    doc.text('Total Trabalhado: ' + formatarMinutos(totalGeralMin), 50, resumoY + 18);
    doc.text('Horas Extras: ' + formatarMinutos(totalExtras), 200, resumoY + 18);
    doc.text('Jornada Mensal: ' + formatarMinutos(jornadaMensal), 350, resumoY + 18);

    var saldo = totalGeralMin - jornadaMensal;
    var saldoColor = saldo >= 0 ? '#18d26e' : '#ed3c0d';
    doc.text('Faltas: ' + totalFaltasPdf, 50, resumoY + 31);
    doc.font('Helvetica-Bold').fillColor(saldoColor);
    doc.text('Saldo: ' + (saldo >= 0 ? '+' : '') + formatarMinutos(saldo), 200, resumoY + 31);
    doc.font('Helvetica').fillColor('#333333');
    doc.text('Dias Uteis: ' + diasUteisNoMes(mes, ano, feriadosMap), 350, resumoY + 31);

    // ===== ASSINATURAS (3 campos) =====
    var assY = resumoY + 75;

    if (assY > 690) {
      doc.addPage();
      assY = 60;
    }

    doc.fontSize(8).font('Helvetica').fillColor('#333333');

    // Colaborador
    doc.moveTo(42, assY + 30).lineTo(192, assY + 30).lineWidth(0.5).strokeColor('#333333').stroke();
    doc.text('Colaborador', 42, assY + 34, { width: 150, align: 'center' });
    doc.fontSize(7).text(func[0].nome, 42, assY + 44, { width: 150, align: 'center' });

    // Responsavel
    doc.moveTo(210, assY + 30).lineTo(360, assY + 30).lineWidth(0.5).strokeColor('#333333').stroke();
    doc.fontSize(8).text('Responsavel', 210, assY + 34, { width: 150, align: 'center' });

    // RH
    doc.moveTo(395, assY + 30).lineTo(545, assY + 30).lineWidth(0.5).strokeColor('#333333').stroke();
    doc.fontSize(8).text('Recursos Humanos', 395, assY + 34, { width: 150, align: 'center' });

    // Rodape
    var footerY = assY + 70;
    doc.moveTo(40, footerY).lineTo(555, footerY).lineWidth(0.5).strokeColor('#cccccc').stroke();
    doc.fontSize(6.5).fillColor('#999999');
    doc.text('Documento gerado em ' + moment().format('DD/MM/YYYY [as] HH:mm') + ' - ' + EMPRESA.nome + ' - CNPJ: ' + EMPRESA.cnpj, 40, footerY + 4, { align: 'center', width: pageWidth });
    doc.text('Este documento deve ser assinado pelo colaborador, responsavel e RH para ter validade.', 40, footerY + 13, { align: 'center', width: pageWidth });

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
      'SELECT * FROM rp_registros_ponto WHERE funcionario_id = ? AND MONTH(data_hora) = ? AND YEAR(data_hora) = ? ORDER BY data_hora ASC',
      [funcId, mes, ano]
    );

    const porDia = {};
    registros.forEach(r => {
      const dia = moment(r.data_hora).format('YYYY-MM-DD');
      if (!porDia[dia]) porDia[dia] = {};
      porDia[dia][r.tipo] = moment(r.data_hora).format('HH:mm');
    });

    let csv = 'Data,Entrada,Saida Almoco,Retorno Almoco,Saida,Total Horas\n';
    Object.keys(porDia).sort().forEach(dia => {
      const reg = porDia[dia];
      let minutos = 0;
      if (reg.entrada && reg.saida_almoco) minutos += moment(dia + ' ' + reg.saida_almoco).diff(moment(dia + ' ' + reg.entrada), 'minutes');
      if (reg.retorno_almoco && reg.saida) minutos += moment(dia + ' ' + reg.saida).diff(moment(dia + ' ' + reg.retorno_almoco), 'minutes');
      if (reg.entrada && reg.saida && !reg.saida_almoco && !reg.retorno_almoco) minutos = moment(dia + ' ' + reg.saida).diff(moment(dia + ' ' + reg.entrada), 'minutes');
      csv += moment(dia).format('DD/MM/YYYY') + ',' + (reg.entrada || '-') + ',' + (reg.saida_almoco || '-') + ',' + (reg.retorno_almoco || '-') + ',' + (reg.saida || '-') + ',' + formatarMinutos(Math.max(0, minutos)) + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=ponto_' + func[0].nome.replace(/\s/g, '_') + '_' + mes + '_' + ano + '.csv');
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gerar CSV' });
  }
});

function formatarMinutos(minutos) {
  var h = Math.floor(Math.abs(minutos) / 60);
  var m = Math.abs(minutos) % 60;
  var sinal = minutos < 0 ? '-' : '';
  return sinal + String(h).padStart(2, '0') + ':' + String(Math.round(m)).padStart(2, '0');
}

function diasUteisNoMes(mes, ano, feriadosMap) {
  var count = 0;
  var total = moment(ano + '-' + mes, 'YYYY-MM').daysInMonth();
  for (var d = 1; d <= total; d++) {
    var dia = moment(ano + '-' + String(mes).padStart(2, '0') + '-' + String(d).padStart(2, '0'));
    if (dia.day() !== 0 && dia.day() !== 6 && !feriadosMap[dia.format('YYYY-MM-DD')]) count++;
  }
  return count;
}

module.exports = router;
