-- ================================================================
-- SISSA Platform – Domain Module (Trabalho em Grupo N2.A1)
-- FILE: 05_sissa_domain.sql
-- Run after 01_ddl.sql
--
-- Modelo normalizado:
--   aluno (pessoa) + matricula (vínculo curso) — risco/grupos/intervenções
--   referenciam a MATRÍCULA. unidade/disciplina/semestre são entidades.
--   Intervenção é individual (1 linha por matrícula). Grupo é só favorito.
-- ================================================================

-- ----------------------------------------------------------------
-- DROP (idempotente – funções de trigger primeiro via CASCADE, depois
-- views, funções, procedures e tabelas filhas → pais). Cobre tanto o
-- schema novo quanto o antigo, para reexecução a partir de qualquer um.
-- ----------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_tg_sissa_risco_updated_at()  CASCADE;
DROP FUNCTION IF EXISTS fn_tg_sissa_grupo_inativo()     CASCADE;
DROP FUNCTION IF EXISTS fn_tg_sissa_classificar_risco() CASCADE;

DROP VIEW IF EXISTS vw_sissa_perfil_permissoes      CASCADE;
DROP VIEW IF EXISTS vw_sissa_risco_anonimo          CASCADE;
DROP VIEW IF EXISTS vw_sissa_resumo_intervencoes    CASCADE;
DROP VIEW IF EXISTS vw_sissa_estudantes_risco       CASCADE;
DROP VIEW IF EXISTS vw_sissa_grupos                 CASCADE;

DROP FUNCTION IF EXISTS fu_sissa_classificar(INTEGER, NUMERIC, INTEGER)   CASCADE;
DROP FUNCTION IF EXISTS fu_sissa_calcular_risco(INTEGER)                  CASCADE;
DROP FUNCTION IF EXISTS fu_sissa_resumo_curso(INTEGER)                    CASCADE;
DROP FUNCTION IF EXISTS fu_sissa_nivel_usuario(INTEGER)                   CASCADE;
DROP FUNCTION IF EXISTS fu_sissa_pode(INTEGER, VARCHAR)                   CASCADE;
DROP FUNCTION IF EXISTS fu_sissa_pode_gerenciar_usuario(INTEGER, INTEGER) CASCADE;

-- pr_* podem ter sido criados como FUNCTION (versões antigas) ou PROCEDURE.
DO $drop_procs$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT oid::regprocedure AS sig, prokind
        FROM   pg_proc
        WHERE  proname IN ('pr_sissa_criar_intervencao_grupo',
                           'pr_sissa_atualizar_status_grupos')
    LOOP
        IF r.prokind = 'p' THEN
            EXECUTE 'DROP PROCEDURE ' || r.sig || ' CASCADE';
        ELSE
            EXECUTE 'DROP FUNCTION '  || r.sig || ' CASCADE';
        END IF;
    END LOOP;
END
$drop_procs$;

-- Tabelas (filhas → pais). Inclui nomes antigos para reexecução limpa.
DROP TABLE IF EXISTS sissa_intervencao_estudante  CASCADE;  -- antigo
DROP TABLE IF EXISTS sissa_intervencao            CASCADE;
DROP TABLE IF EXISTS sissa_grupo_estudante        CASCADE;  -- antigo
DROP TABLE IF EXISTS sissa_grupo_matricula        CASCADE;
DROP TABLE IF EXISTS sissa_grupo_intervencao      CASCADE;
DROP TABLE IF EXISTS sissa_risco_evasao           CASCADE;
DROP TABLE IF EXISTS sissa_estudante              CASCADE;  -- antigo
DROP TABLE IF EXISTS sissa_matricula              CASCADE;
DROP TABLE IF EXISTS sissa_aluno                  CASCADE;
DROP TABLE IF EXISTS sissa_disciplina             CASCADE;
DROP TABLE IF EXISTS sissa_semestre               CASCADE;
DROP TABLE IF EXISTS sissa_usuario_curso          CASCADE;
DROP TABLE IF EXISTS sissa_usuario_sissa          CASCADE;
DROP TABLE IF EXISTS sissa_nivel_acao             CASCADE;
DROP TABLE IF EXISTS sissa_perfil                 CASCADE;
DROP TABLE IF EXISTS sissa_curso                  CASCADE;
DROP TABLE IF EXISTS sissa_unidade                CASCADE;
DROP TABLE IF EXISTS sissa_instituicao            CASCADE;

-- ================================================================
-- TABLES
-- ================================================================

-- ----------------------------------------------------------------
-- SISSA_INSTITUICAO
-- ----------------------------------------------------------------
CREATE TABLE sissa_instituicao (
    id       SERIAL       PRIMARY KEY,
    code_mec VARCHAR(20)  NOT NULL UNIQUE,
    nome     VARCHAR(255) NOT NULL,
    tipo     VARCHAR(30)  CHECK (tipo IN ('Universidade','Instituto Federal'))
);

-- ----------------------------------------------------------------
-- SISSA_UNIDADE  (câmpus/regional; um curso pertence a uma unidade)
-- ----------------------------------------------------------------
CREATE TABLE sissa_unidade (
    id             SERIAL       PRIMARY KEY,
    nome           VARCHAR(255) NOT NULL,
    sigla          VARCHAR(20),
    instituicao_id INTEGER      NOT NULL REFERENCES sissa_instituicao(id) ON DELETE RESTRICT
);

CREATE INDEX idx_sissa_unidade_inst ON sissa_unidade(instituicao_id);

-- ----------------------------------------------------------------
-- SISSA_CURSO  (alcança a instituição via unidade)
-- ----------------------------------------------------------------
CREATE TABLE sissa_curso (
    id         SERIAL       PRIMARY KEY,
    codigo     VARCHAR(20),
    nome       VARCHAR(255) NOT NULL,
    unidade_id INTEGER      NOT NULL REFERENCES sissa_unidade(id) ON DELETE RESTRICT
);

CREATE INDEX idx_sissa_curso_unidade ON sissa_curso(unidade_id);

