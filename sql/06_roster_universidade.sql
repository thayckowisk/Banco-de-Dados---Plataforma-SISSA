-- ════════════════════════════════════════════════════════════
--  06 — CADASTRO ACADÊMICO DA UNIVERSIDADE (roster para importação)
--
--  Snapshot só-leitura do sistema acadêmico da instituição (tabelas
--  uni_*), trazido do banco normalizado `sissa`. Serve de origem para
--  o fluxo "Importar estudante" do SISSA: a partir daqui calculamos
--  CH semestre (= soma da carga horária das disciplinas das turmas em
--  que o aluno está inscrito) e Turmas (= nº de inscrições), além de
--  puxar média, reprovações, nível de risco e maior influência reais.
--
--  Idempotente: pode ser re-executado sem erros.
-- ════════════════════════════════════════════════════════════

DROP VIEW  IF EXISTS vw_roster_universidade CASCADE;
DROP TABLE IF EXISTS uni_inscricao_turma   CASCADE;
DROP TABLE IF EXISTS uni_evasao            CASCADE;
DROP TABLE IF EXISTS uni_matricula         CASCADE;
DROP TABLE IF EXISTS uni_turma             CASCADE;
DROP TABLE IF EXISTS uni_disciplina        CASCADE;
DROP TABLE IF EXISTS uni_curso             CASCADE;
DROP TABLE IF EXISTS uni_aluno             CASCADE;
DROP TABLE IF EXISTS uni_semestre          CASCADE;

-- ──────────────── Estrutura (snapshot, sem FKs) ────────────────
CREATE TABLE uni_semestre (
    id      INTEGER PRIMARY KEY,
    ano     SMALLINT NOT NULL,
    periodo SMALLINT NOT NULL
);

CREATE TABLE uni_curso (
    id                   INTEGER PRIMARY KEY,
    nome                 VARCHAR(50) NOT NULL,
    quantidade_semestres SMALLINT
);

CREATE TABLE uni_disciplina (
    id            INTEGER PRIMARY KEY,
    nome          VARCHAR(100) NOT NULL,
    carga_horaria SMALLINT NOT NULL,
    codigo        VARCHAR(50) NOT NULL,
    id_curso      INTEGER NOT NULL
);

CREATE TABLE uni_turma (
    id            INTEGER PRIMARY KEY,
    codigo        CHAR(1) NOT NULL,
    id_disciplina INTEGER NOT NULL,
    id_professor  INTEGER,
    id_semestre   INTEGER
);

CREATE TABLE uni_aluno (
    id    INTEGER PRIMARY KEY,
    nome  VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL
);

CREATE TABLE uni_matricula (
    id              INTEGER PRIMARY KEY,
    status          VARCHAR(255) NOT NULL,
    naturalidade_uf CHAR(2) NOT NULL,
    forma_ingresso  VARCHAR(255) NOT NULL,
    data_matricula  DATE NOT NULL,
    id_estudante    INTEGER NOT NULL,
    id_curso        INTEGER NOT NULL,
    media_global    NUMERIC NOT NULL,
    reprovacoes     SMALLINT NOT NULL,
    id_semestre     INTEGER NOT NULL
);

CREATE TABLE uni_inscricao_turma (
    id           INTEGER PRIMARY KEY,
    situacao     VARCHAR(255) NOT NULL,
    id_turma     INTEGER NOT NULL,
    id_matricula INTEGER NOT NULL
);

CREATE TABLE uni_evasao (
    id               INTEGER PRIMARY KEY,
    id_matricula     INTEGER NOT NULL UNIQUE,
    maior_influencia VARCHAR(255) NOT NULL,
    nivel_risco      VARCHAR(255) NOT NULL,
    percentual       NUMERIC NOT NULL
);

-- ──────────────── Dados (snapshot do banco `sissa`) ────────────────
INSERT INTO uni_semestre (id, ano, periodo) VALUES
    (1, 2023, 1), (2, 2023, 2), (3, 2024, 1), (4, 2024, 2), (5, 2025, 1);

INSERT INTO uni_curso (id, nome, quantidade_semestres) VALUES
    (1, 'Licenciatura em Física',            8),
    (2, 'Técnico em Mecânica Integrado EM',  6),
    (3, 'Bacharelado em Agronomia',          10),
    (4, 'Licenciatura em Matemática',        8),
    (5, 'Tecnologia em Análise de Sistemas', 6);

