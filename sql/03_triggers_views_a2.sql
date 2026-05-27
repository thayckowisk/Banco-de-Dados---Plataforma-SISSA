-- ================================================================
-- SISSA Platform – Access Control Module
-- FILE: 03_triggers_views_a2.sql — Activity 2: Triggers & Views
-- Run after 01_ddl.sql and 02_functions_a1.sql
-- ================================================================

-- ----------------------------------------------------------------
-- 1. pr_remover_dependencia_usuario
--    IN:  p_usuario_id — user PK
--    Removes all rows in usuario_papel and usuario_grupo
--    that reference this user (called by trigger before DELETE)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION pr_remover_dependencia_usuario(p_usuario_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM usuario_papel WHERE usuario_id = p_usuario_id;
    DELETE FROM usuario_grupo  WHERE usuario_id = p_usuario_id;
END;
$$;

-- ----------------------------------------------------------------
-- 2. tg_acionar_remocao_dependencia
--    Trigger function that calls pr_remover_dependencia_usuario
--    BEFORE DELETE on usuario so FK constraints are satisfied.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION tg_fn_remover_dependencia()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pr_remover_dependencia_usuario(OLD.id);
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tg_acionar_remocao_dependencia ON usuario;
CREATE TRIGGER tg_acionar_remocao_dependencia
    BEFORE DELETE ON usuario
    FOR EACH ROW
    EXECUTE FUNCTION tg_fn_remover_dependencia();

-- ----------------------------------------------------------------
-- 3. AUDITORIA — trigger function + triggers on ALL tables
--    Records: data_hora, nome_entidade (table name), operacao
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION tg_fn_auditoria()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO auditoria (nome_entidade, operacao)
    VALUES (TG_TABLE_NAME, TG_OP);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- Apply to every table except auditoria itself
DROP TRIGGER IF EXISTS tg_audit_modulo                  ON modulo;
DROP TRIGGER IF EXISTS tg_audit_categoria_funcionalidade ON categoria_funcionalidade;
DROP TRIGGER IF EXISTS tg_audit_funcionalidade          ON funcionalidade;
DROP TRIGGER IF EXISTS tg_audit_usuario                 ON usuario;
DROP TRIGGER IF EXISTS tg_audit_grupo                   ON grupo;
DROP TRIGGER IF EXISTS tg_audit_papel                   ON papel;
DROP TRIGGER IF EXISTS tg_audit_usuario_grupo           ON usuario_grupo;
DROP TRIGGER IF EXISTS tg_audit_usuario_papel           ON usuario_papel;
DROP TRIGGER IF EXISTS tg_audit_grupo_funcionalidade    ON grupo_funcionalidade;

CREATE TRIGGER tg_audit_modulo
    AFTER INSERT OR UPDATE OR DELETE ON modulo
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_categoria_funcionalidade
    AFTER INSERT OR UPDATE OR DELETE ON categoria_funcionalidade
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_funcionalidade
    AFTER INSERT OR UPDATE OR DELETE ON funcionalidade
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_usuario
    AFTER INSERT OR UPDATE OR DELETE ON usuario
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_grupo
    AFTER INSERT OR UPDATE OR DELETE ON grupo
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_papel
    AFTER INSERT OR UPDATE OR DELETE ON papel
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_usuario_grupo
    AFTER INSERT OR UPDATE OR DELETE ON usuario_grupo
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_usuario_papel
    AFTER INSERT OR UPDATE OR DELETE ON usuario_papel
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_grupo_funcionalidade
    AFTER INSERT OR UPDATE OR DELETE ON grupo_funcionalidade
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

-- ----------------------------------------------------------------
-- 4. vw_consulta_usuario
--    For: Permissions > Users screen
--    Shows: id, email, nome, ultimo_acesso, formatted time,
--           comma-separated group names, comma-separated role names
-- ----------------------------------------------------------------
DROP VIEW IF EXISTS vw_consulta_usuario CASCADE;

CREATE OR REPLACE VIEW vw_consulta_usuario AS
SELECT
    u.id,
    u.email,
    COALESCE(u.nome, '-')            AS nome,
    u.ultimo_acesso,
    fu_formatar_tempo_acesso(u.ultimo_acesso)  AS ultimo_acesso_fmt,
    COALESCE(
        STRING_AGG(DISTINCT g.nome, ', ' ORDER BY g.nome),
        ''
    )                                AS grupos,
    COALESCE(
        STRING_AGG(DISTINCT p.nome, ', ' ORDER BY p.nome),
        ''
    )                                AS papeis
FROM usuario u
LEFT JOIN usuario_grupo ug ON ug.usuario_id = u.id
LEFT JOIN grupo g          ON g.id          = ug.grupo_id
LEFT JOIN usuario_papel up ON up.usuario_id = u.id
LEFT JOIN papel p          ON p.id          = up.papel_id
GROUP BY u.id, u.email, u.nome, u.ultimo_acesso
ORDER BY u.email;

-- ----------------------------------------------------------------
-- 5. vwm_consulta_usuario  (Materialized)
-- ----------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS vwm_consulta_usuario;

CREATE MATERIALIZED VIEW vwm_consulta_usuario AS
SELECT * FROM vw_consulta_usuario;

CREATE UNIQUE INDEX ON vwm_consulta_usuario(id);

-- ----------------------------------------------------------------
-- 6. vw_consulta_grupo
--    For: Permissions > Groups list screen
--    Shows: id, nome, total enabled permissions, total users
-- ----------------------------------------------------------------
DROP VIEW IF EXISTS vw_consulta_grupo CASCADE;

CREATE OR REPLACE VIEW vw_consulta_grupo AS
SELECT
    g.id,
    g.nome,
    COUNT(DISTINCT CASE WHEN gf.habilitado = TRUE THEN gf.funcionalidade_id END)
        AS total_permissoes,
    COUNT(DISTINCT ug.usuario_id)
        AS total_usuarios
FROM grupo g
LEFT JOIN grupo_funcionalidade gf ON gf.grupo_id = g.id
LEFT JOIN usuario_grupo ug        ON ug.grupo_id  = g.id
GROUP BY g.id, g.nome
ORDER BY g.nome;

-- ----------------------------------------------------------------
-- 7. vmw_consulta_grupo  (Materialized)
-- ----------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS vmw_consulta_grupo;

CREATE MATERIALIZED VIEW vmw_consulta_grupo AS
SELECT * FROM vw_consulta_grupo;

CREATE UNIQUE INDEX ON vmw_consulta_grupo(id);

-- ----------------------------------------------------------------
-- 10. vw_consulta_permissoes_grupo
--     For: Add/Edit Group > Permissions tab
--     Lists EVERY funcionalidade × grupo combination with habilitado flag.
--     Uses CROSS JOIN so every group sees every functionality even
--     when no grupo_funcionalidade row exists yet.
-- ----------------------------------------------------------------
DROP VIEW IF EXISTS vw_consulta_permissoes_grupo CASCADE;

CREATE OR REPLACE VIEW vw_consulta_permissoes_grupo AS
SELECT
    g.id                           AS grupo_id,
    g.nome                         AS grupo_nome,
    m.nome                         AS modulo,
    m.id                           AS modulo_id,
    cf.nome                        AS categoria,
    cf.id                          AS categoria_id,
    f.id                           AS funcionalidade_id,
    f.nome                         AS funcionalidade,
    COALESCE(gf.habilitado, FALSE) AS habilitado
FROM grupo g
CROSS JOIN funcionalidade f
JOIN categoria_funcionalidade cf ON cf.id = f.categoria_id
JOIN modulo m                    ON m.id  = cf.modulo_id
LEFT JOIN grupo_funcionalidade gf
       ON gf.grupo_id = g.id AND gf.funcionalidade_id = f.id
ORDER BY g.nome, m.nome, cf.nome, f.nome;

-- ----------------------------------------------------------------
-- 11. vmw_consulta_permissoes_grupo  (Materialized)
-- ----------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS vmw_consulta_permissoes_grupo;

CREATE MATERIALIZED VIEW vmw_consulta_permissoes_grupo AS
SELECT * FROM vw_consulta_permissoes_grupo;

CREATE UNIQUE INDEX ON vmw_consulta_permissoes_grupo(grupo_id, funcionalidade_id);

-- ================================================================
-- 12. TWO ALTERNATIVES FOR AUTO-REFRESHING MATERIALIZED VIEWS
--     every 2 hours
-- ================================================================

-- ----------------------------------------------------------------
-- ALTERNATIVE 1: pg_cron extension
-- pg_cron is a PostgreSQL extension that runs scheduled SQL jobs
-- inside the database itself. Install: shared_preload_libraries = 'pg_cron'
-- ----------------------------------------------------------------
/*
-- Run once as superuser to enable the extension:
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule refresh every 2 hours (cron: minute hour day month weekday)
-- '0 SLASH2 * * *' = at minute 0 of every 2nd hour
SELECT cron.schedule(
    'refresh-mat-views',          -- job name (unique)
    '0 */2 * * *',                -- cron expression
    $$
        REFRESH MATERIALIZED VIEW CONCURRENTLY vwm_consulta_usuario;
        REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_grupo;
        REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_permissoes_grupo;
    $$
);

