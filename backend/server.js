const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Serve static frontend
app.use(express.static(
  path.join(__dirname, '..', 'Banco-de-Dados---Plataforma-SISSA')
));

// Routes
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/grupos',   require('./routes/grupos'));

// GET /api/papeis
app.get('/api/papeis', async (req, res) => {
  try {
    const result = await db.query('SELECT id, nome FROM papel ORDER BY nome');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/funcionalidades
app.get('/api/funcionalidades', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT f.id, f.nome,
             cf.nome AS categoria, cf.id AS categoria_id,
             m.nome  AS modulo,    m.id  AS modulo_id
      FROM funcionalidade f
      JOIN categoria_funcionalidade cf ON cf.id = f.categoria_id
      JOIN modulo m                    ON m.id  = cf.modulo_id
      ORDER BY m.nome, cf.nome, f.nome
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/auditoria
app.get('/api/auditoria', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM auditoria ORDER BY data_hora DESC LIMIT 100'
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/engajamento
app.get('/api/engajamento', async (req, res) => {
  try {
    const result = await db.query('SELECT r_nome AS nome, r_email AS email, r_ultimo_acesso AS ultimo_acesso, r_engajamento AS engajamento FROM fu_verificar_engajamento()');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Rota não encontrada' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`SISSA backend running on http://localhost:${PORT}`);
});
