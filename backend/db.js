const { Pool } = require('pg');
const os = require('os');

// Conexão sem fricção no ambiente local: por padrão usa o socket Unix do
// PostgreSQL (peer auth — autentica pelo usuário do SO, sem senha) e o próprio
// usuário do sistema. Assim `node server.js` sobe direto, sem exportar nada,
// e funciona para qualquer pessoa que clonar (usa o usuário do SO dela).
// Em outro ambiente (TCP/senha), basta exportar PGHOST/PGUSER/PGPASSWORD/etc.
// Nenhuma credencial fica no código.
// No macOS com Homebrew o socket fica em /tmp; no Linux fica em /var/run/postgresql.
// Detecta automaticamente qual existe, com fallback para TCP localhost.
const { execSync } = require('child_process');
function detectPgHost() {
  if (process.env.PGHOST) return process.env.PGHOST;
  const candidates = ['/tmp', '/var/run/postgresql'];
  for (const dir of candidates) {
    try { require('fs').statSync(`${dir}/.s.PGSQL.5432`); return dir; } catch (_) {}
  }
  return 'localhost';
}

const pool = new Pool({
  host:     detectPgHost(),
  port:     parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'sissa',
  user:     process.env.PGUSER     || os.userInfo().username,
  password: process.env.PGPASSWORD || undefined,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err.message);
});

module.exports = pool;