INSERT INTO uni_disciplina (id, nome, carga_horaria, codigo, id_curso) VALUES
    (1, 'Eletromagnetismo',          60, 'FIS001', 1),
    (2, 'Mecânica Clássica',         60, 'FIS002', 1),
    (3, 'Cálculo Diferencial I',     90, 'FIS003', 1),
    (4, 'Resistência dos Materiais', 60, 'MEC001', 2),
    (5, 'Solos e Fundações',         60, 'AGR001', 3);

INSERT INTO uni_turma (id, codigo, id_disciplina, id_professor, id_semestre) VALUES
    (1, 'A', 1, 1, 3),
    (2, 'B', 1, 2, 3),
    (3, 'A', 2, 1, 3),
    (4, 'A', 3, 3, 3),
    (5, 'A', 5, 5, 3);

INSERT INTO uni_aluno (id, nome, email) VALUES
    (1, 'Andria De Oliveira Sebastiao',           'andria.sebastiao@discente.ufg.br'),
    (2, 'Denny Ryu De Carvalho Nacano',           'denny.nacano@discente.ufg.br'),
    (3, 'Isabelly Victoria De Freitas Fornitani', 'isabelly.fornitani@discente.ifsp.edu.br'),
    (4, 'Beatriz Alves Cardoso',                  'beatriz.alves@discente.ufmg.br'),
    (5, 'Lucas Henrique Pereira',                 'lucas.pereira@discente.ufg.br');

INSERT INTO uni_matricula (id, status, naturalidade_uf, forma_ingresso, data_matricula, id_estudante, id_curso, media_global, reprovacoes, id_semestre) VALUES
    (1, 'Ativa', 'GO', 'SISU',          '2021-08-20', 1, 1, 6.5, 2, 3),
    (2, 'Ativa', 'SP', 'ENEM',          '2021-08-20', 2, 3, 7.0, 1, 3),
    (3, 'Ativa', 'SP', 'Vestibular',    '2021-08-20', 3, 1, 5.0, 3, 3),
    (4, 'Ativa', 'MG', 'SISU',          '2022-02-10', 4, 4, 8.5, 0, 3),
    (5, 'Ativa', 'GO', 'Transferência', '2020-08-20', 5, 1, 4.0, 5, 2);

INSERT INTO uni_inscricao_turma (id, situacao, id_turma, id_matricula) VALUES
    (1, 'Cursando', 1, 1),
    (2, 'Cursando', 3, 1),
    (3, 'Cursando', 4, 1),
    (4, 'Cursando', 1, 3),
    (5, 'Cursando', 5, 2);

INSERT INTO uni_evasao (id, id_matricula, maior_influencia, nivel_risco, percentual) VALUES
    (1, 1, 'Forma de ingresso', 'Médio', 35.5),
    (2, 2, 'Naturalidade UF',   'Baixo', 12.0),
    (3, 3, 'Reprovações',       'Alto',  72.0),
    (4, 4, 'Média global',      'Baixo',  8.5),
    (5, 5, 'Reprovações',       'Alto',  85.0);

-- ──────────────── View consolidada para importação ────────────────
-- Uma linha por aluno, com CH e turmas calculados e marca de já importado.
CREATE VIEW vw_roster_universidade AS
SELECT
    a.id                                          AS aluno_id,
    'UNI' || LPAD(a.id::text, 6, '0')             AS matricula_codigo,
    a.nome,
    a.email,
    c.nome                                        AS curso_nome,
    EXTRACT(YEAR FROM m.data_matricula)::int      AS ingresso,
    m.forma_ingresso,
    m.naturalidade_uf,
    m.media_global,
    m.reprovacoes,
    COALESCE((
        SELECT SUM(d.carga_horaria)
        FROM uni_inscricao_turma it
        JOIN uni_turma t      ON t.id = it.id_turma
        JOIN uni_disciplina d ON d.id = t.id_disciplina
        WHERE it.id_matricula = m.id
    ), 0)::int                                    AS ch_semestre,
    (
        SELECT COUNT(*)
        FROM uni_inscricao_turma it
        WHERE it.id_matricula = m.id
    )::int                                        AS turmas,
    e.maior_influencia,
    e.nivel_risco,
    e.percentual,
    EXISTS (
        SELECT 1 FROM sissa_estudante se
        WHERE se.matricula = 'UNI' || LPAD(a.id::text, 6, '0')
    )                                             AS ja_importado
FROM uni_aluno a
JOIN uni_matricula m ON m.id_estudante = a.id
JOIN uni_curso c     ON c.id = m.id_curso
LEFT JOIN uni_evasao e ON e.id_matricula = m.id;
