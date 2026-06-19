-- ================================================================
-- SISSA Platform – Requisito 5: ÍNDICES + MASSA DE DADOS
-- FILE: 07_sissa_indices_performance.sql
-- Run after 05_sissa_domain.sql
--
-- Objetivo do requisito:
--   "Identifique duas necessidades de aplicação do conceito de índice
--    e crie o código de implementação dos índices identificados. Além
--    disso, crie uma massa de dados para simular os cenários de
--    processamento com e sem uso de índice para justificar o seu uso.
--    O cenário COM índice deve gerar um ganho de pelo menos 20% em
--    relação ao tempo de processamento da transação."
--
-- Modelo NORMALIZADO: o estudante é sissa_aluno + sissa_matricula, e o
-- risco vive em sissa_risco_evasao (1:1 com a matrícula). Por isso o
-- benchmark mede o CAMINHO REAL COM JOIN entre duas tabelas de massa que
-- espelham sissa_matricula + sissa_risco_evasao (e não uma tabela
-- achatada). A FK do join (risco.matricula_id) tem índice sempre — como
-- no schema real (UNIQUE em sissa_risco_evasao.matricula_id).
--
-- DUAS NECESSIDADES IDENTIFICADAS (extraídas dos requisitos do Anexo):
--
--   ÍNDICE 1 — "Consulta de risco de evasão dos alunos do curso"
--     A tela lista estudantes filtrando por CURSO e por NÍVEL DE RISCO,
--     juntando matrícula e risco (é o caminho da vw_sissa_estudantes_risco).
--     Sem índice no curso, o join varre toda a tabela de matrículas
--     (Seq Scan). Índice B-tree em matricula(curso_id) → Index Scan
--     seletivo + Nested Loop. Espelha o índice real idx_sissa_matricula_curso
--     (e a FK idx_sissa_risco_comp / UNIQUE em risco.matricula_id).
--
--   ÍNDICE 2 — "Identificação do estudante por matrícula"
--     A importação via API e o vínculo único exigem localizar 1 matrícula
--     pelo CÓDIGO (WHERE codigo = ...). Sem índice → Seq Scan da tabela
--     inteira para achar 1 linha. Índice B-tree em (codigo) → busca direta.
--     Espelha o índice real UNIQUE em sissa_matricula.codigo.
--
-- Este script é AUTOCONTIDO e IDEMPOTENTE: cria duas tabelas de massa
-- (sissa_bench_matricula + sissa_bench_risco), mede os dois cenários e,
-- ao final, remove a massa para não poluir os dados de demonstração da UI.
-- ================================================================

-- ----------------------------------------------------------------
-- Limpeza prévia (idempotente)
-- ----------------------------------------------------------------
DROP FUNCTION IF EXISTS fu_sissa_benchmark_indice(INTEGER, INTEGER) CASCADE;
DROP TABLE    IF EXISTS sissa_bench_risco     CASCADE;
DROP TABLE    IF EXISTS sissa_bench_matricula CASCADE;

