const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initDatabase } = require('./database');
const authRoutes = require('./routes/auth');
const funcionariosRoutes = require('./routes/funcionarios');
const pontoRoutes = require('./routes/ponto');
const horasRoutes = require('./routes/horas');
const ajustesRoutes = require('./routes/ajustes');
const relatoriosRoutes = require('./routes/relatorios');
const configuracoesRoutes = require('./routes/configuracoes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));
app.use(express.static(path.join(__dirname, '../frontend')));

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/funcionarios', funcionariosRoutes);
app.use('/api/ponto', pontoRoutes);
app.use('/api/horas', horasRoutes);
app.use('/api/ajustes', ajustesRoutes);
app.use('/api/relatorios', relatoriosRoutes);
app.use('/api/configuracoes', configuracoesRoutes);

// Servir frontend
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

async function startServer(port) {
  await initDatabase();
  const servidor = app.listen(port || process.env.PORT || 3131, () => {
    console.log(`Servidor rodando na porta ${port || process.env.PORT || 3131}`);
  });
  return servidor;
}

module.exports = { app, startServer };
