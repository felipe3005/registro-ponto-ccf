const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Login por usuario
router.post('/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    if (!usuario || !senha) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }

    const [rows] = await pool.execute(
      'SELECT * FROM rp_funcionarios WHERE usuario = ? AND ativo = 1',
      [usuario.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const user = rows[0];
    const senhaValida = await bcrypt.compare(senha, user.senha_hash);
    if (!senhaValida) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { id: user.id, usuario: user.usuario, role: user.role, nome: user.nome },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        nome: user.nome,
        usuario: user.usuario,
        email: user.email,
        role: user.role,
        cargo: user.cargo,
        departamento: user.departamento
      },
      senhaTemporaria: user.senha_temporaria === 1
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Logout (client-side, apenas retorna sucesso)
router.post('/logout', authMiddleware, (req, res) => {
  res.json({ message: 'Logout realizado com sucesso' });
});

// Verificar token
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, nome, usuario, email, cargo, departamento, role, senha_temporaria FROM rp_funcionarios WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Trocar senha (usado na troca obrigatória e na troca voluntária)
router.post('/alterar-senha', authMiddleware, async (req, res) => {
  try {
    const { senhaAtual, novaSenha } = req.body;

    if (!novaSenha || novaSenha.length < 6) {
      return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
    }

    const [rows] = await pool.execute('SELECT senha_hash FROM rp_funcionarios WHERE id = ?', [req.user.id]);

    const valida = await bcrypt.compare(senhaAtual, rows[0].senha_hash);
    if (!valida) {
      return res.status(400).json({ error: 'Senha atual incorreta' });
    }

    const hash = await bcrypt.hash(novaSenha, 10);
    await pool.execute(
      'UPDATE rp_funcionarios SET senha_hash = ?, senha_temporaria = 0 WHERE id = ?',
      [hash, req.user.id]
    );

    res.json({ message: 'Senha alterada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
