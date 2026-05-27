-- ================================================================
-- SISSA Platform – Audit Assertion Script
-- FILE: 04_audit_assertions.sql
-- Purpose: Run AFTER test-runner.js to verify the audit table
--          captured all expected activity from the test session.
-- Usage: psql -U postgres -d sissa -f sql/04_audit_assertions.sql
-- ================================================================
-- Each block uses RAISE NOTICE for PASS and RAISE EXCEPTION for FAIL
-- (exceptions are caught by the outer DO blocks so the script continues).
-- Final summary printed at the end.
-- ================================================================

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo '  SISSA — Audit Table Assertion Script'
\echo '════════════════════════════════════════════════════════════'
\echo ''

-- ──────────────────────────────────────────────────────────────
-- Helper: counts and stores pass/fail in a temp table
-- ──────────────────────────────────────────────────────────────
CREATE TEMP TABLE IF NOT EXISTS _results (
    id      SERIAL,
    section TEXT,
    label   TEXT,
    passed  BOOLEAN,
    detail  TEXT
);

CREATE OR REPLACE FUNCTION _assert(
    p_section TEXT,
    p_label   TEXT,
    p_cond    BOOLEAN,
    p_detail  TEXT DEFAULT ''
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO _results (section, label, passed, detail)
    VALUES (p_section, p_label, p_cond, p_detail);
    IF p_cond THEN
        RAISE NOTICE 'PASS  %: %', p_section, p_label;
    ELSE
        RAISE WARNING 'FAIL  %: % — %', p_section, p_label, p_detail;
    END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- SECTION 1: Audit table structure
-- ──────────────────────────────────────────────────────────────
\echo ''
\echo '[1] Audit Table Structure'
\echo '──────────────────────────────────────────'

DO $$
DECLARE
    col_count INT;
    has_check BOOLEAN;
BEGIN
    -- 1.1 Table exists
    PERFORM _assert(
        '1-Structure', 'auditoria table exists',
        EXISTS(
            SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name='auditoria'
        )
    );

    -- 1.2 Correct columns
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='auditoria'
      AND column_name IN ('id','data_hora','nome_entidade','operacao');

    PERFORM _assert(
        '1-Structure', 'auditoria has all 4 required columns (id, data_hora, nome_entidade, operacao)',
        col_count = 4,
        'Found ' || col_count || '/4 columns'
    );

    -- 1.3 operacao CHECK constraint exists
    PERFORM _assert(
        '1-Structure', 'operacao CHECK constraint defined',
        EXISTS(
            SELECT 1 FROM information_schema.check_constraints cc
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = cc.constraint_name
            WHERE ccu.table_name = 'auditoria'
              AND ccu.column_name = 'operacao'
        ),
        'CHECK constraint on operacao not found'
    );

    -- 1.4 data_hora defaults to NOW()
    PERFORM _assert(
        '1-Structure', 'data_hora has DEFAULT NOW()',
        EXISTS(
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public'
              AND table_name='auditoria'
              AND column_name='data_hora'
              AND column_default LIKE '%now()%'
        ),
        'data_hora column_default does not include now()'
    );

    -- 1.5 Indexes exist
    PERFORM _assert(
        '1-Structure', 'index on auditoria(nome_entidade) exists',
        EXISTS(
            SELECT 1 FROM pg_indexes
            WHERE tablename='auditoria' AND indexdef LIKE '%nome_entidade%'
        )
    );

    PERFORM _assert(
        '1-Structure', 'index on auditoria(data_hora) exists',
        EXISTS(
            SELECT 1 FROM pg_indexes
            WHERE tablename='auditoria' AND indexdef LIKE '%data_hora%'
        )
    );
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- PRE-SECTION 2: Touch static tables so triggers fire and
-- coverage assertions have something to find.
-- ──────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_mod_id  INT;
    v_cat_id  INT;
    v_fun_id  INT;
    v_pap_id  INT;
BEGIN
    -- modulo
    INSERT INTO modulo (nome) VALUES ('__AUDIT_TEST_MOD__') RETURNING id INTO v_mod_id;
    DELETE FROM modulo WHERE id = v_mod_id;

    -- categoria_funcionalidade (needs a valid modulo_id)
    SELECT id INTO v_mod_id FROM modulo LIMIT 1;
    INSERT INTO categoria_funcionalidade (nome, modulo_id) VALUES ('__AUDIT_TEST_CAT__', v_mod_id) RETURNING id INTO v_cat_id;
    DELETE FROM categoria_funcionalidade WHERE id = v_cat_id;

    -- funcionalidade (needs a valid categoria_id)
    SELECT id INTO v_cat_id FROM categoria_funcionalidade LIMIT 1;
    INSERT INTO funcionalidade (nome, categoria_id) VALUES ('__AUDIT_TEST_FUN__', v_cat_id) RETURNING id INTO v_fun_id;
    DELETE FROM funcionalidade WHERE id = v_fun_id;

    -- papel
    INSERT INTO papel (nome) VALUES ('__AUDIT_TEST_PAP__') RETURNING id INTO v_pap_id;
    DELETE FROM papel WHERE id = v_pap_id;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- SECTION 2: Coverage — every monitored table appears in audit
-- ──────────────────────────────────────────────────────────────
\echo ''
\echo '[2] Audit Coverage — all monitored tables'
\echo '──────────────────────────────────────────'

DO $$
DECLARE
    t TEXT;
    cnt INT;
    monitored TEXT[] := ARRAY[
        'modulo','categoria_funcionalidade','funcionalidade',
        'usuario','grupo','papel',
        'usuario_grupo','usuario_papel','grupo_funcionalidade'
    ];
BEGIN
    FOREACH t IN ARRAY monitored LOOP
        SELECT COUNT(*) INTO cnt
        FROM auditoria WHERE nome_entidade = t;

        PERFORM _assert(
            '2-Coverage',
            'Table "' || t || '" has ≥1 audit entry',
            cnt >= 1,
            'Found ' || cnt || ' entries'
        );
    END LOOP;

    -- auditoria itself must NOT appear (no self-audit)
    SELECT COUNT(*) INTO cnt
    FROM auditoria WHERE nome_entidade = 'auditoria';

    PERFORM _assert(
        '2-Coverage', 'auditoria table does NOT audit itself',
        cnt = 0,
        'Found ' || cnt || ' self-audit entries (should be 0)'
    );
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- SECTION 3: Operation types logged correctly
-- ──────────────────────────────────────────────────────────────
\echo ''
\echo '[3] Audit Operation Types'
\echo '──────────────────────────────────────────'

DO $$
DECLARE
    cnt INT;
BEGIN
    -- 3.1 Only valid values in operacao
    SELECT COUNT(*) INTO cnt
    FROM auditoria
    WHERE operacao NOT IN ('INSERT','UPDATE','DELETE');

    PERFORM _assert(
        '3-Operations', 'No invalid values in operacao column',
        cnt = 0,
        'Found ' || cnt || ' rows with invalid operacao'
    );

    -- 3.2 All three operation types are present
    PERFORM _assert(
        '3-Operations', 'INSERT operations logged',
        EXISTS(SELECT 1 FROM auditoria WHERE operacao='INSERT'),
        'No INSERT entries found'
    );

    PERFORM _assert(
        '3-Operations', 'UPDATE operations logged',
        EXISTS(SELECT 1 FROM auditoria WHERE operacao='UPDATE'),
        'No UPDATE entries found'
    );

    PERFORM _assert(
        '3-Operations', 'DELETE operations logged',
        EXISTS(SELECT 1 FROM auditoria WHERE operacao='DELETE'),
        'No DELETE entries found'
    );

    -- 3.3 No NULL data_hora
    SELECT COUNT(*) INTO cnt
    FROM auditoria WHERE data_hora IS NULL;

    PERFORM _assert(
        '3-Operations', 'No NULL data_hora values',
        cnt = 0,
        'Found ' || cnt || ' rows with NULL data_hora'
    );

    -- 3.4 No NULL nome_entidade
    SELECT COUNT(*) INTO cnt
    FROM auditoria WHERE nome_entidade IS NULL OR nome_entidade = '';

    PERFORM _assert(
        '3-Operations', 'No NULL or empty nome_entidade',
        cnt = 0,
        'Found ' || cnt || ' rows with NULL/empty nome_entidade'
    );
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- SECTION 4: Verify test-specific audit trail
-- ──────────────────────────────────────────────────────────────
\echo ''
\echo '[4] Test Session Audit Trail'
\echo '──────────────────────────────────────────'

DO $$
DECLARE
    cnt INT;
    recent_threshold TIMESTAMPTZ := NOW() - INTERVAL '30 minutes';
BEGIN
    -- 4.1 Recent inserts on usuario (test-runner creates test users)
    SELECT COUNT(*) INTO cnt
    FROM auditoria
    WHERE nome_entidade='usuario' AND operacao='INSERT'
      AND data_hora >= recent_threshold;

    PERFORM _assert(
        '4-TestTrail', 'Recent INSERT entries on usuario (from test-runner)',
        cnt >= 1,
        'Expected ≥1 recent usuario INSERT, found ' || cnt
    );

    -- 4.2 Recent deletes on usuario (test-runner deletes test users)
    SELECT COUNT(*) INTO cnt
    FROM auditoria
    WHERE nome_entidade='usuario' AND operacao='DELETE'
      AND data_hora >= recent_threshold;

    PERFORM _assert(
        '4-TestTrail', 'Recent DELETE entries on usuario (cleanup by test-runner)',
        cnt >= 1,
        'Expected ≥1 recent usuario DELETE, found ' || cnt
    );

    -- 4.3 Recent inserts on grupo
    SELECT COUNT(*) INTO cnt
    FROM auditoria
    WHERE nome_entidade='grupo' AND operacao='INSERT'
      AND data_hora >= recent_threshold;

    PERFORM _assert(
        '4-TestTrail', 'Recent INSERT entries on grupo (test-runner creates groups)',
        cnt >= 1,
        'Expected ≥1 recent grupo INSERT, found ' || cnt
    );

    -- 4.4 Recent deletes on grupo_funcionalidade
    SELECT COUNT(*) INTO cnt
    FROM auditoria
    WHERE nome_entidade='grupo_funcionalidade' AND operacao='INSERT'
      AND data_hora >= recent_threshold;

    PERFORM _assert(
        '4-TestTrail', 'Recent INSERT entries on grupo_funcionalidade',
        cnt >= 1,
        'Expected ≥1 recent grupo_funcionalidade INSERT, found ' || cnt
    );

    -- 4.5 Audit trail is time-ordered (ids increase with time)
    PERFORM _assert(
        '4-TestTrail', 'Audit entries are monotonically ordered (id correlates with data_hora)',
        (
            SELECT COUNT(*)
            FROM (
                SELECT id, data_hora,
                       LAG(data_hora) OVER (ORDER BY id) AS prev_dh
                FROM auditoria
            ) t
            WHERE prev_dh IS NOT NULL AND data_hora < prev_dh - INTERVAL '1 second'
        ) = 0,
        'Some audit rows appear out of chronological order'
    );
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- SECTION 5: Trigger coverage — all 9 triggers exist
-- ──────────────────────────────────────────────────────────────
\echo ''
\echo '[5] Trigger Existence'
\echo '──────────────────────────────────────────'

DO $$
DECLARE
    trig TEXT;
    expected TEXT[] := ARRAY[
        'tg_audit_modulo',
        'tg_audit_categoria_funcionalidade',
        'tg_audit_funcionalidade',
        'tg_audit_usuario',
        'tg_audit_grupo',
        'tg_audit_papel',
        'tg_audit_usuario_grupo',
        'tg_audit_usuario_papel',
        'tg_audit_grupo_funcionalidade',
        'tg_acionar_remocao_dependencia'
    ];
BEGIN
    FOREACH trig IN ARRAY expected LOOP
        PERFORM _assert(
            '5-Triggers',
            'Trigger "' || trig || '" exists',
            EXISTS(
                SELECT 1 FROM information_schema.triggers
                WHERE trigger_name = trig
            ),
            'Trigger not found in information_schema'
        );
    END LOOP;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- SECTION 6: Deletion cascade guard — pr_remover_dependencia
-- ──────────────────────────────────────────────────────────────
\echo ''
\echo '[6] Deletion Guard Validation'
\echo '──────────────────────────────────────────'

DO $$
DECLARE
    test_email  TEXT := '__assert_test_' || EXTRACT(EPOCH FROM NOW())::BIGINT || '@sissa.test';
    test_uid    INT;
    test_gid    INT;
    test_pid    INT;
    ug_before   INT;
    up_before   INT;
    ug_after    INT;
    up_after    INT;
BEGIN
    -- Setup: create user with group and role links
    INSERT INTO usuario (email) VALUES (test_email) RETURNING id INTO test_uid;

    SELECT id INTO test_gid FROM grupo WHERE nome = 'Contas a receber' LIMIT 1;
    SELECT id INTO test_pid FROM papel LIMIT 1;

    IF test_gid IS NOT NULL THEN
        INSERT INTO usuario_grupo VALUES (test_uid, test_gid) ON CONFLICT DO NOTHING;
    END IF;
    IF test_pid IS NOT NULL THEN
        INSERT INTO usuario_papel VALUES (test_uid, test_pid) ON CONFLICT DO NOTHING;
    END IF;

    SELECT COUNT(*) INTO ug_before FROM usuario_grupo WHERE usuario_id = test_uid;
    SELECT COUNT(*) INTO up_before FROM usuario_papel WHERE usuario_id = test_uid;

    -- Delete user (trigger should fire and clean up FK rows)
    DELETE FROM usuario WHERE id = test_uid;

    SELECT COUNT(*) INTO ug_after FROM usuario_grupo WHERE usuario_id = test_uid;
    SELECT COUNT(*) INTO up_after FROM usuario_papel WHERE usuario_id = test_uid;

    PERFORM _assert(
        '6-DeleteGuard',
        'usuario_grupo rows removed by trigger before user delete',
        ug_after = 0,
        'Expected 0, found ' || ug_after
    );

    PERFORM _assert(
        '6-DeleteGuard',
        'usuario_papel rows removed by trigger before user delete',
        up_after = 0,
        'Expected 0, found ' || up_after
    );

    -- Confirm audit captured the usuario INSERT and DELETE
    PERFORM _assert(
        '6-DeleteGuard',
        'Audit logged INSERT for the guard-test user',
        EXISTS(
            SELECT 1 FROM auditoria
            WHERE nome_entidade='usuario' AND operacao='INSERT'
              AND data_hora >= NOW() - INTERVAL '1 minute'
        ),
        'No recent INSERT for usuario in auditoria'
    );

    PERFORM _assert(
        '6-DeleteGuard',
        'Audit logged DELETE for the guard-test user',
        EXISTS(
            SELECT 1 FROM auditoria
            WHERE nome_entidade='usuario' AND operacao='DELETE'
              AND data_hora >= NOW() - INTERVAL '1 minute'
        ),
        'No recent DELETE for usuario in auditoria'
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Section 6 error: %', SQLERRM;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- SECTION 7: Views and Materialized Views sanity check
-- ──────────────────────────────────────────────────────────────
\echo ''
\echo '[7] Views & Materialized Views'
\echo '──────────────────────────────────────────'

DO $$
DECLARE
    cnt INT;
BEGIN
    -- 7.1 vw_consulta_usuario exists and has rows
    SELECT COUNT(*) INTO cnt FROM vw_consulta_usuario;
    PERFORM _assert(
        '7-Views', 'vw_consulta_usuario returns rows',
        cnt >= 1, 'Got ' || cnt || ' rows'
    );

    -- 7.2 vwm_consulta_usuario (materialized)
    SELECT COUNT(*) INTO cnt FROM vwm_consulta_usuario;
    PERFORM _assert(
        '7-Views', 'vwm_consulta_usuario (materialized) returns rows',
        cnt >= 1, 'Got ' || cnt || ' rows'
    );

    -- 7.3 vw_consulta_grupo has correct columns
    PERFORM _assert(
        '7-Views', 'vw_consulta_grupo exposes total_permissoes and total_usuarios',
        EXISTS(
            SELECT 1 FROM information_schema.columns
            WHERE table_name='vw_consulta_grupo'
              AND column_name IN ('total_permissoes','total_usuarios')
        ),
        'Expected columns not found in vw_consulta_grupo'
    );

    -- 7.4 vmw_consulta_grupo (materialized)
    SELECT COUNT(*) INTO cnt FROM vmw_consulta_grupo;
    PERFORM _assert(
        '7-Views', 'vmw_consulta_grupo (materialized) returns rows',
        cnt >= 1, 'Got ' || cnt || ' rows'
    );

    -- 7.5 Cross-join math check: vw_consulta_permissoes_grupo row count
    PERFORM _assert(
        '7-Views', 'vw_consulta_permissoes_grupo row count = grupos × funcionalidades',
        (SELECT COUNT(*) FROM vw_consulta_permissoes_grupo) =
        (SELECT COUNT(*) FROM grupo) * (SELECT COUNT(*) FROM funcionalidade),
        'Cross-join count mismatch'
    );

    -- 7.6 vmw_consulta_permissoes_grupo (materialized)
    SELECT COUNT(*) INTO cnt FROM vmw_consulta_permissoes_grupo;
    PERFORM _assert(
        '7-Views', 'vmw_consulta_permissoes_grupo (materialized) returns rows',
        cnt >= 1, 'Got ' || cnt || ' rows'
    );

    -- 7.7 habilitado column is strictly boolean in materialized view
    SELECT COUNT(*) INTO cnt
    FROM vmw_consulta_permissoes_grupo
    WHERE habilitado IS NOT TRUE AND habilitado IS NOT FALSE;

    PERFORM _assert(
        '7-Views', 'habilitado column contains only TRUE or FALSE (no NULLs)',
        cnt = 0,
        'Found ' || cnt || ' rows with NULL habilitado'
    );
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- SECTION 8: Business Rule Assertions
-- ──────────────────────────────────────────────────────────────
\echo ''
\echo '[8] Business Rule Assertions'
\echo '──────────────────────────────────────────'

DO $$
DECLARE
    cnt INT;
    admin_id INT;
BEGIN
    -- 8.1 admin@ufg.br must exist
    PERFORM _assert(
        '8-Business', 'admin@ufg.br exists in usuario',
        EXISTS(SELECT 1 FROM usuario WHERE email='admin@ufg.br')
    );

    -- 8.2 Administrador group must exist
    PERFORM _assert(
        '8-Business', 'Administrador group exists',
        EXISTS(SELECT 1 FROM grupo WHERE nome='Administrador')
    );

    -- 8.3 admin@ufg.br is linked to Administrador group
    SELECT u.id INTO admin_id FROM usuario u WHERE u.email='admin@ufg.br';
    PERFORM _assert(
        '8-Business', 'admin@ufg.br is linked to Administrador group',
        EXISTS(
            SELECT 1 FROM usuario_grupo ug
            JOIN grupo g ON g.id = ug.grupo_id
            WHERE ug.usuario_id = admin_id AND g.nome='Administrador'
        ),
        'No usuario_grupo link found for admin'
    );

    -- 8.4 Administrador group has ALL funcionalidades enabled
    PERFORM _assert(
        '8-Business', 'Administrador group has all funcionalidades enabled',
        (
            SELECT COUNT(*) FROM grupo_funcionalidade gf
            JOIN grupo g ON g.id=gf.grupo_id
            WHERE g.nome='Administrador' AND gf.habilitado=TRUE
        ) = (SELECT COUNT(*) FROM funcionalidade),
        'Not all funcionalidades are enabled for Administrador'
    );

    -- 8.5 No orphan usuario_grupo rows (referential integrity)
    SELECT COUNT(*) INTO cnt
    FROM usuario_grupo ug
    WHERE NOT EXISTS(SELECT 1 FROM usuario u WHERE u.id=ug.usuario_id)
       OR NOT EXISTS(SELECT 1 FROM grupo  g WHERE g.id=ug.grupo_id);

    PERFORM _assert(
        '8-Business', 'No orphan rows in usuario_grupo',
        cnt = 0,
        'Found ' || cnt || ' orphan usuario_grupo rows'
    );

    -- 8.6 No orphan usuario_papel rows
    SELECT COUNT(*) INTO cnt
    FROM usuario_papel up
    WHERE NOT EXISTS(SELECT 1 FROM usuario u WHERE u.id=up.usuario_id)
       OR NOT EXISTS(SELECT 1 FROM papel  p WHERE p.id=up.papel_id);

    PERFORM _assert(
        '8-Business', 'No orphan rows in usuario_papel',
        cnt = 0,
        'Found ' || cnt || ' orphan usuario_papel rows'
    );

    -- 8.7 Every email in usuario is unique (belt-and-suspenders)
    SELECT COUNT(*) INTO cnt
    FROM (
        SELECT email, COUNT(*) c FROM usuario GROUP BY email HAVING COUNT(*) > 1
    ) dupes;

    PERFORM _assert(
        '8-Business', 'All emails in usuario are unique',
        cnt = 0,
        'Found ' || cnt || ' duplicate email(s)'
    );

    -- 8.8 fu_validar_email rejects malformed entries in the DB
    SELECT COUNT(*) INTO cnt
    FROM usuario
    WHERE NOT fu_validar_email(email);

    PERFORM _assert(
        '8-Business', 'All stored emails pass fu_validar_email()',
        cnt = 0,
        'Found ' || cnt || ' stored email(s) failing validation'
    );
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- SECTION 9: Function existence check
-- ──────────────────────────────────────────────────────────────
\echo ''
\echo '[9] Function Existence'
\echo '──────────────────────────────────────────'

DO $$
DECLARE
    fn TEXT;
    expected TEXT[] := ARRAY[
        'fu_validar_cadastro',
        'fu_validar_email',
        'fu_formatar_tempo_acesso',
        'pr_excluir_usuario',
        'fu_migrar_usuarios_grupo',
        'pr_copiar_grupo',
        'fu_verificar_engajamento',
        'pr_criar_usuario_adm',
        'pr_remover_dependencia_usuario',
        'tg_fn_remover_dependencia',
        'tg_fn_auditoria'
    ];
BEGIN
    FOREACH fn IN ARRAY expected LOOP
        PERFORM _assert(
            '9-Functions',
            'Function/procedure "' || fn || '" exists',
            EXISTS(
                SELECT 1 FROM pg_proc
                JOIN pg_namespace ns ON ns.oid = pg_proc.pronamespace
                WHERE ns.nspname='public' AND proname = fn
            ),
            'Not found in pg_proc'
        );
    END LOOP;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- FINAL REPORT
-- ──────────────────────────────────────────────────────────────
\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo '  FINAL REPORT'
\echo '════════════════════════════════════════════════════════════'

DO $$
DECLARE
    total_pass INT;
    total_fail INT;
    total_all  INT;
    rec RECORD;
BEGIN
    SELECT
        COUNT(*) FILTER (WHERE passed),
        COUNT(*) FILTER (WHERE NOT passed),
        COUNT(*)
    INTO total_pass, total_fail, total_all
    FROM _results;

    RAISE NOTICE '';
    RAISE NOTICE '  Total:  % assertions', total_all;
    RAISE NOTICE '  PASSED: %', total_pass;
    RAISE NOTICE '  FAILED: %', total_fail;
    RAISE NOTICE '';

    IF total_fail > 0 THEN
        RAISE NOTICE '  ── Failed Assertions ──';
        FOR rec IN
            SELECT section, label, detail FROM _results WHERE NOT passed ORDER BY id
        LOOP
            RAISE NOTICE '  [%] % → %', rec.section, rec.label, rec.detail;
        END LOOP;
        RAISE NOTICE '';
    ELSE
        RAISE NOTICE '  All assertions passed!';
    END IF;
END;
$$;

-- Cleanup helpers
DROP FUNCTION IF EXISTS _assert(TEXT,TEXT,BOOLEAN,TEXT);
DROP TABLE IF EXISTS _results;

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo ''
