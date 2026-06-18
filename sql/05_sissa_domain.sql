-- ================================================================
-- SISSA Platform – Domain Module (Trabalho em Grupo N2.A1)
-- FILE: 05_sissa_domain.sql
-- Run after 01_ddl.sql
-- ================================================================

-- ----------------------------------------------------------------
-- DROP (idempotent – safe re-run order: children first)
-- ----------------------------------------------------------------
DROP VIEW  IF EXISTS vw_sissa_risco_anonimo          CASCADE;
DROP VIEW  IF EXISTS vw_sissa_resumo_intervencoes     CASCADE;
DROP VIEW  IF EXISTS vw_sissa_estudantes_risco        CASCADE;
DROP VIEW  IF EXISTS vw_sissa_grupos                  CASCADE;

DROP FUNCTION IF EXISTS fu_sissa_calcular_risco(INTEGER)            CASCADE;
DROP FUNCTION IF EXISTS fu_sissa_resumo_curso(INTEGER)              CASCADE;
DROP FUNCTION IF EXISTS pr_sissa_criar_intervencao_grupo(INTEGER, DATE, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT) CASCADE;
DROP FUNCTION IF EXISTS pr_sissa_atualizar_status_grupos()          CASCADE;

DROP TRIGGER IF EXISTS tg_sissa_risco_evasao_timestamp ON sissa_risco_evasao;
DROP TRIGGER IF EXISTS tg_sissa_grupo_inativo_auto     ON sissa_intervencao;
DROP TRIGGER IF EXISTS tg_sissa_classificar_risco      ON sissa_risco_evasao;

DROP FUNCTION IF EXISTS fn_tg_sissa_risco_updated_at()  CASCADE;
DROP FUNCTION IF EXISTS fn_tg_sissa_grupo_inativo()     CASCADE;
DROP FUNCTION IF EXISTS fn_tg_sissa_classificar_risco() CASCADE;

DROP TABLE IF EXISTS sissa_intervencao_estudante  CASCADE;
DROP TABLE IF EXISTS sissa_intervencao             CASCADE;
DROP TABLE IF EXISTS sissa_grupo_estudante         CASCADE;
DROP TABLE IF EXISTS sissa_grupo_intervencao       CASCADE;
DROP TABLE IF EXISTS sissa_risco_evasao            CASCADE;
DROP TABLE IF EXISTS sissa_estudante               CASCADE;
DROP TABLE IF EXISTS sissa_usuario_curso           CASCADE;
DROP TABLE IF EXISTS sissa_usuario_sissa           CASCADE;
DROP TABLE IF EXISTS sissa_perfil                  CASCADE;
DROP TABLE IF EXISTS sissa_curso                   CASCADE;
DROP TABLE IF EXISTS sissa_instituicao             CASCADE;

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
-- SISSA_CURSO
-- ----------------------------------------------------------------
CREATE TABLE sissa_curso (
    id             SERIAL       PRIMARY KEY,
    codigo         VARCHAR(20),
    nome           VARCHAR(255) NOT NULL,
    instituicao_id INTEGER      NOT NULL REFERENCES sissa_instituicao(id) ON DELETE RESTRICT
);

CREATE INDEX idx_sissa_curso_inst ON sissa_curso(instituicao_id);

