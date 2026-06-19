const express = require('express');
const router  = express.Router();
const db      = require('../db');

/* ══════════════════════════════════════════
   CONTROLE DE ACESSO POR NÍVEL (hierarquia de perfis)
   O frontend envia o id do usuário SISSA logado no header
   'x-sissa-usuario-id'. As ações são validadas pela matriz
   sissa_nivel_acao via a função fu_sissa_pode().
══════════════════════════════════════════ */
function getActorId(req) {
  const id = parseInt(req.headers['x-sissa-usuario-id'], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Verifica a permissão de uma ação. Em caso de falha já responde
// (401 sem usuário / 403 sem permissão) e retorna null.
async function exigirPermissao(req, res, acao) {
  const actorId = getActorId(req);
  if (!actorId) {
    res.status(401).json({ success: false, error: 'Autenticação necessária (faça login no SISSA).' });
    return null;
  }
  const r = await db.query('SELECT fu_sissa_pode($1,$2) AS pode', [actorId, acao]);
  if (!r.rows[0] || !r.rows[0].pode) {
    res.status(403).json({ success: false, error: `Seu perfil não tem permissão para esta ação (${acao}).` });
    return null;
  }
  return actorId;
}

// Valida o :id da rota como inteiro positivo; responde 400 e retorna null se inválido.
function getId(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'ID inválido.' });
    return null;
  }
  return id;
}

async function nivelDoUsuario(userId) {
  const r = await db.query('SELECT fu_sissa_nivel_usuario($1) AS n', [userId]);
  return r.rows[0] ? Number(r.rows[0].n) : 0;
}
async function nivelDoPerfil(perfilId) {
  const id = parseInt(perfilId, 10);
  if (!Number.isInteger(id) || id <= 0) return 0;
  const r = await db.query('SELECT nivel FROM sissa_perfil WHERE id=$1', [id]);
  return r.rows[0] ? Number(r.rows[0].nivel) : 0;
}

