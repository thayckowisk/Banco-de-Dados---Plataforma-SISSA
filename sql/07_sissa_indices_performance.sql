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
-- DUAS NECESSIDADES IDENTIFICADAS (extraídas dos requisitos do Anexo):
--
--   ÍNDICE 1 — "Consulta de risco de evasão dos alunos do curso"
--     A tela 4 lista estudantes filtrando por CURSO e por NÍVEL DE RISCO.
--     Sem índice, cada consulta varre toda a tabela (Seq Scan).
--     Índice composto B-tree em (curso_id, risco) → Index Scan seletivo.
--     Espelha o índice real idx_sissa_est_curso_nome / idx_sissa_risco_comp.
--
--   ÍNDICE 2 — "Identificação do estudante por matrícula"
--     A importação via API e o vínculo único exigem localizar 1 aluno
--     pela matrícula (WHERE matricula = ...). Sem índice → Seq Scan da
--     tabela inteira para achar 1 linha. Índice B-tree em (matricula)
--     → busca direta. Espelha o índice real idx_sissa_estudante_mat.
--
-- Este script é AUTOCONTIDO e IDEMPOTENTE: cria uma tabela de massa
-- (sissa_bench_risco), mede os dois cenários e, ao final, remove a
-- tabela de massa para não poluir os dados de demonstração da UI.
-- ================================================================

-- ----------------------------------------------------------------
-- Limpeza prévia (idempotente)
-- ----------------------------------------------------------------
DROP FUNCTION IF EXISTS fu_sissa_benchmark_indice(INTEGER, INTEGER) CASCADE;
DROP TABLE    IF EXISTS sissa_bench_risco CASCADE;

-- ----------------------------------------------------------------
-- Tabela de massa (estrutura achatada estudante + risco)
-- ----------------------------------------------------------------
CREATE TABLE sissa_bench_risco (
    id           SERIAL       PRIMARY KEY,
    matricula    VARCHAR(20)  NOT NULL,
    nome         VARCHAR(120) NOT NULL,
    curso_id     INTEGER      NOT NULL,
    risco        VARCHAR(10)  NOT NULL,
    media_global NUMERIC(4,2) NOT NULL,
    reprovacoes  INTEGER      NOT NULL
);

-- ================================================================
-- FUNÇÃO DE BENCHMARK
--   p_linhas  : tamanho da massa de dados a gerar
--   p_repeat  : quantas vezes cada consulta é repetida (reduz ruído)
--   Retorna, para cada um dos 2 cenários:
--     - tempo total SEM índice (Seq Scan)
--     - tempo total COM índice (Index Scan)
--     - ganho percentual
--     - se atende ao mínimo de 20%
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
    v_mat_alvo   TEXT;