-- ----------------------------------------------------------------
-- SISSA_PERFIL
-- ----------------------------------------------------------------
CREATE TABLE sissa_perfil (
    id   SERIAL       PRIMARY KEY,
    nome VARCHAR(100) NOT NULL UNIQUE
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
-- SISSA_USUARIO_CURSO  (N:N)
-- ----------------------------------------------------------------
CREATE TABLE sissa_usuario_curso (
    usuario_id INTEGER NOT NULL REFERENCES sissa_usuario_sissa(id) ON DELETE CASCADE,
    curso_id   INTEGER NOT NULL REFERENCES sissa_curso(id) ON DELETE CASCADE,
    CONSTRAINT pk_sissa_uc PRIMARY KEY (usuario_id, curso_id)
);

-- ----------------------------------------------------------------
-- SISSA_ESTUDANTE
-- ----------------------------------------------------------------
CREATE TABLE sissa_estudante (
    id         SERIAL       PRIMARY KEY,
    matricula  VARCHAR(30)  NOT NULL UNIQUE,
    nome       VARCHAR(255) NOT NULL,
    curso_id   INTEGER      NOT NULL REFERENCES sissa_curso(id) ON DELETE RESTRICT,
    ingresso   INTEGER,
    created_at TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sissa_estudante_curso ON sissa_estudante(curso_id);
CREATE INDEX idx_sissa_estudante_mat   ON sissa_estudante(matricula);
CREATE INDEX idx_sissa_estudante_nome  ON sissa_estudante(nome);

-- ----------------------------------------------------------------
-- SISSA_RISCO_EVASAO  (1:1 com estudante, updated via trigger)
-- ----------------------------------------------------------------
CREATE TABLE sissa_risco_evasao (
    id               SERIAL      PRIMARY KEY,
    estudante_id     INTEGER     NOT NULL UNIQUE REFERENCES sissa_estudante(id) ON DELETE CASCADE,
    risco            VARCHAR(10) CHECK (risco IN ('Alto','Médio','Baixo')),
    semestre_saida   INTEGER,
    media_global     DECIMAL(4,2),
    semestre_atual   INTEGER,
    reprovacoes      INTEGER     DEFAULT 0,
    ch_semestre      INTEGER     DEFAULT 0,
    maior_influencia VARCHAR(100),
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
-- SISSA_GRUPO_ESTUDANTE  (N:N)
-- ----------------------------------------------------------------
CREATE TABLE sissa_grupo_estudante (
    grupo_id     INTEGER NOT NULL REFERENCES sissa_grupo_intervencao(id) ON DELETE CASCADE,
    estudante_id INTEGER NOT NULL REFERENCES sissa_estudante(id) ON DELETE CASCADE,
    CONSTRAINT pk_sissa_ge PRIMARY KEY (grupo_id, estudante_id)
);

-- ----------------------------------------------------------------
-- SISSA_INTERVENCAO
-- ----------------------------------------------------------------
CREATE TABLE sissa_intervencao (
    id                  SERIAL       PRIMARY KEY,
    grupo_id            INTEGER      REFERENCES sissa_grupo_intervencao(id) ON DELETE SET NULL,
    data_intervencao    DATE,
    semestre            VARCHAR(10),
    disciplina          VARCHAR(255),
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
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sissa_intervencao_grupo ON sissa_intervencao(grupo_id);
CREATE INDEX idx_sissa_intervencao_data  ON sissa_intervencao(data_intervencao DESC);

-- ----------------------------------------------------------------
-- SISSA_INTERVENCAO_ESTUDANTE  (N:N)
-- ----------------------------------------------------------------
CREATE TABLE sissa_intervencao_estudante (
    intervencao_id INTEGER NOT NULL REFERENCES sissa_intervencao(id) ON DELETE CASCADE,
    estudante_id   INTEGER NOT NULL REFERENCES sissa_estudante(id) ON DELETE CASCADE,
    CONSTRAINT pk_sissa_ie PRIMARY KEY (intervencao_id, estudante_id)
);

-- ================================================================
-- ÍNDICE ADICIONAL para demonstração de ganho de performance
-- (massa de dados: sissa_risco_evasao + sissa_estudante)
-- ================================================================
CREATE INDEX idx_sissa_risco_comp ON sissa_risco_evasao(risco, estudante_id, media_global);
CREATE INDEX idx_sissa_est_curso_nome ON sissa_estudante(curso_id, nome);

-- ================================================================
-- TRIGGERS
-- ================================================================

-- ----------------------------------------------------------------
-- TRIGGER 1 – tg_sissa_risco_evasao_timestamp
--   Atualiza automaticamente o campo updated_at em sissa_risco_evasao
--   sempre que uma linha for modificada (INSERT ou UPDATE).
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
-- TRIGGER 2 – tg_sissa_grupo_inativo_auto
--   Ao inserir uma nova intervenção vinculada a um grupo,
--   verifica se o grupo está 'Inativo' e automaticamente
--   o reativa para 'Ativo', garantindo consistência de dados.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tg_sissa_grupo_inativo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR(10);
BEGIN
    IF NEW.grupo_id IS NOT NULL THEN
        SELECT status INTO v_status
        FROM sissa_grupo_intervencao
        WHERE id = NEW.grupo_id;

        IF v_status = 'Inativo' THEN
            UPDATE sissa_grupo_intervencao
            SET status = 'Ativo'
            WHERE id = NEW.grupo_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_sissa_grupo_inativo_auto
    AFTER INSERT ON sissa_intervencao
    FOR EACH ROW
    EXECUTE FUNCTION fn_tg_sissa_grupo_inativo();

-- ----------------------------------------------------------------
-- TRIGGER 3 – tg_sissa_classificar_risco
--   Classifica automaticamente o nível de risco do estudante a cada
--   INSERT/UPDATE em sissa_risco_evasao, com base nos indicadores
--   (reprovações, média global, CH semestre). Garante que o campo
--   'risco' nunca fique inconsistente com os dados — não importa se a
--   escrita veio da importação, da API ou de um SQL direto.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tg_sissa_classificar_risco()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.reprovacoes >= 3 OR NEW.media_global < 3.0 THEN
        NEW.risco := 'Alto';
    ELSIF NEW.reprovacoes >= 1 OR NEW.media_global < 5.5 OR NEW.ch_semestre < 400 THEN
        NEW.risco := 'Médio';
    ELSE
        NEW.risco := 'Baixo';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_sissa_classificar_risco
    BEFORE INSERT OR UPDATE ON sissa_risco_evasao
    FOR EACH ROW
    EXECUTE FUNCTION fn_tg_sissa_classificar_risco();

-- ================================================================
-- FUNÇÕES PostgreSQL do domínio SISSA
-- ================================================================

-- ----------------------------------------------------------------
-- FUNÇÃO 1 – fu_sissa_calcular_risco
--   IN:  p_estudante_id — id do estudante
--   OUT: texto com o nível de risco calculado dinamicamente
--        com base em: reprovações, média global, CH semestre
--   Lógica:
--     Alto   → reprovacoes >= 3 OU media_global < 3.0
--     Médio  → reprovacoes >= 1 OU media_global < 5.5
--     Baixo  → caso contrário
--   Difere das atividades individuais (que operam em tabela usuario
--   e verificam engajamento/email). Esta função calcula risco
--   acadêmico por indicadores educacionais do domínio SISSA.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fu_sissa_calcular_risco(p_estudante_id INTEGER)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_rep    INTEGER;
    v_media  DECIMAL(4,2);
    v_ch     INTEGER;
BEGIN
    SELECT reprovacoes, media_global, ch_semestre
    INTO   v_rep, v_media, v_ch
    FROM   sissa_risco_evasao
    WHERE  estudante_id = p_estudante_id;

    IF NOT FOUND THEN
        RETURN 'Sem dados';
    END IF;

    IF v_rep >= 3 OR v_media < 3.0 THEN
        RETURN 'Alto';
    ELSIF v_rep >= 1 OR v_media < 5.5 OR v_ch < 400 THEN
        RETURN 'Médio';
    ELSE
        RETURN 'Baixo';
    END IF;
END;
$$;

-- ----------------------------------------------------------------
-- FUNÇÃO 2 – fu_sissa_resumo_curso
--   IN:  p_curso_id — id do curso
--   OUT: TABLE com indicadores agregados do curso:
--        total de estudantes, contagem por nível de risco,
--        média geral de reprovações, percentual de alto risco
--   Difere das atividades individuais (funções A1 operam sobre
--   grupos e usuários do sistema de controle de acesso).
--   Esta função agrega dados educacionais por curso.
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
        c.nome::VARCHAR                                        AS r_curso_nome,
        COUNT(e.id)                                           AS r_total,
        COUNT(*) FILTER (WHERE r.risco = 'Alto')             AS r_alto,
        COUNT(*) FILTER (WHERE r.risco = 'Médio')            AS r_medio,
        COUNT(*) FILTER (WHERE r.risco = 'Baixo')            AS r_baixo,
        ROUND(AVG(r.reprovacoes)::NUMERIC, 2)                AS r_media_reprov,
        CASE
            WHEN COUNT(e.id) = 0 THEN 0
            ELSE ROUND(
                (COUNT(*) FILTER (WHERE r.risco = 'Alto') * 100.0 / COUNT(e.id))::NUMERIC, 1
            )
        END                                                    AS r_pct_alto_risco
    FROM sissa_curso c
    JOIN sissa_estudante e     ON e.curso_id = c.id
    LEFT JOIN sissa_risco_evasao r ON r.estudante_id = e.id
    WHERE c.id = p_curso_id
    GROUP BY c.nome;
END;
$$;

-- ================================================================
-- PROCEDIMENTOS do domínio SISSA
-- ================================================================

-- ----------------------------------------------------------------
-- PROCEDURE 1 – pr_sissa_criar_intervencao_grupo
--   Registra uma nova intervenção já vinculada a um grupo,
--   associando automaticamente todos os estudantes do grupo.
--   Retorna o id da intervenção criada.
--   Difere das atividades individuais (A1 cria usuário admin,
--   copia grupos de controle de acesso). Esta procedure opera
--   sobre o domínio pedagógico SISSA.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION pr_sissa_criar_intervencao_grupo(
    p_grupo_id          INTEGER,
    p_data              DATE,
    p_semestre          VARCHAR,
    p_forma_meio        VARCHAR,
    p_assunto           VARCHAR,
    p_formato           VARCHAR,
    p_interacao         VARCHAR,
    p_tipo              VARCHAR,
    p_acompanhamento    VARCHAR,
    p_observacoes       TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_intervencao_id INTEGER;
    v_estudante_id   INTEGER;
BEGIN
    -- Verifica que o grupo existe
    IF NOT EXISTS (SELECT 1 FROM sissa_grupo_intervencao WHERE id = p_grupo_id) THEN
        RAISE EXCEPTION 'Grupo de intervenção % não encontrado.', p_grupo_id;
    END IF;

    -- Insere a intervenção
    INSERT INTO sissa_intervencao
        (grupo_id, data_intervencao, semestre, forma_meio, assunto,
         formato, interacao, tipo, acompanhamento, observacoes)
    VALUES
        (p_grupo_id, p_data, p_semestre, p_forma_meio, p_assunto,
         p_formato, p_interacao, p_tipo, p_acompanhamento, p_observacoes)
    RETURNING id INTO v_intervencao_id;

    -- Associa todos os estudantes do grupo
    FOR v_estudante_id IN
        SELECT estudante_id FROM sissa_grupo_estudante WHERE grupo_id = p_grupo_id
    LOOP
        INSERT INTO sissa_intervencao_estudante (intervencao_id, estudante_id)
        VALUES (v_intervencao_id, v_estudante_id)
        ON CONFLICT DO NOTHING;
    END LOOP;

    RETURN v_intervencao_id;
END;
$$;

-- ----------------------------------------------------------------
-- PROCEDURE 2 – pr_sissa_atualizar_status_grupos
--   Percorre todos os grupos de intervenção e define status
--   como 'Inativo' quando a última intervenção do grupo
--   tiver mais de 180 dias. Grupos sem nenhuma intervenção
--   com mais de 180 dias de criação também são inativados.
--   Retorna o total de grupos inativados.
--   Difere das atividades individuais (A1 migra usuários entre
--   grupos do sistema de controle de acesso). Esta procedure
--   gerencia o ciclo de vida dos grupos pedagógicos SISSA.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION pr_sissa_atualizar_status_grupos()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_total  INTEGER := 0;
    v_rec    RECORD;
    v_ultima DATE;
BEGIN
    FOR v_rec IN
        SELECT g.id
        FROM sissa_grupo_intervencao g
        WHERE g.status = 'Ativo'
    LOOP
        SELECT MAX(i.data_intervencao)
        INTO   v_ultima
        FROM   sissa_intervencao i
        WHERE  i.grupo_id = v_rec.id;

        IF (v_ultima IS NULL AND (NOW()::DATE - (SELECT created_at::DATE FROM sissa_grupo_intervencao WHERE id=v_rec.id)) > 180)
        OR (v_ultima IS NOT NULL AND (NOW()::DATE - v_ultima) > 180) THEN
            UPDATE sissa_grupo_intervencao
            SET    status = 'Inativo'
            WHERE  id = v_rec.id;
            v_total := v_total + 1;
        END IF;
    END LOOP;

    RETURN v_total;
END;
$$;

-- ================================================================
-- VIEWS
-- ================================================================

-- View 1 – estudantes com risco de evasão (já existente, mantida)
CREATE OR REPLACE VIEW vw_sissa_estudantes_risco AS
SELECT
    e.id,
    e.matricula,
    e.nome,
    e.ingresso,
    c.id     AS curso_id,
    c.nome   AS curso_nome,
    c.codigo AS curso_codigo,
    i.nome   AS instituicao_nome,
    i.code_mec,
    r.risco,
    r.semestre_saida,
    r.media_global,
    r.semestre_atual,
    r.reprovacoes,
    r.ch_semestre,
    r.maior_influencia,
    r.turmas,
    r.updated_at AS risco_updated_at,
    (
        SELECT COUNT(*)
        FROM sissa_grupo_estudante ge
        WHERE ge.estudante_id = e.id
    ) AS total_grupos
FROM sissa_estudante e
JOIN  sissa_curso c           ON c.id = e.curso_id
JOIN  sissa_instituicao i     ON i.id = c.instituicao_id
LEFT JOIN sissa_risco_evasao r ON r.estudante_id = e.id;

-- View 2 – grupos com contagem de estudantes (já existente, mantida)
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
    COUNT(ge.estudante_id) AS total_estudantes
FROM sissa_grupo_intervencao g
LEFT JOIN sissa_usuario_sissa u   ON u.id = g.autoria_id
LEFT JOIN sissa_perfil p          ON p.id = u.perfil_id
LEFT JOIN sissa_grupo_estudante ge ON ge.grupo_id = g.id
GROUP BY g.id, g.titulo, g.semestre, g.observacoes, g.status, g.created_at,
         u.nome, u.perfil_id, p.nome;

-- View 3 – RISCO ANÔNIMO (sem nome nem matrícula do aluno)
--   Usada pelo role risco_anonimo_sissa para acesso externo/público
--   sem expor dados identificadores do estudante.
CREATE OR REPLACE VIEW vw_sissa_risco_anonimo AS
SELECT
    r.id                                        AS risco_id,
    c.nome                                      AS curso_nome,
    c.codigo                                    AS curso_codigo,
    i.nome                                      AS instituicao_nome,
    r.risco,
    r.semestre_saida,
    r.media_global,
    r.semestre_atual,
    r.reprovacoes,
    r.ch_semestre,
    r.maior_influencia,
    r.turmas,
    r.updated_at
FROM sissa_risco_evasao r
JOIN sissa_estudante e     ON e.id = r.estudante_id
JOIN sissa_curso c         ON c.id = e.curso_id
JOIN sissa_instituicao i   ON i.id = c.instituicao_id;

-- View 4 – RESUMO DE INTERVENÇÕES por grupo e semestre
--   Facilita relatórios gerenciais sobre a efetividade das ações.
CREATE OR REPLACE VIEW vw_sissa_resumo_intervencoes AS
SELECT
    g.id                                                             AS grupo_id,
    g.titulo                                                         AS grupo_titulo,
    g.semestre                                                       AS grupo_semestre,
    g.status                                                         AS grupo_status,
    COUNT(DISTINCT i.id)                                            AS total_intervencoes,
    COUNT(DISTINCT ge.estudante_id)                                 AS total_estudantes_grupo,
    COUNT(DISTINCT ie.estudante_id)                                 AS total_estudantes_atendidos,
    COUNT(*) FILTER (WHERE i.objetivo_alcancado = 'Sim')           AS objetivos_sim,
    COUNT(*) FILTER (WHERE i.objetivo_alcancado = 'Não')           AS objetivos_nao,
    COUNT(*) FILTER (WHERE i.objetivo_alcancado = 'Parcialmente')  AS objetivos_parciais,
    MAX(i.data_intervencao)                                         AS ultima_intervencao,
    MIN(i.data_intervencao)                                         AS primeira_intervencao,
    u.nome                                                           AS autoria_nome,
    p.nome                                                           AS autoria_perfil
FROM sissa_grupo_intervencao g
LEFT JOIN sissa_intervencao i            ON i.grupo_id = g.id
LEFT JOIN sissa_grupo_estudante ge       ON ge.grupo_id = g.id
LEFT JOIN sissa_intervencao_estudante ie ON ie.intervencao_id = i.id
LEFT JOIN sissa_usuario_sissa u          ON u.id = g.autoria_id
LEFT JOIN sissa_perfil p                 ON p.id = u.perfil_id
GROUP BY g.id, g.titulo, g.semestre, g.status, u.nome, p.nome;

-- ================================================================
-- ROLES DE SEGURANÇA
-- ================================================================

-- Remove roles se já existirem (idempotente)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'admin_sissa') THEN
        REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM admin_sissa;
        REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM admin_sissa;
        DROP ROLE admin_sissa;
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'leitura_sissa') THEN
        REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM leitura_sissa;
        DROP ROLE leitura_sissa;
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'risco_anonimo_sissa') THEN
        REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM risco_anonimo_sissa;
        DROP ROLE risco_anonimo_sissa;
    END IF;
END $$;

-- ROLE 1 – admin_sissa: CRUD total em todas as tabelas SISSA
CREATE ROLE admin_sissa NOLOGIN;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON sissa_instituicao, sissa_curso, sissa_perfil, sissa_usuario_sissa,
       sissa_usuario_curso, sissa_estudante, sissa_risco_evasao,
       sissa_grupo_intervencao, sissa_grupo_estudante,
       sissa_intervencao, sissa_intervencao_estudante
    TO admin_sissa;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO admin_sissa;
GRANT SELECT ON vw_sissa_estudantes_risco, vw_sissa_grupos,
               vw_sissa_risco_anonimo, vw_sissa_resumo_intervencoes
    TO admin_sissa;

-- ROLE 2 – leitura_sissa: somente SELECT em todas as tabelas SISSA
CREATE ROLE leitura_sissa NOLOGIN;
GRANT SELECT
    ON sissa_instituicao, sissa_curso, sissa_perfil, sissa_usuario_sissa,
       sissa_usuario_curso, sissa_estudante, sissa_risco_evasao,
       sissa_grupo_intervencao, sissa_grupo_estudante,
       sissa_intervencao, sissa_intervencao_estudante
    TO leitura_sissa;
GRANT SELECT ON vw_sissa_estudantes_risco, vw_sissa_grupos,
               vw_sissa_risco_anonimo, vw_sissa_resumo_intervencoes
    TO leitura_sissa;

-- ROLE 3 – risco_anonimo_sissa: SELECT somente na view sem identificadores
CREATE ROLE risco_anonimo_sissa NOLOGIN;
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

-- Perfis
INSERT INTO sissa_perfil (nome) VALUES
    ('Coordenador de curso'),
    ('Coordenador de ensino'),
    ('Coordenador de unidade'),
    ('Tutor Físico'),
    ('Tutor')
ON CONFLICT (nome) DO NOTHING;

-- Cursos (4 cursos distribuídos pelas instituições)
INSERT INTO sissa_curso (codigo, nome, instituicao_id) VALUES
    ('LFI',   'Licenciatura em Física',                             1),
    ('LMA',   'Licenciatura em Matemática',                         1),
    ('12075', 'Técnico em Agroecologia Integrado ao Ensino Médio',  3),
    ('52921', 'Bacharelado em Agronomia',                           2),
    ('50',    'Técnico em Administração Subsequente ao Ensino Médio', 3);

-- Usuários SISSA (6 usuários)
INSERT INTO sissa_usuario_sissa (nome, email_institucional, senha, perfil_id, ultimo_acesso) VALUES
    ('Adailton Araújo',                  'adailton@ufg.com',                    '1234', 1, NOW() - INTERVAL '2 hours'),
    ('Beatriz de Barros Vianna Cardoso', 'beatriz.de.bastos.vianna@gmail.com',  '2345', 2, NOW() - INTERVAL '30 days'),
    ('Laís Hauptli Cândido',             'laishcandido@gmail.com',              '3456', 3, NULL),
    ('Kalebe Xavier',                    'kalebe.xavier@ifsp.edu.br',           '4567', 4, NOW() - INTERVAL '1 day'),
    ('Juliana Moraes',                   'juliana.moraes@ifsp.edu.br',          '5678', 5, NOW() - INTERVAL '3 hours'),
    ('Beatriz Cardoso',                  'beatriz.cardoso@ifsp.edu.br',         '6789', 5, NOW() - INTERVAL '6 hours');

-- Vínculo usuário-curso
INSERT INTO sissa_usuario_curso (usuario_id, curso_id) VALUES
    (1, 1), (2, 1), (3, 1), (3, 2), (4, 1), (5, 1), (6, 1);

-- ----------------------------------------------------------------
-- ESTUDANTES (20+) – Licenciatura em Física (curso_id=1)
-- ----------------------------------------------------------------
INSERT INTO sissa_estudante (matricula, nome, curso_id, ingresso) VALUES
    ('2021108020001', 'Andria De Oliveira Sebastiao',           1, 2020),
    ('2021108020002', 'Denny Ryu De Carvalho Nacano',           1, 2019),
    ('2021108023001', 'Isabelly Victoria De Freitas Formitani', 1, 2021),
    ('2021108024001', 'Carlos Eduardo Santos Ferreira',         1, 2020),
    ('2021108025001', 'Maria Fernanda Alves Costa',             1, 2021),
    ('2021108026001', 'João Pedro Rodrigues Lima',              1, 2022),
    ('2021108027001', 'Ana Paula Souza Mendes',                 1, 2021),
    ('2021108028001', 'Lucas Gabriel Pereira Neves',            1, 2020),
    ('2021108029001', 'Fernanda Cristina Borges',               1, 2019),
    ('2021108030001', 'Rafael Henrique Oliveira',               1, 2022),
    ('2021108031001', 'Thais Regina Monteiro Silva',            1, 2021),
    ('2021108032001', 'Marcos Vinicius Almeida Carvalho',       1, 2020),
    ('2021108033001', 'Patricia Helena Costa Lima',             1, 2021),
    ('2021108034001', 'Bruno Alexandre Gomes Neto',             1, 2019),
    ('2021108035001', 'Camila Rodrigues Farias',                1, 2022),
    ('2021108036001', 'Diego Alves Santos',                     1, 2021),
    ('2021108037001', 'Eliane Beatriz Rodrigues',               1, 2020),
    ('2021108038001', 'Felipe Augusto Carvalho Melo',           1, 2019),
    ('2021108039001', 'Gabriela Ferreira Sousa',                1, 2022),
    ('2021108040001', 'Hugo Leonardo Nascimento',               1, 2021),
    ('2021108041001', 'Irene Carvalho Pinto',                   1, 2020),
    ('2021108042001', 'Jorge Luiz Menezes',                     1, 2019),
    ('2021108043001', 'Karina Siqueira Dias',                   1, 2022),
    ('2021108044001', 'Leonardo Costa Abreu',                   1, 2021);

-- ----------------------------------------------------------------
-- RISCO DE EVASÃO (para todos os 24 estudantes)
-- ----------------------------------------------------------------
INSERT INTO sissa_risco_evasao
    (estudante_id, risco, semestre_saida, media_global, semestre_atual, reprovacoes, ch_semestre, maior_influencia, turmas)
VALUES
    (1,  'Alto',  1, 0.0, 2, 2, 600, 'Forma de ingresso',      5),
    (2,  'Médio', 1, 3.2, 2, 1, 600, 'Forma de ingresso',      5),
    (3,  'Médio', 1, 4.5, 1, 0, 600, 'UF naturalidade',        5),
    (4,  'Alto',  2, 2.1, 3, 3, 480, 'Reprovações',            4),
    (5,  'Baixo', 4, 7.8, 2, 0, 600, 'Sem risco identificado', 5),
    (6,  'Médio', 2, 5.0, 1, 1, 360, 'Forma de ingresso',      3),
    (7,  'Baixo', 5, 8.2, 3, 0, 600, 'Sem risco identificado', 5),
    (8,  'Alto',  1, 1.5, 4, 4, 600, 'Reprovações',            5),
    (9,  'Médio', 3, 4.8, 5, 2, 480, 'CH semestre',            4),
    (10, 'Baixo', 6, 9.1, 2, 0, 600, 'Sem risco identificado', 5),
    (11, 'Alto',  1, 2.3, 2, 3, 600, 'Reprovações',            5),
    (12, 'Médio', 2, 4.1, 3, 1, 480, 'Forma de ingresso',      4),
    (13, 'Baixo', 5, 7.5, 2, 0, 600, 'Sem risco identificado', 5),
    (14, 'Alto',  1, 1.8, 2, 4, 600, 'Reprovações',            5),
    (15, 'Médio', 3, 5.2, 1, 1, 420, 'UF naturalidade',        3),
    (16, 'Baixo', 4, 8.0, 3, 0, 600, 'Sem risco identificado', 5),
    (17, 'Alto',  2, 2.5, 2, 2, 480, 'CH semestre',            4),
    (18, 'Médio', 2, 4.7, 4, 1, 600, 'Forma de ingresso',      5),
    (19, 'Baixo', 6, 8.9, 1, 0, 600, 'Sem risco identificado', 5),
    (20, 'Alto',  1, 1.2, 2, 5, 600, 'Reprovações',            5),
    (21, 'Médio', 3, 4.4, 2, 1, 360, 'CH semestre',            3),
    (22, 'Baixo', 5, 7.6, 3, 0, 600, 'Sem risco identificado', 5),
    (23, 'Alto',  2, 2.8, 1, 3, 480, 'Forma de ingresso',      4),
    (24, 'Médio', 2, 5.1, 2, 1, 600, 'UF naturalidade',        5);

-- ----------------------------------------------------------------
-- GRUPOS DE INTERVENÇÃO (3 grupos)
-- ----------------------------------------------------------------
INSERT INTO sissa_grupo_intervencao (titulo, semestre, observacoes, autoria_id, status, created_at) VALUES
    ('Grupo A', '2024/2', 'Grupo com estudantes que necessitam de intervenção proativa no conteúdo de física', 4, 'Ativo',  '2024-02-01'),
    ('Grupo B', '2024/1', 'Grupo que requer atenção em eletromagnetismo e avaliação continuada', 1, 'Inativo', '2023-05-20'),
    ('Grupo C', '2024/2', 'Estudantes com alto índice de reprovação – foco em cálculo e mecânica', 5, 'Ativo',  '2024-08-10');

-- ----------------------------------------------------------------
-- ESTUDANTES POR GRUPO
-- ----------------------------------------------------------------
INSERT INTO sissa_grupo_estudante (grupo_id, estudante_id) VALUES
    -- Grupo A
    (1, 1), (1, 3), (1, 11), (1, 17),
    -- Grupo B
    (2, 2), (2, 4), (2, 5), (2, 8), (2, 9), (2, 12),
    -- Grupo C
    (3, 14), (3, 20), (3, 23), (3, 4), (3, 8);

-- ----------------------------------------------------------------
-- INTERVENÇÕES (5+)
-- ----------------------------------------------------------------
INSERT INTO sissa_intervencao
    (grupo_id, data_intervencao, semestre, disciplina, forma_meio, assunto,
     formato, interacao, tipo, acompanhamento, duracao, objetivo_alcancado,
     observacoes, encaminhado)
VALUES
    (1, '2023-05-30', '2023/1', 'Física Geral I',   'Vídeo aula', 'Cinemática',
     'Grupo',      'Reativa',   'Conteúdo',    'Assíncrono', '1:30', 'Parcialmente',
     'Aula sobre como montar rotina de estudos para disciplinas de exatas', false),

    (1, '2023-07-06', '2023/1', NULL,               'Chat',       'Orientação',
     'Individual', 'Pró-ativa', 'Acolhimento', 'Assíncrono', '0:45', 'Sim',
     'Dicas sobre eletromagnetismo e gestão do tempo de estudos', false),

    (2, '2023-09-15', '2023/2', 'Eletromagnetismo', 'Reunião online', 'Conteúdo',
     'Grupo',      'Reativa',   'Conteúdo',    'Síncrono',   '2:00', 'Sim',
     'Revisão dos conceitos de campo elétrico e magnético', false),

    (3, '2024-09-20', '2024/2', 'Cálculo I',        'Presencial', 'Apoio acadêmico',
     'Grupo',      'Pró-ativa', 'Conteúdo',    'Síncrono',   '1:00', 'Parcialmente',
     'Sessão de resolução de exercícios de limites e derivadas', true),

    (1, '2024-10-05', '2024/2', 'Mecânica Clássica','E-mail',     'Acolhimento',
     'Individual', 'Pró-ativa', 'Acolhimento', 'Assíncrono', '0:30', 'Sim',
     'Suporte emocional e orientação de permanência no curso', false),

    (3, '2024-11-12', '2024/2', 'Física Geral II',  'Ligação',   'Conteúdo',
     'Individual', 'Reativa',   'Conteúdo',    'Síncrono',   '0:50', 'Não',
     'Aluno não respondeu às tentativas de contato anteriores', true);

-- ----------------------------------------------------------------
-- VÍNCULOS INTERVENÇÃO ↔ ESTUDANTE
-- ----------------------------------------------------------------
INSERT INTO sissa_intervencao_estudante (intervencao_id, estudante_id) VALUES
    (1, 1), (1, 3), (1, 11),
    (2, 1),
    (3, 2), (3, 4), (3, 9),
    (4, 14), (4, 20), (4, 23),
    (5, 11),
    (6, 14);

-- ================================================================
-- FIM DO ARQUIVO 05_sissa_domain.sql
-- ================================================================
