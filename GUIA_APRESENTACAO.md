# Guia de Apresentação — SISSA (as entregas no banco)

Este guia mostra **cada uma das 6 entregas SQL rodando direto no PostgreSQL**, em
paralelo com o que aparece no frontend — a ideia é, na banca, dar `SELECT`/`CALL`
e mostrar que a tela apenas reflete o que o banco já faz.

> Para o roteiro de navegação **na tela** (logins, telas, cliques), use o
> `GUIA_DEMONSTRACAO.md`. Aqui o foco é o **banco**.

## Como subir
```bash
dropdb --if-exists sissa && createdb sissa
psql -d sissa -f sql/01_ddl.sql
psql -d sissa -f sql/05_sissa_domain.sql
psql -d sissa -f sql/06_roster_universidade.sql
cd backend && node server.js          # http://localhost:3000
```

## Como acompanhar
Deixe **dois terminais/janelas** abertos lado a lado:
- o **navegador** em `http://localhost:3000` (o frontend);
- um **psql** conectado ao banco, para rodar os comandos deste guia:
```bash
psql -d sissa
```
Assim você roda o SQL e mostra o reflexo na tela (e vice-versa).

---

## Visão geral do cadastro
O seed é **multi-instituição de verdade**: 4 instituições, sendo só UFG e IFSP com
dados de piloto (IFRO/IFMT existem para provar que o modelo não é mono-instituição).

**Instituições e unidades**
```sql
SELECT i.sigla, i.nome, un.sigla AS unidade, un.nome
FROM sissa_instituicao i
LEFT JOIN sissa_unidade un ON un.instituicao_id = i.id
ORDER BY i.id, un.id;
```
- **UFG** → Regional Goiânia (GYN) · **IFSP** → Câmpus São Paulo (SPO) + Guarulhos (GRU)
- **IFRO** → Colorado do Oeste (COL) · **IFMT** → Cuiabá (CBA)

**Cursos (6) — instituição, semestres e nº de alunos**
```sql
SELECT i.sigla, c.nome, c.codigo, c.quantidade_semestres AS semestres,
       COUNT(m.id) AS alunos
FROM sissa_curso c
JOIN sissa_unidade un      ON un.id = c.unidade_id
JOIN sissa_instituicao i   ON i.id = un.instituicao_id
LEFT JOIN sissa_matricula m ON m.curso_id = c.id
GROUP BY i.sigla, c.nome, c.codigo, c.quantidade_semestres, c.id
ORDER BY i.sigla, c.id;
```
| Curso | Código | Inst. | Sem. | Alunos |
|-------|:------:|:----:|:---:|:-----:|
| Licenciatura em Física | LFI | UFG | 8 | 12 |
| Licenciatura em Matemática | LMA | UFG | 8 | 6 |
| Bacharelado em Agronomia | 52921 | UFG | 10 | 0 |
| Tecnologia em ADS | ADS | IFSP | 6 | 10 |
| Téc. Agroecologia | 12075 | IFRO | 6 | 0 |
| Téc. Administração | 50 | IFRO | 4 | 0 |

**Semestres (6)** — guardados como `ano` + `periodo`:
```sql
SELECT ano || '/' || periodo AS semestre FROM sissa_semestre ORDER BY id;
-- 2023/1, 2023/2, 2024/1, 2024/2, 2025/1, 2025/2
```

**Alunos e risco (28 no total)** — o nível é calculado, não digitado:
```sql
SELECT c.nome AS curso, r.risco, COUNT(*)
FROM sissa_matricula m
JOIN sissa_curso c          ON c.id = m.curso_id
JOIN sissa_risco_evasao r   ON r.matricula_id = m.id
GROUP BY c.nome, r.risco ORDER BY c.nome, r.risco;
-- Física 4/4/4 · Matemática 2/2/2 · ADS 3/3/4 (Alto/Médio/Baixo)
```

**Disciplinas, turmas e inscrições** (o nº de turmas de um aluno é **derivado**):
```sql
SELECT (SELECT COUNT(*) FROM sissa_disciplina)      AS disciplinas,
       (SELECT COUNT(*) FROM sissa_turma)           AS turmas,
       (SELECT COUNT(*) FROM sissa_professor)       AS professores,
       (SELECT COUNT(*) FROM sissa_inscricao_turma) AS inscricoes;
-- 11 · 11 · 4 · 88
```

**Grupos de intervenção (3) e intervenções (6)** — todos de Física:
```sql
SELECT g.titulo, g.status,
       (SELECT COUNT(*) FROM sissa_grupo_matricula gm WHERE gm.grupo_id = g.id) AS membros
FROM sissa_grupo_intervencao g ORDER BY g.id;
-- Grupo A=Ativo(4) · Grupo B=Inativo(4) · Grupo C=Inativo(5)
```

