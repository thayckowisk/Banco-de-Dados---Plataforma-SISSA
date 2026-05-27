const express = require('express');
const router  = express.Router();
const db      = require('../db');

async function refreshGroupViews() {
  await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_grupo');
  await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_permissoes_grupo');
}

// GET /api/grupos[?search=term]
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM vmw_consulta_grupo';
    const params = [];
    if (search) {
      query += ' WHERE LOWER(nome) LIKE $1';
      params.push(`%${search.toLowerCase()}%`);
    }
    query += ' ORDER BY nome';
    const result = await db.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/grupos/copiar — placeholder to avoid route conflict (must be before /:id)
// POST /api/grupos/copiar
router.post('/copiar', async (req, res) => {
  const { grupo_origem, novo_grupo } = req.body;
  if (!grupo_origem || !novo_grupo) {
    return res.status(400).json({ success: false, error: 'Informe grupo_origem e novo_grupo' });
  }
  try {
    const result = await db.query(
      'SELECT pr_copiar_grupo($1, $2) AS total_habilitadas',
      [grupo_origem, novo_grupo]
    );
    await refreshGroupViews();
    res.json({ success: true, data: { total_habilitadas: result.rows[0].total_habilitadas } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/grupos/permissoes/:id
router.get('/permissoes/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM vw_consulta_permissoes_grupo WHERE grupo_id = $1 ORDER BY modulo, categoria, funcionalidade',
      [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/grupos/:id
router.get('/:id', async (req, res) => {
  try {
    const grupoRes = await db.query(
      'SELECT * FROM vw_consulta_grupo WHERE id = $1',
      [req.params.id]
    );
    if (!grupoRes.rows.length) {
      return res.status(404).json({ success: false, error: 'Grupo não encontrado' });
    }

    const permRes = await db.query(
      'SELECT * FROM vw_consulta_permissoes_grupo WHERE grupo_id = $1 ORDER BY modulo, categoria, funcionalidade',
      [req.params.id]
    );

    const usersRes = await db.query(
      `SELECT u.id, u.email, u.nome
       FROM usuario_grupo ug
       JOIN usuario u ON u.id = ug.usuario_id
       WHERE ug.grupo_id = $1
       ORDER BY u.email`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        ...grupoRes.rows[0],
        permissoes: permRes.rows,
        usuarios:   usersRes.rows,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/grupos  { nome, permissoes: [{ funcionalidade_id, habilitado }], usuario_ids: [] }
router.post('/', async (req, res) => {
  const { nome, permissoes = [], usuario_ids = [] } = req.body;
  if (!nome || !nome.trim()) {
    return res.status(400).json({ success: false, error: 'Nome do grupo é obrigatório' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const ins = await client.query(
      'INSERT INTO grupo (nome) VALUES ($1) RETURNING id',
      [nome.trim()]
    );
    const grupoId = ins.rows[0].id;

    // Insert all funcionalidades (with habilitado state)
    const allFuncs = await client.query('SELECT id FROM funcionalidade');
    for (const f of allFuncs.rows) {
      const perm = permissoes.find(p => p.funcionalidade_id === f.id);
      await client.query(
        'INSERT INTO grupo_funcionalidade (grupo_id, funcionalidade_id, habilitado) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [grupoId, f.id, perm ? perm.habilitado : false]
      );
    }

    for (const uid of usuario_ids) {
      await client.query(
        'INSERT INTO usuario_grupo (usuario_id, grupo_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [uid, grupoId]
      );
    }

    await client.query('COMMIT');
    await refreshGroupViews();
    res.status(201).json({ success: true, data: { id: grupoId } });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'Grupo com este nome já existe' });
    }
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/grupos/:id  { nome, permissoes: [...], usuario_ids: [] }
router.put('/:id', async (req, res) => {
  const { nome, permissoes = [], usuario_ids = [] } = req.body;
  const grupoId = parseInt(req.params.id);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const exists = await client.query('SELECT id FROM grupo WHERE id = $1', [grupoId]);
    if (!exists.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Grupo não encontrado' });
    }

    if (nome) {
      await client.query('UPDATE grupo SET nome = $1 WHERE id = $2', [nome.trim(), grupoId]);
    }

    // Upsert permissions
    for (const p of permissoes) {
      await client.query(
        `INSERT INTO grupo_funcionalidade (grupo_id, funcionalidade_id, habilitado)
         VALUES ($1,$2,$3)
         ON CONFLICT (grupo_id, funcionalidade_id)
         DO UPDATE SET habilitado = EXCLUDED.habilitado`,
        [grupoId, p.funcionalidade_id, p.habilitado]
      );
    }

    // Replace users
    await client.query('DELETE FROM usuario_grupo WHERE grupo_id = $1', [grupoId]);
    for (const uid of usuario_ids) {
      await client.query(
        'INSERT INTO usuario_grupo (usuario_id, grupo_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [uid, grupoId]
      );
    }

    await client.query('COMMIT');
    await refreshGroupViews();
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/grupos/:id
router.delete('/:id', async (req, res) => {
  const grupoId = parseInt(req.params.id);
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Block if users still linked
    const usersRes = await client.query(
      'SELECT COUNT(*) AS cnt FROM usuario_grupo WHERE grupo_id = $1',
      [grupoId]
    );
    if (parseInt(usersRes.rows[0].cnt) > 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        error: 'Grupo possui usuários vinculados. Remova-os antes de excluir.'
      });
    }

    await client.query('DELETE FROM grupo_funcionalidade WHERE grupo_id = $1', [grupoId]);
    const del = await client.query('DELETE FROM grupo WHERE id = $1 RETURNING id', [grupoId]);

    if (!del.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Grupo não encontrado' });
    }

    await client.query('COMMIT');
    await refreshGroupViews();
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
