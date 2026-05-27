-- ================================================================
-- SISSA Platform – Access Control Module
-- FILE: 01_ddl.sql — DDL + Seed Data
-- Run this first before 02 and 03.
-- ================================================================

-- Create database (run this separately as superuser if needed):
-- CREATE DATABASE sissa;

-- ----------------------------------------------------------------
-- DROP (safe re-run order, respecting FK deps)
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS auditoria              CASCADE;
DROP TABLE IF EXISTS grupo_funcionalidade   CASCADE;
DROP TABLE IF EXISTS usuario_papel          CASCADE;
DROP TABLE IF EXISTS usuario_grupo          CASCADE;
DROP TABLE IF EXISTS funcionalidade         CASCADE;
DROP TABLE IF EXISTS categoria_funcionalidade CASCADE;
DROP TABLE IF EXISTS modulo                 CASCADE;
DROP TABLE IF EXISTS papel                  CASCADE;
DROP TABLE IF EXISTS grupo                  CASCADE;
DROP TABLE IF EXISTS usuario                CASCADE;

-- ----------------------------------------------------------------
-- MODULO
-- ----------------------------------------------------------------
CREATE TABLE modulo (
    id   SERIAL       PRIMARY KEY,
    nome VARCHAR(100) NOT NULL UNIQUE
);