BEGIN
    -- ---------- Garante a tabela de massa (autossuficiente) ----------
    CREATE TABLE IF NOT EXISTS sissa_bench_risco (
        id           SERIAL       PRIMARY KEY,
        matricula    VARCHAR(20)  NOT NULL,
        nome         VARCHAR(120) NOT NULL,
        curso_id     INTEGER      NOT NULL,
        risco        VARCHAR(10)  NOT NULL,
        media_global NUMERIC(4,2) NOT NULL,
        reprovacoes  INTEGER      NOT NULL
    );

    -- ---------- Geração da massa de dados ----------
    TRUNCATE sissa_bench_risco RESTART IDENTITY;
    INSERT INTO sissa_bench_risco (matricula, nome, curso_id, risco, media_global, reprovacoes)
    SELECT
        'EST' || LPAD(g::TEXT, 9, '0'),
        'Estudante Sintetico ' || g,
        (g % 60) + 1,                                       -- 60 cursos distintos
        (ARRAY['Alto','Médio','Baixo'])[(g % 3) + 1],       -- 3 níveis de risco
        ROUND((random() * 10)::NUMERIC, 2),
        (g % 6)
    FROM generate_series(1, p_linhas) g;

    v_mat_alvo := 'EST' || LPAD((p_linhas / 2)::TEXT, 9, '0');  -- matrícula no meio
    ANALYZE sissa_bench_risco;

    -- ================================================================
    -- CENÁRIO 1 — Consulta de risco por curso (filtro curso_id + risco)
    -- ================================================================
    -- garante ausência de índice de apoio
    DROP INDEX IF EXISTS idx_bench_curso_risco;

    -- aquecimento (carrega buffers) para comparação justa
    EXECUTE 'SELECT count(*) FROM sissa_bench_risco WHERE curso_id = $1 AND risco = $2'
        INTO v_dummy USING v_curso_alvo, 'Alto';

    v_start := clock_timestamp();
    FOR k IN 1..p_repeat LOOP
        EXECUTE 'SELECT count(*) FROM sissa_bench_risco WHERE curso_id = $1 AND risco = $2'
            INTO v_dummy USING v_curso_alvo, 'Alto';
    END LOOP;
    v_sem := EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000;

    -- cria índice composto e mede de novo
    CREATE INDEX idx_bench_curso_risco ON sissa_bench_risco(curso_id, risco);
    ANALYZE sissa_bench_risco;

    EXECUTE 'SELECT count(*) FROM sissa_bench_risco WHERE curso_id = $1 AND risco = $2'
        INTO v_dummy USING v_curso_alvo, 'Alto';

    v_start := clock_timestamp();
    FOR k IN 1..p_repeat LOOP
        EXECUTE 'SELECT count(*) FROM sissa_bench_risco WHERE curso_id = $1 AND risco = $2'
            INTO v_dummy USING v_curso_alvo, 'Alto';
    END LOOP;
    v_com := EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000;

    cenario             := 'Consulta de risco por curso (curso_id + risco)';
    indice              := 'idx (curso_id, risco)';
    linhas_massa        := p_linhas;
    tempo_sem_indice_ms := ROUND(v_sem, 2);
    tempo_com_indice_ms := ROUND(v_com, 2);
    ganho_pct           := ROUND((v_sem - v_com) / NULLIF(v_sem,0) * 100, 1);
    atende_min_20pct    := ganho_pct >= 20;
    RETURN NEXT;

    DROP INDEX IF EXISTS idx_bench_curso_risco;

    -- ================================================================
    -- CENÁRIO 2 — Identificação de estudante por matrícula (exato)
    -- ================================================================
    DROP INDEX IF EXISTS idx_bench_matricula;

    EXECUTE 'SELECT count(*) FROM sissa_bench_risco WHERE matricula = $1'
        INTO v_dummy USING v_mat_alvo;

    v_start := clock_timestamp();
    FOR k IN 1..p_repeat LOOP
        EXECUTE 'SELECT count(*) FROM sissa_bench_risco WHERE matricula = $1'
            INTO v_dummy USING v_mat_alvo;
    END LOOP;
    v_sem := EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000;

    CREATE INDEX idx_bench_matricula ON sissa_bench_risco(matricula);
    ANALYZE sissa_bench_risco;

    EXECUTE 'SELECT count(*) FROM sissa_bench_risco WHERE matricula = $1'
        INTO v_dummy USING v_mat_alvo;

    v_start := clock_timestamp();
    FOR k IN 1..p_repeat LOOP
        EXECUTE 'SELECT count(*) FROM sissa_bench_risco WHERE matricula = $1'
            INTO v_dummy USING v_mat_alvo;
    END LOOP;
    v_com := EXTRACT(EPOCH FROM clock_timestamp() - v_start) * 1000;

    cenario             := 'Identificacao de estudante por matricula (exato)';
    indice              := 'idx (matricula)';
    linhas_massa        := p_linhas;
    tempo_sem_indice_ms := ROUND(v_sem, 2);
    tempo_com_indice_ms := ROUND(v_com, 2);
    ganho_pct           := ROUND((v_sem - v_com) / NULLIF(v_sem,0) * 100, 1);
    atende_min_20pct    := ganho_pct >= 20;
    RETURN NEXT;

    DROP INDEX IF EXISTS idx_bench_matricula;
END;
$$;

-- ----------------------------------------------------------------
-- EXECUÇÃO DO BENCHMARK + RELATÓRIO
-- ----------------------------------------------------------------
\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo '  BENCHMARK DE ÍNDICES — SISSA (massa de 500.000 linhas)'
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
-- EXPLAIN ANALYZE do Seq Scan (sem índice) vs Index Scan (com índice)
-- para o cenário 1. Útil para anexar ao relatório do trabalho.
-- ----------------------------------------------------------------
SELECT count(*) AS regerando_massa_para_explain
FROM fu_sissa_benchmark_indice(200000, 1);  -- regenera a massa (200k p/ EXPLAIN rápido)

\echo ''
\echo '--- EXPLAIN ANALYZE SEM ÍNDICE (espera-se Seq Scan) ---'
DROP INDEX IF EXISTS idx_bench_curso_risco;
ANALYZE sissa_bench_risco;
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT count(*) FROM sissa_bench_risco WHERE curso_id = 37 AND risco = 'Alto';

\echo ''
\echo '--- EXPLAIN ANALYZE COM ÍNDICE (espera-se Index Scan) ---'
CREATE INDEX idx_bench_curso_risco ON sissa_bench_risco(curso_id, risco);
ANALYZE sissa_bench_risco;
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT count(*) FROM sissa_bench_risco WHERE curso_id = 37 AND risco = 'Alto';

-- ----------------------------------------------------------------
-- LIMPEZA: remove a massa de benchmark (não polui a demonstração)
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS sissa_bench_risco CASCADE;
-- a função fu_sissa_benchmark_indice é mantida para reexecução do teste.

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo '  FIM DO BENCHMARK DE ÍNDICES'
\echo '════════════════════════════════════════════════════════════════'