---

## As 6 entregas

### 1. Funções (Requisito 1)
**Na tela:** a coluna **Risco** (Alto/Médio/Baixo) na lista de Estudantes e o **gauge** de risco do curso.

**1ª função — `fu_sissa_calcular_risco(matricula_id)`** classifica o risco de uma
matrícula a partir dos indicadores acadêmicos:
```sql
SELECT m.codigo AS matricula, a.nome, m.reprovacoes, m.media_global,
       fu_sissa_calcular_risco(m.id) AS risco
FROM sissa_matricula m JOIN sissa_aluno a ON a.id = m.aluno_id
WHERE m.curso_id = 1 ORDER BY m.id LIMIT 3;
```
> Os limiares ficam em **`fu_sissa_classificar(reprovacoes, media, ch)`** (fonte única,
> `IMMUTABLE`) — a função acima e a trigger de classificação **delegam** a ela, então a
> regra de risco mora num lugar só.

**2ª função — `fu_sissa_dias_sem_intervencao(grupo_id)`** mede o "abandono" de um grupo
(dias desde a última intervenção dos membros, ou desde a criação):
```sql
SELECT g.titulo, g.status, fu_sissa_dias_sem_intervencao(g.id) AS dias_sem_intervencao
FROM sissa_grupo_intervencao g ORDER BY g.id;
-- Grupo A ~625 · B ~640 · C ~587  (os dias crescem com o tempo)
```
**O que observar:** todos passam de **180** → é exatamente o limiar que a procedure de
manutenção usa (próxima seção). A regra de abandono é **uma função só**, reusada pela procedure.

**Função de apoio — `fu_sissa_resumo_curso(curso_id)`** alimenta o gauge:
```sql
SELECT * FROM fu_sissa_resumo_curso(1);
-- total=12, alto=4, medio=4, baixo=4, pct_alto_risco=33.3
```

### 2. Procedimentos (Requisito 2)
São **`CREATE PROCEDURE`** reais (invocadas com `CALL`; retorno por `INOUT`).
⚠️ **Estas escrevem no banco** — rode de verdade para ver o efeito na tela e
**reconstrua o banco no final** (seção "Restaurar o estado").

**`pr_sissa_criar_intervencao_grupo(...)`** — o botão *"intervenção a partir do grupo"*.
Cria **uma intervenção individual por matrícula** do grupo (sem N:N) e grava o autor:
```sql
CALL pr_sissa_criar_intervencao_grupo(
  1, CURRENT_DATE, 5, 1, 'Chat', 'Apoio', 'Pró-ativa',
  'Conteúdo', 'Síncrono', 'demo apresentação', 1, 0);   -- grupo 1, autoria 1 (Adailton)
-- p_total = 4  (Grupo A tem 4 membros → 4 intervenções)
SELECT matricula_id, formato, autoria_id FROM sissa_intervencao
WHERE observacoes = 'demo apresentação';
```
**Na tela:** as 4 intervenções aparecem na lista de Intervenções, uma por aluno.

**`pr_sissa_atualizar_status_grupos(INOUT total)`** — o botão *"Manutenção"*.
Inativa grupos parados há mais de 180 dias (a medição é **delegada** a
`fu_sissa_dias_sem_intervencao`):
```sql
CALL pr_sissa_atualizar_status_grupos(0);
-- p_total = 1
SELECT titulo, status FROM sissa_grupo_intervencao ORDER BY id;
-- Grupo A passa de Ativo → Inativo (estava com ~625 dias)
```
**O que observar:** só o **Grupo A** muda (B e C já eram Inativos). Recarregue a tela de
Grupos para ver o status mudar.

### 3. Triggers (Requisito 3) — 3 triggers
**`tg_sissa_classificar_risco`** (BEFORE INSERT/UPDATE em `sissa_risco_evasao`) — o campo
`risco` **nunca** é digitado; é derivado dos indicadores da matrícula. Mude os indicadores
e force um update no risco:
```sql
SELECT risco FROM sissa_risco_evasao WHERE matricula_id =
  (SELECT id FROM sissa_matricula WHERE codigo = '2021108020001');     -- Alto
UPDATE sissa_matricula SET reprovacoes = 0, media_global = 9.5 WHERE codigo = '2021108020001';
UPDATE sissa_risco_evasao SET maior_influencia = maior_influencia
  WHERE matricula_id = (SELECT id FROM sissa_matricula WHERE codigo = '2021108020001');
SELECT risco, updated_at FROM sissa_risco_evasao WHERE matricula_id =
  (SELECT id FROM sissa_matricula WHERE codigo = '2021108020001');     -- agora Baixo
```
**`tg_sissa_risco_evasao_timestamp`** — no mesmo update acima, repare que **`updated_at`
saltou para agora** sozinho (auditoria temporal).

