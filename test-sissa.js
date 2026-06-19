#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SISSA — Módulo de Gestão de Risco de Evasão (PARTE 2)        ║
 * ║  Suíte de testes automatizada (>= 150 testes)                ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Cobre: schema/DDL, funções, procedimentos, triggers, views, ║
 * ║         índices (com benchmark de ganho), segurança/roles e   ║
 * ║         todas as rotas da API /api/sissa/*                     ║
 * ║  Modelo NORMALIZADO: aluno + matrícula; intervenção individual.║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Pré-requisitos:                                              ║
 * ║   1. Banco recriado: psql sissa -f sql/01,05,06,07            ║
 * ║   2. cd backend && node server.js  (porta 3000)               ║
 * ║   3. Node.js >= 18 (fetch nativo)                            ║
 * ║  Uso: node test-sissa.js                                      ║
 * ║  Local (peer/socket): PGHOST=/var/run/postgresql PGUSER=<você> ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
'use strict';

// ─── Resolução do módulo pg (raiz ou /backend) ────────────────────────────────
let Pool;
for (const p of ['pg', './backend/node_modules/pg', '../node_modules/pg']) {
  try { Pool = require(p).Pool; break; } catch { /* próximo */ }
}
if (!Pool) {
  console.error('\n[ERRO] módulo pg não encontrado. Rode: cd backend && npm install\n');
  process.exit(1);
}

// ─── Configuração ─────────────────────────────────────────────────────────────
const BASE_URL  = process.env.BASE_URL  || 'http://localhost:3000';
const DB_CONFIG = {
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'sissa',
  user:     process.env.PGUSER     || 'thiagohonoratoferreira',
  password: process.env.PGPASSWORD || '',
};
const POLL_TIMEOUT_MS = 8000;