/* ══════════════════════════════════════════
   AUTH – verifica se usuário tem acesso
   Retorna: { tipo: 'privado' | 'publico', usuario }
   - 'privado': e-mail cadastrado em sissa_usuario_sissa
   - 'publico' : qualquer e-mail com credencial válida (federação)
══════════════════════════════════════════ */
router.post('/auth', async (req, res) => {
  const { email, senha, instituicao_id } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ success: false, error: 'Informe login e senha.' });
  }
  try {
    const result = await db.query(
      `SELECT u.id, u.nome, u.email_institucional, u.senha, u.perfil_id, u.ultimo_acesso,
              p.nome AS perfil_nome, p.nivel AS perfil_nivel,
              array_agg(DISTINCT c.nome) FILTER (WHERE c.nome IS NOT NULL) AS cursos,
              i.nome AS instituicao_nome
       FROM sissa_usuario_sissa u
       LEFT JOIN sissa_perfil        p  ON p.id = u.perfil_id
       LEFT JOIN sissa_usuario_curso uc ON uc.usuario_id = u.id
       LEFT JOIN sissa_curso         c  ON c.id = uc.curso_id
       LEFT JOIN sissa_instituicao   i  ON i.id = $2
       WHERE LOWER(u.email_institucional) = LOWER($1)
       GROUP BY u.id, p.nome, p.nivel, i.nome`,
      [email.trim(), instituicao_id || 1]
    );

    if (result.rows.length > 0) {
      // Usuário cadastrado: exige senha correta para a área privada
      const usuario = result.rows[0];
      if (usuario.senha !== senha) {
        return res.json({ success: false, error: 'E-mail ou senha incorretos.' });
      }
      delete usuario.senha; // nunca devolver a senha ao cliente

      // Anexa as permissões do nível do usuário (para o frontend ocultar ações)
      const permRes = await db.query(
        'SELECT acao FROM sissa_nivel_acao WHERE nivel = $1 ORDER BY acao',
        [usuario.perfil_nivel || 0]
      );
      usuario.permissoes = permRes.rows.map(r => r.acao);

      await db.query(
        'UPDATE sissa_usuario_sissa SET ultimo_acesso = NOW() WHERE id = $1',
        [usuario.id]
      );
      res.json({ success: true, tipo: 'privado', usuario });
    } else {
      // E-mail não cadastrado: acessa a área pública (federação), sem checagem de senha
      res.json({ success: true, tipo: 'publico', usuario: { email, nome: email.split('@')[0] } });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ══════════════════════════════════════════
   ESTATÍSTICAS DE RISCO (para gauge)
══════════════════════════════════════════ */
router.get('/estatisticas/risco', async (req, res) => {
  try {
    const { curso_id } = req.query;
    let q = `
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE r.risco = 'Alto')       AS alto,
        COUNT(*) FILTER (WHERE r.risco = 'Médio')      AS medio,
        COUNT(*) FILTER (WHERE r.risco = 'Baixo')      AS baixo
      FROM sissa_risco_evasao r
      JOIN sissa_matricula m ON m.id = r.matricula_id
      WHERE 1=1`;
    const p = [];
    if (curso_id) { p.push(curso_id); q += ` AND m.curso_id = $${p.length}`; }
    const result = await db.query(q, p);
    const row = result.rows[0];
    const total = parseInt(row.total) || 0;
    const alto  = parseInt(row.alto)  || 0;
    const medio = parseInt(row.medio) || 0;
    const baixo = parseInt(row.baixo) || 0;
    res.json({
      success: true,
      data: {
        total,
        alto,  pct_alto:  total ? Math.round(alto  / total * 100) : 0,
        medio, pct_medio: total ? Math.round(medio / total * 100) : 0,
        baixo, pct_baixo: total ? Math.round(baixo / total * 100) : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ══════════════════════════════════════════
   ESTUDANTES
══════════════════════════════════════════ */
router.get('/estudantes', async (req, res) => {
  try {
    const { curso_id, risco } = req.query;
    let q = 'SELECT * FROM vw_sissa_estudantes_risco WHERE 1=1';
    const p = [];
    if (curso_id) { p.push(curso_id); q += ` AND curso_id = $${p.length}`; }
    if (risco)    { p.push(risco);    q += ` AND risco = $${p.length}`; }
    q += " ORDER BY CASE risco WHEN 'Alto' THEN 1 WHEN 'Médio' THEN 2 WHEN 'Baixo' THEN 3 ELSE 4 END, nome";
    const result = await db.query(q, p);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/estudantes', async (req, res) => {
  if (!await exigirPermissao(req, res, 'estudante_gerenciar')) return;
  const {
    matricula, nome, curso_id, ingresso,
    semestre_saida, media_global, semestre_atual,
    reprovacoes, ch_semestre, maior_influencia, turmas
  } = req.body;
  if (!matricula || !nome || !curso_id) {
    return res.status(400).json({ success: false, error: 'matricula, nome e curso_id são obrigatórios' });
  }

  // converte string vazia / undefined em NULL para colunas numéricas
  const num = (v) => (v === '' || v === undefined || v === null ? null : v);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Aluno (pessoa) + matrícula (vínculo curso, guarda os indicadores)
    const aRes = await client.query(
      'INSERT INTO sissa_aluno (nome) VALUES ($1) RETURNING id',
      [nome]
    );
    const alunoId = aRes.rows[0].id;

    const mRes = await client.query(
      `INSERT INTO sissa_matricula
         (codigo, aluno_id, curso_id, ingresso, media_global, reprovacoes, ch_semestre)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,0),COALESCE($7,0)) RETURNING id`,
      [matricula, alunoId, curso_id, num(ingresso),
       num(media_global), num(reprovacoes), num(ch_semestre)]
    );
    const matriculaId = mRes.rows[0].id;

    // 'risco' é derivado pela trigger tg_sissa_classificar_risco (fonte única)
    await client.query(
      `INSERT INTO sissa_risco_evasao
         (matricula_id, semestre_saida, semestre_atual, maior_influencia, turmas)
       VALUES ($1,$2,$3,$4,COALESCE($5,0))`,
      [matriculaId, num(semestre_saida), num(semestre_atual),
       maior_influencia || null, num(turmas)]
    );

    const vRes = await client.query(
      'SELECT * FROM vw_sissa_estudantes_risco WHERE id = $1',
      [matriculaId]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: vRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/* ══════════════════════════════════════════
   ROSTER — alunos do cadastro acadêmico da universidade
   (origem para o fluxo de importação de estudantes)
══════════════════════════════════════════ */
router.get('/roster', async (req, res) => {
  try {
    const { q, curso } = req.query;
    let sql = 'SELECT * FROM vw_roster_universidade';
    const conditions = [];
    const p = [];
    if (curso) {
      p.push(curso);
      conditions.push(`curso_nome = $${p.length}`);
    }
    if (q) {
      p.push(`%${q}%`);
      conditions.push(`(nome ILIKE $${p.length} OR curso_nome ILIKE $${p.length})`);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY nome';
    const result = await db.query(sql, p);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/estudantes/importar', async (req, res) => {
  if (!await exigirPermissao(req, res, 'estudante_gerenciar')) return;
  const { aluno_id, curso_esperado } = req.body;
  if (!aluno_id) {
    return res.status(400).json({ success: false, error: 'aluno_id é obrigatório' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const rRes = await client.query(
      'SELECT * FROM vw_roster_universidade WHERE aluno_id = $1',
      [aluno_id]
    );
    if (!rRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Aluno não encontrado no cadastro da universidade.' });
    }
    const r = rRes.rows[0];

    // Garante que só é possível importar aluno do curso da tela atual
    // (defesa server-side, independente do filtro já aplicado no GET /roster)
    if (curso_esperado && r.curso_nome !== curso_esperado) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        error: `Este aluno pertence ao curso "${r.curso_nome}" e não pode ser importado nesta tela (curso atual: "${curso_esperado}").`
      });
    }

    if (r.ja_importado) {
      await client.query('ROLLBACK');
      return res.json({ success: false, error: 'Estudante já importado.' });
    }

    // Mapeia o curso da universidade para o curso da plataforma (por nome)
    const cRes = await client.query('SELECT id FROM sissa_curso WHERE nome = $1', [r.curso_nome]);
    if (!cRes.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ success: false, error: `Curso "${r.curso_nome}" não existe na plataforma SISSA.` });
    }
    const cursoId = cRes.rows[0].id;

    // Achar-ou-criar o aluno (pessoa) pelo email vindo do roster da universidade
    const aRes = await client.query(
      `INSERT INTO sissa_aluno (nome, email) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome
       RETURNING id`,
      [r.nome, r.email]
    );
    const alunoId = aRes.rows[0].id;

    // Matrícula (vínculo curso + indicadores acadêmicos vindos da universidade)
    const mRes = await client.query(
      `INSERT INTO sissa_matricula
         (codigo, aluno_id, curso_id, ingresso, naturalidade_uf, forma_ingresso,
          media_global, reprovacoes, ch_semestre)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [r.matricula_codigo, alunoId, cursoId, r.ingresso, r.naturalidade_uf,
       r.forma_ingresso, r.media_global, r.reprovacoes, r.ch_semestre]
    );
    const matriculaId = mRes.rows[0].id;

    // 'risco' é definido automaticamente pelo trigger tg_sissa_classificar_risco
    await client.query(
      `INSERT INTO sissa_risco_evasao
         (matricula_id, maior_influencia, percentual, turmas)
       VALUES ($1,$2,$3,$4)`,
      [matriculaId, r.maior_influencia, r.percentual, r.turmas]
    );

    const vRes = await client.query(
      'SELECT * FROM vw_sissa_estudantes_risco WHERE id = $1',
      [matriculaId]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: vRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    // matrícula duplicada → aluno já importado
    if (err.code === '23505') {
      return res.json({ success: false, error: 'Estudante já importado.' });
    }
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/* ══════════════════════════════════════════
   GRUPOS DE INTERVENÇÃO
   Rotas: /grupos  e  /grupos-intervencao (alias para compatibilidade)
══════════════════════════════════════════ */
async function getGrupos(req, res) {
  try {
    const result = await db.query('SELECT * FROM vw_sissa_grupos ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getGrupoById(req, res) {
  try {
    const g = await db.query('SELECT * FROM vw_sissa_grupos WHERE id = $1', [req.params.id]);
    if (!g.rows.length) return res.status(404).json({ success: false, error: 'Grupo não encontrado' });

    const estudantes = await db.query(
      `SELECT m.id, m.codigo AS matricula, a.nome, c.nome AS curso_nome
       FROM sissa_grupo_matricula gm
       JOIN sissa_matricula m ON m.id = gm.matricula_id
       JOIN sissa_aluno a     ON a.id = m.aluno_id
       JOIN sissa_curso c     ON c.id = m.curso_id
       WHERE gm.grupo_id = $1
       ORDER BY a.nome`, [req.params.id]
    );

    res.json({ success: true, data: { ...g.rows[0], estudantes: estudantes.rows } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function createGrupo(req, res) {
  if (!await exigirPermissao(req, res, 'grupo_gerenciar')) return;
  // estudante_ids = ids de MATRÍCULA (o grupo é um favorito de matrículas)
  const { titulo, semestre, observacoes, autoria_id, estudante_ids = [] } = req.body;
  if (!titulo) return res.status(400).json({ success: false, error: 'titulo é obrigatório' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const gRes = await client.query(
      'INSERT INTO sissa_grupo_intervencao (titulo, semestre, observacoes, autoria_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [titulo, semestre || null, observacoes || null, autoria_id || null]
    );
    const grupo = gRes.rows[0];

    for (const mid of estudante_ids) {
      await client.query(
        'INSERT INTO sissa_grupo_matricula (grupo_id, matricula_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [grupo.id, mid]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, data: grupo });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
}

async function updateGrupo(req, res) {
  if (!await exigirPermissao(req, res, 'grupo_gerenciar')) return;
  const { titulo, semestre, observacoes, status, estudante_ids } = req.body;
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE sissa_grupo_intervencao
       SET titulo      = COALESCE($1, titulo),
           semestre    = COALESCE($2, semestre),
           observacoes = COALESCE($3, observacoes),
           status      = COALESCE($4, status)
       WHERE id = $5`,
      [titulo, semestre, observacoes, status, req.params.id]
    );

    if (Array.isArray(estudante_ids)) {
      // estudante_ids = ids de MATRÍCULA
      await client.query('DELETE FROM sissa_grupo_matricula WHERE grupo_id = $1', [req.params.id]);
      for (const mid of estudante_ids) {
        await client.query(
          'INSERT INTO sissa_grupo_matricula (grupo_id, matricula_id) VALUES ($1,$2)',
          [req.params.id, mid]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
}

async function deleteGrupo(req, res) {
  if (!await exigirPermissao(req, res, 'grupo_excluir')) return;
  try {
    await db.query('DELETE FROM sissa_grupo_intervencao WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// Rotas canônicas /grupos
router.get('/grupos',         getGrupos);
router.post('/grupos',        createGrupo);
router.get('/grupos/:id',     getGrupoById);
router.put('/grupos/:id',     updateGrupo);
router.delete('/grupos/:id',  deleteGrupo);

// Sub-rota explícita de estudantes de um grupo
router.get('/grupos/:id/estudantes', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT m.id, m.codigo AS matricula, a.nome,
              c.nome AS curso_nome,
              r.risco, m.media_global, m.reprovacoes
       FROM sissa_grupo_matricula gm
       JOIN sissa_matricula m    ON m.id = gm.matricula_id
       JOIN sissa_aluno a        ON a.id = m.aluno_id
       JOIN sissa_curso c        ON c.id = m.curso_id
       LEFT JOIN sissa_risco_evasao r ON r.matricula_id = m.id
       WHERE gm.grupo_id = $1
       ORDER BY a.nome`,
      [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fluxo "a partir do grupo": CALL da procedure que cria UMA intervenção
// individual por matrícula membro do grupo (demonstra a procedure no banco,
// em vez de refazer a lógica em JS).
router.post('/grupos/:id/intervencoes', async (req, res) => {
  const actorId = await exigirPermissao(req, res, 'intervencao_criar');
  if (!actorId) return;
  const grupoId = getId(req, res); if (!grupoId) return;
  const {
    data_intervencao, semestre_id, disciplina_id, forma_meio, assunto,
    interacao, tipo, acompanhamento, observacoes
  } = req.body;
  const num = (v) => (v === '' || v === undefined || v === null ? null : v);
  try {
    const r = await db.query(
      'CALL pr_sissa_criar_intervencao_grupo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [grupoId, data_intervencao || null, num(semestre_id), num(disciplina_id),
       forma_meio || null, assunto || null, interacao || null, tipo || null,
       acompanhamento || null, observacoes || null, 0]
    );
    res.json({ success: true, total: r.rows[0] ? r.rows[0].p_total : 0 });
  } catch (err) {
    // grupo inexistente → a procedure dá RAISE EXCEPTION
    res.status(400).json({ success: false, error: err.message });
  }
});

// Aliases legados /grupos-intervencao (mantidos para JS existente no frontend)
router.get('/grupos-intervencao',          getGrupos);
router.post('/grupos-intervencao',         createGrupo);
router.get('/grupos-intervencao/:id',      getGrupoById);
router.put('/grupos-intervencao/:id',      updateGrupo);
router.delete('/grupos-intervencao/:id',   deleteGrupo);

/* ══════════════════════════════════════════
   INTERVENÇÕES
══════════════════════════════════════════ */
router.get('/intervencoes', async (req, res) => {
  try {
    const { grupo_id, data_min, data_max, busca } = req.query;
    // Intervenção é individual: 1 linha por matrícula. Inclui rótulos de
    // disciplina/semestre e o nome do aluno (estudante_nomes como array de 1
    // elemento mantém o render atual do front).
    let q = `
      SELECT i.*,
             m.codigo  AS matricula,
             a.nome    AS estudante_nome,
             ARRAY[a.nome] AS estudante_nomes,
             d.nome    AS disciplina,
             (s.ano || '/' || s.periodo) AS semestre
      FROM sissa_intervencao i
      JOIN sissa_matricula m       ON m.id = i.matricula_id
      JOIN sissa_aluno a           ON a.id = m.aluno_id
      LEFT JOIN sissa_disciplina d ON d.id = i.disciplina_id
      LEFT JOIN sissa_semestre s   ON s.id = i.semestre_id
      WHERE 1=1`;
    const p = [];
    if (grupo_id) { p.push(grupo_id);  q += ` AND i.matricula_id IN (SELECT matricula_id FROM sissa_grupo_matricula WHERE grupo_id = $${p.length})`; }
    if (data_min) { p.push(data_min);  q += ` AND i.data_intervencao >= $${p.length}`; }
    if (data_max) { p.push(data_max);  q += ` AND i.data_intervencao <= $${p.length}`; }
    if (busca)    { p.push(`%${busca}%`); q += ` AND (a.nome ILIKE $${p.length} OR i.observacoes ILIKE $${p.length} OR d.nome ILIKE $${p.length})`; }
    q += ' ORDER BY i.data_intervencao DESC';

    const result = await db.query(q, p);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Intervenção é INDIVIDUAL: selecionar N matrículas cria N intervenções
// (uma por matrícula). estudante_ids = ids de matrícula.
router.post('/intervencoes', async (req, res) => {
  const actorId = await exigirPermissao(req, res, 'intervencao_criar');
  if (!actorId) return;
  const {
    estudante_ids = [], disciplina_id, semestre_id, data_intervencao, forma_meio, assunto,
    formato, interacao, tipo, acompanhamento, duracao, objetivo_alcancado,
    observacoes, encaminhado, encaminhar_para
  } = req.body;
  if (!Array.isArray(estudante_ids) || estudante_ids.length === 0) {
    return res.status(400).json({ success: false, error: 'Selecione ao menos uma matrícula (estudante_ids).' });
  }
  const num = (v) => (v === '' || v === undefined || v === null ? null : v);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const criadas = [];
    // autoria_id = usuário logado (permite que o Tutor edite só as próprias)
    for (const mid of estudante_ids) {
      const iRes = await client.query(
        `INSERT INTO sissa_intervencao
           (matricula_id, disciplina_id, semestre_id, data_intervencao, forma_meio, assunto,
            formato, interacao, tipo, acompanhamento, duracao, objetivo_alcancado,
            observacoes, encaminhado, encaminhar_para, autoria_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [mid, num(disciplina_id), num(semestre_id), data_intervencao || null, forma_meio || null, assunto || null,
         formato || 'Individual', interacao || null, tipo || null, acompanhamento || null, duracao || null,
         objetivo_alcancado || null, observacoes || null, encaminhado || false, encaminhar_para || null, actorId]
      );
      criadas.push(iRes.rows[0]);
    }

    await client.query('COMMIT');
    res.json({ success: true, data: criadas, total: criadas.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

router.put('/intervencoes/:id', async (req, res) => {
  const actorId = await exigirPermissao(req, res, 'intervencao_editar');
  if (!actorId) return;
  const alvoId = getId(req, res); if (!alvoId) return;

  // Regra do piso: o Tutor (nível 1) só pode editar as próprias intervenções.
  const nivel = await nivelDoUsuario(actorId);
  if (nivel <= 1) {
    const dono = await db.query('SELECT autoria_id FROM sissa_intervencao WHERE id=$1', [req.params.id]);
    if (!dono.rows.length) {
      return res.status(404).json({ success: false, error: 'Intervenção não encontrada.' });
    }
    if (dono.rows[0].autoria_id !== actorId) {
      return res.status(403).json({ success: false, error: 'Tutor só pode editar as próprias intervenções.' });
    }
  }

  const {
    data_intervencao, semestre_id, disciplina_id, forma_meio, assunto, formato,
    interacao, tipo, acompanhamento, duracao, objetivo_alcancado,
    observacoes, encaminhado, encaminhar_para
  } = req.body;
  try {
    // matricula_id permanece imutável (a intervenção pertence a uma matrícula)
    await db.query(
      `UPDATE sissa_intervencao SET
         data_intervencao   = COALESCE($1,  data_intervencao),
         semestre_id        = COALESCE($2,  semestre_id),
         disciplina_id      = COALESCE($3,  disciplina_id),
         forma_meio         = COALESCE($4,  forma_meio),
         assunto            = COALESCE($5,  assunto),
         formato            = COALESCE($6,  formato),
         interacao          = COALESCE($7,  interacao),
         tipo               = COALESCE($8,  tipo),
         acompanhamento     = COALESCE($9,  acompanhamento),
         duracao            = COALESCE($10, duracao),
         objetivo_alcancado = COALESCE($11, objetivo_alcancado),
         observacoes        = COALESCE($12, observacoes),
         encaminhado        = COALESCE($13, encaminhado),
         encaminhar_para    = COALESCE($14, encaminhar_para)
       WHERE id = $15`,
      [data_intervencao, semestre_id, disciplina_id, forma_meio, assunto, formato,
       interacao, tipo, acompanhamento, duracao, objetivo_alcancado,
       observacoes, encaminhado, encaminhar_para, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/intervencoes/:id', async (req, res) => {
  if (!await exigirPermissao(req, res, 'intervencao_excluir')) return;
  try {
    await db.query('DELETE FROM sissa_intervencao WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ══════════════════════════════════════════
   USUÁRIOS SISSA
══════════════════════════════════════════ */
router.get('/usuarios', async (req, res) => {
  try {
    const { perfil_id, curso_id } = req.query;
    let q = `
      SELECT u.id, u.nome, u.email_institucional, u.perfil_id, u.ultimo_acesso, u.created_at,
             p.nome AS perfil_nome, p.nivel AS perfil_nivel,
             array_agg(DISTINCT c.id)   FILTER (WHERE c.id IS NOT NULL)   AS curso_ids,
             array_agg(DISTINCT c.nome) FILTER (WHERE c.nome IS NOT NULL) AS cursos
      FROM sissa_usuario_sissa u
      LEFT JOIN sissa_perfil p          ON p.id = u.perfil_id
      LEFT JOIN sissa_usuario_curso uc  ON uc.usuario_id = u.id
      LEFT JOIN sissa_curso c           ON c.id = uc.curso_id
      WHERE 1=1`;
    const params = [];
    if (perfil_id) { params.push(perfil_id); q += ` AND u.perfil_id = $${params.length}`; }
    if (curso_id)  { params.push(curso_id);  q += ` AND uc.curso_id = $${params.length}`; }
    q += ' GROUP BY u.id, p.nome, p.nivel ORDER BY u.nome';
    const result = await db.query(q, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/usuarios', async (req, res) => {
  const actorId = await exigirPermissao(req, res, 'usuario_gerenciar');
  if (!actorId) return;
  const { nome, email_institucional, perfil_id, curso_ids = [] } = req.body;
  if (!nome || !email_institucional) {
    return res.status(400).json({ success: false, error: 'nome e email_institucional são obrigatórios' });
  }
  // Não é possível criar um usuário de nível maior ou igual ao seu
  const nivelAtor = await nivelDoUsuario(actorId);
  if (await nivelDoPerfil(perfil_id) >= nivelAtor) {
    return res.status(403).json({ success: false, error: 'Você não pode criar um usuário de nível igual ou superior ao seu.' });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const uRes = await client.query(
      'INSERT INTO sissa_usuario_sissa (nome, email_institucional, perfil_id) VALUES ($1,$2,$3) RETURNING *',
      [nome, email_institucional, perfil_id || null]
    );
    const u = uRes.rows[0];
    for (const cid of curso_ids) {
      await client.query(
        'INSERT INTO sissa_usuario_curso (usuario_id, curso_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [u.id, cid]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, data: u });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

router.put('/usuarios/:id', async (req, res) => {
  const actorId = await exigirPermissao(req, res, 'usuario_gerenciar');
  if (!actorId) return;
  const alvoId = getId(req, res); if (!alvoId) return;
  // Só pode editar quem é de nível estritamente menor que o seu
  const podeGerenciar = await db.query(
    'SELECT fu_sissa_pode_gerenciar_usuario($1,$2) AS ok', [actorId, alvoId]);
  if (!podeGerenciar.rows[0].ok) {
    return res.status(403).json({ success: false, error: 'Você não pode editar um usuário de nível igual ou superior ao seu.' });
  }
  const { nome, email_institucional, perfil_id, curso_ids } = req.body;
  // Não pode promover alguém a um nível maior ou igual ao seu
  if (perfil_id !== undefined && perfil_id !== null) {
    const nivelAtor = await nivelDoUsuario(actorId);
    if (await nivelDoPerfil(perfil_id) >= nivelAtor) {
      return res.status(403).json({ success: false, error: 'Você não pode atribuir um nível igual ou superior ao seu.' });
    }
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE sissa_usuario_sissa SET
         nome                = COALESCE($1, nome),
         email_institucional = COALESCE($2, email_institucional),
         perfil_id           = COALESCE($3, perfil_id)
       WHERE id = $4`,
      [nome, email_institucional, perfil_id, req.params.id]
    );
    if (Array.isArray(curso_ids)) {
      await client.query('DELETE FROM sissa_usuario_curso WHERE usuario_id = $1', [req.params.id]);
      for (const cid of curso_ids) {
        await client.query(
          'INSERT INTO sissa_usuario_curso (usuario_id, curso_id) VALUES ($1,$2)',
          [req.params.id, cid]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/usuarios/:id', async (req, res) => {
  const actorId = await exigirPermissao(req, res, 'usuario_excluir');
  if (!actorId) return;
  const alvoId = getId(req, res); if (!alvoId) return;
  const podeGerenciar = await db.query(
    'SELECT fu_sissa_pode_gerenciar_usuario($1,$2) AS ok', [actorId, alvoId]);
  if (!podeGerenciar.rows[0].ok) {
    return res.status(403).json({ success: false, error: 'Você não pode excluir um usuário de nível igual ou superior ao seu.' });
  }
  try {
    await db.query('DELETE FROM sissa_usuario_sissa WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ══════════════════════════════════════════
   AUX: CURSOS + PERFIS + INSTITUIÇÕES
══════════════════════════════════════════ */
router.get('/cursos', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.*, un.nome AS unidade_nome, i.nome AS instituicao_nome, i.code_mec
      FROM sissa_curso c
      JOIN sissa_unidade un     ON un.id = c.unidade_id
      JOIN sissa_instituicao i  ON i.id = un.instituicao_id
      ORDER BY i.nome, c.nome`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Resumo agregado do curso (usa a função fu_sissa_resumo_curso)
router.get('/resumo-curso/:curso_id', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM fu_sissa_resumo_curso($1)', [req.params.curso_id]);
    res.json({ success: true, data: r.rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/perfis', async (req, res) => {
  try {
    const result = await db.query('SELECT id, nome, nivel FROM sissa_perfil ORDER BY nivel DESC, nome');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Matriz de permissões por perfil/nível (para exibir a hierarquia)
router.get('/permissoes', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.id AS perfil_id, p.nome AS perfil_nome, p.nivel,
             array_agg(na.acao ORDER BY na.acao) AS acoes
      FROM sissa_perfil p
      LEFT JOIN sissa_nivel_acao na ON na.nivel = p.nivel
      GROUP BY p.id, p.nome, p.nivel
      ORDER BY p.nivel DESC, p.nome`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/instituicoes', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sissa_instituicao ORDER BY nome');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Disciplinas (opcionalmente por curso) — alimenta o select da intervenção
router.get('/disciplinas', async (req, res) => {
  try {
    const { curso_id } = req.query;
    let q = 'SELECT id, nome, codigo, carga_horaria, curso_id FROM sissa_disciplina WHERE 1=1';
    const p = [];
    if (curso_id) { p.push(curso_id); q += ` AND curso_id = $${p.length}`; }
    q += ' ORDER BY nome';
    const result = await db.query(q, p);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Semestres — alimenta o select da intervenção
router.get('/semestres', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, ano, periodo, (ano || '/' || periodo) AS rotulo
       FROM sissa_semestre ORDER BY ano DESC, periodo DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rotina de manutenção: CALL da 2ª procedure (inativa grupos antigos).
router.post('/manutencao/status-grupos', async (req, res) => {
  if (!await exigirPermissao(req, res, 'grupo_gerenciar')) return;
  try {
    const r = await db.query('CALL pr_sissa_atualizar_status_grupos($1)', [0]);
    res.json({ success: true, total: r.rows[0] ? r.rows[0].p_total : 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
