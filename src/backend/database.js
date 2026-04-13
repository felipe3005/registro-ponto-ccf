const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT) || 4000,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 20,           // maior para suportar Promise.all paralelo
  queueLimit: 0,
  enableKeepAlive: true,         // reduz custo de reconexão ao TiDB remoto
  keepAliveInitialDelay: 10000,
  ssl: { rejectUnauthorized: true }
});

async function initDatabase() {
  const conn = await pool.getConnection();
  try {
    // Tabela de funcionários
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS rp_funcionarios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        usuario VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(255),
        senha_hash VARCHAR(255) NOT NULL,
        senha_temporaria TINYINT(1) DEFAULT 1,
        cargo VARCHAR(100),
        departamento VARCHAR(100),
        jornada_semanal DECIMAL(5,2) DEFAULT 44.00,
        role ENUM('admin', 'funcionario') DEFAULT 'funcionario',
        ativo TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migração: adicionar colunas novas se tabela já existia sem elas
    const [cols] = await conn.execute(`SHOW COLUMNS FROM rp_funcionarios`);
    const colNames = cols.map(c => c.Field);
    if (!colNames.includes('usuario')) {
      await conn.execute(`ALTER TABLE rp_funcionarios ADD COLUMN usuario VARCHAR(100) AFTER nome`);
      // Gerar usuario a partir do email para registros existentes
      await conn.execute(`UPDATE rp_funcionarios SET usuario = LOWER(REPLACE(SUBSTRING_INDEX(email, '@', 1), ' ', '.')) WHERE usuario IS NULL OR usuario = ''`);
      await conn.execute(`ALTER TABLE rp_funcionarios MODIFY COLUMN usuario VARCHAR(100) NOT NULL`);
      // Tentar adicionar UNIQUE (pode falhar se houver duplicados)
      try { await conn.execute(`ALTER TABLE rp_funcionarios ADD UNIQUE INDEX uk_usuario (usuario)`); } catch(e) {}
    }
    if (!colNames.includes('senha_temporaria')) {
      await conn.execute(`ALTER TABLE rp_funcionarios ADD COLUMN senha_temporaria TINYINT(1) DEFAULT 0 AFTER senha_hash`);
    }

    // Tabela de registros de ponto
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS rp_registros_ponto (
        id INT AUTO_INCREMENT PRIMARY KEY,
        funcionario_id INT NOT NULL,
        tipo ENUM('entrada', 'saida_almoco', 'retorno_almoco', 'saida') NOT NULL,
        data_hora DATETIME NOT NULL,
        ip_origem VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_func_data (funcionario_id, data_hora),
        INDEX idx_data (data_hora),
        INDEX idx_tipo_data (tipo, data_hora)
      )
    `);

    // Migrações: garantir índices novos em bases antigas
    try {
      const [idx] = await conn.execute(`SHOW INDEX FROM rp_registros_ponto`);
      const idxNames = idx.map(i => i.Key_name);
      if (!idxNames.includes('idx_data')) {
        try { await conn.execute(`CREATE INDEX idx_data ON rp_registros_ponto (data_hora)`); } catch(e) {}
      }
      if (!idxNames.includes('idx_tipo_data')) {
        try { await conn.execute(`CREATE INDEX idx_tipo_data ON rp_registros_ponto (tipo, data_hora)`); } catch(e) {}
      }
    } catch(e) {}

    // Tabela de ajustes de ponto
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS rp_ajustes_ponto (
        id INT AUTO_INCREMENT PRIMARY KEY,
        funcionario_id INT NOT NULL,
        data DATE NOT NULL,
        tipo ENUM('entrada', 'saida_almoco', 'retorno_almoco', 'saida') NOT NULL,
        nova_hora TIME NOT NULL,
        motivo TEXT NOT NULL,
        status ENUM('pendente', 'aprovado', 'rejeitado') DEFAULT 'pendente',
        admin_id INT,
        motivo_rejeicao TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabela de atestados
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS rp_atestados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        funcionario_id INT NOT NULL,
        data_inicio DATE NOT NULL,
        data_fim DATE NOT NULL,
        arquivo_path VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabela de feriados
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS rp_feriados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        data DATE NOT NULL UNIQUE,
        descricao VARCHAR(255) NOT NULL
      )
    `);

    // Tabela de perfis de horário
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS rp_perfis_horario (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        hora_entrada TIME NOT NULL,
        hora_saida_almoco TIME,
        hora_retorno_almoco TIME,
        hora_saida TIME NOT NULL,
        dias_trabalho VARCHAR(20) DEFAULT '1,2,3,4,5' COMMENT 'dias da semana: 0=dom,1=seg...6=sab',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migração: adicionar perfil_horario_id em funcionários
    const [colsFunc] = await conn.execute(`SHOW COLUMNS FROM rp_funcionarios`);
    const colNamesFunc = colsFunc.map(c => c.Field);
    if (!colNamesFunc.includes('perfil_horario_id')) {
      await conn.execute(`ALTER TABLE rp_funcionarios ADD COLUMN perfil_horario_id INT AFTER jornada_semanal`);
    }

    // Tabela de configurações de horário (legado - por funcionário/dia)
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS rp_configuracoes_horario (
        id INT AUTO_INCREMENT PRIMARY KEY,
        funcionario_id INT NOT NULL,
        dia_semana TINYINT NOT NULL COMMENT '0=dom, 1=seg, 2=ter, 3=qua, 4=qui, 5=sex, 6=sab',
        hora_entrada TIME,
        hora_saida_almoco TIME,
        hora_retorno_almoco TIME,
        hora_saida TIME,
        UNIQUE KEY uk_func_dia (funcionario_id, dia_semana)
      )
    `);

    // Tabela de abonos
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS rp_abonos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        funcionario_id INT NOT NULL,
        tipo ENUM('atestado', 'abono_horas', 'compensacao') NOT NULL,
        data_inicio DATE NOT NULL,
        data_fim DATE NOT NULL,
        horas DECIMAL(5,2) DEFAULT NULL COMMENT 'horas abonadas (para abono parcial)',
        motivo TEXT NOT NULL,
        arquivo_path VARCHAR(500) DEFAULT NULL,
        status ENUM('pendente', 'aprovado', 'rejeitado') DEFAULT 'pendente',
        admin_id INT DEFAULT NULL,
        motivo_rejeicao TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_abono_func (funcionario_id),
        INDEX idx_abono_status (status)
      )
    `);

    // Tabela de configurações gerais
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS rp_configuracoes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        chave VARCHAR(100) NOT NULL UNIQUE,
        valor VARCHAR(255) NOT NULL
      )
    `);

    // Inserir tolerância padrão se não existir
    await conn.execute(`
      INSERT IGNORE INTO rp_configuracoes (chave, valor) VALUES ('tolerancia_minutos', '10')
    `);

    // Tabela de faltas
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS rp_faltas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        funcionario_id INT NOT NULL,
        data DATE NOT NULL,
        justificativa TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_func_data (funcionario_id, data)
      )
    `);

    console.log('Banco de dados inicializado com sucesso.');
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDatabase };
