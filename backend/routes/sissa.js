const express = require('express');
const router  = express.Router();
const db      = require('../db');

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
              p.nome AS perfil_nome,
              array_agg(DISTINCT c.nome) FILTER (WHERE c.nome IS NOT NULL) AS cursos,
              i.nome AS instituicao_nome
       FROM sissa_usuario_sissa u
       LEFT JOIN sissa_perfil        p  ON p.id = u.perfil_id
       LEFT JOIN sissa_usuario_curso uc ON uc.usuario_id = u.id
       LEFT JOIN sissa_curso         c  ON c.id = uc.curso_id
       LEFT JOIN sissa_instituicao   i  ON i.id = $2
       WHERE LOWER(u.email_institucional) = LOWER($1)
       GROUP BY u.id, p.nome, i.nome`,
      [email.trim(), instituicao_id || 1]
    );

    if (result.rows.length > 0) {
      // Usuário cadastrado: exige senha correta para a área privada
      const usuario = result.rows[0];
      if (usuario.senha !== senha) {
        return res.json({ success: false, error: 'E-mail ou senha incorretos.' });
      }
      delete usuario.senha; // nunca devolver a senha ao cliente
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
      JOIN sissa_estudante e ON e.id = r.estudante_id
      WHERE 1=1`;
    const p = [];
    if (curso_id) { p.push(curso_id); q += ` AND e.curso_id = $${p.length}`; }
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

    const eRes = await client.query(
      'INSERT INTO sissa_estudante (matricula, nome, curso_id, ingresso) VALUES ($1,$2,$3,$4) RETURNING id',
      [matricula, nome, curso_id, num(ingresso)]
    );
    const estudanteId = eRes.rows[0].id;

    await client.query(
      `INSERT INTO sissa_risco_evasao
         (estudante_id, semestre_saida, media_global, semestre_atual,
          reprovacoes, ch_semestre, maior_influencia, turmas)
       VALUES ($1,$2,$3,$4,COALESCE($5,0),COALESCE($6,0),$7,COALESCE($8,0))`,
      [estudanteId, num(semestre_saida), num(media_global), num(semestre_atual),
       num(reprovacoes), num(ch_semestre), maior_influencia || null, num(turmas)]
    );

    // nível de risco derivado automaticamente pela função de domínio
    await client.query(
      'UPDATE sissa_risco_evasao SET risco = fu_sissa_calcular_risco($1) WHERE estudante_id = $1',
      [estudanteId]
    );

    const vRes = await client.query(
      'SELECT * FROM vw_sissa_estudantes_risco WHERE id = $1',
      [estudanteId]
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

    const eRes = await client.query(
      'INSERT INTO sissa_estudante (matricula, nome, curso_id, ingresso) VALUES ($1,$2,$3,$4) RETURNING id',
      [r.matricula_codigo, r.nome, cursoId, r.ingresso]
    );
    const estudanteId = eRes.rows[0].id;

    // 'risco' é definido automaticamente pelo trigger tg_sissa_classificar_risco
    await client.query(
      `INSERT INTO sissa_risco_evasao
         (estudante_id, media_global, reprovacoes, ch_semestre, turmas, maior_influencia)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [estudanteId, r.media_global, r.reprovacoes, r.ch_semestre, r.turmas, r.maior_influencia]
    );

    const vRes = await client.query(
      'SELECT * FROM vw_sissa_estudantes_risco WHERE id = $1',
      [estudanteId]
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
      `SELECT e.id, e.matricula, e.nome, c.nome AS curso_nome
       FROM sissa_grupo_estudante ge
       JOIN sissa_estudante e ON e.id = ge.estudante_id
       JOIN sissa_curso c     ON c.id = e.curso_id
       WHERE ge.grupo_id = $1
       ORDER BY e.nome`, [req.params.id]
    );

    res.json({ success: true, data: { ...g.rows[0], estudantes: estudantes.rows } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function createGrupo(req, res) {
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

    for (const eid of estudante_ids) {
      await client.query(
        'INSERT INTO sissa_grupo_estudante (grupo_id, estudante_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [grupo.id, eid]
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
      await client.query('DELETE FROM sissa_grupo_estudante WHERE grupo_id = $1', [req.params.id]);
      for (const eid of estudante_ids) {
        await client.query(
          'INSERT INTO sissa_grupo_estudante (grupo_id, estudante_id) VALUES ($1,$2)',
          [req.params.id, eid]
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
      `SELECT e.id, e.matricula, e.nome,
              c.nome AS curso_nome,
              r.risco, r.media_global, r.reprovacoes
       FROM sissa_grupo_estudante ge
       JOIN sissa_estudante e    ON e.id = ge.estudante_id
       JOIN sissa_curso c        ON c.id = e.curso_id
       LEFT JOIN sissa_risco_evasao r ON r.estudante_id = e.id
       WHERE ge.grupo_id = $1
       ORDER BY e.nome`,
      [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    let q = `
      SELECT i.*,
             array_agg(ie.estudante_id ORDER BY ie.estudante_id) FILTER (WHERE ie.estudante_id IS NOT NULL) AS estudante_ids,
             array_agg(e.nome          ORDER BY e.nome)          FILTER (WHERE e.nome IS NOT NULL)          AS estudante_nomes,
             g.titulo AS grupo_titulo
      FROM sissa_intervencao i
      LEFT JOIN sissa_intervencao_estudante ie ON ie.intervencao_id = i.id
      LEFT JOIN sissa_estudante e              ON e.id = ie.estudante_id
      LEFT JOIN sissa_grupo_intervencao g      ON g.id = i.grupo_id
      WHERE 1=1`;
    const p = [];
    if (grupo_id) { p.push(grupo_id);  q += ` AND i.grupo_id = $${p.length}`; }
    if (data_min) { p.push(data_min);  q += ` AND i.data_intervencao >= $${p.length}`; }
    if (data_max) { p.push(data_max);  q += ` AND i.data_intervencao <= $${p.length}`; }
    if (busca)    { p.push(`%${busca}%`); q += ` AND (g.titulo ILIKE $${p.length} OR i.observacoes ILIKE $${p.length})`; }
    q += ' GROUP BY i.id, g.titulo ORDER BY i.data_intervencao DESC';

    const result = await db.query(q, p);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/intervencoes', async (req, res) => {
  const {
    grupo_id, data_intervencao, semestre, disciplina, forma_meio, assunto,
    formato, interacao, tipo, acompanhamento, duracao, objetivo_alcancado,
    observacoes, encaminhado, encaminhar_para, estudante_ids = []
  } = req.body;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const iRes = await client.query(
      `INSERT INTO sissa_intervencao
         (grupo_id, data_intervencao, semestre, disciplina, forma_meio, assunto,
          formato, interacao, tipo, acompanhamento, duracao, objetivo_alcancado,
          observacoes, encaminhado, encaminhar_para)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [grupo_id || null, data_intervencao || null, semestre || null, disciplina || null,
       forma_meio || null, assunto || null, formato || null, interacao || null,
       tipo || null, acompanhamento || null, duracao || null, objetivo_alcancado || null,
       observacoes || null, encaminhado || false, encaminhar_para || null]
    );
    const intervencao = iRes.rows[0];

    for (const eid of estudante_ids) {
      await client.query(
        'INSERT INTO sissa_intervencao_estudante (intervencao_id, estudante_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [intervencao.id, eid]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, data: intervencao });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

router.put('/intervencoes/:id', async (req, res) => {
  const {
    data_intervencao, semestre, disciplina, forma_meio, assunto, formato,
    interacao, tipo, acompanhamento, duracao, objetivo_alcancado,
    observacoes, encaminhado, encaminhar_para, estudante_ids
  } = req.body;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE sissa_intervencao SET
         data_intervencao   = COALESCE($1,  data_intervencao),
         semestre           = COALESCE($2,  semestre),
         disciplina         = COALESCE($3,  disciplina),
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
      [data_intervencao, semestre, disciplina, forma_meio, assunto, formato,
       interacao, tipo, acompanhamento, duracao, objetivo_alcancado,
       observacoes, encaminhado, encaminhar_para, req.params.id]
    );

    if (Array.isArray(estudante_ids)) {
      await client.query('DELETE FROM sissa_intervencao_estudante WHERE intervencao_id = $1', [req.params.id]);
      for (const eid of estudante_ids) {
        await client.query(
          'INSERT INTO sissa_intervencao_estudante (intervencao_id, estudante_id) VALUES ($1,$2)',
          [req.params.id, eid]
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

router.delete('/intervencoes/:id', async (req, res) => {
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
             p.nome AS perfil_nome,
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
    q += ' GROUP BY u.id, p.nome ORDER BY u.nome';
    const result = await db.query(q, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/usuarios', async (req, res) => {
  const { nome, email_institucional, perfil_id, curso_ids = [] } = req.body;
  if (!nome || !email_institucional) {
    return res.status(400).json({ success: false, error: 'nome e email_institucional são obrigatórios' });
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
  const { nome, email_institucional, perfil_id, curso_ids } = req.body;
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
      SELECT c.*, i.nome AS instituicao_nome, i.code_mec
      FROM sissa_curso c
      JOIN sissa_instituicao i ON i.id = c.instituicao_id
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
    const result = await db.query('SELECT * FROM sissa_perfil ORDER BY nome');
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

module.exports = router;
