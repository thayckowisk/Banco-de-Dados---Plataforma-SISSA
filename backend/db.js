const { Pool } = require('pg');
const os = require('os');

// Conexão sem fricção no ambiente local: por padrão usa o socket Unix do
// PostgreSQL (peer auth — autentica pelo usuário do SO, sem senha) e o próprio
// usuário do sistema. Assim `node server.js` sobe direto, sem exportar nada,
// e funciona para qualquer pessoa que clonar (usa o usuário do SO dela).
// Em outro ambiente (TCP/senha), basta exportar PGHOST/PGUSER/PGPASSWORD/etc.
// Nenhuma credencial fica no código.
const pool = new Pool({
  host:     process.env.PGHOST     || '/var/run/postgresql',
  port:     parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'sissa',
  user:     process.env.PGUSER     || os.userInfo().username,
  password: process.env.PGPASSWORD || undefined,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err.message);
});

module.exports = pool;