-- ================================================================
-- FUNÇÃO DE BENCHMARK
--   p_linhas  : tamanho da massa de dados a gerar (por tabela)
--   p_repeat  : quantas vezes cada consulta é repetida (reduz ruído)
--   Retorna, para cada um dos 2 cenários:
--     - tempo total SEM índice / COM índice / ganho % / atende >= 20%
--   As tabelas de massa ficam criadas ao final (a limpeza é feita pelo
--   script, depois do EXPLAIN), com a FK do join já indexada.
-- ================================================================
CREATE OR REPLACE FUNCTION fu_sissa_benchmark_indice(
    p_linhas INTEGER DEFAULT 500000,
    p_repeat INTEGER DEFAULT 25
)
RETURNS TABLE(
    cenario             TEXT,
    indice              TEXT,
    linhas_massa        INTEGER,
    tempo_sem_indice_ms NUMERIC,
    tempo_com_indice_ms NUMERIC,
    ganho_pct           NUMERIC,
    atende_min_20pct    BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_start      TIMESTAMPTZ;
    v_sem        NUMERIC;
    v_com        NUMERIC;
    v_dummy      BIGINT;
    k            INTEGER;
    v_curso_alvo INTEGER := 37;                 -- curso seletivo no meio da massa
    v_cod_alvo   TEXT;
    v_sql_join   TEXT := 'SELECT count(*) FROM sissa_bench_matricula m '
                      || 'JOIN sissa_bench_risco r ON r.matricula_id = m.id '
                      || 'WHERE m.curso_id = $1 AND r.risco = $2';
    v_sql_cod    TEXT := 'SELECT count(*) FROM sissa_bench_matricula WHERE codigo = $1';
BEGIN
    -- ---------- (Re)cria as duas tabelas de massa (espelham o modelo) ----------
    DROP TABLE IF EXISTS sissa_bench_risco     CASCADE;
    DROP TABLE IF EXISTS sissa_bench_matricula CASCADE;

    CREATE TABLE sissa_bench_matricula (
        id           SERIAL       PRIMARY KEY,
        codigo       VARCHAR(20)  NOT NULL,
        curso_id     INTEGER      NOT NULL,
        media_global NUMERIC(4,2) NOT NULL,
        reprovacoes  INTEGER      NOT NULL
    );
    CREATE TABLE sissa_bench_risco (
        id           SERIAL      PRIMARY KEY,
        matricula_id INTEGER     NOT NULL,
        risco        VARCHAR(10) NOT NULL
    );

    -- ---------- Geração da massa (matrícula 1:1 risco) ----------
    INSERT INTO sissa_bench_matricula (codigo, curso_id, media_global, reprovacoes)
    SELECT
        'EST' || LPAD(g::TEXT, 9, '0'),
        (g % 60) + 1,                                  -- 60 cursos distintos
        ROUND((random() * 10)::NUMERIC, 2),
        (g % 6)
    FROM generate_series(1, p_linhas) g;

    INSERT INTO sissa_bench_risco (matricula_id, risco)
    SELECT m.id, (ARRAY['Alto','Médio','Baixo'])[(m.id % 3) + 1]   -- 3 níveis
    FROM sissa_bench_matricula m;

    -- FK do join SEMPRE indexada (como a UNIQUE real em risco.matricula_id)
    CREATE INDEX idx_bench_risco_mat ON sissa_bench_risco(matricula_id);

    v_cod_alvo := 'EST' || LPAD((p_linhas / 2)::TEXT, 9, '0');     -- matrícula no meio
    ANALYZE sissa_bench_matricula;
    ANALYZE sissa_bench_risco;

    -- ================================================================
    -- CENÁRIO 1 — Consulta de risco por curso (JOIN matrícula+risco)
    --   Índice demonstrado: sissa_bench_matricula(curso_id)
    -- ================================================================
    DROP INDEX IF EXISTS idx_bench_mat_curso;

    EXECUTE v_sql_join INTO v_dummy USING v_curso_alvo, 'Alto';      -- aquecimento
    v_start := clock_timestamp();
    FOR k IN 1..p_repeat LOOP
        EXECUTE v_sql_join INTO v_dummy USING v_curso_alvo, 'Alto';
    END LOOP;
    v_sem := EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000;

    CREATE INDEX idx_bench_mat_curso ON sissa_bench_matricula(curso_id);
    ANALYZE sissa_bench_matricula;

    EXECUTE v_sql_join INTO v_dummy USING v_curso_alvo, 'Alto';      -- aquecimento
    v_start := clock_timestamp();
    FOR k IN 1..p_repeat LOOP
        EXECUTE v_sql_join INTO v_dummy USING v_curso_alvo, 'Alto';
    END LOOP;
    v_com := EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000;

    cenario             := 'Consulta de risco por curso (JOIN matricula+risco, curso_id + risco)';
    indice              := 'idx sissa_bench_matricula(curso_id)  [real: idx_sissa_matricula_curso]';
    linhas_massa        := p_linhas;
    tempo_sem_indice_ms := ROUND(v_sem, 2);
    tempo_com_indice_ms := ROUND(v_com, 2);
    ganho_pct           := ROUND((v_sem - v_com) / NULLIF(v_sem,0) * 100, 1);
    atende_min_20pct    := ganho_pct >= 20;
    RETURN NEXT;

    DROP INDEX IF EXISTS idx_bench_mat_curso;

    -- ================================================================
    -- CENÁRIO 2 — Identificação por matrícula (lookup exato por código)
    --   Índice demonstrado: sissa_bench_matricula(codigo)
    -- ================================================================
    DROP INDEX IF EXISTS idx_bench_mat_codigo;

    EXECUTE v_sql_cod INTO v_dummy USING v_cod_alvo;                 -- aquecimento
    v_start := clock_timestamp();
    FOR k IN 1..p_repeat LOOP
        EXECUTE v_sql_cod INTO v_dummy USING v_cod_alvo;
    END LOOP;
    v_sem := EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000;

    CREATE INDEX idx_bench_mat_codigo ON sissa_bench_matricula(codigo);
    ANALYZE sissa_bench_matricula;

    EXECUTE v_sql_cod INTO v_dummy USING v_cod_alvo;                 -- aquecimento
    v_start := clock_timestamp();
    FOR k IN 1..p_repeat LOOP
        EXECUTE v_sql_cod INTO v_dummy USING v_cod_alvo;
    END LOOP;
    v_com := EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000;

    cenario             := 'Identificacao por matricula (lookup exato por codigo)';
    indice              := 'idx sissa_bench_matricula(codigo)  [real: UNIQUE sissa_matricula.codigo]';
    linhas_massa        := p_linhas;
    tempo_sem_indice_ms := ROUND(v_sem, 2);
    tempo_com_indice_ms := ROUND(v_com, 2);
    ganho_pct           := ROUND((v_sem - v_com) / NULLIF(v_sem,0) * 100, 1);
    atende_min_20pct    := ganho_pct >= 20;
    RETURN NEXT;

    DROP INDEX IF EXISTS idx_bench_mat_codigo;
END;
$$;

-- ----------------------------------------------------------------
-- EXECUÇÃO DO BENCHMARK + RELATÓRIO
-- ----------------------------------------------------------------
\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo '  BENCHMARK DE ÍNDICES — SISSA (massa de 500.000 linhas, com JOIN)'
\echo '════════════════════════════════════════════════════════════════'

-- roda o benchmark pesado UMA única vez e guarda o resultado
DROP TABLE IF EXISTS _bench_resultado;
CREATE TEMP TABLE _bench_resultado AS
    SELECT * FROM fu_sissa_benchmark_indice(500000, 25);

SELECT cenario,
       linhas_massa                       AS linhas,
       tempo_sem_indice_ms || ' ms'       AS sem_indice,
       tempo_com_indice_ms || ' ms'       AS com_indice,
       ganho_pct || ' %'                  AS ganho,
       CASE WHEN atende_min_20pct THEN 'OK (>= 20%)' ELSE 'FALHOU' END AS resultado
FROM _bench_resultado;

-- ----------------------------------------------------------------
-- ASSERÇÃO: aborta se algum cenário não atingir o ganho de 20%
-- ----------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT * FROM _bench_resultado LOOP
        RAISE NOTICE '[%] sem=% ms | com=% ms | ganho=% %% | %',
            r.cenario, r.tempo_sem_indice_ms, r.tempo_com_indice_ms, r.ganho_pct,
            CASE WHEN r.atende_min_20pct THEN 'ATENDE >=20%' ELSE 'NAO ATENDE' END;
        IF NOT r.atende_min_20pct THEN
            RAISE EXCEPTION 'Cenário "%" ficou abaixo de 20%% de ganho (% %%).',
                r.cenario, r.ganho_pct;
        END IF;
    END LOOP;
    RAISE NOTICE 'Todos os cenários atingiram ganho >= 20%% com uso de índice.';
END
$$;

-- ----------------------------------------------------------------
-- PROVA VISUAL (planos de execução): recria a massa e mostra
-- EXPLAIN ANALYZE do Seq Scan (sem índice) vs Index Scan + Nested Loop
-- (com índice) para o cenário 1 (JOIN). Útil para anexar ao relatório.
-- ----------------------------------------------------------------
SELECT count(*) AS regerando_massa_para_explain
FROM fu_sissa_benchmark_indice(200000, 1);  -- regenera a massa (200k p/ EXPLAIN rápido)

\echo ''
\echo '--- EXPLAIN ANALYZE SEM ÍNDICE (espera-se Seq Scan na matrícula) ---'
DROP INDEX IF EXISTS idx_bench_mat_curso;
ANALYZE sissa_bench_matricula;
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT count(*) FROM sissa_bench_matricula m
JOIN sissa_bench_risco r ON r.matricula_id = m.id
WHERE m.curso_id = 37 AND r.risco = 'Alto';

\echo ''
\echo '--- EXPLAIN ANALYZE COM ÍNDICE (espera-se Index Scan + Nested Loop) ---'
CREATE INDEX idx_bench_mat_curso ON sissa_bench_matricula(curso_id);
ANALYZE sissa_bench_matricula;
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT count(*) FROM sissa_bench_matricula m
JOIN sissa_bench_risco r ON r.matricula_id = m.id
WHERE m.curso_id = 37 AND r.risco = 'Alto';

-- ----------------------------------------------------------------
-- LIMPEZA: remove a massa de benchmark (não polui a demonstração)
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS sissa_bench_risco     CASCADE;
DROP TABLE IF EXISTS sissa_bench_matricula CASCADE;
-- a função fu_sissa_benchmark_indice é mantida para reexecução do teste.

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo '  FIM DO BENCHMARK DE ÍNDICES'
\echo '════════════════════════════════════════════════════════════════'