-- To check scheduled jobs:
SELECT * FROM cron.job;

-- To remove:
SELECT cron.unschedule('refresh-mat-views');
*/

-- ----------------------------------------------------------------
-- ALTERNATIVE 2: OS-level cron (crontab) calling psql
-- No extra PostgreSQL extension required. The OS scheduler calls
-- psql directly to refresh. Suitable when pg_cron is unavailable.
-- ----------------------------------------------------------------
/*
-- 1. Create a refresh script: /usr/local/bin/refresh_sissa_views.sh
--    #!/bin/bash
--    psql -U postgres -d sissa -c "
--        REFRESH MATERIALIZED VIEW CONCURRENTLY vwm_consulta_usuario;
--        REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_grupo;
--        REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_permissoes_grupo;
--    "
--
-- 2. Make it executable:
--    chmod +x /usr/local/bin/refresh_sissa_views.sh
--
-- 3. Add to crontab (crontab -e):
--    0 SLASH2 * * * /usr/local/bin/refresh_sissa_views.sh >> /var/log/sissa_refresh.log 2>&1
--
-- Additionally, a PostgreSQL-native approach using a stored procedure
-- and dblink (without pg_cron) can run via pg_background:
--
CREATE EXTENSION IF NOT EXISTS dblink;

CREATE OR REPLACE PROCEDURE refresh_all_mat_views()
LANGUAGE plpgsql
AS $proc$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY vwm_consulta_usuario;
    REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_grupo;
    REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_permissoes_grupo;
END;
$proc$;

-- Call it manually anytime:
-- CALL refresh_all_mat_views();
--
-- Or invoke from the Node.js backend after every write operation
-- (already implemented in the backend routes).
*/
