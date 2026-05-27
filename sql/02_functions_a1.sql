-- ================================================================
-- SISSA Platform – Access Control Module
-- FILE: 02_functions_a1.sql — Activity 1: Functions & Procedures
-- Run after 01_ddl.sql
-- ================================================================

-- ----------------------------------------------------------------
-- 1. fu_validar_cadastro
--    IN:  p_email — user email to look up
--    OUT: TRUE if email exists in usuario, FALSE otherwise
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fu_validar_cadastro(p_email VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM usuario WHERE LOWER(email) = LOWER(p_email)
    ) INTO v_exists;
    RETURN v_exists;
END;
$$;

-- ----------------------------------------------------------------
-- 2. fu_validar_email
--    IN:  p_email — raw string typed by user
--    OUT: TRUE if matches RFC-style email regex, FALSE otherwise
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fu_validar_email(p_email VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN p_email ~* '^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$';
END;
$$;

-- ----------------------------------------------------------------
-- 3. fu_formatar_tempo_acesso
--    IN:  p_ultimo_acesso — timestamp of last access (nullable)
--    OUT: human-readable elapsed time in Portuguese
--         e.g. '3 segundos', '10 minutos', '5 horas', '15 dias',
--              '3 meses', '2 anos', 'Nunca acessou'
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fu_formatar_tempo_acesso(p_ultimo_acesso TIMESTAMPTZ)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_diff   INTERVAL;
    v_secs   BIGINT;
    v_val    BIGINT;
BEGIN
    IF p_ultimo_acesso IS NULL THEN
        RETURN 'Nunca acessou';
    END IF;

    v_diff := NOW() - p_ultimo_acesso;
    v_secs := EXTRACT(EPOCH FROM v_diff)::BIGINT;

    IF v_secs < 0 THEN
        RETURN 'Agora';
    ELSIF v_secs < 60 THEN
        v_val := v_secs;
        RETURN v_val || CASE WHEN v_val = 1 THEN ' segundo' ELSE ' segundos' END;
    ELSIF v_secs < 3600 THEN
        v_val := v_secs / 60;
        RETURN v_val || CASE WHEN v_val = 1 THEN ' minuto' ELSE ' minutos' END;
    ELSIF v_secs < 86400 THEN
        v_val := v_secs / 3600;
        RETURN v_val || CASE WHEN v_val = 1 THEN ' hora' ELSE ' horas' END;
    ELSIF v_secs < 2592000 THEN
        v_val := v_secs / 86400;
        RETURN v_val || CASE WHEN v_val = 1 THEN ' dia' ELSE ' dias' END;
    ELSIF v_secs < 31536000 THEN
        v_val := v_secs / 2592000;
        RETURN v_val || CASE WHEN v_val = 1 THEN ' mês' ELSE ' meses' END;
    ELSE
        v_val := v_secs / 31536000;
        RETURN v_val || CASE WHEN v_val = 1 THEN ' ano' ELSE ' anos' END;
    END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 4. pr_excluir_usuario
--    IN:  p_usuario_id — PK of the user to delete
--    OUT: TRUE on success, FALSE if blocked (not found / admin group)
--    Note: tg_acionar_remocao_dependencia (Activity 2) removes
--          usuario_grupo and usuario_papel rows before delete fires.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION pr_excluir_usuario(p_usuario_id INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_is_admin BOOLEAN;
BEGIN
    -- User must exist
    IF NOT EXISTS (SELECT 1 FROM usuario WHERE id = p_usuario_id) THEN
        RETURN FALSE;
    END IF;

    -- Block deletion if user belongs to 'Administrador' group
    SELECT EXISTS(
        SELECT 1
        FROM usuario_grupo ug
        JOIN grupo g ON g.id = ug.grupo_id
        WHERE ug.usuario_id = p_usuario_id
          AND LOWER(g.nome) = 'administrador'
    ) INTO v_is_admin;

    IF v_is_admin THEN
        RETURN FALSE;
    END IF;

    -- Perform deletion (trigger removes FK deps first)
    DELETE FROM usuario WHERE id = p_usuario_id;
    RETURN TRUE;

EXCEPTION
    WHEN foreign_key_violation THEN
        RETURN FALSE;
    WHEN OTHERS THEN
        RETURN FALSE;
END;
$$;

-- ----------------------------------------------------------------
-- 5. fu_migrar_usuarios_grupo
--    IN:  p_grupo_origem  — name of source group
--         p_grupo_destino — name of destination group
--    OUT: TABLE with (nome, email, ultimo_acesso) of migrated users
--    Processing: moves ALL users from origem to destino
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fu_migrar_usuarios_grupo(
    p_grupo_origem  VARCHAR,
    p_grupo_destino VARCHAR
)
RETURNS TABLE(r_nome VARCHAR, r_email VARCHAR, r_ultimo_acesso TIMESTAMP)
LANGUAGE plpgsql
AS $$
DECLARE
    v_id_origem  INTEGER;
    v_id_destino INTEGER;
BEGIN
    SELECT g.id INTO v_id_origem  FROM grupo g WHERE LOWER(g.nome) = LOWER(p_grupo_origem);
    SELECT g.id INTO v_id_destino FROM grupo g WHERE LOWER(g.nome) = LOWER(p_grupo_destino);

    IF v_id_origem IS NULL THEN
        RAISE EXCEPTION 'Grupo de origem "%" não encontrado.', p_grupo_origem;
    END IF;
    IF v_id_destino IS NULL THEN
        RAISE EXCEPTION 'Grupo de destino "%" não encontrado.', p_grupo_destino;
    END IF;
    IF v_id_origem = v_id_destino THEN
        RAISE EXCEPTION 'Grupos de origem e destino não podem ser o mesmo.';
    END IF;

    -- Insert into destino (skip if already a member)
    INSERT INTO usuario_grupo (usuario_id, grupo_id)
    SELECT ug.usuario_id, v_id_destino
    FROM   usuario_grupo ug
    WHERE  ug.grupo_id = v_id_origem
    ON CONFLICT DO NOTHING;

    -- Return list of migrated users (before removing from origem)
    RETURN QUERY
        SELECT u.nome::VARCHAR, u.email::VARCHAR, u.ultimo_acesso
        FROM   usuario_grupo ug
        JOIN   usuario u ON u.id = ug.usuario_id
        WHERE  ug.grupo_id = v_id_origem;

    -- Remove from origem
    DELETE FROM usuario_grupo WHERE grupo_id = v_id_origem;
END;
$$;

-- ----------------------------------------------------------------
-- 6. pr_copiar_grupo
--    IN:  p_grupo_origem — name of existing group to copy
--         p_novo_grupo   — name for the new group
--    OUT: count of enabled (habilitado=TRUE) permissions in new group
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION pr_copiar_grupo(
    p_grupo_origem VARCHAR,
    p_novo_grupo   VARCHAR
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_id_origem    INTEGER;
    v_id_novo      INTEGER;
    v_count_enabled INTEGER;
BEGIN
    SELECT id INTO v_id_origem FROM grupo WHERE LOWER(nome) = LOWER(p_grupo_origem);
    IF v_id_origem IS NULL THEN
        RAISE EXCEPTION 'Grupo "%" não encontrado.', p_grupo_origem;
    END IF;

    IF EXISTS (SELECT 1 FROM grupo WHERE LOWER(nome) = LOWER(p_novo_grupo)) THEN
        RAISE EXCEPTION 'Grupo "%" já existe.', p_novo_grupo;
    END IF;

    -- Create the new group
    INSERT INTO grupo (nome) VALUES (p_novo_grupo) RETURNING id INTO v_id_novo;

    -- Copy all grupo_funcionalidade rows
    INSERT INTO grupo_funcionalidade (grupo_id, funcionalidade_id, habilitado)
    SELECT v_id_novo, funcionalidade_id, habilitado
    FROM   grupo_funcionalidade
    WHERE  grupo_id = v_id_origem;

    -- Count enabled permissions
    SELECT COUNT(*) INTO v_count_enabled
    FROM   grupo_funcionalidade
    WHERE  grupo_id = v_id_novo AND habilitado = TRUE;

    RETURN v_count_enabled;
END;
$$;

-- ----------------------------------------------------------------
-- 7. fu_verificar_engajamento
--    OUT: TABLE (nome, email, ultimo_acesso, engajamento)
--    Classification:
--      Alto       — accessed within last 2 days
--      Médio      — accessed within last 7 days
--      Baixo      — accessed within last 30 days
--      Inexistente— never accessed OR more than 30 days ago
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fu_verificar_engajamento()
RETURNS TABLE(
    r_nome          VARCHAR,
    r_email         VARCHAR,
    r_ultimo_acesso TIMESTAMP,
    r_engajamento   VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.nome::VARCHAR,
        u.email::VARCHAR,
        u.ultimo_acesso,
        CASE
            WHEN u.ultimo_acesso IS NULL                                    THEN 'Inexistente'::VARCHAR
            WHEN u.ultimo_acesso >= NOW() - INTERVAL '2 days'              THEN 'Alto'::VARCHAR
            WHEN u.ultimo_acesso >= NOW() - INTERVAL '7 days'              THEN 'Médio'::VARCHAR
            WHEN u.ultimo_acesso >= NOW() - INTERVAL '30 days'             THEN 'Baixo'::VARCHAR
            ELSE                                                                 'Inexistente'::VARCHAR
        END AS r_engajamento
    FROM usuario u
    ORDER BY
        CASE
            WHEN u.ultimo_acesso IS NULL THEN 4
            WHEN u.ultimo_acesso >= NOW() - INTERVAL '2 days'  THEN 1
            WHEN u.ultimo_acesso >= NOW() - INTERVAL '7 days'  THEN 2
            WHEN u.ultimo_acesso >= NOW() - INTERVAL '30 days' THEN 3
            ELSE 4
        END,
        u.ultimo_acesso DESC NULLS LAST;
END;
$$;

-- ----------------------------------------------------------------
-- 8. pr_criar_usuario_adm
--    IN:  p_email      — admin email (default: admin@ufg.br)
--         p_nome_grupo — group name  (default: 'Administrador')
--    Processing:
--      - Uses fu_validar_cadastro to avoid duplicates
--      - Creates user if not exists
--      - Creates group if not exists
--      - Enables ALL funcionalidades for the group
--      - Links user to group
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION pr_criar_usuario_adm(
    p_email      VARCHAR DEFAULT 'admin@ufg.br',
    p_nome_grupo VARCHAR DEFAULT 'Administrador'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_usuario_id INTEGER;
    v_grupo_id   INTEGER;
BEGIN
    -- Create user only if not already registered
    IF NOT fu_validar_cadastro(p_email) THEN
        INSERT INTO usuario (email) VALUES (p_email) RETURNING id INTO v_usuario_id;
    ELSE
        SELECT id INTO v_usuario_id FROM usuario WHERE LOWER(email) = LOWER(p_email);
    END IF;

    -- Create group if not exists
    SELECT id INTO v_grupo_id FROM grupo WHERE LOWER(nome) = LOWER(p_nome_grupo);
    IF v_grupo_id IS NULL THEN
        INSERT INTO grupo (nome) VALUES (p_nome_grupo) RETURNING id INTO v_grupo_id;
    END IF;

    -- Enable ALL funcionalidades for this group
    INSERT INTO grupo_funcionalidade (grupo_id, funcionalidade_id, habilitado)
    SELECT v_grupo_id, f.id, TRUE
    FROM   funcionalidade f
    ON CONFLICT (grupo_id, funcionalidade_id)
    DO UPDATE SET habilitado = TRUE;

    -- Link user to group
    INSERT INTO usuario_grupo (usuario_id, grupo_id)
    VALUES (v_usuario_id, v_grupo_id)
    ON CONFLICT DO NOTHING;
END;
$$;