// ─── Cores ANSI ───────────────────────────────────────────────────────────────
const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m', green:'\x1b[32m', red:'\x1b[31m',
  yellow:'\x1b[33m', cyan:'\x1b[36m', blue:'\x1b[34m', magenta:'\x1b[35m',
};
const ok   = (s) => `${C.green}✓${C.reset} ${s}`;
const fail = (s) => `${C.red}✗${C.reset} ${s}`;
const suite= (s) => `\n${C.bold}${C.cyan}[${s}]${C.reset}`;
const info = (s) => `${C.dim}  → ${s}${C.reset}`;

// ─── Estado ───────────────────────────────────────────────────────────────────
const results = [];
let currentSuite = '';
const tmp = {
  matriculaIds: [], alunoIds: [], grupoIds: [], intervencaoIds: [], usuarioIds: [],
};

function assert(cond, msg)          { if (!cond) throw new Error(msg || 'Falha na asserção'); }
function assertEqual(a, e, msg)     { if (a !== e) throw new Error(msg || `Esperado ${JSON.stringify(e)}, obtido ${JSON.stringify(a)}`); }
function assertIncludes(s, sub, msg){ if (!String(s).toLowerCase().includes(String(sub).toLowerCase())) throw new Error(msg || `Esperava "${s}" conter "${sub}"`); }
function assertIsArray(v, msg)      { if (!Array.isArray(v)) throw new Error(msg || `Esperava Array, obtido ${typeof v}`); }
function assertHasKeys(o, keys, msg){ for (const k of keys) if (!(k in o)) throw new Error(msg || `Falta chave "${k}"`); }
function assertTrue(v, msg)         { if (v !== true) throw new Error(msg || `Esperava true, obtido ${JSON.stringify(v)}`); }
function assertFalse(v, msg)        { if (v !== false) throw new Error(msg || `Esperava false, obtido ${JSON.stringify(v)}`); }

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
function startSuite(name) { currentSuite = name; console.log(suite(name)); }

async function assertRejects(fn) {
  let threw = false;
  try { await fn(); } catch { threw = true; }
  if (!threw) throw new Error('Esperava que a operação fosse rejeitada pelo banco, mas foi aceita');
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const { headers: optHeaders, body, ...rest } = opts;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...optHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}
// Ator padrão das chamadas mutadoras: Coordenador de unidade (nível 5, acesso total).
// Resolvido em main(). Passe `actor` explícito para testar outros níveis; passe null p/ 401.
let ACTOR = null;
function actorHeader(actor) {
  const a = actor === undefined ? ACTOR : actor;
  return a ? { 'x-sissa-usuario-id': String(a) } : {};
}
const GET    = (p)                    => api(p);
const POST   = (p, body, actor)       => api(p, { method: 'POST',   body, headers: actorHeader(actor) });
const PUT    = (p, body, actor)       => api(p, { method: 'PUT',    body, headers: actorHeader(actor) });
const DELETE = (p, actor)             => api(p, { method: 'DELETE',       headers: actorHeader(actor) });

// ─── DB ───────────────────────────────────────────────────────────────────────
let pool;
async function q(sql, params = []) { return pool.query(sql, params); }
async function scalar(sql, params = []) {
  const r = await q(sql, params);
  return r.rows[0] ? Object.values(r.rows[0])[0] : null;
}
async function waitForServer() {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE_URL}/health`); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

// Cria aluno + matrícula (curso 1) com os indicadores dados e devolve o matricula_id.
// (Os indicadores moram na matrícula; o risco é derivado pela trigger.)
let _seq = 0;
async function mkMatricula(reprov = 0, media = 8.0, ch = 600, nome = 'ZZ Teste Aluno', withRisco = true) {
  _seq++;
  const cod = 'ZZ' + Date.now() + '_' + _seq;
  const alunoId = await scalar(`INSERT INTO sissa_aluno(nome) VALUES($1) RETURNING id`, [nome]);
  tmp.alunoIds.push(alunoId);
  const matId = await scalar(
    `INSERT INTO sissa_matricula(codigo, aluno_id, curso_id, media_global, reprovacoes, ch_semestre)
     VALUES($1,$2,1,$3,$4,$5) RETURNING id`,
    [cod, alunoId, media, reprov, ch]);
  tmp.matriculaIds.push(matId);
  // por padrão cria o registro de risco (risco derivado pela trigger), para que
  // toda matrícula de curso conte tanto no total quanto num bucket de risco.
  if (withRisco) await q(`INSERT INTO sissa_risco_evasao(matricula_id) VALUES($1)`, [matId]);
  return matId;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 1 — INFRAESTRUTURA & SCHEMA (DDL)
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteSchema() {
  startSuite('Schema & DDL');

  await test('Servidor HTTP acessível (/health)', async () => {
    const { status, body } = await GET('/health');
    assertEqual(status, 200); assertEqual(body.status, 'ok');
  });
  await test('Conexão com o banco estabelecida', async () => {
    assertEqual(await scalar('SELECT 1 AS x'), 1);
  });

  const tabelas = [
    'sissa_instituicao','sissa_unidade','sissa_curso','sissa_perfil','sissa_usuario_sissa',
    'sissa_usuario_curso','sissa_semestre','sissa_disciplina','sissa_aluno','sissa_matricula',
    'sissa_risco_evasao','sissa_grupo_intervencao','sissa_grupo_matricula','sissa_intervencao',
  ];
  for (const t of tabelas) {
    await test(`Tabela ${t} existe`, async () => {
      const n = await scalar(`SELECT count(*) FROM information_schema.tables WHERE table_name=$1`, [t]);
      assertEqual(Number(n), 1);
    });
  }
  // tabelas antigas não devem mais existir
  for (const t of ['sissa_estudante','sissa_intervencao_estudante','sissa_grupo_estudante']) {
    await test(`Tabela antiga ${t} foi removida`, async () => {
      const n = await scalar(`SELECT count(*) FROM information_schema.tables WHERE table_name=$1`, [t]);
      assertEqual(Number(n), 0);
    });
  }

  await test('Tabelas uni_* (roster) carregadas (8)', async () => {
    const n = await scalar(`SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'uni_%'`);
    assertEqual(Number(n), 8);
  });
  await test('CHECK em sissa_instituicao.tipo (Universidade/Instituto Federal)', async () => {
    await assertRejects(() => q(`INSERT INTO sissa_instituicao(code_mec,nome,tipo) VALUES('ZZTESTMEC','X','Faculdade')`));
  });
  await test('UNIQUE em sissa_instituicao.code_mec', async () => {
    await assertRejects(() => q(`INSERT INTO sissa_instituicao(code_mec,nome,tipo) VALUES('579','Dup','Universidade')`));
  });
  await test('UNIQUE em sissa_risco_evasao.matricula_id (1:1 com matrícula)', async () => {
    // matrícula 1 já possui registro de risco no seed → 2º insert viola o UNIQUE
    await assertRejects(() => q(`INSERT INTO sissa_risco_evasao(matricula_id) VALUES(1)`));
  });
  await test('CHECK em sissa_intervencao.formato (Individual/Grupo)', async () => {
    await assertRejects(() => q(`INSERT INTO sissa_intervencao(matricula_id,formato) VALUES(1,'Coletivo')`));
  });
  await test('CHECK em sissa_grupo_intervencao.status (Ativo/Inativo)', async () => {
    await assertRejects(() => q(`INSERT INTO sissa_grupo_intervencao(titulo,status) VALUES('ZZ','Pausado')`));
  });
  await test('FK sissa_matricula.curso_id NOT NULL', async () => {
    await assertRejects(() => q(`INSERT INTO sissa_matricula(codigo,aluno_id,curso_id) VALUES('ZZTESTNULL',1,NULL)`));
  });
  await test('FK sissa_matricula.aluno_id NOT NULL', async () => {
    await assertRejects(() => q(`INSERT INTO sissa_matricula(codigo,aluno_id,curso_id) VALUES('ZZTESTNULL2',NULL,1)`));
  });
  await test('FK sissa_instituicao referenciada por unidade (ON DELETE RESTRICT)', async () => {
    await assertRejects(() => q(`DELETE FROM sissa_instituicao WHERE id=1`));
  });
  await test('UNIQUE em sissa_matricula.codigo', async () => {
    const m = await scalar(`SELECT codigo FROM sissa_matricula LIMIT 1`);
    await assertRejects(() => q(`INSERT INTO sissa_matricula(codigo,aluno_id,curso_id) VALUES($1,1,1)`, [m]));
  });
  await test('Entidades unidade/semestre/disciplina populadas', async () => {
    assert(Number(await scalar(`SELECT count(*) FROM sissa_unidade`))    >= 1, 'sem unidades');
    assert(Number(await scalar(`SELECT count(*) FROM sissa_semestre`))   >= 1, 'sem semestres');
    assert(Number(await scalar(`SELECT count(*) FROM sissa_disciplina`)) >= 1, 'sem disciplinas');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 2 — FUNÇÕES
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteFuncoes() {
  startSuite('Funções');

  await test('fu_sissa_classificar é FUNCTION (prokind=f) e IMMUTABLE', async () => {
    const r = await q(`SELECT prokind::text k, provolatile::text v FROM pg_proc WHERE proname='fu_sissa_classificar'`);
    assert(r.rows.length === 1, 'função inexistente');
    assertEqual(r.rows[0].k, 'f'); assertEqual(r.rows[0].v, 'i');
  });
  await test('fu_sissa_calcular_risco é FUNCTION (prokind=f)', async () => {
    assertEqual(await scalar(`SELECT prokind::text FROM pg_proc WHERE proname='fu_sissa_calcular_risco'`), 'f');
  });
  await test('fu_sissa_resumo_curso é FUNCTION (prokind=f)', async () => {
    assertEqual(await scalar(`SELECT prokind::text FROM pg_proc WHERE proname='fu_sissa_resumo_curso'`), 'f');
  });

  // fonte única dos limiares — casos puros
  await test('fu_sissa_classificar(3,8.0,600) → Alto (reprovacoes>=3)', async () => {
    assertEqual(await scalar(`SELECT fu_sissa_classificar(3,8.0,600)`), 'Alto');
  });
  await test('fu_sissa_classificar(0,2.5,600) → Alto (media<3.0)', async () => {
    assertEqual(await scalar(`SELECT fu_sissa_classificar(0,2.5,600)`), 'Alto');
  });
  await test('fu_sissa_classificar(1,7.0,600) → Médio (reprovacoes>=1)', async () => {
    assertEqual(await scalar(`SELECT fu_sissa_classificar(1,7.0,600)`), 'Médio');
  });
  await test('fu_sissa_classificar(0,7.0,300) → Médio (ch<400)', async () => {
    assertEqual(await scalar(`SELECT fu_sissa_classificar(0,7.0,300)`), 'Médio');
  });
  await test('fu_sissa_classificar(0,8.5,600) → Baixo', async () => {
    assertEqual(await scalar(`SELECT fu_sissa_classificar(0,8.5,600)`), 'Baixo');
  });

  // fu_sissa_calcular_risco lê os indicadores da matrícula e delega à fonte única
  await test('fu_sissa_calcular_risco → Alto (reprovacoes>=3)', async () => {
    const id = await mkMatricula(3, 8.0, 600);
    assertEqual(await scalar(`SELECT fu_sissa_calcular_risco($1)`, [id]), 'Alto');
  });
  await test('fu_sissa_calcular_risco → Alto (media<3.0)', async () => {
    const id = await mkMatricula(0, 2.5, 600);
    assertEqual(await scalar(`SELECT fu_sissa_calcular_risco($1)`, [id]), 'Alto');
  });
  await test('fu_sissa_calcular_risco → Médio (reprovacoes=1)', async () => {
    const id = await mkMatricula(1, 7.0, 600);
    assertEqual(await scalar(`SELECT fu_sissa_calcular_risco($1)`, [id]), 'Médio');
  });
  await test('fu_sissa_calcular_risco → Médio (ch<400)', async () => {
    const id = await mkMatricula(0, 7.0, 300);
    assertEqual(await scalar(`SELECT fu_sissa_calcular_risco($1)`, [id]), 'Médio');
  });
  await test('fu_sissa_calcular_risco → Baixo (indicadores bons)', async () => {
    const id = await mkMatricula(0, 8.5, 600);
    assertEqual(await scalar(`SELECT fu_sissa_calcular_risco($1)`, [id]), 'Baixo');
  });
  await test('fu_sissa_calcular_risco → "Sem dados" (matrícula inexistente)', async () => {
    assertEqual(await scalar(`SELECT fu_sissa_calcular_risco(999999)`), 'Sem dados');
  });

  await test('fu_sissa_resumo_curso retorna colunas esperadas', async () => {
    const r = await q(`SELECT * FROM fu_sissa_resumo_curso(1)`);
    assertHasKeys(r.rows[0], ['r_curso_nome','r_total','r_alto','r_medio','r_baixo','r_media_reprov','r_pct_alto_risco']);
  });
  await test('fu_sissa_resumo_curso: total = soma(alto+medio+baixo)', async () => {
    const r = (await q(`SELECT * FROM fu_sissa_resumo_curso(1)`)).rows[0];
    assertEqual(Number(r.r_total), Number(r.r_alto)+Number(r.r_medio)+Number(r.r_baixo));
  });
  await test('fu_sissa_resumo_curso: pct_alto_risco entre 0 e 100', async () => {
    const r = (await q(`SELECT * FROM fu_sissa_resumo_curso(1)`)).rows[0];
    const p = Number(r.r_pct_alto_risco);
    assert(p >= 0 && p <= 100, `pct fora da faixa: ${p}`);
  });
  await test('fu_sissa_resumo_curso: curso sem alunos → 0 linhas', async () => {
    const r = await q(`SELECT * FROM fu_sissa_resumo_curso(999999)`);
    assertEqual(r.rows.length, 0);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 3 — PROCEDIMENTOS
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteProcedimentos() {
  startSuite('Procedimentos');

  await test('pr_sissa_criar_intervencao_grupo é PROCEDURE (prokind=p)', async () => {
    assertEqual(await scalar(`SELECT prokind::text FROM pg_proc WHERE proname='pr_sissa_criar_intervencao_grupo'`), 'p');
  });
  await test('pr_sissa_atualizar_status_grupos é PROCEDURE (prokind=p)', async () => {
    assertEqual(await scalar(`SELECT prokind::text FROM pg_proc WHERE proname='pr_sissa_atualizar_status_grupos'`), 'p');
  });

  // grupo de teste com 2 matrículas
  let grupoId, m1, m2;
  await test('Setup: grupo de teste + 2 matrículas', async () => {
    grupoId = await scalar(`INSERT INTO sissa_grupo_intervencao(titulo,semestre,status) VALUES('ZZ Proc Grupo','2025/1','Ativo') RETURNING id`);
    tmp.grupoIds.push(grupoId);
    m1 = await mkMatricula(0, 8.0, 600);
    m2 = await mkMatricula(1, 6.0, 600);
    await q(`INSERT INTO sissa_grupo_matricula(grupo_id,matricula_id) VALUES($1,$2),($1,$3)`, [grupoId, m1, m2]);
  });

  await test('CALL pr_sissa_criar_intervencao_grupo retorna p_total (INOUT)', async () => {
    const r = await q(
      `CALL pr_sissa_criar_intervencao_grupo($1, CURRENT_DATE, 5, 1, 'Chat', 'Apoio', 'Pró-ativa', 'Conteúdo', 'Síncrono', 'ZZ proc teste', 0)`,
      [grupoId]);
    assertEqual(Number(r.rows[0].p_total), 2);
  });
  await test('Procedimento cria 1 intervenção individual por matrícula do grupo', async () => {
    const rows = (await q(`SELECT id, matricula_id, formato FROM sissa_intervencao WHERE observacoes='ZZ proc teste' ORDER BY matricula_id`)).rows;
    rows.forEach(r => tmp.intervencaoIds.push(r.id));
    assertEqual(rows.length, 2);
    assertTrue(rows.every(r => r.formato === 'Individual'));
    assertEqual([Number(rows[0].matricula_id), Number(rows[1].matricula_id)].sort((a,b)=>a-b).join(','),
                [m1, m2].sort((a,b)=>a-b).join(','));
  });
  await test('CALL pr_sissa_criar_intervencao_grupo com grupo inexistente → erro', async () => {
    await assertRejects(() => q(
      `CALL pr_sissa_criar_intervencao_grupo(999999, CURRENT_DATE, 5, 1, 'Chat','x','Reativa','Conteúdo','Síncrono','x',0)`));
  });

  await test('CALL pr_sissa_atualizar_status_grupos retorna total (INOUT)', async () => {
    const r = await q(`CALL pr_sissa_atualizar_status_grupos(0)`);
    const total = r.rows[0].p_total;
    assert(Number.isInteger(total) && total >= 0, `total inválido: ${total}`);
  });
  await test('pr_sissa_atualizar_status_grupos inativa grupo antigo sem intervenção', async () => {
    const gid = await scalar(
      `INSERT INTO sissa_grupo_intervencao(titulo,status,created_at) VALUES('ZZ Antigo','Ativo', NOW()-INTERVAL '400 days') RETURNING id`);
    tmp.grupoIds.push(gid);
    await q(`CALL pr_sissa_atualizar_status_grupos(0)`);
    assertEqual(await scalar(`SELECT status FROM sissa_grupo_intervencao WHERE id=$1`, [gid]), 'Inativo');
  });
  await test('pr_sissa_atualizar_status_grupos NÃO inativa grupo recente', async () => {
    const gid = await scalar(
      `INSERT INTO sissa_grupo_intervencao(titulo,status,created_at) VALUES('ZZ Recente','Ativo', NOW()) RETURNING id`);
    tmp.grupoIds.push(gid);
    await q(`CALL pr_sissa_atualizar_status_grupos(0)`);
    assertEqual(await scalar(`SELECT status FROM sissa_grupo_intervencao WHERE id=$1`, [gid]), 'Ativo');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 4 — TRIGGERS
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteTriggers() {
  startSuite('Triggers');

  for (const tg of ['tg_sissa_risco_evasao_timestamp','tg_sissa_classificar_risco']) {
    await test(`Trigger ${tg} existe`, async () => {
      const n = await scalar(`SELECT count(*) FROM pg_trigger WHERE tgname=$1`, [tg]);
      assertEqual(Number(n), 1);
    });
  }
  await test('tg_sissa_grupo_inativo_auto foi removida (pendência de redesenho)', async () => {
    assertEqual(Number(await scalar(`SELECT count(*) FROM pg_trigger WHERE tgname='tg_sissa_grupo_inativo_auto'`)), 0);
  });

  let matId;
  await test('Setup: matrícula (reprovacoes=4) para triggers', async () => {
    // sem risco ainda — o teste de INSERT abaixo cria o registro e dispara a trigger
    matId = await mkMatricula(4, 8.0, 600, 'ZZ Teste Aluno', false);
  });

  await test('tg_sissa_classificar_risco: classifica Alto no INSERT (reprovacoes>=3)', async () => {
    await q(`INSERT INTO sissa_risco_evasao(matricula_id) VALUES($1)`, [matId]);
    assertEqual(await scalar(`SELECT risco FROM sissa_risco_evasao WHERE matricula_id=$1`, [matId]), 'Alto');
  });
  await test('tg_sissa_classificar_risco: reclassifica Baixo ao mudar indicadores', async () => {
    await q(`UPDATE sissa_matricula SET reprovacoes=0, media_global=9.0, ch_semestre=600 WHERE id=$1`, [matId]);
    await q(`UPDATE sissa_risco_evasao SET turmas=turmas WHERE matricula_id=$1`, [matId]); // toca → dispara a trigger
    assertEqual(await scalar(`SELECT risco FROM sissa_risco_evasao WHERE matricula_id=$1`, [matId]), 'Baixo');
  });
  await test('tg_sissa_classificar_risco: ignora valor de risco fornecido manualmente', async () => {
    await q(`UPDATE sissa_risco_evasao SET risco='Alto' WHERE matricula_id=$1`, [matId]);
    assertEqual(await scalar(`SELECT risco FROM sissa_risco_evasao WHERE matricula_id=$1`, [matId]), 'Baixo');
  });
  await test('tg_sissa_risco_evasao_timestamp: updated_at avança após UPDATE', async () => {
    const t0 = await scalar(`SELECT updated_at FROM sissa_risco_evasao WHERE matricula_id=$1`, [matId]);
    await new Promise(r => setTimeout(r, 25));
    await q(`UPDATE sissa_risco_evasao SET turmas=turmas+1 WHERE matricula_id=$1`, [matId]);
    const t1 = await scalar(`SELECT updated_at FROM sissa_risco_evasao WHERE matricula_id=$1`, [matId]);
    assert(new Date(t1) > new Date(t0), `updated_at não avançou: ${t0} → ${t1}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 5 — VIEWS
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteViews() {
  startSuite('Views');

  for (const v of ['vw_sissa_estudantes_risco','vw_sissa_grupos','vw_sissa_risco_anonimo',
                   'vw_sissa_resumo_intervencoes','vw_sissa_perfil_permissoes','vw_roster_universidade']) {
    await test(`View ${v} existe`, async () => {
      const n = await scalar(`SELECT count(*) FROM information_schema.views WHERE table_name=$1`, [v]);
      assertEqual(Number(n), 1);
    });
  }

  await test('vw_sissa_estudantes_risco retorna linhas com colunas-chave', async () => {
    const r = await q(`SELECT * FROM vw_sissa_estudantes_risco LIMIT 1`);
    assert(r.rows.length === 1);
    assertHasKeys(r.rows[0], ['id','matricula','nome','curso_nome','instituicao_nome','risco','total_grupos']);
  });
  await test('vw_sissa_estudantes_risco: total de linhas = total de matrículas', async () => {
    const a = Number(await scalar(`SELECT count(*) FROM vw_sissa_estudantes_risco`));
    const b = Number(await scalar(`SELECT count(*) FROM sissa_matricula`));
    assertEqual(a, b);
  });
  await test('vw_sissa_grupos: total_estudantes confere com vínculos (grupo_matricula)', async () => {
    const gid = await scalar(`SELECT id FROM sissa_grupo_intervencao ORDER BY id LIMIT 1`);
    const v = Number(await scalar(`SELECT total_estudantes FROM vw_sissa_grupos WHERE id=$1`, [gid]));
    const real = Number(await scalar(`SELECT count(*) FROM sissa_grupo_matricula WHERE grupo_id=$1`, [gid]));
    assertEqual(v, real);
  });

  // ANONIMATO — requisito de segurança (view sem identificadores)
  for (const col of ['nome','matricula','aluno_id','matricula_id','estudante_id']) {
    await test(`vw_sissa_risco_anonimo NÃO expõe coluna "${col}"`, async () => {
      const n = await scalar(`SELECT count(*) FROM information_schema.columns WHERE table_name='vw_sissa_risco_anonimo' AND column_name=$1`, [col]);
      assertEqual(Number(n), 0);
    });
  }
  await test('vw_sissa_risco_anonimo EXPÕE risco e curso_nome', async () => {
    const r = await q(`SELECT * FROM vw_sissa_risco_anonimo LIMIT 1`);
    assertHasKeys(r.rows[0], ['risco','curso_nome','instituicao_nome','media_global']);
  });
  await test('vw_sissa_risco_anonimo: nº linhas = nº registros de risco', async () => {
    const a = Number(await scalar(`SELECT count(*) FROM vw_sissa_risco_anonimo`));
    const b = Number(await scalar(`SELECT count(*) FROM sissa_risco_evasao`));
    assertEqual(a, b);
  });

  await test('vw_sissa_resumo_intervencoes agrega por grupo', async () => {
    const r = await q(`SELECT * FROM vw_sissa_resumo_intervencoes LIMIT 1`);
    assertHasKeys(r.rows[0], ['grupo_id','grupo_titulo','total_intervencoes','objetivos_sim','objetivos_nao']);
  });
  await test('vw_sissa_resumo_intervencoes: total_intervencoes confere via membros', async () => {
    const gid = await scalar(`SELECT id FROM sissa_grupo_intervencao ORDER BY id LIMIT 1`);
    const v = Number(await scalar(`SELECT total_intervencoes FROM vw_sissa_resumo_intervencoes WHERE grupo_id=$1`, [gid]));
    const real = Number(await scalar(
      `SELECT count(DISTINCT i.id) FROM sissa_intervencao i
       JOIN sissa_grupo_matricula gm ON gm.matricula_id = i.matricula_id WHERE gm.grupo_id=$1`, [gid]));
    assertEqual(v, real);
  });
  await test('vw_roster_universidade calcula ch_semestre (>0 p/ aluno c/ inscrições)', async () => {
    const ch = await scalar(`SELECT ch_semestre FROM vw_roster_universidade WHERE aluno_id=1`);
    assert(Number(ch) > 0, `ch_semestre esperado > 0, obtido ${ch}`);
  });
  await test('vw_roster_universidade tem flag ja_importado booleana', async () => {
    const r = await q(`SELECT ja_importado FROM vw_roster_universidade LIMIT 1`);
    assert(typeof r.rows[0].ja_importado === 'boolean');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 6 — ÍNDICES (+ benchmark de ganho >= 20%)
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteIndices() {
  startSuite('Índices');

  const esperados = [
    'idx_sissa_unidade_inst','idx_sissa_curso_unidade','idx_sissa_usuario_perfil','idx_sissa_usuario_email',
    'idx_sissa_aluno_nome','idx_sissa_matricula_curso','idx_sissa_matricula_aluno','idx_sissa_disciplina_curso',
    'idx_sissa_risco_nivel','idx_sissa_risco_updated','idx_sissa_grupo_status',
    'idx_sissa_intervencao_matricula','idx_sissa_intervencao_data','idx_sissa_intervencao_disciplina',
    'idx_sissa_intervencao_semestre','idx_sissa_risco_comp',
  ];
  for (const idx of esperados) {
    await test(`Índice ${idx} existe`, async () => {
      const n = await scalar(`SELECT count(*) FROM pg_indexes WHERE indexname=$1`, [idx]);
      assertEqual(Number(n), 1);
    });
  }

  // ── Benchmark INLINE auto-contido (não depende do script 07) ──
  async function execMs(sql) {
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const r = await q(`EXPLAIN (ANALYZE, TIMING OFF) ${sql}`);
      const txt = r.rows.map(x => x['QUERY PLAN']).find(s => s.includes('Execution Time'));
      best = Math.min(best, parseFloat(txt.split('Execution Time:')[1]));
    }
    return best;
  }

  let g1, g2;
  await test('Massa de 150k linhas gerada para benchmark', async () => {
    await q(`DROP TABLE IF EXISTS sissa_bench_chk CASCADE`);
    await q(`CREATE TABLE sissa_bench_chk(id serial primary key, codigo text, curso_id int, risco text)`);
    await q(`INSERT INTO sissa_bench_chk(codigo,curso_id,risco)
             SELECT 'EST'||lpad(g::text,9,'0'),(g%60)+1,(ARRAY['Alto','Médio','Baixo'])[(g%3)+1]
             FROM generate_series(1,150000) g`);
    await q(`ANALYZE sissa_bench_chk`);
    assertEqual(Number(await scalar(`SELECT count(*) FROM sissa_bench_chk`)), 150000);
  });
  await test('Cenário "curso+risco": ganho com índice (curso_id,risco) >= 20%', async () => {
    await q(`DROP INDEX IF EXISTS idx_chk_cr`);
    const sem = await execMs(`SELECT count(*) FROM sissa_bench_chk WHERE curso_id=37 AND risco='Alto'`);
    await q(`CREATE INDEX idx_chk_cr ON sissa_bench_chk(curso_id,risco)`); await q(`ANALYZE sissa_bench_chk`);
    const com = await execMs(`SELECT count(*) FROM sissa_bench_chk WHERE curso_id=37 AND risco='Alto'`);
    g1 = (sem - com) / sem * 100;
    console.log(info(`curso+risco: sem=${sem.toFixed(2)}ms com=${com.toFixed(2)}ms ganho=${g1.toFixed(1)}%`));
    assert(g1 >= 20, `ganho insuficiente: ${g1.toFixed(1)}%`);
  });
  await test('Cenário "código": ganho com índice (codigo) >= 20%', async () => {
    await q(`DROP INDEX IF EXISTS idx_chk_cod`);
    const sem = await execMs(`SELECT count(*) FROM sissa_bench_chk WHERE codigo='EST000075000'`);
    await q(`CREATE INDEX idx_chk_cod ON sissa_bench_chk(codigo)`); await q(`ANALYZE sissa_bench_chk`);
    const com = await execMs(`SELECT count(*) FROM sissa_bench_chk WHERE codigo='EST000075000'`);
    g2 = (sem - com) / sem * 100;
    console.log(info(`código: sem=${sem.toFixed(2)}ms com=${com.toFixed(2)}ms ganho=${g2.toFixed(1)}%`));
    assert(g2 >= 20, `ganho insuficiente: ${g2.toFixed(1)}%`);
  });
  await test('EXPLAIN: sem índice usa Seq Scan / com índice usa Index', async () => {
    await q(`DROP INDEX IF EXISTS idx_chk_cr`); await q(`ANALYZE sissa_bench_chk`);
    const semPlan = (await q(`EXPLAIN SELECT count(*) FROM sissa_bench_chk WHERE curso_id=37 AND risco='Alto'`)).rows.map(r=>r['QUERY PLAN']).join(' ');
    assertIncludes(semPlan, 'Seq Scan');
    await q(`CREATE INDEX idx_chk_cr ON sissa_bench_chk(curso_id,risco)`); await q(`ANALYZE sissa_bench_chk`);
    const comPlan = (await q(`EXPLAIN SELECT count(*) FROM sissa_bench_chk WHERE curso_id=37 AND risco='Alto'`)).rows.map(r=>r['QUERY PLAN']).join(' ');
    assertIncludes(comPlan, 'Index');
  });
  await test('Script 07 (Req.5) fornece fu_sissa_benchmark_indice quando carregado', async () => {
    const exists = Number(await scalar(`SELECT count(*) FROM pg_proc WHERE proname='fu_sissa_benchmark_indice'`));
    if (exists) {
      const r = await q(`SELECT * FROM fu_sissa_benchmark_indice(50000, 6)`);
      assertEqual(r.rows.length, 2);
      assertTrue(r.rows.every(x => x.atende_min_20pct === true));
      await q(`DROP TABLE IF EXISTS sissa_bench_matricula CASCADE`).catch(()=>{});
      await q(`DROP TABLE IF EXISTS sissa_bench_risco CASCADE`).catch(()=>{});
    } else {
      console.log(info('07 não carregado — função de benchmark é opcional para a app (ok)'));
    }
  });
  await q(`DROP TABLE IF EXISTS sissa_bench_chk CASCADE`).catch(()=>{});
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 7 — SEGURANÇA / ROLES
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteSeguranca() {
  startSuite('Segurança & Roles');

  for (const role of ['admin_sissa','leitura_sissa','risco_anonimo_sissa']) {
    await test(`Role ${role} existe`, async () => {
      assertEqual(Number(await scalar(`SELECT count(*) FROM pg_roles WHERE rolname=$1`, [role])), 1);
    });
    await test(`Role ${role} é NOLOGIN`, async () => {
      assertFalse(await scalar(`SELECT rolcanlogin FROM pg_roles WHERE rolname=$1`, [role]));
    });
  }

  // admin_sissa — todas as operações
  for (const priv of ['SELECT','INSERT','UPDATE','DELETE']) {
    await test(`admin_sissa tem ${priv} em sissa_matricula`, async () => {
      assertTrue(await scalar(`SELECT has_table_privilege('admin_sissa','sissa_matricula',$1)`, [priv]));
    });
  }
  await test('admin_sissa tem INSERT em sissa_aluno', async () => {
    assertTrue(await scalar(`SELECT has_table_privilege('admin_sissa','sissa_aluno','INSERT')`));
  });
  await test('admin_sissa tem INSERT em sissa_intervencao', async () => {
    assertTrue(await scalar(`SELECT has_table_privilege('admin_sissa','sissa_intervencao','INSERT')`));
  });

  // leitura_sissa — somente leitura
  await test('leitura_sissa TEM SELECT em sissa_matricula', async () => {
    assertTrue(await scalar(`SELECT has_table_privilege('leitura_sissa','sissa_matricula','SELECT')`));
  });
  await test('leitura_sissa NÃO tem INSERT em sissa_matricula', async () => {
    assertFalse(await scalar(`SELECT has_table_privilege('leitura_sissa','sissa_matricula','INSERT')`));
  });
  await test('leitura_sissa NÃO tem UPDATE em sissa_risco_evasao', async () => {
    assertFalse(await scalar(`SELECT has_table_privilege('leitura_sissa','sissa_risco_evasao','UPDATE')`));
  });
  await test('leitura_sissa NÃO tem DELETE em sissa_grupo_intervencao', async () => {
    assertFalse(await scalar(`SELECT has_table_privilege('leitura_sissa','sissa_grupo_intervencao','DELETE')`));
  });

  // risco_anonimo_sissa — só a view anônima
  await test('risco_anonimo_sissa TEM SELECT em vw_sissa_risco_anonimo', async () => {
    assertTrue(await scalar(`SELECT has_table_privilege('risco_anonimo_sissa','vw_sissa_risco_anonimo','SELECT')`));
  });
  await test('risco_anonimo_sissa NÃO tem SELECT em sissa_matricula', async () => {
    assertFalse(await scalar(`SELECT has_table_privilege('risco_anonimo_sissa','sissa_matricula','SELECT')`));
  });
  await test('risco_anonimo_sissa NÃO tem SELECT em vw_sissa_estudantes_risco', async () => {
    assertFalse(await scalar(`SELECT has_table_privilege('risco_anonimo_sissa','vw_sissa_estudantes_risco','SELECT')`));
  });
  await test('risco_anonimo_sissa NÃO tem SELECT em sissa_risco_evasao', async () => {
    assertFalse(await scalar(`SELECT has_table_privilege('risco_anonimo_sissa','sissa_risco_evasao','SELECT')`));
  });

  // teste funcional de isolamento — exige que o usuário de conexão seja MEMBRO
  // do role para poder SET ROLE; concedemos a associação (best-effort).
  await test('Setup: associação ao role para SET ROLE', async () => {
    await q(`GRANT risco_anonimo_sissa TO current_user`).catch(()=>{});
    assert(true);
  });
  await test('SET ROLE risco_anonimo_sissa: SELECT na view anônima funciona', async () => {
    const c = await pool.connect();
    try {
      await c.query('SET ROLE risco_anonimo_sissa');
      const r = await c.query('SELECT count(*) FROM vw_sissa_risco_anonimo');
      assert(Number(r.rows[0].count) >= 0);
    } finally { await c.query('RESET ROLE'); c.release(); }
  });
  await test('SET ROLE risco_anonimo_sissa: SELECT em sissa_matricula é BLOQUEADO', async () => {
    const c = await pool.connect();
    let blocked = false;
    try {
      await c.query('SET ROLE risco_anonimo_sissa');
      try { await c.query('SELECT * FROM sissa_matricula LIMIT 1'); }
      catch { blocked = true; }
    } finally { await c.query('RESET ROLE'); c.release(); }
    assertTrue(blocked, 'role anônimo conseguiu ler sissa_matricula (deveria ser negado)');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 8 — API: AUTENTICAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteApiAuth() {
  startSuite('API — Autenticação');

  await test('POST /auth sem credenciais → 400', async () => {
    const { status, body } = await POST('/api/sissa/auth', {});
    assertEqual(status, 400); assertFalse(body.success);
  });
  await test('POST /auth usuário cadastrado + senha correta → privado', async () => {
    const { body } = await POST('/api/sissa/auth', { email: 'adailton@ufg.com', senha: '1234' });
    assertTrue(body.success); assertEqual(body.tipo, 'privado');
    assertEqual(body.usuario.email_institucional, 'adailton@ufg.com');
  });
  await test('POST /auth nunca devolve a senha', async () => {
    const { body } = await POST('/api/sissa/auth', { email: 'adailton@ufg.com', senha: '1234' });
    assert(!('senha' in body.usuario), 'senha vazou na resposta');
  });
  await test('POST /auth senha incorreta → success=false', async () => {
    const { body } = await POST('/api/sissa/auth', { email: 'adailton@ufg.com', senha: '0000' });
    assertFalse(body.success);
  });
  await test('POST /auth e-mail não cadastrado → público (federação)', async () => {
    const { body } = await POST('/api/sissa/auth', { email: 'qualquer@externo.com', senha: 'x' });
    assertTrue(body.success); assertEqual(body.tipo, 'publico');
  });
  await test('POST /auth atualiza ultimo_acesso do usuário privado', async () => {
    const before = await scalar(`SELECT ultimo_acesso FROM sissa_usuario_sissa WHERE email_institucional='kalebe.xavier@ifsp.edu.br'`);
    await new Promise(r => setTimeout(r, 20));
    await POST('/api/sissa/auth', { email: 'kalebe.xavier@ifsp.edu.br', senha: '4567' });
    const after = await scalar(`SELECT ultimo_acesso FROM sissa_usuario_sissa WHERE email_institucional='kalebe.xavier@ifsp.edu.br'`);
    assert(!before || new Date(after) >= new Date(before));
  });
  await test('POST /auth case-insensitive no e-mail', async () => {
    const { body } = await POST('/api/sissa/auth', { email: 'ADAILTON@UFG.COM', senha: '1234' });
    assertTrue(body.success); assertEqual(body.tipo, 'privado');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 9 — API: ESTUDANTES & ESTATÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteApiEstudantes() {
  startSuite('API — Estudantes & Estatísticas');

  await test('GET /estudantes retorna array', async () => {
    const { body } = await GET('/api/sissa/estudantes');
    assertTrue(body.success); assertIsArray(body.data); assert(body.data.length > 0);
  });
  await test('GET /estudantes?curso_id=1 filtra por curso', async () => {
    const { body } = await GET('/api/sissa/estudantes?curso_id=1');
    assertTrue(body.data.every(e => e.curso_id === 1));
  });
  await test('GET /estudantes?risco=Alto filtra por risco', async () => {
    const { body } = await GET('/api/sissa/estudantes?risco=Alto');
    assertTrue(body.data.every(e => e.risco === 'Alto'));
  });
  await test('GET /estudantes ordena com Alto risco primeiro', async () => {
    const { body } = await GET('/api/sissa/estudantes?curso_id=1');
    const ordem = { 'Alto':1, 'Médio':2, 'Baixo':3 };
    let prev = 0;
    for (const e of body.data) { const v = ordem[e.risco] || 4; assert(v >= prev); prev = v; }
  });
  await test('POST /estudantes cria aluno+matrícula e deriva risco automaticamente', async () => {
    const { body } = await POST('/api/sissa/estudantes', {
      matricula: 'ZZAPI' + Date.now(), nome: 'ZZ API Estudante', curso_id: 1,
      ingresso: 2024, media_global: 1.5, reprovacoes: 4, ch_semestre: 600,
    });
    assertTrue(body.success, body.error);
    assertEqual(body.data.risco, 'Alto');
    tmp.matriculaIds.push(body.data.id);
  });
  await test('POST /estudantes sem campos obrigatórios → 400', async () => {
    const { status, body } = await POST('/api/sissa/estudantes', { nome: 'x' });
    assertEqual(status, 400); assertFalse(body.success);
  });
  await test('GET /estatisticas/risco soma total = alto+medio+baixo', async () => {
    const { body } = await GET('/api/sissa/estatisticas/risco');
    assertTrue(body.success);
    assertEqual(body.data.total, body.data.alto + body.data.medio + body.data.baixo);
  });
  await test('GET /estatisticas/risco percentuais entre 0 e 100', async () => {
    const { body } = await GET('/api/sissa/estatisticas/risco');
    for (const k of ['pct_alto','pct_medio','pct_baixo']) {
      assert(body.data[k] >= 0 && body.data[k] <= 100);
    }
  });
  await test('GET /estatisticas/risco?curso_id=1 filtra', async () => {
    const { body } = await GET('/api/sissa/estatisticas/risco?curso_id=1');
    assertTrue(body.success); assert(body.data.total >= 0);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 10 — API: ROSTER & IMPORTAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteApiRoster() {
  startSuite('API — Roster & Importação');

  await test('GET /roster retorna alunos do cadastro acadêmico', async () => {
    const { body } = await GET('/api/sissa/roster');
    assertTrue(body.success); assertIsArray(body.data); assert(body.data.length > 0);
    assertHasKeys(body.data[0], ['aluno_id','matricula_codigo','nome','curso_nome','ch_semestre','ja_importado']);
  });
  await test('GET /roster?q=Andria filtra por nome', async () => {
    const { body } = await GET('/api/sissa/roster?q=Andria');
    assertTrue(body.data.every(r => r.nome.toLowerCase().includes('andria') || r.curso_nome.toLowerCase().includes('andria')));
  });
  await test('POST /estudantes/importar sem aluno_id → 400', async () => {
    const { status, body } = await POST('/api/sissa/estudantes/importar', {});
    assertEqual(status, 400); assertFalse(body.success);
  });
  await test('POST /estudantes/importar curso divergente → 403', async () => {
    const { status, body } = await POST('/api/sissa/estudantes/importar', { aluno_id: 1, curso_esperado: 'Curso Inexistente XYZ' });
    assertEqual(status, 403); assertFalse(body.success);
  });
  let importadoId;
  await test('POST /estudantes/importar importa aluno do roster (aluno+matrícula+risco)', async () => {
    const { body: roster } = await GET('/api/sissa/roster');
    const alvo = roster.data.find(r => !r.ja_importado);
    if (!alvo) { console.log(info('todos já importados — pulando inserção')); return; }
    const { body } = await POST('/api/sissa/estudantes/importar', { aluno_id: alvo.aluno_id });
    assertTrue(body.success, body.error);
    importadoId = body.data.id; tmp.matriculaIds.push(importadoId);
  });
  await test('POST /estudantes/importar duplicado → já importado', async () => {
    const { body: roster } = await GET('/api/sissa/roster');
    const jaImp = roster.data.find(r => r.ja_importado);
    if (!jaImp) { console.log(info('nenhum importado — pulando')); return; }
    const { body } = await POST('/api/sissa/estudantes/importar', { aluno_id: jaImp.aluno_id });
    assertFalse(body.success); assertIncludes(body.error, 'importado');
  });
  await test('Matrícula importada recebe risco via trigger', async () => {
    if (!importadoId) { console.log(info('nada importado — pulando')); return; }
    const risco = await scalar(`SELECT risco FROM sissa_risco_evasao WHERE matricula_id=$1`, [importadoId]);
    assert(['Alto','Médio','Baixo'].includes(risco), `risco inválido: ${risco}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 11 — API: GRUPOS DE INTERVENÇÃO
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteApiGrupos() {
  startSuite('API — Grupos de Intervenção');

  let mA, mB;
  await test('Setup: matrículas para grupos', async () => {
    mA = await mkMatricula(0, 8, 600);
    mB = await mkMatricula(1, 6, 600);
  });

  await test('GET /grupos retorna array', async () => {
    const { body } = await GET('/api/sissa/grupos');
    assertTrue(body.success); assertIsArray(body.data);
  });
  let grupoId;
  await test('POST /grupos cria grupo com matrículas', async () => {
    const { body } = await POST('/api/sissa/grupos', {
      titulo: 'ZZ Grupo API', semestre: '2025/1', observacoes: 'teste',
      autoria_id: 1, estudante_ids: [mA, mB],
    });
    assertTrue(body.success); grupoId = body.data.id; tmp.grupoIds.push(grupoId);
  });
  await test('POST /grupos sem título → 400', async () => {
    const { status, body } = await POST('/api/sissa/grupos', { semestre: '2025/1' });
    assertEqual(status, 400); assertFalse(body.success);
  });
  await test('GET /grupos/:id retorna grupo com matrículas', async () => {
    const { body } = await GET(`/api/sissa/grupos/${grupoId}`);
    assertTrue(body.success); assertEqual(body.data.estudantes.length, 2);
  });
  await test('GET /grupos/:id/estudantes lista membros com risco', async () => {
    const { body } = await GET(`/api/sissa/grupos/${grupoId}/estudantes`);
    assertTrue(body.success); assertEqual(body.data.length, 2);
    assertHasKeys(body.data[0], ['id','matricula','nome','curso_nome']);
  });
  await test('PUT /grupos/:id atualiza título', async () => {
    const { body } = await PUT(`/api/sissa/grupos/${grupoId}`, { titulo: 'ZZ Grupo API Editado' });
    assertTrue(body.success);
    assertEqual(await scalar(`SELECT titulo FROM sissa_grupo_intervencao WHERE id=$1`, [grupoId]), 'ZZ Grupo API Editado');
  });
  await test('PUT /grupos/:id substitui lista de matrículas', async () => {
    const { body } = await PUT(`/api/sissa/grupos/${grupoId}`, { estudante_ids: [mA] });
    assertTrue(body.success);
    assertEqual(Number(await scalar(`SELECT count(*) FROM sissa_grupo_matricula WHERE grupo_id=$1`, [grupoId])), 1);
  });
  await test('GET /grupos-intervencao (alias) funciona', async () => {
    const { body } = await GET('/api/sissa/grupos-intervencao');
    assertTrue(body.success); assertIsArray(body.data);
  });
  await test('DELETE /grupos/:id remove o grupo', async () => {
    const gid = await scalar(`INSERT INTO sissa_grupo_intervencao(titulo,status) VALUES('ZZ Del Grupo','Ativo') RETURNING id`);
    const { body } = await DELETE(`/api/sissa/grupos/${gid}`);
    assertTrue(body.success);
    assertEqual(Number(await scalar(`SELECT count(*) FROM sissa_grupo_intervencao WHERE id=$1`, [gid])), 0);
  });
  await test('GET /grupos/:id inexistente → 404', async () => {
    const { status, body } = await GET('/api/sissa/grupos/999999');
    assertEqual(status, 404); assertFalse(body.success);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 12 — API: INTERVENÇÕES (individuais)
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteApiIntervencoes() {
  startSuite('API — Intervenções');

  let mX, grupoX;
  await test('Setup: grupo + matrícula para intervenções', async () => {
    mX = await mkMatricula(0, 7, 600);
    grupoX = await scalar(`INSERT INTO sissa_grupo_intervencao(titulo,status) VALUES('ZZ Interv Grupo','Ativo') RETURNING id`);
    tmp.grupoIds.push(grupoX);
    await q(`INSERT INTO sissa_grupo_matricula(grupo_id,matricula_id) VALUES($1,$2)`, [grupoX, mX]);
  });

  await test('GET /intervencoes retorna array', async () => {
    const { body } = await GET('/api/sissa/intervencoes');
    assertTrue(body.success); assertIsArray(body.data);
  });
  let intId;
  await test('POST /intervencoes cria intervenção individual (1 por matrícula)', async () => {
    const { body } = await POST('/api/sissa/intervencoes', {
      estudante_ids: [mX], disciplina_id: 1, semestre_id: 5,
      data_intervencao: '2025-03-10', forma_meio: 'Chat', assunto: 'Apoio',
      formato: 'Individual', interacao: 'Pró-ativa', tipo: 'Conteúdo',
      acompanhamento: 'Assíncrono', duracao: '0:45', objetivo_alcancado: 'Sim',
      observacoes: 'ZZ teste intervencao',
    });
    assertTrue(body.success, body.error); assertEqual(body.total, 1);
    intId = body.data[0].id; tmp.intervencaoIds.push(intId);
  });
  await test('Intervenção criada tem a matrícula vinculada', async () => {
    assertEqual(Number(await scalar(`SELECT matricula_id FROM sissa_intervencao WHERE id=$1`, [intId])), mX);
  });
  await test('POST /intervencoes com 2 matrículas cria 2 intervenções individuais', async () => {
    const m2 = await mkMatricula(0, 8, 600);
    const { body } = await POST('/api/sissa/intervencoes', {
      estudante_ids: [mX, m2], formato: 'Individual', observacoes: 'ZZ batch',
    });
    assertTrue(body.success); assertEqual(body.total, 2);
    body.data.forEach(d => tmp.intervencaoIds.push(d.id));
  });
  await test('POST /intervencoes sem estudante_ids → 400', async () => {
    const { status, body } = await POST('/api/sissa/intervencoes', { observacoes: 'x' });
    assertEqual(status, 400); assertFalse(body.success);
  });
  await test('POST /grupos/:id/intervencoes dá CALL na procedure (1 por membro)', async () => {
    const { body } = await POST(`/api/sissa/grupos/${grupoX}/intervencoes`, {
      data_intervencao: '2025-03-11', semestre_id: 5, disciplina_id: 1,
      forma_meio: 'Chat', assunto: 'Apoio', interacao: 'Pró-ativa', tipo: 'Conteúdo',
      acompanhamento: 'Síncrono', observacoes: 'ZZ via proc',
    });
    assertTrue(body.success, body.error); assertEqual(body.total, 1);
  });
  await test('GET /intervencoes?grupo_id filtra pelos membros do grupo', async () => {
    const { body } = await GET(`/api/sissa/intervencoes?grupo_id=${grupoX}`);
    assertTrue(body.success);
    assertTrue(body.data.every(i => i.matricula_id === mX));
  });
  await test('GET /intervencoes?busca filtra por texto', async () => {
    const { body } = await GET('/api/sissa/intervencoes?busca=teste');
    assertTrue(body.success); assertIsArray(body.data);
  });
  await test('GET /intervencoes?data_min/data_max filtra por período', async () => {
    const { body } = await GET('/api/sissa/intervencoes?data_min=2025-01-01&data_max=2025-12-31');
    assertTrue(body.success);
    assertTrue(body.data.every(i => !i.data_intervencao || (String(i.data_intervencao).slice(0,10) >= '2025-01-01' && String(i.data_intervencao).slice(0,10) <= '2025-12-31')));
  });
  await test('PUT /intervencoes/:id atualiza objetivo', async () => {
    const { body } = await PUT(`/api/sissa/intervencoes/${intId}`, { objetivo_alcancado: 'Parcialmente' });
    assertTrue(body.success);
    assertEqual(await scalar(`SELECT objetivo_alcancado FROM sissa_intervencao WHERE id=$1`, [intId]), 'Parcialmente');
  });
  await test('PUT /intervencoes/:id atualiza disciplina_id/semestre_id', async () => {
    const { body } = await PUT(`/api/sissa/intervencoes/${intId}`, { disciplina_id: 2, semestre_id: 4 });
    assertTrue(body.success);
    assertEqual(Number(await scalar(`SELECT disciplina_id FROM sissa_intervencao WHERE id=$1`, [intId])), 2);
    assertEqual(Number(await scalar(`SELECT semestre_id FROM sissa_intervencao WHERE id=$1`, [intId])), 4);
  });
  await test('POST /intervencoes formato inválido → 500 (CHECK)', async () => {
    const { body } = await POST('/api/sissa/intervencoes', { estudante_ids: [mX], formato: 'Coletivo' });
    assertFalse(body.success);
  });
  await test('POST /manutencao/status-grupos dá CALL na 2ª procedure', async () => {
    const { body } = await POST('/api/sissa/manutencao/status-grupos', {});
    assertTrue(body.success, body.error);
    assert(Number.isInteger(body.total) && body.total >= 0);
  });
  await test('GET /disciplinas e GET /semestres alimentam os selects', async () => {
    const d = await GET('/api/sissa/disciplinas'); assertTrue(d.body.success); assert(d.body.data.length > 0);
    const s = await GET('/api/sissa/semestres');   assertTrue(s.body.success); assert(s.body.data.length > 0);
    assertHasKeys(s.body.data[0], ['id','ano','periodo','rotulo']);
  });
  await test('DELETE /intervencoes/:id remove', async () => {
    const iid = await scalar(`INSERT INTO sissa_intervencao(matricula_id,data_intervencao) VALUES($1,CURRENT_DATE) RETURNING id`, [mX]);
    const { body } = await DELETE(`/api/sissa/intervencoes/${iid}`);
    assertTrue(body.success);
    assertEqual(Number(await scalar(`SELECT count(*) FROM sissa_intervencao WHERE id=$1`, [iid])), 0);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 13 — API: USUÁRIOS SISSA + AUXILIARES
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteApiUsuarios() {
  startSuite('API — Usuários & Auxiliares');

  await test('GET /usuarios retorna array com perfil e cursos', async () => {
    const { body } = await GET('/api/sissa/usuarios');
    assertTrue(body.success); assertIsArray(body.data); assert(body.data.length > 0);
    assertHasKeys(body.data[0], ['id','nome','email_institucional','perfil_nome']);
  });
  await test('GET /usuarios?perfil_id filtra', async () => {
    const { body } = await GET('/api/sissa/usuarios?perfil_id=1');
    assertTrue(body.data.every(u => u.perfil_id === 1));
  });
  let novoUserId;
  await test('POST /usuarios cria usuário com cursos', async () => {
    const { body } = await POST('/api/sissa/usuarios', {
      nome: 'ZZ Usuario API', email_institucional: `zzuser${Date.now()}@sissa.test`,
      perfil_id: 5, curso_ids: [1],
    });
    assertTrue(body.success); novoUserId = body.data.id; tmp.usuarioIds.push(novoUserId);
  });
  await test('POST /usuarios sem nome/email → 400', async () => {
    const { status, body } = await POST('/api/sissa/usuarios', { nome: 'x' });
    assertEqual(status, 400); assertFalse(body.success);
  });
  await test('POST /usuarios e-mail duplicado → falha (UNIQUE)', async () => {
    const { body } = await POST('/api/sissa/usuarios', { nome: 'Dup', email_institucional: 'adailton@ufg.com' });
    assertFalse(body.success);
  });
  await test('PUT /usuarios/:id atualiza nome', async () => {
    const { body } = await PUT(`/api/sissa/usuarios/${novoUserId}`, { nome: 'ZZ Usuario API Editado' });
    assertTrue(body.success);
    assertEqual(await scalar(`SELECT nome FROM sissa_usuario_sissa WHERE id=$1`, [novoUserId]), 'ZZ Usuario API Editado');
  });
  await test('PUT /usuarios/:id substitui cursos vinculados', async () => {
    const { body } = await PUT(`/api/sissa/usuarios/${novoUserId}`, { curso_ids: [1,2] });
    assertTrue(body.success);
    assertEqual(Number(await scalar(`SELECT count(*) FROM sissa_usuario_curso WHERE usuario_id=$1`, [novoUserId])), 2);
  });
  await test('DELETE /usuarios/:id remove', async () => {
    const uid = await scalar(`INSERT INTO sissa_usuario_sissa(nome,email_institucional) VALUES('ZZ Del User','zzdel${Date.now()}@sissa.test') RETURNING id`);
    const { body } = await DELETE(`/api/sissa/usuarios/${uid}`);
    assertTrue(body.success);
    assertEqual(Number(await scalar(`SELECT count(*) FROM sissa_usuario_sissa WHERE id=$1`, [uid])), 0);
  });

  // auxiliares
  await test('GET /cursos retorna cursos com instituição (via unidade)', async () => {
    const { body } = await GET('/api/sissa/cursos');
    assertTrue(body.success); assert(body.data.length > 0);
    assertHasKeys(body.data[0], ['id','nome','instituicao_nome','code_mec']);
  });
  await test('GET /perfis retorna perfis', async () => {
    const { body } = await GET('/api/sissa/perfis');
    assertTrue(body.success); assert(body.data.length >= 5);
  });
  await test('GET /instituicoes retorna instituições', async () => {
    const { body } = await GET('/api/sissa/instituicoes');
    assertTrue(body.success); assert(body.data.length >= 2);
  });
  await test('GET /resumo-curso/:id usa a função fu_sissa_resumo_curso', async () => {
    const { body } = await GET('/api/sissa/resumo-curso/1');
    assertTrue(body.success);
    assertHasKeys(body.data, ['r_curso_nome','r_total','r_alto','r_medio','r_baixo']);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE — NÍVEIS DE PERMISSÃO (hierarquia de perfis)
// ═══════════════════════════════════════════════════════════════════════════════
async function suiteApiPermissoes() {
  startSuite('Níveis de Permissão');

  const idDe = async (email) =>
    Number(await scalar(`SELECT id FROM sissa_usuario_sissa WHERE email_institucional=$1`, [email]));
  let tutor, tfisico, coordCurso, coordEnsino, coordUnidade;

  await test('Setup: resolve atores por nível', async () => {
    tutor        = await idDe('juliana.moraes@ifsp.edu.br');          // nv1
    tfisico      = await idDe('kalebe.xavier@ifsp.edu.br');           // nv2
    coordCurso   = await idDe('adailton@ufg.com');                   // nv3
    coordEnsino  = await idDe('beatriz.de.bastos.vianna@gmail.com'); // nv4
    coordUnidade = await idDe('laishcandido@gmail.com');             // nv5
    assert(tutor && tfisico && coordCurso && coordEnsino && coordUnidade);
  });

  // matrícula auxiliar para POSTs de intervenção (precisam de estudante_ids)
  let mAux;
  await test('Setup: matrícula auxiliar para intervenções', async () => {
    mAux = await mkMatricula(0, 8, 600);
  });

  await test('Níveis dos perfis estão corretos (5..1)', async () => {
    const r = await q(`SELECT nome, nivel FROM sissa_perfil ORDER BY nivel DESC`);
    const map = Object.fromEntries(r.rows.map(x => [x.nome, x.nivel]));
    assertEqual(map['Coordenador de unidade'], 5);
    assertEqual(map['Coordenador de ensino'], 4);
    assertEqual(map['Coordenador de curso'], 3);
    assertEqual(map['Tutor Físico'], 2);
    assertEqual(map['Tutor'], 1);
  });
  await test('Matriz: nível 1 tem 3 ações; nível 5 tem 9', async () => {
    assertEqual(Number(await scalar(`SELECT count(*) FROM sissa_nivel_acao WHERE nivel=1`)), 3);
    assertEqual(Number(await scalar(`SELECT count(*) FROM sissa_nivel_acao WHERE nivel=5`)), 9);
  });
  await test('fu_sissa_pode: tutor pode intervencao_criar, não pode usuario_gerenciar', async () => {
    assertTrue(await scalar(`SELECT fu_sissa_pode($1,'intervencao_criar')`, [tutor]));
    assertFalse(await scalar(`SELECT fu_sissa_pode($1,'usuario_gerenciar')`, [tutor]));
  });
  await test('fu_sissa_pode_gerenciar_usuario: coord unidade > tutor (TRUE)', async () => {
    assertTrue(await scalar(`SELECT fu_sissa_pode_gerenciar_usuario($1,$2)`, [coordUnidade, tutor]));
  });
  await test('fu_sissa_pode_gerenciar_usuario: tutor > coord (FALSE)', async () => {
    assertFalse(await scalar(`SELECT fu_sissa_pode_gerenciar_usuario($1,$2)`, [tutor, coordUnidade]));
  });
  await test('fu_sissa_pode_gerenciar_usuario: mesmo nível (FALSE)', async () => {
    const outroTutor = await idDe('beatriz.cardoso@ifsp.edu.br');
    assertFalse(await scalar(`SELECT fu_sissa_pode_gerenciar_usuario($1,$2)`, [tutor, outroTutor]));
  });

  await test('/auth (tutor) devolve 3 permissões sem usuario_gerenciar', async () => {
    const { body } = await POST('/api/sissa/auth', { email: 'juliana.moraes@ifsp.edu.br', senha: '5678' });
    assertEqual(body.usuario.perfil_nivel, 1);
    assertEqual(body.usuario.permissoes.length, 3);
    assert(!body.usuario.permissoes.includes('usuario_gerenciar'));
  });
  await test('/auth (coord unidade) inclui usuario_excluir', async () => {
    const { body } = await POST('/api/sissa/auth', { email: 'laishcandido@gmail.com', senha: '3456' });
    assertEqual(body.usuario.perfil_nivel, 5);
    assert(body.usuario.permissoes.includes('usuario_excluir'));
  });

  // Enforcement na API
  await test('Sem header em rota mutadora → 401', async () => {
    const { status } = await POST('/api/sissa/grupos', { titulo: 'ZZ NoAuth' }, null);
    assertEqual(status, 401);
  });
  await test('Tutor pode CRIAR intervenção (intervencao_criar)', async () => {
    const { body } = await POST('/api/sissa/intervencoes',
      { estudante_ids: [mAux], data_intervencao: '2025-04-01', formato: 'Individual', observacoes: 'ZZ tutor cria' }, tutor);
    assertTrue(body.success, body.error);
    body.data.forEach(d => tmp.intervencaoIds.push(d.id));
  });
  await test('Tutor NÃO pode excluir intervenção → 403', async () => {
    const { status, body } = await DELETE('/api/sissa/intervencoes/1', tutor);
    assertEqual(status, 403); assertFalse(body.success);
  });
  await test('Tutor NÃO pode criar grupo → 403', async () => {
    const { status } = await POST('/api/sissa/grupos', { titulo: 'ZZ TutorGrupo' }, tutor);
    assertEqual(status, 403);
  });
  await test('Tutor NÃO pode gerenciar usuários → 403', async () => {
    const { status } = await POST('/api/sissa/usuarios',
      { nome: 'ZZ x', email_institucional: `zz${Date.now()}@sissa.test` }, tutor);
    assertEqual(status, 403);
  });
  await test('Tutor Físico PODE criar grupo (grupo_gerenciar)', async () => {
    const { body } = await POST('/api/sissa/grupos', { titulo: 'ZZ TFisicoGrupo' }, tfisico);
    assertTrue(body.success, body.error);
    tmp.grupoIds.push(body.data.id);
  });
  await test('Tutor Físico NÃO pode gerenciar usuários → 403', async () => {
    const { status } = await POST('/api/sissa/usuarios',
      { nome: 'ZZ y', email_institucional: `zz${Date.now()}@sissa.test` }, tfisico);
    assertEqual(status, 403);
  });
  await test('Coord. de curso PODE criar usuário de nível menor (Tutor)', async () => {
    const { body } = await POST('/api/sissa/usuarios',
      { nome: 'ZZ NovoTutor', email_institucional: `zztutor${Date.now()}@sissa.test`, perfil_id: 5 }, coordCurso);
    assertTrue(body.success, body.error);
    tmp.usuarioIds.push(body.data.id);
  });
  await test('Coord. de curso NÃO pode criar usuário de nível ≥ (Coord. ensino) → 403', async () => {
    const { status } = await POST('/api/sissa/usuarios',
      { nome: 'ZZ Z', email_institucional: `zz${Date.now()}@sissa.test`, perfil_id: 2 }, coordCurso);
    assertEqual(status, 403);
  });
  await test('Coord. de curso NÃO pode excluir usuários (usuario_excluir é nv4+) → 403', async () => {
    const { status } = await DELETE(`/api/sissa/usuarios/${tutor}`, coordCurso);
    assertEqual(status, 403);
  });
  await test('Tutor NÃO pode editar um Coordenador → 403', async () => {
    const { status } = await PUT(`/api/sissa/usuarios/${coordUnidade}`, { nome: 'hack' }, tutor);
    assertEqual(status, 403);
  });
  await test('Coord. de curso NÃO pode editar Coord. de unidade (nível maior) → 403', async () => {
    const { status } = await PUT(`/api/sissa/usuarios/${coordUnidade}`, { nome: 'hack' }, coordCurso);
    assertEqual(status, 403);
  });
  await test('Coord. de ensino PODE excluir um Tutor', async () => {
    const novo = await scalar(
      `INSERT INTO sissa_usuario_sissa(nome,email_institucional,perfil_id) VALUES('ZZ DelTutor','zzdel${Date.now()}@sissa.test',5) RETURNING id`);
    const { body } = await DELETE(`/api/sissa/usuarios/${novo}`, coordEnsino);
    assertTrue(body.success, body.error);
    assertEqual(Number(await scalar(`SELECT count(*) FROM sissa_usuario_sissa WHERE id=$1`, [novo])), 0);
  });

  // Regra "Tutor edita só as próprias intervenções"
  await test('Tutor edita a PRÓPRIA intervenção (200)', async () => {
    const cria = await POST('/api/sissa/intervencoes',
      { estudante_ids: [mAux], data_intervencao: '2025-04-02', formato: 'Individual', observacoes: 'ZZ propria' }, tutor);
    const id = cria.body.data[0].id; tmp.intervencaoIds.push(id);
    const { body } = await PUT(`/api/sissa/intervencoes/${id}`, { observacoes: 'ZZ editada' }, tutor);
    assertTrue(body.success, body.error);
  });
  await test('Tutor NÃO edita intervenção de OUTRO autor → 403', async () => {
    const cria = await POST('/api/sissa/intervencoes',
      { estudante_ids: [mAux], data_intervencao: '2025-04-03', formato: 'Individual', observacoes: 'ZZ do coord' }, coordUnidade);
    const id = cria.body.data[0].id; tmp.intervencaoIds.push(id);
    const { status } = await PUT(`/api/sissa/intervencoes/${id}`, { observacoes: 'hack' }, tutor);
    assertEqual(status, 403);
  });
}

// ─── Limpeza ────────────────────────────────────────────────────────────────────
async function runCleanup() {
  console.log(`\n${C.dim}─── Limpeza ─────────────────────────────────────────${C.reset}`);
  try {
    for (const id of tmp.intervencaoIds) await q(`DELETE FROM sissa_intervencao WHERE id=$1`, [id]).catch(()=>{});
    for (const id of tmp.grupoIds)       await q(`DELETE FROM sissa_grupo_intervencao WHERE id=$1`, [id]).catch(()=>{});
    for (const id of tmp.matriculaIds)   await q(`DELETE FROM sissa_matricula WHERE id=$1`, [id]).catch(()=>{});
    for (const id of tmp.alunoIds)       await q(`DELETE FROM sissa_aluno WHERE id=$1`, [id]).catch(()=>{});
    for (const id of tmp.usuarioIds)     await q(`DELETE FROM sissa_usuario_sissa WHERE id=$1`, [id]).catch(()=>{});
    // varredura por padrão ZZ / sissa.test (segurança)
    await q(`DELETE FROM sissa_matricula        WHERE codigo LIKE 'ZZ%'`).catch(()=>{});
    await q(`DELETE FROM sissa_aluno            WHERE nome LIKE 'ZZ %'`).catch(()=>{});
    await q(`DELETE FROM sissa_grupo_intervencao WHERE titulo LIKE 'ZZ %'`).catch(()=>{});
    await q(`DELETE FROM sissa_usuario_sissa     WHERE nome LIKE 'ZZ %' OR email_institucional LIKE '%@sissa.test'`).catch(()=>{});
    await q(`DROP TABLE IF EXISTS sissa_bench_chk CASCADE`).catch(()=>{});
    await q(`DROP TABLE IF EXISTS sissa_bench_matricula CASCADE`).catch(()=>{});
    await q(`DROP TABLE IF EXISTS sissa_bench_risco CASCADE`).catch(()=>{});
    console.log(`  ${ok('Dados de teste removidos')}`);
  } catch (err) {
    console.log(`  ${fail('Limpeza parcial: ' + err.message)}`);
  }
}

// ─── Relatório ────────────────────────────────────────────────────────────────
function printReport(totalMs) {
  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`${C.bold}  RELATÓRIO DE TESTES — SISSA (Parte 2: Gestão de Evasão)${C.reset}`);
  console.log(`${'═'.repeat(64)}`);
  const suites = [...new Set(results.map(r => r.suite))];
  for (const s of suites) {
    const sr = results.filter(r => r.suite === s);
    const sp = sr.filter(r => r.passed).length;
    const icon = sp < sr.length ? C.red + '✗' + C.reset : C.green + '✓' + C.reset;
    console.log(`  ${icon}  ${C.bold}${s}${C.reset} — ${sp}/${sr.length}`);
  }
  console.log(`${'─'.repeat(64)}`);
  if (failed.length) {
    console.log(`\n${C.red}${C.bold}  TESTES QUE FALHARAM:${C.reset}`);
    for (const r of failed) {
      console.log(`  ${C.red}✗${C.reset} [${r.suite}] ${r.name}`);
      console.log(`    ${C.dim}→ ${r.error}${C.reset}`);
    }
    console.log('');
  }
  console.log(`${'─'.repeat(64)}`);
  console.log(`  ${C.bold}Total:${C.reset}   ${results.length} testes`);
  console.log(`  ${C.green}${C.bold}Passou:${C.reset}  ${passed.length}`);
  if (failed.length) console.log(`  ${C.red}${C.bold}Falhou:${C.reset}  ${failed.length}`);
  console.log(`  ${C.dim}Duração: ${(totalMs/1000).toFixed(2)}s${C.reset}`);
  console.log(`${'═'.repeat(64)}\n`);
  return failed.length === 0;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}  SISSA — Testes do Módulo de Gestão de Risco de Evasão${C.reset}`);
  console.log(`${C.dim}  Alvo: ${BASE_URL} | DB: ${DB_CONFIG.database}@${DB_CONFIG.host}:${DB_CONFIG.port}${C.reset}\n`);

  process.stdout.write(`  Verificando servidor HTTP… `);
  if (!await waitForServer()) {
    console.log(`${C.red}INACESSÍVEL${C.reset}`);
    console.error(`\n[ERRO] ${BASE_URL}/health inacessível. Rode: cd backend && node server.js\n`);
    process.exit(1);
  }
  console.log(`${C.green}OK${C.reset}`);

  pool = new Pool(DB_CONFIG);
  process.stdout.write(`  Verificando banco… `);
  await q('SELECT 1');
  console.log(`${C.green}OK${C.reset}`);

  // Ator padrão das chamadas mutadoras = Coordenador de unidade (nível 5)
  ACTOR = Number(await scalar(
    `SELECT id FROM sissa_usuario_sissa WHERE email_institucional='laishcandido@gmail.com'`));

  const t0 = Date.now();
  try {
    await suiteSchema();
    await suiteFuncoes();
    await suiteProcedimentos();
    await suiteTriggers();
    await suiteViews();
    await suiteIndices();
    await suiteSeguranca();
    await suiteApiAuth();
    await suiteApiPermissoes();
    await suiteApiEstudantes();
    await suiteApiRoster();
    await suiteApiGrupos();
    await suiteApiIntervencoes();
    await suiteApiUsuarios();
  } finally {
    await runCleanup();
  }
  const okAll = printReport(Date.now() - t0);
  await pool.end();
  process.exit(okAll ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`\n${C.red}Erro fatal: ${err.message}${C.reset}\n`);
  if (pool) await pool.end().catch(()=>{});
  process.exit(1);
});
