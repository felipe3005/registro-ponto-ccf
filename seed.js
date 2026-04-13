// Script para criar o usuário admin inicial
const bcrypt = require('bcryptjs');
const { pool, initDatabase } = require('./src/backend/database');

async function seed() {
  try {
    await initDatabase();

    const senhaHash = await bcrypt.hash('admin123', 10);

    // Verificar se já existe algum admin
    const [admins] = await pool.execute(
      "SELECT id, usuario FROM rp_funcionarios WHERE role = 'admin' LIMIT 1"
    );

    if (admins.length === 0) {
      await pool.execute(
        `INSERT INTO rp_funcionarios (nome, usuario, email, senha_hash, senha_temporaria, cargo, departamento, jornada_semanal, role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['Administrador', 'admin', 'noreply@creditocasafinanciamentos.com.br', senhaHash, 1, 'Administrador', 'TI', 44, 'admin']
      );
      console.log('=================================');
      console.log('  Admin criado com sucesso!');
      console.log('  Usu��rio: admin');
      console.log('  Senha: admin123');
      console.log('  (Troque a senha no primeiro login)');
      console.log('=================================');
    } else {
      console.log('=================================');
      console.log('  Admin já existe (id:', admins[0].id + ')');
      console.log('  Usuário:', admins[0].usuario || '(sem usuario definido)');
      console.log('  Tabelas verificadas com sucesso.');
      console.log('=================================');
    }

    process.exit(0);
  } catch (err) {
    console.error('Erro no seed:', err);
    process.exit(1);
  }
}

seed();