-- ----------------------------------------------------------------
-- SISSA_PERFIL
-- ----------------------------------------------------------------
CREATE TABLE sissa_perfil (
    id    SERIAL       PRIMARY KEY,
    nome  VARCHAR(100) NOT NULL UNIQUE,
    nivel INTEGER      NOT NULL DEFAULT 1   -- 5=Coord. unidade … 1=Tutor
);

-- ----------------------------------------------------------------
-- SISSA_NIVEL_ACAO  (matriz de permissões data-driven)
-- ----------------------------------------------------------------
CREATE TABLE sissa_nivel_acao (
    nivel INTEGER     NOT NULL,
    acao  VARCHAR(40) NOT NULL,
    CONSTRAINT pk_sissa_nivel_acao PRIMARY KEY (nivel, acao)
);

-- ----------------------------------------------------------------
-- SISSA_USUARIO_SISSA
-- ----------------------------------------------------------------
CREATE TABLE sissa_usuario_sissa (
    id                  SERIAL       PRIMARY KEY,
    nome                VARCHAR(255) NOT NULL,
    email_institucional VARCHAR(255) NOT NULL UNIQUE,
    senha               VARCHAR(4),   -- senha simples de 4 dígitos (projeto educacional/local)
    perfil_id           INTEGER      REFERENCES sissa_perfil(id) ON DELETE SET NULL,
    ultimo_acesso       TIMESTAMP,
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sissa_usuario_perfil ON sissa_usuario_sissa(perfil_id);
CREATE INDEX idx_sissa_usuario_email  ON sissa_usuario_sissa(email_institucional);

-- ----------------------------------------------------------------
-- SISSA_USUARIO_CURSO  (N:N) — escopo de acesso por curso
-- ----------------------------------------------------------------
CREATE TABLE sissa_usuario_curso (
    usuario_id INTEGER NOT NULL REFERENCES sissa_usuario_sissa(id) ON DELETE CASCADE,
    curso_id   INTEGER NOT NULL REFERENCES sissa_curso(id) ON DELETE CASCADE,
    CONSTRAINT pk_sissa_uc PRIMARY KEY (usuario_id, curso_id)
);

-- ----------------------------------------------------------------
-- SISSA_SEMESTRE  (entidade)
-- ----------------------------------------------------------------
CREATE TABLE sissa_semestre (
    id      SERIAL   PRIMARY KEY,
    ano     SMALLINT NOT NULL,
    periodo SMALLINT NOT NULL CHECK (periodo IN (1,2)),
    CONSTRAINT uq_sissa_semestre UNIQUE (ano, periodo)
);

-- ----------------------------------------------------------------
-- SISSA_ALUNO  (pessoa)
-- ----------------------------------------------------------------
CREATE TABLE sissa_aluno (
    id         SERIAL       PRIMARY KEY,
    nome       VARCHAR(255) NOT NULL,
    email      VARCHAR(255) UNIQUE,
    created_at TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sissa_aluno_nome ON sissa_aluno(nome);

-- ----------------------------------------------------------------
-- SISSA_MATRICULA  (vínculo aluno↔curso; guarda os indicadores
--   acadêmicos que alimentam a classificação de risco)
-- ----------------------------------------------------------------
CREATE TABLE sissa_matricula (
    id              SERIAL       PRIMARY KEY,
    codigo          VARCHAR(30)  NOT NULL UNIQUE,
    aluno_id        INTEGER      NOT NULL REFERENCES sissa_aluno(id) ON DELETE CASCADE,
    curso_id        INTEGER      NOT NULL REFERENCES sissa_curso(id) ON DELETE RESTRICT,
    ingresso        INTEGER,
    status          VARCHAR(20)  NOT NULL DEFAULT 'Ativa',
    naturalidade_uf CHAR(2),
    forma_ingresso  VARCHAR(50),
    media_global    DECIMAL(4,2),
    reprovacoes     INTEGER      DEFAULT 0,
    ch_semestre     INTEGER      DEFAULT 0,
    created_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sissa_matricula_curso ON sissa_matricula(curso_id);
CREATE INDEX idx_sissa_matricula_aluno ON sissa_matricula(aluno_id);

-- ----------------------------------------------------------------
-- SISSA_DISCIPLINA  (entidade; pertence a um curso)
-- ----------------------------------------------------------------
CREATE TABLE sissa_disciplina (
    id            SERIAL       PRIMARY KEY,
    nome          VARCHAR(255) NOT NULL,
    carga_horaria INTEGER,
    codigo        VARCHAR(50),
    curso_id      INTEGER      NOT NULL REFERENCES sissa_curso(id) ON DELETE RESTRICT
);

CREATE INDEX idx_sissa_disciplina_curso ON sissa_disciplina(curso_id);

-- ----------------------------------------------------------------
-- SISSA_RISCO_EVASAO  (1:1 com matrícula; guarda o derivado de risco)
-- ----------------------------------------------------------------
CREATE TABLE sissa_risco_evasao (
    id               SERIAL      PRIMARY KEY,
    matricula_id     INTEGER     NOT NULL UNIQUE REFERENCES sissa_matricula(id) ON DELETE CASCADE,
    risco            VARCHAR(10) CHECK (risco IN ('Alto','Médio','Baixo')),
    semestre_saida   INTEGER,
    semestre_atual   INTEGER,
    maior_influencia VARCHAR(100),
    percentual       DECIMAL(5,2),
    turmas           INTEGER     DEFAULT 0,
    updated_at       TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sissa_risco_nivel   ON sissa_risco_evasao(risco);
CREATE INDEX idx_sissa_risco_updated ON sissa_risco_evasao(updated_at DESC);

-- ----------------------------------------------------------------
-- SISSA_GRUPO_INTERVENCAO
-- ----------------------------------------------------------------
CREATE TABLE sissa_grupo_intervencao (
    id          SERIAL       PRIMARY KEY,
    titulo      VARCHAR(255) NOT NULL,
    semestre    VARCHAR(10),
    observacoes TEXT,
    autoria_id  INTEGER      REFERENCES sissa_usuario_sissa(id) ON DELETE SET NULL,
    status      VARCHAR(10)  NOT NULL DEFAULT 'Ativo' CHECK (status IN ('Ativo','Inativo')),
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sissa_grupo_status ON sissa_grupo_intervencao(status);

-- ----------------------------------------------------------------
-- SISSA_GRUPO_MATRICULA  (N:N) — grupo é um favorito de matrículas
-- ----------------------------------------------------------------
CREATE TABLE sissa_grupo_matricula (
    grupo_id     INTEGER NOT NULL REFERENCES sissa_grupo_intervencao(id) ON DELETE CASCADE,
    matricula_id INTEGER NOT NULL REFERENCES sissa_matricula(id) ON DELETE CASCADE,
    CONSTRAINT pk_sissa_gm PRIMARY KEY (grupo_id, matricula_id)
);

-- ----------------------------------------------------------------
-- SISSA_INTERVENCAO  (individual: 1 linha por matrícula)
-- ----------------------------------------------------------------
CREATE TABLE sissa_intervencao (
    id                  SERIAL       PRIMARY KEY,
    matricula_id        INTEGER      NOT NULL REFERENCES sissa_matricula(id) ON DELETE CASCADE,
    disciplina_id       INTEGER      REFERENCES sissa_disciplina(id) ON DELETE SET NULL,
    semestre_id         INTEGER      REFERENCES sissa_semestre(id) ON DELETE SET NULL,
    data_intervencao    DATE,
    forma_meio          VARCHAR(100),
    assunto             VARCHAR(100),
    formato             VARCHAR(20)  CHECK (formato IN ('Individual','Grupo')),
    interacao           VARCHAR(20)  CHECK (interacao IN ('Pró-ativa','Reativa')),
    tipo                VARCHAR(20)  CHECK (tipo IN ('Conteúdo','Acolhimento','Outro')),
    acompanhamento      VARCHAR(20)  CHECK (acompanhamento IN ('Assíncrono','Síncrono')),
    duracao             VARCHAR(20),
    objetivo_alcancado  VARCHAR(20)  CHECK (objetivo_alcancado IN ('Sim','Não','Parcialmente')),
    observacoes         TEXT,
    encaminhado         BOOLEAN      DEFAULT FALSE,
    encaminhar_para     VARCHAR(255),
    autoria_id          INTEGER      REFERENCES sissa_usuario_sissa(id) ON DELETE SET NULL,
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sissa_intervencao_matricula  ON sissa_intervencao(matricula_id);
CREATE INDEX idx_sissa_intervencao_data       ON sissa_intervencao(data_intervencao DESC);
CREATE INDEX idx_sissa_intervencao_disciplina ON sissa_intervencao(disciplina_id);
CREATE INDEX idx_sissa_intervencao_semestre   ON sissa_intervencao(semestre_id);

-- ================================================================
-- ÍNDICE ADICIONAL para demonstração de ganho de performance
-- ================================================================
CREATE INDEX idx_sissa_risco_comp ON sissa_risco_evasao(risco, matricula_id);

-- ================================================================
-- FONTE ÚNICA DE RISCO
-- ================================================================

-- ----------------------------------------------------------------
-- fu_sissa_classificar — ÚNICO lugar com os limiares Alto/Médio/Baixo.
--   Função pura (IMMUTABLE) dos indicadores acadêmicos; a trigger e a
--   fu_sissa_calcular_risco delegam a ela, sem repetir os limiares.
--     Alto  → reprovacoes >= 3 OU media_global < 3.0
--     Médio → reprovacoes >= 1 OU media_global < 5.5 OU ch_semestre < 400
--     Baixo → caso contrário
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fu_sissa_classificar(
    p_reprovacoes  INTEGER,
    p_media_global NUMERIC,
    p_ch_semestre  INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_reprovacoes >= 3 OR p_media_global < 3.0 THEN
        RETURN 'Alto';
    ELSIF p_reprovacoes >= 1 OR p_media_global < 5.5 OR p_ch_semestre < 400 THEN
        RETURN 'Médio';
    ELSE
        RETURN 'Baixo';
    END IF;
END;
$$;

-- ================================================================
-- TRIGGERS
-- ================================================================

-- ----------------------------------------------------------------
-- TRIGGER 1 – tg_sissa_risco_evasao_timestamp
--   Atualiza updated_at em sissa_risco_evasao a cada INSERT/UPDATE.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tg_sissa_risco_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_sissa_risco_evasao_timestamp
    BEFORE INSERT OR UPDATE ON sissa_risco_evasao
    FOR EACH ROW
    EXECUTE FUNCTION fn_tg_sissa_risco_updated_at();

-- ----------------------------------------------------------------
-- TRIGGER 2 – tg_sissa_classificar_risco
--   Classifica o nível de risco a cada INSERT/UPDATE em
--   sissa_risco_evasao, lendo os indicadores (reprovações, média
--   global, CH semestre) da MATRÍCULA referenciada. Garante que o
--   campo 'risco' nunca fique inconsistente com os dados. Os limiares
--   ficam em fu_sissa_classificar (fonte única); aqui só delegamos.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tg_sissa_classificar_risco()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_rep   INTEGER;
    v_media NUMERIC;
    v_ch    INTEGER;
BEGIN
    SELECT reprovacoes, media_global, ch_semestre
    INTO   v_rep, v_media, v_ch
    FROM   sissa_matricula
    WHERE  id = NEW.matricula_id;

    NEW.risco := fu_sissa_classificar(v_rep, v_media, v_ch);
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_sissa_classificar_risco
    BEFORE INSERT OR UPDATE ON sissa_risco_evasao
    FOR EACH ROW
    EXECUTE FUNCTION fn_tg_sissa_classificar_risco();

-- NOTA: a antiga tg_sissa_grupo_inativo_auto (reativava o grupo ao
-- receber intervenção via grupo_id) foi removida — intervenção não se
-- vincula mais a grupo. Sua redefinição ("reativar quando todos os
-- membros tiverem intervenção") é a pendência de design do CLAUDE.md.

-- ================================================================
-- FUNÇÕES PostgreSQL do domínio SISSA
-- ================================================================

-- ----------------------------------------------------------------
-- FUNÇÃO 1 – fu_sissa_calcular_risco
--   IN:  p_matricula_id — id da matrícula
--   OUT: nível de risco calculado a partir dos indicadores da matrícula
--        (reprovações, média global, CH semestre).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fu_sissa_calcular_risco(p_matricula_id INTEGER)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_rep   INTEGER;
    v_media NUMERIC;
    v_ch    INTEGER;
BEGIN
    SELECT reprovacoes, media_global, ch_semestre
    INTO   v_rep, v_media, v_ch
    FROM   sissa_matricula
    WHERE  id = p_matricula_id;

    IF NOT FOUND THEN
        RETURN 'Sem dados';
    END IF;

    -- delega à fonte única dos limiares
    RETURN fu_sissa_classificar(v_rep, v_media, v_ch);
END;
$$;

-- ----------------------------------------------------------------
-- FUNÇÃO 2 – fu_sissa_resumo_curso
--   IN:  p_curso_id — id do curso
--   OUT: TABLE com indicadores agregados do curso (total de matrículas,
--        contagem por nível de risco, média de reprovações, % alto risco).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fu_sissa_resumo_curso(p_curso_id INTEGER)
RETURNS TABLE(
    r_curso_nome       VARCHAR,
    r_total            BIGINT,
    r_alto             BIGINT,
    r_medio            BIGINT,
    r_baixo            BIGINT,
    r_media_reprov     NUMERIC,
    r_pct_alto_risco   NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.nome::VARCHAR                                      AS r_curso_nome,
        COUNT(m.id)                                          AS r_total,
        COUNT(*) FILTER (WHERE r.risco = 'Alto')            AS r_alto,
        COUNT(*) FILTER (WHERE r.risco = 'Médio')           AS r_medio,
        COUNT(*) FILTER (WHERE r.risco = 'Baixo')           AS r_baixo,
        ROUND(AVG(m.reprovacoes)::NUMERIC, 2)               AS r_media_reprov,
        CASE
            WHEN COUNT(m.id) = 0 THEN 0
            ELSE ROUND(
                (COUNT(*) FILTER (WHERE r.risco = 'Alto') * 100.0 / COUNT(m.id))::NUMERIC, 1
            )
        END                                                  AS r_pct_alto_risco
    FROM sissa_curso c
    JOIN sissa_matricula m         ON m.curso_id = c.id
    LEFT JOIN sissa_risco_evasao r ON r.matricula_id = m.id
    WHERE c.id = p_curso_id
    GROUP BY c.nome;
END;
$$;

-- ----------------------------------------------------------------
-- FUNÇÃO 3 – fu_sissa_nivel_usuario
--   Retorna o nível (1..5) do perfil de um usuário SISSA. 0 se não houver.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fu_sissa_nivel_usuario(p_usuario_id INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_nivel INTEGER;
BEGIN
    SELECT p.nivel
    INTO   v_nivel
    FROM   sissa_usuario_sissa u
    JOIN   sissa_perfil p ON p.id = u.perfil_id
    WHERE  u.id = p_usuario_id;

    RETURN COALESCE(v_nivel, 0);
END;
$$;

-- ----------------------------------------------------------------
-- FUNÇÃO 4 – fu_sissa_pode
--   TRUE se o nível do usuário possui a ação na matriz sissa_nivel_acao.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fu_sissa_pode(p_usuario_id INTEGER, p_acao VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM   sissa_nivel_acao na
        WHERE  na.acao  = p_acao
        AND    na.nivel = fu_sissa_nivel_usuario(p_usuario_id)
    );
END;
$$;

-- ----------------------------------------------------------------
-- FUNÇÃO 5 – fu_sissa_pode_gerenciar_usuario
--   Um usuário só gerencia OUTRO de nível estritamente menor, e precisa
--   da permissão 'usuario_gerenciar'.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fu_sissa_pode_gerenciar_usuario(
    p_ator_id INTEGER,
    p_alvo_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_nivel_ator INTEGER := fu_sissa_nivel_usuario(p_ator_id);
    v_nivel_alvo INTEGER := fu_sissa_nivel_usuario(p_alvo_id);
BEGIN
    IF NOT fu_sissa_pode(p_ator_id, 'usuario_gerenciar') THEN
        RETURN FALSE;
    END IF;
    RETURN v_nivel_ator > v_nivel_alvo;
END;
$$;

-- ================================================================
-- PROCEDIMENTOS do domínio SISSA
-- ================================================================

-- ----------------------------------------------------------------
-- PROCEDURE 1 – pr_sissa_criar_intervencao_grupo
--   Percorre as matrículas do grupo e insere UMA intervenção individual
--   por matrícula (intervenção é individual; sem grupo_id, sem N:N). O
--   total de intervenções criadas volta pelo INOUT p_total.
-- ----------------------------------------------------------------
CREATE OR REPLACE PROCEDURE pr_sissa_criar_intervencao_grupo(
    p_grupo_id       INTEGER,
    p_data           DATE,
    p_semestre_id    INTEGER,
    p_disciplina_id  INTEGER,
    p_forma_meio     VARCHAR,
    p_assunto        VARCHAR,
    p_interacao      VARCHAR,
    p_tipo           VARCHAR,
    p_acompanhamento VARCHAR,
    p_observacoes    TEXT,
    INOUT p_total    INTEGER DEFAULT 0
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_matricula_id INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sissa_grupo_intervencao WHERE id = p_grupo_id) THEN
        RAISE EXCEPTION 'Grupo de intervenção % não encontrado.', p_grupo_id;
    END IF;

    p_total := 0;
    FOR v_matricula_id IN
        SELECT matricula_id FROM sissa_grupo_matricula WHERE grupo_id = p_grupo_id
    LOOP
        INSERT INTO sissa_intervencao
            (matricula_id, disciplina_id, semestre_id, data_intervencao,
             forma_meio, assunto, formato, interacao, tipo, acompanhamento, observacoes)
        VALUES
            (v_matricula_id, p_disciplina_id, p_semestre_id, p_data,
             p_forma_meio, p_assunto, 'Individual', p_interacao, p_tipo, p_acompanhamento, p_observacoes);
        p_total := p_total + 1;
    END LOOP;
END;
$$;

-- ----------------------------------------------------------------
-- PROCEDURE 2 – pr_sissa_atualizar_status_grupos
--   Rotina de manutenção em lote: inativa grupos ATIVOS cuja última
--   intervenção (entre as matrículas membros) tem mais de 180 dias, ou
--   que não têm intervenção e foram criados há mais de 180 dias. O total
--   inativado volta pelo INOUT p_total.
-- ----------------------------------------------------------------
CREATE OR REPLACE PROCEDURE pr_sissa_atualizar_status_grupos(
    INOUT p_total INTEGER DEFAULT 0
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_rec    RECORD;
    v_ultima DATE;
BEGIN
    p_total := 0;
    FOR v_rec IN
        SELECT g.id
        FROM sissa_grupo_intervencao g
        WHERE g.status = 'Ativo'
    LOOP
        SELECT MAX(i.data_intervencao)
        INTO   v_ultima
        FROM   sissa_intervencao i
        JOIN   sissa_grupo_matricula gm ON gm.matricula_id = i.matricula_id
        WHERE  gm.grupo_id = v_rec.id;

        IF (v_ultima IS NULL AND (NOW()::DATE - (SELECT created_at::DATE FROM sissa_grupo_intervencao WHERE id=v_rec.id)) > 180)
        OR (v_ultima IS NOT NULL AND (NOW()::DATE - v_ultima) > 180) THEN
            UPDATE sissa_grupo_intervencao
            SET    status = 'Inativo'
            WHERE  id = v_rec.id;
            p_total := p_total + 1;
        END IF;
    END LOOP;
END;
$$;

-- ================================================================
-- VIEWS  (mesmas colunas de saída do schema anterior — front não muda)
-- ================================================================

-- View 1 – matrículas com risco de evasão
CREATE OR REPLACE VIEW vw_sissa_estudantes_risco AS
SELECT
    m.id,
    m.codigo AS matricula,
    a.nome,
    m.ingresso,
    c.id     AS curso_id,
    c.nome   AS curso_nome,
    c.codigo AS curso_codigo,
    i.nome   AS instituicao_nome,
    i.code_mec,
    r.risco,
    r.semestre_saida,
    m.media_global,
    r.semestre_atual,
    m.reprovacoes,
    m.ch_semestre,
    r.maior_influencia,
    r.turmas,
    r.updated_at AS risco_updated_at,
    (
        SELECT COUNT(*)
        FROM sissa_grupo_matricula gm
        WHERE gm.matricula_id = m.id
    ) AS total_grupos
FROM sissa_matricula m
JOIN  sissa_aluno a            ON a.id = m.aluno_id
JOIN  sissa_curso c            ON c.id = m.curso_id
JOIN  sissa_unidade un         ON un.id = c.unidade_id
JOIN  sissa_instituicao i      ON i.id = un.instituicao_id
LEFT JOIN sissa_risco_evasao r ON r.matricula_id = m.id;

-- View 2 – grupos com contagem de matrículas
CREATE OR REPLACE VIEW vw_sissa_grupos AS
SELECT
    g.id,
    g.titulo,
    g.semestre,
    g.observacoes,
    g.status,
    g.created_at,
    u.nome     AS autoria_nome,
    u.perfil_id,
    p.nome     AS autoria_perfil,
    COUNT(gm.matricula_id) AS total_estudantes
FROM sissa_grupo_intervencao g
LEFT JOIN sissa_usuario_sissa u    ON u.id = g.autoria_id
LEFT JOIN sissa_perfil p           ON p.id = u.perfil_id
LEFT JOIN sissa_grupo_matricula gm ON gm.grupo_id = g.id
GROUP BY g.id, g.titulo, g.semestre, g.observacoes, g.status, g.created_at,
         u.nome, u.perfil_id, p.nome;

-- View 3 – RISCO ANÔNIMO (sem nome nem matrícula do aluno)
CREATE OR REPLACE VIEW vw_sissa_risco_anonimo AS
SELECT
    r.id                                        AS risco_id,
    c.nome                                      AS curso_nome,
    c.codigo                                    AS curso_codigo,
    i.nome                                      AS instituicao_nome,
    r.risco,
    r.semestre_saida,
    m.media_global,
    r.semestre_atual,
    m.reprovacoes,
    m.ch_semestre,
    r.maior_influencia,
    r.turmas,
    r.updated_at
FROM sissa_risco_evasao r
JOIN sissa_matricula m     ON m.id = r.matricula_id
JOIN sissa_curso c         ON c.id = m.curso_id
JOIN sissa_unidade un      ON un.id = c.unidade_id
JOIN sissa_instituicao i   ON i.id = un.instituicao_id;

-- View 4 – RESUMO DE INTERVENÇÕES por grupo (via matrículas membros)
CREATE OR REPLACE VIEW vw_sissa_resumo_intervencoes AS
SELECT
    g.id                                                             AS grupo_id,
    g.titulo                                                         AS grupo_titulo,
    g.semestre                                                       AS grupo_semestre,
    g.status                                                         AS grupo_status,
    COUNT(DISTINCT i.id)                                            AS total_intervencoes,
    COUNT(DISTINCT gm.matricula_id)                                 AS total_estudantes_grupo,
    COUNT(DISTINCT i.matricula_id)                                  AS total_estudantes_atendidos,
    COUNT(*) FILTER (WHERE i.objetivo_alcancado = 'Sim')           AS objetivos_sim,
    COUNT(*) FILTER (WHERE i.objetivo_alcancado = 'Não')           AS objetivos_nao,
    COUNT(*) FILTER (WHERE i.objetivo_alcancado = 'Parcialmente')  AS objetivos_parciais,
    MAX(i.data_intervencao)                                         AS ultima_intervencao,
    MIN(i.data_intervencao)                                         AS primeira_intervencao,
    u.nome                                                           AS autoria_nome,
    p.nome                                                           AS autoria_perfil
FROM sissa_grupo_intervencao g
LEFT JOIN sissa_grupo_matricula gm ON gm.grupo_id = g.id
LEFT JOIN sissa_intervencao i      ON i.matricula_id = gm.matricula_id
LEFT JOIN sissa_usuario_sissa u    ON u.id = g.autoria_id
LEFT JOIN sissa_perfil p           ON p.id = u.perfil_id
GROUP BY g.id, g.titulo, g.semestre, g.status, u.nome, p.nome;

-- View 5 – PERMISSÕES POR PERFIL (matriz nível × ação)
CREATE OR REPLACE VIEW vw_sissa_perfil_permissoes AS
SELECT
    p.id    AS perfil_id,
    p.nome  AS perfil_nome,
    p.nivel,
    na.acao
FROM sissa_perfil p
JOIN sissa_nivel_acao na ON na.nivel = p.nivel
ORDER BY p.nivel DESC, p.nome, na.acao;

-- ================================================================
-- ROLES DE SEGURANÇA
-- ================================================================

-- Roles são GLOBAIS no cluster (podem ser usadas por outros bancos), então
-- NÃO as dropamos: criamos se faltarem e, abaixo, revogamos/reconcedemos os
-- privilégios apenas NESTE banco — idempotente e seguro entre bancos.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'admin_sissa') THEN
        CREATE ROLE admin_sissa NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'leitura_sissa') THEN
        CREATE ROLE leitura_sissa NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'risco_anonimo_sissa') THEN
        CREATE ROLE risco_anonimo_sissa NOLOGIN;
    END IF;
END $$;

-- Zera os privilégios destas roles neste banco antes de reconceder
REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM admin_sissa, leitura_sissa, risco_anonimo_sissa;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM admin_sissa, leitura_sissa, risco_anonimo_sissa;

-- ROLE 1 – admin_sissa: CRUD total nas tabelas SISSA
GRANT SELECT, INSERT, UPDATE, DELETE
    ON sissa_instituicao, sissa_unidade, sissa_curso, sissa_perfil, sissa_nivel_acao,
       sissa_usuario_sissa, sissa_usuario_curso, sissa_semestre, sissa_disciplina,
       sissa_aluno, sissa_matricula, sissa_risco_evasao,
       sissa_grupo_intervencao, sissa_grupo_matricula, sissa_intervencao
    TO admin_sissa;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO admin_sissa;
GRANT SELECT ON vw_sissa_estudantes_risco, vw_sissa_grupos,
               vw_sissa_risco_anonimo, vw_sissa_resumo_intervencoes,
               vw_sissa_perfil_permissoes
    TO admin_sissa;

-- ROLE 2 – leitura_sissa: somente SELECT nas tabelas SISSA
GRANT SELECT
    ON sissa_instituicao, sissa_unidade, sissa_curso, sissa_perfil, sissa_nivel_acao,
       sissa_usuario_sissa, sissa_usuario_curso, sissa_semestre, sissa_disciplina,
       sissa_aluno, sissa_matricula, sissa_risco_evasao,
       sissa_grupo_intervencao, sissa_grupo_matricula, sissa_intervencao
    TO leitura_sissa;
GRANT SELECT ON vw_sissa_estudantes_risco, vw_sissa_grupos,
               vw_sissa_risco_anonimo, vw_sissa_resumo_intervencoes,
               vw_sissa_perfil_permissoes
    TO leitura_sissa;

-- ROLE 3 – risco_anonimo_sissa: SELECT somente na view sem identificadores
GRANT SELECT ON vw_sissa_risco_anonimo TO risco_anonimo_sissa;

-- ================================================================
-- SEED DATA (massa robusta para demonstração)
-- ================================================================

-- Instituições (2 principais + 2 extras)
INSERT INTO sissa_instituicao (code_mec, nome, tipo) VALUES
    ('26358', 'Instituto Federal de São Paulo',  'Instituto Federal'),
    ('579',   'Universidade Federal de Goiás',   'Universidade'),
    ('12075', 'Instituto Federal de Rondônia',   'Instituto Federal'),
    ('23040', 'Instituto Federal do Mato Grosso','Instituto Federal')
ON CONFLICT (code_mec) DO NOTHING;

-- Unidades (câmpus/regionais) — uma instituição tem várias unidades
INSERT INTO sissa_unidade (nome, sigla, instituicao_id) VALUES
    ('Câmpus São Paulo',          'SPO', 1),  -- id 1
    ('Câmpus Guarulhos',          'GRU', 1),  -- id 2
    ('Regional Goiânia',          'GYN', 2),  -- id 3
    ('Câmpus Colorado do Oeste',  'COL', 3),  -- id 4
    ('Câmpus Cuiabá',             'CBA', 4);  -- id 5

-- Perfis (nível: 5 = mais alto … 1 = mais baixo). Ordem preservada (ids 1..5).
INSERT INTO sissa_perfil (nome, nivel) VALUES
    ('Coordenador de curso',   3),   -- id 1
    ('Coordenador de ensino',  4),   -- id 2
    ('Coordenador de unidade', 5),   -- id 3
    ('Tutor Físico',           2),   -- id 4
    ('Tutor',                  1)    -- id 5
ON CONFLICT (nome) DO NOTHING;

-- ----------------------------------------------------------------
-- MATRIZ DE PERMISSÕES (nível → ações permitidas)
-- ----------------------------------------------------------------
INSERT INTO sissa_nivel_acao (nivel, acao) VALUES
    -- Nível 1 — Tutor
    (1,'ver'), (1,'intervencao_criar'), (1,'intervencao_editar'),
    -- Nível 2 — Tutor Físico
    (2,'ver'), (2,'intervencao_criar'), (2,'intervencao_editar'),
    (2,'intervencao_excluir'), (2,'grupo_gerenciar'),
    -- Nível 3 — Coordenador de curso
    (3,'ver'), (3,'intervencao_criar'), (3,'intervencao_editar'),
    (3,'intervencao_excluir'), (3,'grupo_gerenciar'), (3,'grupo_excluir'),
    (3,'estudante_gerenciar'), (3,'usuario_gerenciar'),
    -- Nível 4 — Coordenador de ensino
    (4,'ver'), (4,'intervencao_criar'), (4,'intervencao_editar'),
    (4,'intervencao_excluir'), (4,'grupo_gerenciar'), (4,'grupo_excluir'),
    (4,'estudante_gerenciar'), (4,'usuario_gerenciar'), (4,'usuario_excluir'),
    -- Nível 5 — Coordenador de unidade
    (5,'ver'), (5,'intervencao_criar'), (5,'intervencao_editar'),
    (5,'intervencao_excluir'), (5,'grupo_gerenciar'), (5,'grupo_excluir'),
    (5,'estudante_gerenciar'), (5,'usuario_gerenciar'), (5,'usuario_excluir')
ON CONFLICT DO NOTHING;

-- Cursos (5) — cada um pertence a uma unidade
INSERT INTO sissa_curso (codigo, nome, unidade_id) VALUES
    ('LFI',   'Licenciatura em Física',                                 1),  -- id 1
    ('LMA',   'Licenciatura em Matemática',                             1),  -- id 2
    ('12075', 'Técnico em Agroecologia Integrado ao Ensino Médio',      4),  -- id 3
    ('52921', 'Bacharelado em Agronomia',                              3),  -- id 4
    ('50',    'Técnico em Administração Subsequente ao Ensino Médio',   4);  -- id 5

-- Usuários SISSA (6 usuários)
INSERT INTO sissa_usuario_sissa (nome, email_institucional, senha, perfil_id, ultimo_acesso) VALUES
    ('Adailton Araújo',                  'adailton@ufg.com',                    '1234', 1, NOW() - INTERVAL '2 hours'),
    ('Beatriz de Barros Vianna Cardoso', 'beatriz.de.bastos.vianna@gmail.com',  '2345', 2, NOW() - INTERVAL '30 days'),
    ('Laís Hauptli Cândido',             'laishcandido@gmail.com',              '3456', 3, NULL),
    ('Kalebe Xavier',                    'kalebe.xavier@ifsp.edu.br',           '4567', 4, NOW() - INTERVAL '1 day'),
    ('Juliana Moraes',                   'juliana.moraes@ifsp.edu.br',          '5678', 5, NOW() - INTERVAL '3 hours'),
    ('Beatriz Cardoso',                  'beatriz.cardoso@ifsp.edu.br',         '6789', 5, NOW() - INTERVAL '6 hours');

-- Vínculo usuário-curso:
--   user3 (Coord. de unidade) ↔ TODOS os cursos da sua unidade (Câmpus SP: cursos 1 e 2);
--   demais perfis ↔ exatamente um curso (curso 1).
INSERT INTO sissa_usuario_curso (usuario_id, curso_id) VALUES
    (1, 1), (2, 1), (3, 1), (3, 2), (4, 1), (5, 1), (6, 1);

-- Semestres
INSERT INTO sissa_semestre (ano, periodo) VALUES
    (2023, 1),  -- id 1
    (2023, 2),  -- id 2
    (2024, 1),  -- id 3
    (2024, 2),  -- id 4
    (2025, 1);  -- id 5

-- Disciplinas (curso 1 = Licenciatura em Física; + 1 de Matemática)
INSERT INTO sissa_disciplina (nome, carga_horaria, codigo, curso_id) VALUES
    ('Física Geral I',    90, 'FIS101', 1),  -- id 1
    ('Física Geral II',   90, 'FIS102', 1),  -- id 2
    ('Eletromagnetismo',  60, 'FIS201', 1),  -- id 3
    ('Mecânica Clássica', 60, 'FIS202', 1),  -- id 4
    ('Cálculo I',         90, 'MAT101', 1),  -- id 5
    ('Álgebra Linear',    60, 'MAT201', 2);  -- id 6

-- ----------------------------------------------------------------
-- ALUNOS (pessoas) — ids 1..12
-- ----------------------------------------------------------------
INSERT INTO sissa_aluno (nome, email) VALUES
    ('Andria De Oliveira Sebastiao',          'andria.sebastiao@discente.ufg.br'),     -- 1
    ('Denny Ryu De Carvalho Nacano',          'denny.nacano@discente.ufg.br'),         -- 2
    ('Isabelly Victoria De Freitas Formitani','isabelly.formitani@discente.ufg.br'),   -- 3
    ('Carlos Eduardo Santos Ferreira',        'carlos.ferreira@discente.ufg.br'),      -- 4
    ('Maria Fernanda Alves Costa',            'maria.costa@discente.ufg.br'),          -- 5
    ('João Pedro Rodrigues Lima',             'joao.lima@discente.ufg.br'),            -- 6
    ('Ana Paula Souza Mendes',                'ana.mendes@discente.ufg.br'),           -- 7
    ('Lucas Gabriel Pereira Neves',           'lucas.neves@discente.ufg.br'),          -- 8
    ('Fernanda Cristina Borges',              'fernanda.borges@discente.ufg.br'),      -- 9
    ('Rafael Henrique Oliveira',              'rafael.oliveira@discente.ufg.br'),      -- 10
    ('Thais Regina Monteiro Silva',           'thais.silva@discente.ufg.br'),          -- 11
    ('Marcos Vinicius Almeida Carvalho',      'marcos.carvalho@discente.ufg.br');      -- 12

-- ----------------------------------------------------------------
-- MATRÍCULAS — ids 1..12 (todas no curso 1). Os indicadores
-- (media_global, reprovacoes, ch_semestre) determinam o risco.
-- ----------------------------------------------------------------
INSERT INTO sissa_matricula
    (codigo, aluno_id, curso_id, ingresso, status, naturalidade_uf, forma_ingresso,
     media_global, reprovacoes, ch_semestre)
VALUES
    ('2021108020001', 1,  1, 2020, 'Ativa', 'GO', 'SISU',          4.00, 3, 600),  -- Alto (rep>=3)
    ('2021108020002', 2,  1, 2019, 'Ativa', 'SP', 'ENEM',          2.10, 0, 600),  -- Alto (media<3)
    ('2021108023001', 3,  1, 2021, 'Ativa', 'SP', 'Vestibular',    1.50, 4, 600),  -- Alto
    ('2021108024001', 4,  1, 2020, 'Ativa', 'MG', 'SISU',          1.20, 5, 600),  -- Alto
    ('2021108025001', 5,  1, 2021, 'Ativa', 'GO', 'SISU',          6.00, 1, 600),  -- Médio (rep>=1)
    ('2021108026001', 6,  1, 2022, 'Ativa', 'GO', 'ENEM',          5.00, 0, 600),  -- Médio (media<5.5)
    ('2021108027001', 7,  1, 2021, 'Ativa', 'TO', 'SISU',          7.00, 0, 360),  -- Médio (ch<400)
    ('2021108028001', 8,  1, 2020, 'Ativa', 'GO', 'Transferência', 4.80, 2, 480),  -- Médio
    ('2021108029001', 9,  1, 2019, 'Ativa', 'DF', 'SISU',          7.80, 0, 600),  -- Baixo
    ('2021108030001', 10, 1, 2022, 'Ativa', 'GO', 'ENEM',          9.10, 0, 600),  -- Baixo
    ('2021108031001', 11, 1, 2021, 'Ativa', 'MG', 'SISU',          8.00, 0, 600),  -- Baixo
    ('2021108032001', 12, 1, 2020, 'Ativa', 'GO', 'SISU',          8.90, 0, 600);  -- Baixo

-- ----------------------------------------------------------------
-- RISCO DE EVASÃO (1 por matrícula). 'risco' é definido pela trigger
-- a partir dos indicadores da matrícula; semeamos os campos derivados.
-- ----------------------------------------------------------------
INSERT INTO sissa_risco_evasao
    (matricula_id, semestre_saida, semestre_atual, maior_influencia, percentual, turmas)
VALUES
    (1,  1, 2, 'Reprovações',            70.0, 4),
    (2,  1, 2, 'Média global',           65.0, 5),
    (3,  2, 1, 'Reprovações',            78.0, 5),
    (4,  1, 4, 'Reprovações',            85.0, 5),
    (5,  3, 2, 'Forma de ingresso',      40.0, 5),
    (6,  2, 1, 'Média global',           38.0, 3),
    (7,  2, 1, 'CH semestre',            33.0, 3),
    (8,  3, 5, 'Reprovações',            45.0, 4),
    (9,  5, 3, 'Sem risco identificado',  9.0, 5),
    (10, 6, 2, 'Sem risco identificado',  7.0, 5),
    (11, 5, 2, 'Sem risco identificado', 10.0, 5),
    (12, 6, 1, 'Sem risco identificado',  8.0, 5);

-- ----------------------------------------------------------------
-- GRUPOS DE INTERVENÇÃO (3) — Grupo B já nasce Inativo (arquivado)
-- ----------------------------------------------------------------
INSERT INTO sissa_grupo_intervencao (titulo, semestre, observacoes, autoria_id, status, created_at) VALUES
    ('Grupo A', '2024/2', 'Estudantes que precisam de intervenção proativa em conteúdos de física', 4, 'Ativo',   '2024-02-01'),
    ('Grupo B', '2024/1', 'Grupo arquivado de eletromagnetismo e avaliação continuada',             1, 'Inativo', '2023-05-20'),
    ('Grupo C', '2024/2', 'Estudantes com alto índice de reprovação — foco em cálculo e mecânica',  5, 'Ativo',   '2024-08-10');

-- ----------------------------------------------------------------
-- MATRÍCULAS POR GRUPO (favorito de matrículas)
-- ----------------------------------------------------------------
INSERT INTO sissa_grupo_matricula (grupo_id, matricula_id) VALUES
    -- Grupo A
    (1, 1), (1, 3), (1, 5), (1, 8),
    -- Grupo B
    (2, 2), (2, 4), (2, 6), (2, 9),
    -- Grupo C
    (3, 1), (3, 4), (3, 7), (3, 10), (3, 11);

-- ----------------------------------------------------------------
-- INTERVENÇÕES (6) — individuais, com matrícula / disciplina / semestre
-- ----------------------------------------------------------------
INSERT INTO sissa_intervencao
    (matricula_id, disciplina_id, semestre_id, data_intervencao, forma_meio, assunto,
     formato, interacao, tipo, acompanhamento, duracao, objetivo_alcancado,
     observacoes, encaminhado)
VALUES
    (1, 1, 1, '2023-05-30', 'Vídeo aula', 'Cinemática',
     'Individual', 'Reativa',   'Conteúdo',    'Assíncrono', '1:30', 'Parcialmente',
     'Como montar rotina de estudos para disciplinas de exatas', false),

    (1, 3, 1, '2023-07-06', 'Chat', 'Orientação',
     'Individual', 'Pró-ativa', 'Acolhimento', 'Assíncrono', '0:45', 'Sim',
     'Dicas sobre eletromagnetismo e gestão do tempo de estudos', false),

    (2, 3, 2, '2023-09-15', 'Reunião online', 'Conteúdo',
     'Individual', 'Reativa',   'Conteúdo',    'Síncrono',   '2:00', 'Sim',
     'Revisão dos conceitos de campo elétrico e magnético', false),

    (4, 5, 4, '2024-09-20', 'Presencial', 'Apoio acadêmico',
     'Individual', 'Pró-ativa', 'Conteúdo',    'Síncrono',   '1:00', 'Parcialmente',
     'Resolução de exercícios de limites e derivadas', true),

    (1, 4, 4, '2024-10-05', 'E-mail', 'Acolhimento',
     'Individual', 'Pró-ativa', 'Acolhimento', 'Assíncrono', '0:30', 'Sim',
     'Suporte emocional e orientação de permanência no curso', false),

    (7, 2, 4, '2024-11-12', 'Ligação', 'Conteúdo',
     'Individual', 'Reativa',   'Conteúdo',    'Síncrono',   '0:50', 'Não',
     'Aluno não respondeu às tentativas de contato anteriores', true);

-- ================================================================
-- FIM DO ARQUIVO 05_sissa_domain.sql
-- ================================================================