**`tg_sissa_grupo_inativo_auto`** (AFTER INSERT em `sissa_intervencao`) — registrar uma
intervenção para um membro de grupo **Inativo** o **reativa**:
```sql
SELECT status FROM sissa_grupo_intervencao WHERE titulo = 'Grupo B';   -- Inativo
INSERT INTO sissa_intervencao (matricula_id, data_intervencao, formato)
  SELECT id, CURRENT_DATE, 'Individual' FROM sissa_matricula WHERE codigo = '2021108020002';
SELECT status FROM sissa_grupo_intervencao WHERE titulo = 'Grupo B';   -- Ativo
```
**Na tela:** é o passo "registrar intervenção para aluno de grupo inativo → grupo volta a Ativo".

### 4. Views (Requisito 4) — 5 views
```sql
-- tela de Estudantes (junta aluno+matrícula+curso+instituição+risco)
SELECT matricula, nome, curso_nome, risco FROM vw_sissa_estudantes_risco WHERE curso_id = 1 LIMIT 5;
-- tela de Grupos (com contagem de membros)
SELECT titulo, status, total_estudantes FROM vw_sissa_grupos ORDER BY id;
-- KPIs por grupo
SELECT grupo_titulo, total_intervencoes, total_estudantes_atendidos FROM vw_sissa_resumo_intervencoes;
-- matriz de permissões por perfil
SELECT perfil_nome, nivel, acao FROM vw_sissa_perfil_permissoes ORDER BY nivel DESC, acao;
-- ÁREA PÚBLICA: risco SEM nome nem matrícula do aluno
SELECT risco_id, curso_nome, risco, media_global FROM vw_sissa_risco_anonimo LIMIT 5;
```
**Na tela:** `vw_sissa_estudantes_risco` é a lista de Estudantes; `vw_sissa_risco_anonimo`
é exatamente o que a **área pública** mostra (note: nenhuma coluna identifica o aluno).

### 5. Índices (Requisito 5)
Duas necessidades de consulta com índice: **risco por curso** e **identificação por matrícula**.
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'sissa_risco_evasao' ORDER BY 1;
-- idx_sissa_risco_comp (risco, matricula_id), idx_sissa_risco_nivel, idx_sissa_risco_updated, ...
```
> No banco de **demonstração** (28 alunos) o planejador usa *Seq Scan* — em tão poucas
> linhas o índice não compensa. A **prova do ganho** está no benchmark com massa de dados
> (`sql/07`), que gera 500 mil linhas e mede com/sem índice:
```bash
psql -d sissa -f sql/07_sissa_indices_performance.sql       # cria a massa e a função
```
```sql
SELECT * FROM fu_sissa_benchmark_indice(500000, 25);        # reexecutar o teste
-- ganhos ≈ 84 % (curso_id, risco) e ≈ 99 % (matrícula) — bem acima dos 20 % exigidos
```

### 6. Segurança — roles (Requisito 6) — 3 roles
`admin_sissa` (CRUD), `leitura_sissa` (SELECT) e `risco_anonimo_sissa` (só a view anônima).
Demonstre o acesso externo restrito:
```sql
SET ROLE risco_anonimo_sissa;
SELECT COUNT(*) FROM vw_sissa_risco_anonimo;   -- OK: 28 (vê o risco anonimizado)
SELECT COUNT(*) FROM sissa_aluno;              -- ERROR: permission denied for table sissa_aluno
RESET ROLE;
```
**O que observar:** a role do acesso externo **enxerga o risco, mas não os dados que
identificam o aluno** — é a mesma garantia da área pública, agora no nível do banco.

---

## Restaurar o estado
As demonstrações de **procedures** e **triggers** acima escrevem no banco (inativam o
Grupo A, criam intervenções, reativam grupos). Para voltar ao estado de seed antes de
reapresentar, reconstrua:
```bash
dropdb --if-exists sissa && createdb sissa
psql -d sissa -f sql/01_ddl.sql
psql -d sissa -f sql/05_sissa_domain.sql
psql -d sissa -f sql/06_roster_universidade.sql
```
Depois de reconstruir, o Grupo A volta a **Ativo** e as 6 intervenções originais voltam.
