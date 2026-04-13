const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT) || 4000,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
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
        INDEX idx_func_data (funcionario_id, data_hora)
      )
    `);

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

    // Tabela de configurações de horário
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