-- ----------------------------------------------------------------
-- CATEGORIA_FUNCIONALIDADE
-- ----------------------------------------------------------------
CREATE TABLE categoria_funcionalidade (
    id        SERIAL       PRIMARY KEY,
    nome      VARCHAR(150) NOT NULL,
    modulo_id INTEGER      NOT NULL,
    CONSTRAINT fk_catfunc_modulo
        FOREIGN KEY (modulo_id) REFERENCES modulo(id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_catfunc_modulo ON categoria_funcionalidade(modulo_id);

-- ----------------------------------------------------------------
-- FUNCIONALIDADE
-- ----------------------------------------------------------------
CREATE TABLE funcionalidade (
    id           SERIAL       PRIMARY KEY,
    nome         VARCHAR(200) NOT NULL,
    categoria_id INTEGER      NOT NULL,
    CONSTRAINT fk_func_categoria
        FOREIGN KEY (categoria_id) REFERENCES categoria_funcionalidade(id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_func_categoria ON funcionalidade(categoria_id);

-- ----------------------------------------------------------------
-- USUARIO
-- ----------------------------------------------------------------
CREATE TABLE usuario (
    id            SERIAL       PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    nome          VARCHAR(255),
    ultimo_acesso TIMESTAMP,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usuario_email ON usuario(email);

-- ----------------------------------------------------------------
-- GRUPO
-- ----------------------------------------------------------------
CREATE TABLE grupo (
    id         SERIAL       PRIMARY KEY,
    nome       VARCHAR(150) NOT NULL UNIQUE,
    created_at TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- PAPEL
-- ----------------------------------------------------------------
CREATE TABLE papel (
    id   SERIAL       PRIMARY KEY,
    nome VARCHAR(150) NOT NULL UNIQUE
);

-- ----------------------------------------------------------------
-- USUARIO_GRUPO  (N:N — NO CASCADE)
-- ----------------------------------------------------------------
CREATE TABLE usuario_grupo (
    usuario_id INTEGER NOT NULL,
    grupo_id   INTEGER NOT NULL,
    CONSTRAINT pk_usuario_grupo PRIMARY KEY (usuario_id, grupo_id),
    CONSTRAINT fk_ug_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE RESTRICT,
    CONSTRAINT fk_ug_grupo
        FOREIGN KEY (grupo_id)   REFERENCES grupo(id)   ON DELETE RESTRICT
);

CREATE INDEX idx_ug_grupo ON usuario_grupo(grupo_id);

-- ----------------------------------------------------------------
-- USUARIO_PAPEL  (N:N — NO CASCADE)
-- ----------------------------------------------------------------
CREATE TABLE usuario_papel (
    usuario_id INTEGER NOT NULL,
    papel_id   INTEGER NOT NULL,
    CONSTRAINT pk_usuario_papel PRIMARY KEY (usuario_id, papel_id),
    CONSTRAINT fk_up_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE RESTRICT,
    CONSTRAINT fk_up_papel
        FOREIGN KEY (papel_id)   REFERENCES papel(id)   ON DELETE RESTRICT
);

CREATE INDEX idx_up_papel ON usuario_papel(papel_id);

-- ----------------------------------------------------------------
-- GRUPO_FUNCIONALIDADE  (N:N with habilitado flag — NO CASCADE)
-- ----------------------------------------------------------------
CREATE TABLE grupo_funcionalidade (
    grupo_id          INTEGER NOT NULL,
    funcionalidade_id INTEGER NOT NULL,
    habilitado        BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT pk_grupo_funcionalidade PRIMARY KEY (grupo_id, funcionalidade_id),
    CONSTRAINT fk_gf_grupo
        FOREIGN KEY (grupo_id)          REFERENCES grupo(id)         ON DELETE RESTRICT,
    CONSTRAINT fk_gf_funcionalidade
        FOREIGN KEY (funcionalidade_id) REFERENCES funcionalidade(id) ON DELETE RESTRICT
);

CREATE INDEX idx_gf_habilitado ON grupo_funcionalidade(grupo_id, habilitado);

-- ----------------------------------------------------------------
-- AUDITORIA  (append-only, no FK references)
-- ----------------------------------------------------------------
CREATE TABLE auditoria (
    id            SERIAL       PRIMARY KEY,
    data_hora     TIMESTAMP    NOT NULL DEFAULT NOW(),
    nome_entidade VARCHAR(100) NOT NULL,
    operacao      VARCHAR(10)  NOT NULL,
    CONSTRAINT chk_auditoria_op CHECK (operacao IN ('INSERT','UPDATE','DELETE'))
);

CREATE INDEX idx_auditoria_entidade ON auditoria(nome_entidade);
CREATE INDEX idx_auditoria_data     ON auditoria(data_hora DESC);

-- ================================================================
-- SEED DATA
-- ================================================================

-- Modulos
INSERT INTO modulo (nome) VALUES
    ('EDITAIS'),
    ('CONTRATOS');

-- Categorias
INSERT INTO categoria_funcionalidade (nome, modulo_id) VALUES
    ('Seleção de editais',  1),   -- id=1
    ('Análise de editais',  1),   -- id=2
    ('Consulta de CNPJ',    2);   -- id=3

-- Funcionalidades — Seleção de editais (categoria 1)
INSERT INTO funcionalidade (nome, categoria_id) VALUES
    ('Visualizar editais',               1),  -- id=1
    ('Gerenciar anexos do edital',       1),  -- id=2
    ('Gerenciar status',                 1),  -- id=3
    ('Adicionar edital manualmente',     1),  -- id=4
    ('Gerenciar grupos de editais',      1),  -- id=5
    -- Análise de editais (categoria 2)
    ('Gerenciar análise de edital',                    2),  -- id=6
    ('Visualizar histórico de análise de edital',      2),  -- id=7
    ('Realizar pré-análise técnica',                   2),  -- id=8
    ('Realizar análise de edital',                     2),  -- id=9
    ('Gerenciar etapas do edital',                     2),  -- id=10
    ('Realizar proposta',                              2),  -- id=11
    ('Gerenciar histórico de análise de edital',       2),  -- id=12
    -- Consulta de CNPJ (categoria 3)
    ('Gerenciar consulta',               3);  -- id=13

-- Papeis
INSERT INTO papel (nome) VALUES
    ('Analista de proposta'),
    ('Analista técnico'),
    ('Analista de documentos'),
    ('Gestor');

-- Grupos
INSERT INTO grupo (nome) VALUES
    ('Administrador'),           -- id=1
    ('Cadastro de contratos'),   -- id=2
    ('Contas a receber'),        -- id=3
    ('Liderança de editais'),    -- id=4
    ('Seleção de editais'),      -- id=5
    ('Validação de CNPJ');       -- id=6

-- Usuarios (nome será atualizado pelo AD no login real; simulado aqui)
INSERT INTO usuario (email, nome, ultimo_acesso) VALUES
    ('admin@ufg.br',                  'Admin UFG',       NOW() - INTERVAL '1 hour'),
    ('adailton@positivo.com.br',      'Adailton Araújo', NOW() - INTERVAL '3 hours'),
    ('laishc@positivo.com.br',        'Laís Cândido',    NOW() - INTERVAL '6 hours'),
    ('rodrigom@positivo.com.br',      'Rodrigo Mendes',  NOW() - INTERVAL '30 minutes'),
    ('djuliads@positivo.com.br',      'Djulia dos Santos', NOW() - INTERVAL '1 day'),
    ('guilhermesousa@positivo.com.br','Guilherme Sousa',  NULL);

-- Vincular admin ao grupo Administrador
INSERT INTO usuario_grupo (usuario_id, grupo_id) VALUES (1, 1);

-- Grupo funcionalidades para Administrador (todas habilitadas)
INSERT INTO grupo_funcionalidade (grupo_id, funcionalidade_id, habilitado)
SELECT 1, id, TRUE FROM funcionalidade;

-- Grupo funcionalidades para Liderança de editais (funcionalidades 1-12 habilitadas)
INSERT INTO grupo_funcionalidade (grupo_id, funcionalidade_id, habilitado) VALUES
    (4, 1, TRUE), (4, 2, TRUE), (4, 3, TRUE), (4, 4, TRUE),
    (4, 5, TRUE), (4, 6, TRUE), (4, 7, TRUE), (4, 8, TRUE),
    (4, 9, TRUE), (4,10, TRUE), (4,11, TRUE), (4,12, TRUE),
    (4,13, FALSE);

-- Grupo funcionalidades para Seleção de editais (1-5 habilitadas, 6-8 habilitadas)
INSERT INTO grupo_funcionalidade (grupo_id, funcionalidade_id, habilitado) VALUES
    (5, 1, TRUE), (5, 2, TRUE), (5, 3, TRUE), (5, 4, TRUE),
    (5, 5, TRUE), (5, 6, TRUE), (5, 7, TRUE), (5, 8, FALSE),
    (5, 9, FALSE),(5,10, FALSE),(5,11, FALSE),(5,12, FALSE),(5,13, FALSE);

-- Grupo funcionalidades para Cadastro de contratos
INSERT INTO grupo_funcionalidade (grupo_id, funcionalidade_id, habilitado) VALUES
    (2, 13, TRUE), (2, 1, TRUE), (2, 6, TRUE),
    (2, 2, FALSE), (2, 3, FALSE), (2, 4, FALSE), (2, 5, FALSE),
    (2, 7, FALSE), (2, 8, FALSE), (2, 9, FALSE),(2,10, FALSE),
    (2,11, FALSE),(2,12, FALSE);

-- Grupo funcionalidades para Contas a receber
INSERT INTO grupo_funcionalidade (grupo_id, funcionalidade_id, habilitado) VALUES
    (3, 13, TRUE), (3, 1, TRUE),
    (3, 2, FALSE),(3, 3, FALSE),(3, 4, FALSE),(3, 5, FALSE),
    (3, 6, FALSE),(3, 7, FALSE),(3, 8, FALSE),(3, 9, FALSE),
    (3,10, FALSE),(3,11, FALSE),(3,12, FALSE);

-- Grupo funcionalidades para Validação de CNPJ
INSERT INTO grupo_funcionalidade (grupo_id, funcionalidade_id, habilitado) VALUES
    (6, 13, TRUE),(6, 1, TRUE),(6, 6, TRUE),(6, 7, TRUE),(6, 8, TRUE),
    (6, 9, TRUE),(6,10, TRUE),(6,11, TRUE),
    (6, 2, FALSE),(6, 3, FALSE),(6, 4, FALSE),(6, 5, FALSE),(6,12, FALSE);

-- Vincular usuários a grupos
INSERT INTO usuario_grupo (usuario_id, grupo_id) VALUES
    (2, 2), (2, 4), (2, 5), (2, 6),
    (3, 2), (3, 6),
    (4, 2),
    (5, 2), (5, 5),
    (6, 2), (6, 5);

-- Vincular usuários a papeis
INSERT INTO usuario_papel (usuario_id, papel_id) VALUES
    (2, 1), (2, 2),
    (3, 1),
    (4, 1),
    (5, 2);
