#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SISSA Platform — Comprehensive Test Runner                 ║
 * ║  Tests: DB Functions, Triggers, Views, API Endpoints        ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Pre-requisites:                                            ║
 * ║    1. cd backend && npm install && node server.js           ║
 * ║    2. Database already populated via sql/01-03              ║
 * ║    3. Node.js >= 18 (built-in fetch)                        ║
 * ║  Usage: node test-runner.js                                 ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

// ─── pg resolution (works whether run from root or /backend) ────────────────
let Pool;
for (const p of ['pg', './backend/node_modules/pg', '../node_modules/pg']) {
  try { Pool = require(p).Pool; break; } catch { /* try next */ }
}
if (!Pool) {
  console.error('\n[ERROR] pg module not found. Run: cd backend && npm install\n');
  process.exit(1);
}

// ─── Configuration ───────────────────────────────────────────────────────────
const BASE_URL  = process.env.BASE_URL  || 'http://localhost:3000';
const DB_CONFIG = {
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'sissa',
  user:     process.env.PGUSER     || 'thiagohonoratoferreira',
  password: process.env.PGPASSWORD || '',
};
const POLL_TIMEOUT_MS = 8000; // max wait for server

// ─── ANSI Colors ─────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
  white:  '\x1b[37m',
};
const ok    = (s) => `${C.green}✓${C.reset} ${s}`;
const fail  = (s) => `${C.red}✗${C.reset} ${s}`;
const skip  = (s) => `${C.yellow}⊘${C.reset} ${C.dim}${s}${C.reset}`;
const suite = (s) => `\n${C.bold}${C.cyan}[${s}]${C.reset}`;
const info  = (s) => `${C.dim}  → ${s}${C.reset}`;

// ─── Email Simulator ─────────────────────────────────────────────────────────
const emailLog = [];
const EmailSim = {
  send(to, subject, body) {
    const entry = { to, subject, body, sentAt: new Date().toISOString() };
    emailLog.push(entry);
    console.log(
      `  ${C.magenta}[EMAIL]${C.reset} To: ${C.bold}${to}${C.reset}` +
      ` | Subject: "${subject}"`
    );
  },
  onUserCreated(email) {
    this.send(email, 'Bem-vindo à Plataforma SISSA',
      `Olá! Seu acesso à Plataforma SISSA foi criado com sucesso para ${email}.`);
  },
  onAdminCreated(email, grupo) {
    this.send(email, '[SISSA] Acesso Administrador Concedido',
      `O usuário ${email} foi adicionado ao grupo "${grupo}" com permissões totais.`);
  },
};

// ─── Test Runner State ────────────────────────────────────────────────────────
const results  = [];
const cleanup  = { userIds: [], groupIds: [], groupNames: [] };
let   currentSuite = '';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected)
    throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertIncludes(str, sub, msg) {
  if (!String(str).toLowerCase().includes(String(sub).toLowerCase()))
    throw new Error(msg || `Expected "${str}" to include "${sub}"`);
}
function assertIsArray(val, msg) {
  if (!Array.isArray(val)) throw new Error(msg || `Expected Array, got ${typeof val}`);
}
function assertHasKeys(obj, keys, msg) {
  for (const k of keys)
    if (!(k in obj)) throw new Error(msg || `Missing key "${k}" in object`);
}

async function test(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ suite: currentSuite, name, passed: true, ms });
    console.log(`  ${ok(name)} ${C.dim}(${ms}ms)${C.reset}`);
  } catch (err) {
    const ms = Date.now() - start;
    results.push({ suite: currentSuite, name, passed: false, ms, error: err.message });
    console.log(`  ${fail(name)}`);
    console.log(`    ${C.red}${err.message}${C.reset}`);
  }
}

function startSuite(name) {
  currentSuite = name;
  console.log(suite(name));
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}
const GET    = (p)       => api(p);
const POST   = (p, body) => api(p, { method: 'POST',   body });
const PUT    = (p, body) => api(p, { method: 'PUT',    body });
const DELETE = (p)       => api(p, { method: 'DELETE' });

// ─── DB helpers ───────────────────────────────────────────────────────────────
let pool;
async function q(sql, params = []) {
  return pool.query(sql, params);
}
async function scalar(sql, params = []) {
  const r = await q(sql, params);
  return r.rows[0] ? Object.values(r.rows[0])[0] : null;
}

// ─── Pre-flight: verify server reachable ─────────────────────────────────────
async function waitForServer() {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE_URL}/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═════════════════════════════════════════════════════════════════════════════

