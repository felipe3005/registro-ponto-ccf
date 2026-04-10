// Script para criar o usuário admin inicial
const bcrypt = require('bcryptjs');
const { pool, initDatabase } = require('./src/backend/database');

async function seed() {
  try {
    await initDatabase();

    const senhaHash = await bcrypt.hash('admin123', 10);

    await pool.execute(
      `INSERT IGNORE INTO rp_funcionarios (nome, email, senha_hash, cargo, departamento, jornada_semanal, role)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Administrador', 'admin@ccf.com', senhaHash, 'Administrador', 'TI', 44, 'admin']
    );

    console.log('=================================');
    console.log('  Seed executado com sucesso!');
    console.log('=================================');
    console.log('  Email: admin@ccf.com');
    console.log('  Senha: admin123');
    console.log('=================================');

    process.exit(0);
  } catch (err) {
    console.error('Erro no seed:', err);
    process.exit(1);
  }
}

seed();
