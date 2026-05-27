const express = require('express');
const router  = express.Router();
const db      = require('../db');

async function refreshUserView(client) {
  await (client || db).query(
    'REFRESH MATERIALIZED VIEW CONCURRENTLY vwm_consulta_usuario'
  );
}

// GET /api/usuarios[?search=term]
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM vwm_consulta_usuario';
    const params = [];
    if (search) {
      query += ' WHERE LOWER(email) LIKE $1 OR LOWER(nome) LIKE $1';
      params.push(`%${search.toLowerCase()}%`);
    }
    query += ' ORDER BY email';
    const result = await db.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/usuarios/engajamento/lista
router.get('/engajamento/lista', async (req, res) => {
  try {
    const result = await db.query('SELECT r_nome AS nome, r_email AS email, r_ultimo_acesso AS ultimo_acesso, r_engajamento AS engajamento FROM fu_verificar_engajamento()');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/usuarios/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM vw_consulta_usuario WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/usuarios  { email, grupo_ids: [], papel_ids: [] }
router.post('/', async (req, res) => {
  const { email, grupo_ids = [], papel_ids = [] } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'E-mail é obrigatório' });
  if (!grupo_ids.length) return res.status(400).json({ success: false, error: 'Selecione ao menos um grupo' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Validate email format
    const fmtRes = await client.query('SELECT fu_validar_email($1) AS valido', [email]);
    if (!fmtRes.rows[0].valido) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Formato de e-mail inválido' });
    }

    // Check duplicate
    const dupRes = await client.query('SELECT fu_validar_cadastro($1) AS existe', [email]);
    if (dupRes.rows[0].existe) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'E-mail já cadastrado' });
    }

    const ins = await client.query(
      'INSERT INTO usuario (email) VALUES ($1) RETURNING id',
      [email]
    );
    const userId = ins.rows[0].id;

    for (const gid of grupo_ids) {
      await client.query(
        'INSERT INTO usuario_grupo (usuario_id, grupo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, gid]
      );
    }
    for (const pid of papel_ids) {
      await client.query(
        'INSERT INTO usuario_papel (usuario_id, papel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, pid]
      );
    }

    await client.query('COMMIT');
    await refreshUserView();
    res.status(201).json({ success: true, data: { id: userId } });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/usuarios/:id  { email, grupo_ids: [], papel_ids: [] }
router.put('/:id', async (req, res) => {
  const { email, grupo_ids = [], papel_ids = [] } = req.body;
  const userId = parseInt(req.params.id);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const exists = await client.query('SELECT id FROM usuario WHERE id = $1', [userId]);
    if (!exists.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    if (email) {
      const fmtRes = await client.query('SELECT fu_validar_email($1) AS valido', [email]);
      if (!fmtRes.rows[0].valido) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Formato de e-mail inválido' });
      }
      await client.query('UPDATE usuario SET email = $1 WHERE id = $2', [email, userId]);
    }

    // Replace groups
    await client.query('DELETE FROM usuario_grupo WHERE usuario_id = $1', [userId]);
    for (const gid of grupo_ids) {
      await client.query(
        'INSERT INTO usuario_grupo (usuario_id, grupo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, gid]
      );
    }

    // Replace roles
    await client.query('DELETE FROM usuario_papel WHERE usuario_id = $1', [userId]);
    for (const pid of papel_ids) {
      await client.query(
        'INSERT INTO usuario_papel (usuario_id, papel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, pid]
      );
    }

    await client.query('COMMIT');
    await refreshUserView();
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/usuarios/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT pr_excluir_usuario($1) AS sucesso',
      [req.params.id]
    );
    const sucesso = result.rows[0].sucesso;
    if (!sucesso) {
      return res.status(403).json({
        success: false,
        error: 'Não foi possível excluir: usuário não existe ou é Administrador'
      });
    }
    await refreshUserView();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/usuarios/migrar  { grupo_origem, grupo_destino }
router.post('/migrar', async (req, res) => {
  const { grupo_origem, grupo_destino } = req.body;
  if (!grupo_origem || !grupo_destino) {
    return res.status(400).json({ success: false, error: 'Informe grupo_origem e grupo_destino' });
  }
  try {
    const result = await db.query(
      'SELECT * FROM fu_migrar_usuarios_grupo($1, $2)',
      [grupo_origem, grupo_destino]
    );
    await refreshUserView();
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/usuarios/admin  { email, nome_grupo }
router.post('/admin', async (req, res) => {
  const { email = 'admin@ufg.br', nome_grupo = 'Administrador' } = req.body;
  try {
    await db.query('SELECT pr_criar_usuario_adm($1, $2)', [email, nome_grupo]);
    await refreshUserView();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