// ─── Suite 0: Infrastructure ─────────────────────────────────────────────────
async function suiteInfrastructure() {
  startSuite('Infrastructure');

  await test('HTTP server reachable at ' + BASE_URL, async () => {
    const { status, body } = await GET('/health');
    assertEqual(status, 200);
    assertEqual(body.status, 'ok');
  });

  await test('Database connection established', async () => {
    const r = await q('SELECT 1 AS ping');
    assertEqual(r.rows[0].ping, 1);
  });

  await test('All expected tables exist', async () => {
    const TABLES = [
      'usuario','grupo','papel','modulo',
      'categoria_funcionalidade','funcionalidade',
      'usuario_grupo','usuario_papel','grupo_funcionalidade','auditoria'
    ];
    for (const t of TABLES) {
      const exists = await scalar(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables
                       WHERE table_schema='public' AND table_name=$1)`, [t]
      );
      assert(exists, `Table "${t}" not found`);
    }
  });

  await test('Seed data: at least 13 funcionalidades', async () => {
    const cnt = await scalar('SELECT COUNT(*) FROM funcionalidade');
    assert(parseInt(cnt) >= 13, `Expected ≥13 funcionalidades, got ${cnt}`);
  });

  await test('Seed data: at least 5 usuarios', async () => {
    const cnt = await scalar('SELECT COUNT(*) FROM usuario');
    assert(parseInt(cnt) >= 5, `Expected ≥5 usuarios, got ${cnt}`);
  });
}

// ─── Suite 1: DB Functions — Activity 1 ──────────────────────────────────────
async function suiteDbFunctionsA1() {
  startSuite('DB Functions — Activity 1');

  // Insert a temporary user for tests that need a deletable one
  const tmpEmail = `__test_deletable_${Date.now()}@sissa.test`;
  const tmpIns = await q(
    'INSERT INTO usuario (email) VALUES ($1) RETURNING id', [tmpEmail]
  );
  const tmpId = tmpIns.rows[0].id;
  cleanup.userIds.push(tmpId); // safety net

  // 1. fu_validar_cadastro ─────────────────────────────────────────────────
  await test('fu_validar_cadastro: TRUE for existing email', async () => {
    const r = await scalar(`SELECT fu_validar_cadastro('admin@ufg.br')`);
    assertEqual(r, true);
  });

  await test('fu_validar_cadastro: FALSE for unknown email', async () => {
    const r = await scalar(`SELECT fu_validar_cadastro('nobody@nowhere.test')`);
    assertEqual(r, false);
  });

  await test('fu_validar_cadastro: case-insensitive match', async () => {
    const r = await scalar(`SELECT fu_validar_cadastro('ADMIN@UFG.BR')`);
    assertEqual(r, true);
  });

  // 2. fu_validar_email ─────────────────────────────────────────────────────
  await test('fu_validar_email: accepts valid format (user@domain.com)', async () => {
    const r = await scalar(`SELECT fu_validar_email('user@empresa.com.br')`);
    assertEqual(r, true);
  });

  await test('fu_validar_email: accepts subdomain email', async () => {
    const r = await scalar(`SELECT fu_validar_email('a.b+tag@mail.empresa.org')`);
    assertEqual(r, true);
  });

  await test('fu_validar_email: rejects missing @', async () => {
    const r = await scalar(`SELECT fu_validar_email('notanemail')`);
    assertEqual(r, false);
  });

  await test('fu_validar_email: rejects missing domain', async () => {
    const r = await scalar(`SELECT fu_validar_email('user@')`);
    assertEqual(r, false);
  });

  await test('fu_validar_email: rejects missing TLD', async () => {
    const r = await scalar(`SELECT fu_validar_email('user@domain')`);
    assertEqual(r, false);
  });

  await test('fu_validar_email: rejects empty string', async () => {
    const r = await scalar(`SELECT fu_validar_email('')`);
    assertEqual(r, false);
  });

  // 3. fu_formatar_tempo_acesso ──────────────────────────────────────────────
  await test('fu_formatar_tempo_acesso: NULL → "Nunca acessou"', async () => {
    const r = await scalar(`SELECT fu_formatar_tempo_acesso(NULL)`);
    assertEqual(r, 'Nunca acessou');
  });

  await test('fu_formatar_tempo_acesso: 45s ago → "X segundos"', async () => {
    const r = await scalar(
      `SELECT fu_formatar_tempo_acesso(NOW() - INTERVAL '45 seconds')`
    );
    assertIncludes(r, 'segundo');
  });

  await test('fu_formatar_tempo_acesso: 10min ago → "X minutos"', async () => {
    const r = await scalar(
      `SELECT fu_formatar_tempo_acesso(NOW() - INTERVAL '10 minutes')`
    );
    assertIncludes(r, 'minuto');
  });

  await test('fu_formatar_tempo_acesso: 5h ago → "X horas"', async () => {
    const r = await scalar(
      `SELECT fu_formatar_tempo_acesso(NOW() - INTERVAL '5 hours')`
    );
    assertIncludes(r, 'hora');
  });

  await test('fu_formatar_tempo_acesso: 15d ago → "X dias"', async () => {
    const r = await scalar(
      `SELECT fu_formatar_tempo_acesso(NOW() - INTERVAL '15 days')`
    );
    assertIncludes(r, 'dia');
  });

  await test('fu_formatar_tempo_acesso: 3 months ago → "X meses"', async () => {
    const r = await scalar(
      `SELECT fu_formatar_tempo_acesso(NOW() - INTERVAL '90 days')`
    );
    assertIncludes(r, 'mes');
  });

  await test('fu_formatar_tempo_acesso: 2 years ago → "X anos"', async () => {
    const r = await scalar(
      `SELECT fu_formatar_tempo_acesso(NOW() - INTERVAL '730 days')`
    );
    assertIncludes(r, 'ano');
  });

  await test('fu_formatar_tempo_acesso: singular "1 segundo"', async () => {
    const r = await scalar(
      `SELECT fu_formatar_tempo_acesso(NOW() - INTERVAL '1 second')`
    );
    assertEqual(r, '1 segundo');
  });

  // 4. pr_excluir_usuario ───────────────────────────────────────────────────
  await test('pr_excluir_usuario: FALSE for non-existent ID (999999)', async () => {
    const r = await scalar(`SELECT pr_excluir_usuario(999999)`);
    assertEqual(r, false);
  });

  await test('pr_excluir_usuario: FALSE when user is in Administrador group', async () => {
    // admin@ufg.br (id=1) is in Administrador
    const adminId = await scalar(
      `SELECT id FROM usuario WHERE email='admin@ufg.br'`
    );
    assert(adminId !== null, 'Admin user not found in DB');
    const r = await scalar(`SELECT pr_excluir_usuario(${adminId})`);
    assertEqual(r, false);
  });

  await test('pr_excluir_usuario: TRUE for deletable user', async () => {
    const r = await scalar(`SELECT pr_excluir_usuario(${tmpId})`);
    assertEqual(r, true);
    // Remove from cleanup since it is now gone
    cleanup.userIds = cleanup.userIds.filter(i => i !== tmpId);
  });

  // 5. fu_migrar_usuarios_grupo ─────────────────────────────────────────────
  await test('fu_migrar_usuarios_grupo: raises exception for invalid origin group', async () => {
    let threw = false;
    try {
      await q(`SELECT * FROM fu_migrar_usuarios_grupo('__GHOST__','Administrador')`);
    } catch { threw = true; }
    assert(threw, 'Expected exception for unknown grupo_origem');
  });

  await test('fu_migrar_usuarios_grupo: raises exception for invalid destination group', async () => {
    let threw = false;
    try {
      await q(`SELECT * FROM fu_migrar_usuarios_grupo('Administrador','__GHOST__')`);
    } catch { threw = true; }
    assert(threw, 'Expected exception for unknown grupo_destino');
  });

  await test('fu_migrar_usuarios_grupo: migrates users and returns list', async () => {
    // Create isolated groups and a user for this test
    const { rows: [g1] } = await q(
      `INSERT INTO grupo (nome) VALUES ('__TEST_MIG_ORIGEM_${Date.now()}') RETURNING id, nome`
    );
    const { rows: [g2] } = await q(
      `INSERT INTO grupo (nome) VALUES ('__TEST_MIG_DEST_${Date.now()}') RETURNING id, nome`
    );
    cleanup.groupIds.push(g1.id, g2.id);
    cleanup.groupNames.push(g1.nome, g2.nome);

    const { rows: [u] } = await q(
      `INSERT INTO usuario (email) VALUES ('__mig_${Date.now()}@sissa.test') RETURNING id`
    );
    await q(`INSERT INTO usuario_grupo VALUES ($1,$2)`, [u.id, g1.id]);

    const res = await q(
      `SELECT * FROM fu_migrar_usuarios_grupo($1, $2)`, [g1.nome, g2.nome]
    );
    assert(res.rows.length >= 1, 'Expected at least 1 migrated user');

    // Verify user is now in g2, not g1
    const inG1 = await scalar(
      `SELECT COUNT(*) FROM usuario_grupo WHERE usuario_id=$1 AND grupo_id=$2`,
      [u.id, g1.id]
    );
    const inG2 = await scalar(
      `SELECT COUNT(*) FROM usuario_grupo WHERE usuario_id=$1 AND grupo_id=$2`,
      [u.id, g2.id]
    );
    assertEqual(parseInt(inG1), 0, 'User should have left origin group');
    assertEqual(parseInt(inG2), 1, 'User should be in destination group');

    // Cleanup
    await q(`DELETE FROM usuario_grupo  WHERE usuario_id=$1`, [u.id]);
    await q(`DELETE FROM usuario        WHERE id=$1`,         [u.id]);
    await q(`DELETE FROM grupo          WHERE id=ANY($1::int[])`, [[g1.id, g2.id]]);
    cleanup.groupIds = cleanup.groupIds.filter(id => id !== g1.id && id !== g2.id);
  });

  // 6. pr_copiar_grupo ───────────────────────────────────────────────────────
  await test('pr_copiar_grupo: creates copy and returns enabled permission count', async () => {
    const newName = `__TEST_COPY_${Date.now()}`;
    const r = await scalar(
      `SELECT pr_copiar_grupo('Administrador', $1)`, [newName]
    );
    assert(r !== null, 'Expected integer result');
    assert(parseInt(r) >= 0, 'Expected non-negative integer');
    console.log(info(`pr_copiar_grupo enabled count = ${r}`));

    // Verify the new group was actually created
    const exists = await scalar(
      `SELECT EXISTS(SELECT 1 FROM grupo WHERE nome=$1)`, [newName]
    );
    assertEqual(exists, true, 'New group should exist');
    cleanup.groupNames.push(newName);
  });

  await test('pr_copiar_grupo: raises exception for duplicate target name', async () => {
    let threw = false;
    try {
      await q(`SELECT pr_copiar_grupo('Administrador','Administrador')`);
    } catch { threw = true; }
    assert(threw, 'Expected exception when target group already exists');
  });

  await test('pr_copiar_grupo: raises exception for unknown origin', async () => {
    let threw = false;
    try {
      await q(`SELECT pr_copiar_grupo('__GHOST__GRUPO__','__NEW__')`);
    } catch { threw = true; }
    assert(threw, 'Expected exception for unknown origin group');
  });

  // 7. fu_verificar_engajamento ─────────────────────────────────────────────
  await test('fu_verificar_engajamento: returns classified list', async () => {
    const r = await q(`SELECT * FROM fu_verificar_engajamento()`);
    assertIsArray(r.rows);
    assert(r.rows.length > 0, 'Expected at least one user in engajamento');
    assertHasKeys(r.rows[0], ['r_nome','r_email','r_ultimo_acesso','r_engajamento']);
  });

  await test('fu_verificar_engajamento: Inexistente for NULL access', async () => {
    const r = await q(
      `SELECT * FROM fu_verificar_engajamento() WHERE r_email='guilhermesousa@positivo.com.br'`
    );
    if (r.rows.length > 0) {
      assertEqual(r.rows[0].r_engajamento, 'Inexistente');
    } else {
      console.log(info('User guilhermesousa not in DB, skipping sub-check'));
    }
  });

  await test('fu_verificar_engajamento: Alto for access within 2 days', async () => {
    // Create user with recent access
    const email = `__eng_alto_${Date.now()}@sissa.test`;
    const { rows: [u] } = await q(
      `INSERT INTO usuario (email, ultimo_acesso) VALUES ($1, NOW() - INTERVAL '1 hour') RETURNING id`,
      [email]
    );
    const r = await q(
      `SELECT r_engajamento FROM fu_verificar_engajamento() WHERE r_email=$1`, [email]
    );
    assertEqual(r.rows[0]?.r_engajamento, 'Alto');
    await q(`DELETE FROM usuario WHERE id=$1`, [u.id]);
  });

  await test('fu_verificar_engajamento: valid levels are Alto/Médio/Baixo/Inexistente', async () => {
    const allowed = new Set(['Alto','Médio','Baixo','Inexistente']);
    const r = await q(`SELECT DISTINCT r_engajamento FROM fu_verificar_engajamento()`);
    for (const row of r.rows) {
      assert(allowed.has(row.r_engajamento), `Unexpected level: "${row.r_engajamento}"`);
    }
  });

  // 8. pr_criar_usuario_adm ─────────────────────────────────────────────────
  await test('pr_criar_usuario_adm: creates user and enables all permissions', async () => {
    const testEmail = `__adm_${Date.now()}@sissa.test`;
    const testGrupo = `__ADMGRP_${Date.now()}`;
    await q(`SELECT pr_criar_usuario_adm($1, $2)`, [testEmail, testGrupo]);
    EmailSim.onAdminCreated(testEmail, testGrupo);

    const uExists = await scalar(
      `SELECT EXISTS(SELECT 1 FROM usuario WHERE email=$1)`, [testEmail]
    );
    assertEqual(uExists, true, 'Admin user should exist');

    const gExists = await scalar(
      `SELECT EXISTS(SELECT 1 FROM grupo WHERE nome=$1)`, [testGrupo]
    );
    assertEqual(gExists, true, 'Admin group should exist');

    const enabledCount = await scalar(
      `SELECT COUNT(*) FROM grupo_funcionalidade gf
       JOIN grupo g ON g.id=gf.grupo_id
       WHERE g.nome=$1 AND gf.habilitado=TRUE`, [testGrupo]
    );
    const totalFuncs = await scalar(`SELECT COUNT(*) FROM funcionalidade`);
    assertEqual(parseInt(enabledCount), parseInt(totalFuncs),
      'All functionalities should be enabled for admin group');

    cleanup.groupNames.push(testGrupo);
    const uid = await scalar(`SELECT id FROM usuario WHERE email=$1`, [testEmail]);
    if (uid) cleanup.userIds.push(uid);
  });

  await test('pr_criar_usuario_adm: does not duplicate an existing user', async () => {
    const countBefore = await scalar(
      `SELECT COUNT(*) FROM usuario WHERE email='admin@ufg.br'`
    );
    await q(`SELECT pr_criar_usuario_adm('admin@ufg.br','Administrador')`);
    const countAfter = await scalar(
      `SELECT COUNT(*) FROM usuario WHERE email='admin@ufg.br'`
    );
    assertEqual(parseInt(countBefore), parseInt(countAfter),
      'User count should not increase for existing email');
  });
}

// ─── Suite 2: Triggers & Audit — Activity 2 ──────────────────────────────────
async function suiteTriggersAudit() {
  startSuite('DB Triggers & Audit — Activity 2');

  await test('tg_fn_auditoria: INSERT on usuario logged in auditoria', async () => {
    const auditBefore = await scalar(
      `SELECT COUNT(*) FROM auditoria WHERE nome_entidade='usuario' AND operacao='INSERT'`
    );
    const email = `__audit_ins_${Date.now()}@sissa.test`;
    const { rows: [u] } = await q(
      `INSERT INTO usuario (email) VALUES ($1) RETURNING id`, [email]
    );

    const auditAfter = await scalar(
      `SELECT COUNT(*) FROM auditoria WHERE nome_entidade='usuario' AND operacao='INSERT'`
    );
    assert(parseInt(auditAfter) > parseInt(auditBefore), 'Expected new INSERT audit entry');

    // cleanup immediately (trigger will fire delete audit too)
    await q(`DELETE FROM usuario WHERE id=$1`, [u.id]);
  });

  await test('tg_fn_auditoria: DELETE on usuario logged in auditoria', async () => {
    const email = `__audit_del_${Date.now()}@sissa.test`;
    const { rows: [u] } = await q(
      `INSERT INTO usuario (email) VALUES ($1) RETURNING id`, [email]
    );

    const auditBefore = await scalar(
      `SELECT COUNT(*) FROM auditoria WHERE nome_entidade='usuario' AND operacao='DELETE'`
    );
    await q(`DELETE FROM usuario WHERE id=$1`, [u.id]);
    const auditAfter = await scalar(
      `SELECT COUNT(*) FROM auditoria WHERE nome_entidade='usuario' AND operacao='DELETE'`
    );
    assert(parseInt(auditAfter) > parseInt(auditBefore), 'Expected new DELETE audit entry');
  });

  await test('tg_fn_auditoria: UPDATE on grupo logged in auditoria', async () => {
    const gid = await scalar(`SELECT id FROM grupo WHERE nome='Seleção de editais'`);
    if (!gid) { console.log(info('Grupo not found, skipping')); return; }

    const auditBefore = await scalar(
      `SELECT COUNT(*) FROM auditoria WHERE nome_entidade='grupo' AND operacao='UPDATE'`
    );
    await q(`UPDATE grupo SET nome='Seleção de editais' WHERE id=$1`, [gid]); // same value, still fires trigger
    const auditAfter = await scalar(
      `SELECT COUNT(*) FROM auditoria WHERE nome_entidade='grupo' AND operacao='UPDATE'`
    );
    assert(parseInt(auditAfter) > parseInt(auditBefore), 'Expected new UPDATE audit entry for grupo');
  });

  await test('tg_fn_auditoria: tracks all 9 monitored tables', async () => {
    const tables = [
      'modulo','categoria_funcionalidade','funcionalidade',
      'usuario','grupo','papel',
      'usuario_grupo','usuario_papel','grupo_funcionalidade'
    ];
    for (const t of tables) {
      const cnt = await scalar(
        `SELECT COUNT(*) FROM auditoria WHERE nome_entidade=$1`, [t]
      );
      assert(parseInt(cnt) >= 0, `Table ${t} should be in auditoria schema`);
      // If seed ran, at least modulo/funcionalidade/etc will have entries
    }
  });

  await test('tg_acionar_remocao_dependencia: removes usuario_grupo before delete', async () => {
    // Setup: user in a group
    const email = `__trig_${Date.now()}@sissa.test`;
    const { rows: [u] } = await q(
      `INSERT INTO usuario (email) VALUES ($1) RETURNING id`, [email]
    );
    const gid = await scalar(`SELECT id FROM grupo WHERE nome='Seleção de editais'`);
    if (gid) {
      await q(`INSERT INTO usuario_grupo VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u.id, gid]);
    }

    // Delete user (trigger fires first, removes FK deps)
    await q(`DELETE FROM usuario WHERE id=$1`, [u.id]);

    // After delete, row should be gone from usuario_grupo
    const remaining = await scalar(
      `SELECT COUNT(*) FROM usuario_grupo WHERE usuario_id=$1`, [u.id]
    );
    assertEqual(parseInt(remaining), 0,
      'usuario_grupo rows should be removed by trigger before user delete');
  });

  await test('tg_acionar_remocao_dependencia: removes usuario_papel before delete', async () => {
    const email = `__trig_papel_${Date.now()}@sissa.test`;
    const { rows: [u] } = await q(
      `INSERT INTO usuario (email) VALUES ($1) RETURNING id`, [email]
    );
    const pid = await scalar(`SELECT id FROM papel LIMIT 1`);
    if (pid) {
      await q(`INSERT INTO usuario_papel VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u.id, pid]);
    }

    await q(`DELETE FROM usuario WHERE id=$1`, [u.id]);

    const remaining = await scalar(
      `SELECT COUNT(*) FROM usuario_papel WHERE usuario_id=$1`, [u.id]
    );
    assertEqual(parseInt(remaining), 0,
      'usuario_papel rows should be removed by trigger before user delete');
  });

  await test('pr_remover_dependencia_usuario: directly clears linkages', async () => {
    const email = `__rem_dep_${Date.now()}@sissa.test`;
    const { rows: [u] } = await q(
      `INSERT INTO usuario (email) VALUES ($1) RETURNING id`, [email]
    );
    const gid = await scalar(`SELECT id FROM grupo WHERE nome='Contas a receber'`);
    const pid = await scalar(`SELECT id FROM papel LIMIT 1`);
    if (gid) await q(`INSERT INTO usuario_grupo VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u.id, gid]);
    if (pid) await q(`INSERT INTO usuario_papel VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u.id, pid]);

    await q(`SELECT pr_remover_dependencia_usuario($1)`, [u.id]);

    const g = await scalar(`SELECT COUNT(*) FROM usuario_grupo WHERE usuario_id=$1`, [u.id]);
    const p = await scalar(`SELECT COUNT(*) FROM usuario_papel WHERE usuario_id=$1`, [u.id]);
    assertEqual(parseInt(g), 0, 'usuario_grupo should be cleared');
    assertEqual(parseInt(p), 0, 'usuario_papel should be cleared');

    await q(`DELETE FROM usuario WHERE id=$1`, [u.id]);
  });
}

// ─── Suite 3: Views — Activity 2 ─────────────────────────────────────────────
async function suiteViews() {
  startSuite('DB Views & Materialized Views — Activity 2');

  const VIEW_COLS_USUARIO  = ['id','email','nome','ultimo_acesso','ultimo_acesso_fmt','grupos','papeis'];
  const VIEW_COLS_GRUPO    = ['id','nome','total_permissoes','total_usuarios'];
  const VIEW_COLS_PERMS    = ['grupo_id','grupo_nome','modulo','categoria','funcionalidade_id','funcionalidade','habilitado'];

  await test('vw_consulta_usuario: correct columns and has rows', async () => {
    const r = await q(`SELECT * FROM vw_consulta_usuario LIMIT 1`);
    assert(r.rows.length > 0, 'View should have rows');
    assertHasKeys(r.rows[0], VIEW_COLS_USUARIO);
  });

  await test('vwm_consulta_usuario (materialized): correct columns and has rows', async () => {
    const r = await q(`SELECT * FROM vwm_consulta_usuario LIMIT 1`);
    assert(r.rows.length > 0, 'Materialized view should have rows');
    assertHasKeys(r.rows[0], VIEW_COLS_USUARIO);
  });

  await test('vw_consulta_usuario: ultimo_acesso_fmt is not empty string', async () => {
    const r = await q(`SELECT ultimo_acesso_fmt FROM vw_consulta_usuario LIMIT 5`);
    for (const row of r.rows) {
      assert(
        typeof row.ultimo_acesso_fmt === 'string' && row.ultimo_acesso_fmt.length > 0,
        `ultimo_acesso_fmt should be non-empty, got: "${row.ultimo_acesso_fmt}"`
      );
    }
  });

  await test('vw_consulta_grupo: correct columns and has rows', async () => {
    const r = await q(`SELECT * FROM vw_consulta_grupo LIMIT 1`);
    assert(r.rows.length > 0, 'View should have rows');
    assertHasKeys(r.rows[0], VIEW_COLS_GRUPO);
  });

  await test('vmw_consulta_grupo (materialized): correct columns and has rows', async () => {
    const r = await q(`SELECT * FROM vmw_consulta_grupo LIMIT 1`);
    assert(r.rows.length > 0, 'Materialized view should have rows');
    assertHasKeys(r.rows[0], VIEW_COLS_GRUPO);
  });

  await test('vw_consulta_grupo: total_permissoes is numeric', async () => {
    const r = await q(`SELECT total_permissoes FROM vw_consulta_grupo`);
    for (const row of r.rows) {
      assert(!isNaN(parseInt(row.total_permissoes)), 'total_permissoes must be numeric');
    }
  });

  await test('vw_consulta_permissoes_grupo: cross join covers all groups × funcionalidades', async () => {
    const totalGroups = await scalar(`SELECT COUNT(*) FROM grupo`);
    const totalFuncs  = await scalar(`SELECT COUNT(*) FROM funcionalidade`);
    const expected    = parseInt(totalGroups) * parseInt(totalFuncs);
    const actual      = await scalar(`SELECT COUNT(*) FROM vw_consulta_permissoes_grupo`);
    assertEqual(parseInt(actual), expected,
      `Expected ${expected} rows (${totalGroups}g × ${totalFuncs}f), got ${actual}`
    );
  });

  await test('vmw_consulta_permissoes_grupo (materialized): correct columns', async () => {
    const r = await q(`SELECT * FROM vmw_consulta_permissoes_grupo LIMIT 1`);
    assert(r.rows.length > 0, 'Materialized view should have rows');
    assertHasKeys(r.rows[0], VIEW_COLS_PERMS);
  });

  await test('vw_consulta_permissoes_grupo: habilitado is boolean', async () => {
    const r = await q(`SELECT habilitado FROM vw_consulta_permissoes_grupo LIMIT 10`);
    for (const row of r.rows) {
      assert(
        row.habilitado === true || row.habilitado === false,
        `habilitado must be boolean, got ${typeof row.habilitado}`
      );
    }
  });
}

// ─── Suite 4: API — Infrastructure ───────────────────────────────────────────
async function suiteApiInfra() {
  startSuite('API — Infrastructure Endpoints');

  await test('GET /health → 200 { status: "ok" }', async () => {
    const { status, body } = await GET('/health');
    assertEqual(status, 200);
    assertEqual(body.status, 'ok');
    assert('timestamp' in body, 'Missing timestamp');
  });

  await test('GET /api/papeis → array with items', async () => {
    const { status, body } = await GET('/api/papeis');
    assertEqual(status, 200);
    assert(body.success);
    assertIsArray(body.data);
    assert(body.data.length > 0, 'Expected at least one papel');
    assertHasKeys(body.data[0], ['id','nome']);
  });

  await test('GET /api/funcionalidades → array with modulo info', async () => {
    const { status, body } = await GET('/api/funcionalidades');
    assertEqual(status, 200);
    assertIsArray(body.data);
    assert(body.data.length >= 13, `Expected ≥13 funcionalidades, got ${body.data.length}`);
    assertHasKeys(body.data[0], ['id','nome','categoria','modulo']);
  });

  await test('GET /api/auditoria → array', async () => {
    const { status, body } = await GET('/api/auditoria');
    assertEqual(status, 200);
    assertIsArray(body.data);
  });

  await test('GET /api/engajamento → classified list', async () => {
    const { status, body } = await GET('/api/engajamento');
    assertEqual(status, 200);
    assertIsArray(body.data);
    assert(body.data.length > 0);
    assertHasKeys(body.data[0], ['nome','email','ultimo_acesso','engajamento']);
  });

  await test('GET /nonexistent → 404 JSON', async () => {
    const { status, body } = await GET('/api/__route_does_not_exist__');
    assertEqual(status, 404);
    assertEqual(body.success, false);
  });
}

// ─── Suite 5: API — Usuarios ──────────────────────────────────────────────────
async function suiteApiUsuarios() {
  startSuite('API — /api/usuarios');

  let createdUserId = null;
  const testEmail = `__apitest_${Date.now()}@sissa.test`;

  // Refresh materialized views so they reflect any direct DB changes from previous test suites
  await q(`REFRESH MATERIALIZED VIEW CONCURRENTLY vwm_consulta_usuario`);
  await q(`REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_grupo`);
  await q(`REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_permissoes_grupo`);

  // Need an existing non-admin group ID — query the real table to avoid stale mat view
  const gRow = await q(`SELECT id, nome FROM grupo WHERE LOWER(nome) != 'administrador' ORDER BY id LIMIT 1`);
  const firstGrupo = gRow.rows[0];
  assert(firstGrupo, 'Need at least one non-admin group to run user API tests');

  // Need a papel ID
  const { body: pBody } = await GET('/api/papeis');
  const firstPapel = pBody.data?.[0];

  // ── LIST & SEARCH ──────────────────────────────────────────────────────────
  await test('GET /api/usuarios → 200, array', async () => {
    const { status, body } = await GET('/api/usuarios');
    assertEqual(status, 200);
    assert(body.success);
    assertIsArray(body.data);
  });

  await test('GET /api/usuarios?search=adailton → filtered result', async () => {
    const { status, body } = await GET('/api/usuarios?search=adailton');
    assertEqual(status, 200);
    for (const u of body.data) {
      assert(
        u.email.toLowerCase().includes('adailton') ||
        (u.nome || '').toLowerCase().includes('adailton'),
        `Unexpected result in search: ${u.email}`
      );
    }
  });

  await test('GET /api/usuarios?search=__NOMATCH__ → empty array', async () => {
    const { status, body } = await GET('/api/usuarios?search=__NOMATCH_XYZ_99999__');
    assertEqual(status, 200);
    assertIsArray(body.data);
    assertEqual(body.data.length, 0, 'Search should return empty for unknown term');
  });

  // ── GET by ID ──────────────────────────────────────────────────────────────
  await test('GET /api/usuarios/:id → 200 with correct user', async () => {
    // Use admin@ufg.br which is guaranteed to exist (seed data)
    const adminId = await scalar(`SELECT id FROM usuario WHERE email='admin@ufg.br'`);
    assert(adminId, 'Admin user must exist');
    const { status, body } = await GET(`/api/usuarios/${adminId}`);
    assertEqual(status, 200, `Expected 200, got ${status}`);
    assertEqual(body.data.id, adminId);
    assertHasKeys(body.data, ['id','email','grupos','papeis','ultimo_acesso_fmt']);
  });

  await test('GET /api/usuarios/999999 → 404', async () => {
    const { status, body } = await GET('/api/usuarios/999999');
    assertEqual(status, 404);
    assertEqual(body.success, false);
  });

  // ── ENGAJAMENTO ────────────────────────────────────────────────────────────
  await test('GET /api/usuarios/engajamento/lista → 200 classified list', async () => {
    const { status, body } = await GET('/api/usuarios/engajamento/lista');
    assertEqual(status, 200);
    assert(body.success);
    assertIsArray(body.data);
    if (body.data.length > 0) {
      assertHasKeys(body.data[0], ['nome','email','engajamento']);
    }
  });

  // ── CREATE ─────────────────────────────────────────────────────────────────
  await test('POST /api/usuarios → 400 for invalid email format', async () => {
    const { status, body } = await POST('/api/usuarios', {
      email: 'not-an-email',
      grupo_ids: [firstGrupo.id],
    });
    assertEqual(status, 400);
    assertEqual(body.success, false);
    assertIncludes(body.error, 'inválido');
  });

  await test('POST /api/usuarios → 400 when no group provided', async () => {
    const { status, body } = await POST('/api/usuarios', {
      email: 'valid@email.com',
      grupo_ids: [],
    });
    assertEqual(status, 400);
    assertEqual(body.success, false);
  });

  await test('POST /api/usuarios → 201 created (with email simulation)', async () => {
    const payload = {
      email: testEmail,
      grupo_ids: [firstGrupo.id],
      papel_ids: firstPapel ? [firstPapel.id] : [],
    };
    const { status, body } = await POST('/api/usuarios', payload);
    assertEqual(status, 201, `Expected 201, got ${status}: ${body.error}`);
    assert(body.success);
    assert(body.data?.id, 'Should return new user id');
    createdUserId = body.data.id;
    cleanup.userIds.push(createdUserId);
    // Simulate welcome email
    EmailSim.onUserCreated(testEmail);
  });

  await test('POST /api/usuarios → 409 for duplicate email', async () => {
    const { status, body } = await POST('/api/usuarios', {
      email: testEmail,
      grupo_ids: [firstGrupo.id],
    });
    assertEqual(status, 409, `Expected 409, got ${status}`);
    assertEqual(body.success, false);
  });

  // ── UPDATE ─────────────────────────────────────────────────────────────────
  await test('PUT /api/usuarios/:id → 200 updated email', async () => {
    assert(createdUserId, 'Need created user from previous test');
    const updatedEmail = `__updated_${Date.now()}@sissa.test`;
    const { status, body } = await PUT(`/api/usuarios/${createdUserId}`, {
      email: updatedEmail,
      grupo_ids: [firstGrupo.id],
    });
    assertEqual(status, 200, `Expected 200, got ${status}: ${body.error}`);
    assert(body.success);

    // Verify via DB
    const newEmail = await scalar(
      `SELECT email FROM usuario WHERE id=$1`, [createdUserId]
    );
    assertEqual(newEmail, updatedEmail, 'Email should be updated in DB');
  });

  await test('PUT /api/usuarios/999999 → 404', async () => {
    const { status, body } = await PUT('/api/usuarios/999999', {
      email: 'x@x.com',
      grupo_ids: [firstGrupo.id],
    });
    assertEqual(status, 404);
    assertEqual(body.success, false);
  });

  // ── DELETE ─────────────────────────────────────────────────────────────────
  await test('DELETE /api/usuarios/:id → 403 for admin user', async () => {
    const adminId = await scalar(`SELECT id FROM usuario WHERE email='admin@ufg.br'`);
    assert(adminId, 'Admin user must exist');
    const { status, body } = await DELETE(`/api/usuarios/${adminId}`);
    assertEqual(status, 403, `Expected 403, got ${status}`);
    assertEqual(body.success, false);
  });

  await test('DELETE /api/usuarios/:id → 200 deleted', async () => {
    assert(createdUserId, 'Need created user from previous test');
    const { status, body } = await DELETE(`/api/usuarios/${createdUserId}`);
    assertEqual(status, 200, `Expected 200, got ${status}: ${body.error}`);
    assert(body.success);
    cleanup.userIds = cleanup.userIds.filter(i => i !== createdUserId);
    createdUserId = null;
  });

  // ── MIGRAR ─────────────────────────────────────────────────────────────────
  await test('POST /api/usuarios/migrar → 400 missing fields', async () => {
    const { status, body } = await POST('/api/usuarios/migrar', {});
    assertEqual(status, 400);
    assertEqual(body.success, false);
  });

  await test('POST /api/usuarios/migrar → 400 for invalid group', async () => {
    const { status, body } = await POST('/api/usuarios/migrar', {
      grupo_origem:  '__INVALID_ORIGIN__',
      grupo_destino: 'Administrador',
    });
    assert(status >= 400, `Expected 4xx, got ${status}`);
    assertEqual(body.success, false);
  });

  // ── ADMIN ──────────────────────────────────────────────────────────────────
  await test('POST /api/usuarios/admin → 200 (idempotent re-call)', async () => {
    const { status, body } = await POST('/api/usuarios/admin', {
      email: 'admin@ufg.br',
      nome_grupo: 'Administrador',
    });
    assertEqual(status, 200);
    assert(body.success);
    EmailSim.onAdminCreated('admin@ufg.br', 'Administrador');
  });
}

// ─── Suite 6: API — Grupos ────────────────────────────────────────────────────
async function suiteApiGrupos() {
  startSuite('API — /api/grupos');

  let createdGrupoId   = null;
  let createdGrupoNome = `__APIGRP_${Date.now()}`;

  // Need funcionalidade ids
  const { body: funcBody } = await GET('/api/funcionalidades');
  const allFuncs = funcBody.data || [];

  // ── LIST & SEARCH ──────────────────────────────────────────────────────────
  await test('GET /api/grupos → 200, array with expected columns', async () => {
    const { status, body } = await GET('/api/grupos');
    assertEqual(status, 200);
    assert(body.success);
    assertIsArray(body.data);
    assert(body.data.length > 0);
    assertHasKeys(body.data[0], ['id','nome','total_permissoes','total_usuarios']);
  });

  await test('GET /api/grupos?search=admin → filtered result', async () => {
    const { status, body } = await GET('/api/grupos?search=admin');
    assertEqual(status, 200);
    for (const g of body.data) {
      assertIncludes(g.nome.toLowerCase(), 'admin');
    }
  });

  // ── CREATE ─────────────────────────────────────────────────────────────────
  await test('POST /api/grupos → 400 missing name', async () => {
    const { status, body } = await POST('/api/grupos', { nome: '', permissoes: [] });
    assertEqual(status, 400);
    assertEqual(body.success, false);
  });

  await test('POST /api/grupos → 201 created', async () => {
    const permissoes = allFuncs.slice(0, 3).map(f => ({
      funcionalidade_id: f.id, habilitado: true
    }));
    const { status, body } = await POST('/api/grupos', {
      nome: createdGrupoNome,
      permissoes,
      usuario_ids: [],
    });
    assertEqual(status, 201, `Expected 201, got ${status}: ${body.error}`);
    assert(body.success);
    assert(body.data?.id);
    createdGrupoId = body.data.id;
    cleanup.groupIds.push(createdGrupoId);

    // Verify permissions in DB
    const cnt = await scalar(
      `SELECT COUNT(*) FROM grupo_funcionalidade WHERE grupo_id=$1 AND habilitado=TRUE`,
      [createdGrupoId]
    );
    assertEqual(parseInt(cnt), 3, 'Should have 3 enabled permissions');
  });

  await test('POST /api/grupos → 409 for duplicate name', async () => {
    const { status, body } = await POST('/api/grupos', {
      nome: createdGrupoNome, permissoes: [], usuario_ids: [],
    });
    assertEqual(status, 409);
    assertEqual(body.success, false);
  });

  // ── GET by ID ──────────────────────────────────────────────────────────────
  await test('GET /api/grupos/:id → 200 with permissoes and usuarios', async () => {
    assert(createdGrupoId, 'Need created group from previous test');
    const { status, body } = await GET(`/api/grupos/${createdGrupoId}`);
    assertEqual(status, 200, `Expected 200, got ${status}: ${body.error}`);
    assertHasKeys(body.data, ['id','nome','total_permissoes','total_usuarios','permissoes','usuarios']);
    assertIsArray(body.data.permissoes);
    assertIsArray(body.data.usuarios);
  });

  await test('GET /api/grupos/999999 → 404', async () => {
    const { status, body } = await GET('/api/grupos/999999');
    assertEqual(status, 404);
    assertEqual(body.success, false);
  });

  // ── PERMISSIONS MATRIX ─────────────────────────────────────────────────────
  await test('GET /api/grupos/permissoes/:id → 200 full permission matrix', async () => {
    assert(createdGrupoId, 'Need created group');
    const { status, body } = await GET(`/api/grupos/permissoes/${createdGrupoId}`);
    assertEqual(status, 200);
    assertIsArray(body.data);
    // Since POST /grupos inserts all funcs, this should equal all funcionalidades
    assert(body.data.length >= allFuncs.length,
      `Expected ≥${allFuncs.length} rows, got ${body.data.length}`);
    assertHasKeys(body.data[0], ['funcionalidade','habilitado']);
  });

  // ── UPDATE ─────────────────────────────────────────────────────────────────
  await test('PUT /api/grupos/:id → 200 updated name and permissions', async () => {
    assert(createdGrupoId, 'Need created group');
    const newNome = `__APIGRP_UPDT_${Date.now()}`;
    const permissoes = allFuncs.slice(0, 5).map(f => ({
      funcionalidade_id: f.id, habilitado: true
    }));
    const { status, body } = await PUT(`/api/grupos/${createdGrupoId}`, {
      nome: newNome,
      permissoes,
      usuario_ids: [],
    });
    assertEqual(status, 200, `Expected 200, got ${status}: ${body.error}`);
    assert(body.success);
    createdGrupoNome = newNome; // track updated name

    const nameInDb = await scalar(`SELECT nome FROM grupo WHERE id=$1`, [createdGrupoId]);
    assertEqual(nameInDb, newNome, 'Group name should be updated in DB');
  });

  await test('PUT /api/grupos/999999 → 404', async () => {
    const { status, body } = await PUT('/api/grupos/999999', {
      nome: 'ghost', permissoes: [], usuario_ids: [],
    });
    assertEqual(status, 404);
    assertEqual(body.success, false);
  });

  // ── COPIAR ─────────────────────────────────────────────────────────────────
  await test('POST /api/grupos/copiar → 400 missing fields', async () => {
    const { status, body } = await POST('/api/grupos/copiar', {});
    assertEqual(status, 400);
    assertEqual(body.success, false);
  });

  await test('POST /api/grupos/copiar → 200 creates copy', async () => {
    const novaNome = `__COPY_${Date.now()}`;
    const { status, body } = await POST('/api/grupos/copiar', {
      grupo_origem: 'Administrador',
      novo_grupo:   novaNome,
    });
    assertEqual(status, 200, `Expected 200, got ${status}: ${body.error}`);
    assert(body.success);
    assert('total_habilitadas' in body.data, 'Should return total_habilitadas');
    cleanup.groupNames.push(novaNome);
    console.log(info(`Copied group enabled permissions: ${body.data.total_habilitadas}`));
  });

  // ── DELETE ─────────────────────────────────────────────────────────────────
  await test('DELETE /api/grupos/:id → 403 when users are linked', async () => {
    // Create group, add a user to it, then try to delete
    const gName = `__DEL_GUARD_${Date.now()}`;
    const { body: gIns } = await POST('/api/grupos', { nome: gName, permissoes: [], usuario_ids: [] });
    const gid = gIns.data.id;

    // Link a user directly in DB
    const uid = await scalar(`SELECT id FROM usuario WHERE email='admin@ufg.br'`);
    await q(`INSERT INTO usuario_grupo VALUES ($1,$2) ON CONFLICT DO NOTHING`, [uid, gid]);

    const { status, body } = await DELETE(`/api/grupos/${gid}`);
    assertEqual(status, 403, `Expected 403 (users linked), got ${status}`);
    assertEqual(body.success, false);

    // Cleanup: remove user link, then the group
    await q(`DELETE FROM usuario_grupo WHERE grupo_id=$1`, [gid]);
    await q(`DELETE FROM grupo_funcionalidade WHERE grupo_id=$1`, [gid]);
    await q(`DELETE FROM grupo WHERE id=$1`, [gid]);
  });

  await test('DELETE /api/grupos/:id → 200 deleted', async () => {
    assert(createdGrupoId, 'Need created group');
    const { status, body } = await DELETE(`/api/grupos/${createdGrupoId}`);
    assertEqual(status, 200, `Expected 200, got ${status}: ${body.error}`);
    assert(body.success);
    cleanup.groupIds = cleanup.groupIds.filter(i => i !== createdGrupoId);
    createdGrupoId = null;
  });

  await test('DELETE /api/grupos/999999 → 404', async () => {
    const { status, body } = await DELETE('/api/grupos/999999');
    assertEqual(status, 404);
    assertEqual(body.success, false);
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
async function runCleanup() {
  console.log(`\n${C.dim}─── Cleanup ─────────────────────────────────────────${C.reset}`);
  try {
    // Remove leftover test users
    for (const id of cleanup.userIds) {
      await q(`DELETE FROM usuario_grupo  WHERE usuario_id=$1`, [id]);
      await q(`DELETE FROM usuario_papel  WHERE usuario_id=$1`, [id]);
      await q(`DELETE FROM usuario        WHERE id=$1`,          [id]);
    }
    // Remove leftover test groups (by ID)
    for (const id of cleanup.groupIds) {
      await q(`DELETE FROM usuario_grupo       WHERE grupo_id=$1`, [id]);
      await q(`DELETE FROM grupo_funcionalidade WHERE grupo_id=$1`, [id]);
      await q(`DELETE FROM grupo               WHERE id=$1`,        [id]);
    }
    // Remove leftover test groups (by name pattern)
    await q(`
      DELETE FROM grupo_funcionalidade
      WHERE grupo_id IN (SELECT id FROM grupo WHERE nome LIKE '__TEST%' OR nome LIKE '__COPY%' OR nome LIKE '__APIGRP%' OR nome LIKE '__ADMGRP%' OR nome LIKE '__DEL%')
    `);
    await q(`DELETE FROM grupo WHERE nome LIKE '__TEST%' OR nome LIKE '__COPY%' OR nome LIKE '__APIGRP%' OR nome LIKE '__ADMGRP%' OR nome LIKE '__DEL%'`);
    // Remove leftover test users (by email pattern)
    await q(`DELETE FROM usuario WHERE email LIKE '__@%.%' OR email LIKE '__%@sissa.test' OR email LIKE '__api%'`);

    console.log(`  ${ok('Test data cleaned up')}`);
  } catch (err) {
    console.log(`  ${fail('Cleanup partial: ' + err.message)}`);
  }
}

// ─── Final Report ─────────────────────────────────────────────────────────────
function printReport(totalMs) {
  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);

  console.log(`\n${'═'.repeat(62)}`);
  console.log(`${C.bold}  SISSA TEST REPORT${C.reset}`);
  console.log(`${'═'.repeat(62)}`);

  // By suite
  const suites = [...new Set(results.map(r => r.suite))];
  for (const s of suites) {
    const sr  = results.filter(r => r.suite === s);
    const sp  = sr.filter(r => r.passed).length;
    const sf  = sr.length - sp;
    const icon = sf > 0 ? C.red + '✗' + C.reset : C.green + '✓' + C.reset;
    console.log(`  ${icon}  ${C.bold}${s}${C.reset} — ${sp}/${sr.length} passed`);
  }

  console.log(`\n${'─'.repeat(62)}`);

  if (failed.length > 0) {
    console.log(`\n${C.red}${C.bold}  FAILED TESTS:${C.reset}`);
    for (const r of failed) {
      console.log(`  ${C.red}✗${C.reset} [${r.suite}] ${r.name}`);
      console.log(`    ${C.dim}→ ${r.error}${C.reset}`);
    }
    console.log('');
  }

  console.log(`${'─'.repeat(62)}`);
  console.log(
    `  ${C.bold}Total:${C.reset}   ${results.length} tests`
  );
  console.log(
    `  ${C.green}${C.bold}Passed:${C.reset}  ${passed.length}`
  );
  if (failed.length > 0) {
    console.log(`  ${C.red}${C.bold}Failed:${C.reset}  ${failed.length}`);
  }
  console.log(`  ${C.dim}Duration: ${(totalMs / 1000).toFixed(2)}s${C.reset}`);

  if (emailLog.length > 0) {
    console.log(`\n${C.magenta}${C.bold}  EMAIL SIMULATION LOG (${emailLog.length} emails):${C.reset}`);
    for (const e of emailLog) {
      console.log(`  ${C.magenta}→${C.reset} [${e.sentAt}] To: ${e.to} | "${e.subject}"`);
    }
  }

  console.log(`${'═'.repeat(62)}\n`);
  return failed.length === 0;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}  SISSA Platform — Automated Test Runner${C.reset}`);
  console.log(`${C.dim}  Target: ${BASE_URL} | DB: ${DB_CONFIG.database}@${DB_CONFIG.host}:${DB_CONFIG.port}${C.reset}\n`);

  // Wait for HTTP server
  process.stdout.write(`  Checking HTTP server… `);
  const serverUp = await waitForServer();
  if (!serverUp) {
    console.log(`${C.red}UNREACHABLE${C.reset}`);
    console.error(
      `\n[ERROR] Cannot reach ${BASE_URL}/health after ${POLL_TIMEOUT_MS}ms.\n` +
      `  Make sure the backend is running:\n  cd backend && npm install && node server.js\n`
    );
    process.exit(1);
  }
  console.log(`${C.green}OK${C.reset}`);

  // Connect to DB
  pool = new Pool(DB_CONFIG);
  try {
    await q('SELECT 1');
    process.stdout.write(`  Checking database… `);
    console.log(`${C.green}OK${C.reset}\n`);
  } catch (err) {
    console.log(`${C.red}FAILED${C.reset}`);
    console.error(`\n[ERROR] Cannot connect to database: ${err.message}\n`);
    process.exit(1);
  }

  const globalStart = Date.now();

  try {
    await suiteInfrastructure();
    await suiteDbFunctionsA1();
    await suiteTriggersAudit();
    await suiteViews();
    await suiteApiInfra();
    await suiteApiUsuarios();
    await suiteApiGrupos();
  } catch (err) {
    console.error(`\n${C.red}[FATAL] Unexpected error: ${err.message}${C.reset}`);
    console.error(err.stack);
  }

  await runCleanup();

  const totalMs = Date.now() - globalStart;
  const allPassed = printReport(totalMs);

  await pool.end();
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
