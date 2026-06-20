# Modelagem do Banco — SISSA

Como o banco está modelado hoje. São **duas camadas de tabelas, de propósito**,
mais os objetos programáveis (funções, procedures, triggers, views, índices e
roles) — estes últimos detalhados no `README.md` (seção "Objetos SQL").

## Duas camadas de dados

| Prefixo | Papel | Tratamento |
|---------|-------|-----------|
| **`uni_*`** | Dublê do sistema acadêmico da própria instituição (curso, disciplina, turma, semestre, aluno, matrícula, evasão). É a **fonte**. | Read-only; a importação puxa alunos daqui (simula integração por API). |
| **`sissa_*`** | A **plataforma** de fato — o que coordenadores e tutores usam: usuários, perfis, risco, grupos, intervenções, e o domínio acadêmico normalizado. | Onde tudo acontece. |

O anexo de UX exige que dados acadêmicos cheguem "por integração"; por isso a
separação fonte (`uni_*`) × plataforma (`sissa_*`).

## Tabelas da plataforma (`sissa_*`)

### Domínio acadêmico
- **`sissa_instituicao`** — instituições (sigla, nome, tipo, code_mec).
- **`sissa_unidade`** — unidade/câmpus → `instituicao_id`.
- **`sissa_curso`** — curso → `unidade_id` (a instituição é alcançada **via unidade**), `quantidade_semestres`.
- **`sissa_disciplina`** — disciplina → `curso_id`.
- **`sissa_semestre`** — `ano` + `periodo`.
- **`sissa_professor`** — professor (necessário para turma).
- **`sissa_turma`** — turma → `disciplina_id`, `professor_id`, `semestre_id`.

### Aluno (normalizado) e risco
- **`sissa_aluno`** — a **pessoa** (nome, e-mail).
- **`sissa_matricula`** — a **matrícula** de um aluno num curso → `aluno_id`, `curso_id` (média global, reprovações, carga horária, ingresso…).
- **`sissa_inscricao_turma`** — N:N matrícula ↔ turma → `matricula_id`, `turma_id` (situação). O nº de turmas de um aluno é **derivado** daqui.
- **`sissa_risco_evasao`** — 1:1 com a matrícula → `matricula_id` (`UNIQUE`); guarda `risco`, `maior_influencia`, `updated_at`.

### Operação da plataforma
- **`sissa_usuario_sissa`** — usuário → `perfil_id`, `instituicao_id`.
- **`sissa_perfil`** — 4 níveis (`Tutor`=1, `Coordenador de curso`=2, `Coordenador de ensino`=3, `Coordenador de unidade`=4; `id == nivel`).
- **`sissa_nivel_acao`** — matriz nível → ação (fonte das permissões).
- **`sissa_usuario_curso`** — N:N usuário ↔ curso → `usuario_id`, `curso_id` (escopo de acesso por curso).
- **`sissa_grupo_intervencao`** — grupo (favorito de matrículas) → `autoria_id`, `status` (Ativo/Inativo).
- **`sissa_grupo_matricula`** — N:N grupo ↔ matrícula → `grupo_id`, `matricula_id`.
- **`sissa_intervencao`** — intervenção **individual** → `matricula_id`, `disciplina_id`, `semestre_id`, `autoria_id`.

## Relacionamentos (resumo)
```
instituicao ─< unidade ─< curso ─< disciplina ─< turma >─ professor
                            │           │            │
                            │           │            └─ semestre
                            │           └─< (intervencao, turma)
   aluno ─< matricula >─────┘
              │  │  └──< inscricao_turma >── turma
              │  └─────── risco_evasao (1:1)
              ├──< grupo_matricula >── grupo_intervencao
              └──< intervencao >── disciplina, semestre, usuario(autoria)

instituicao ─< usuario_sissa >─ perfil ─< nivel_acao
                    └──< usuario_curso >── curso
```
(`>─`/`─<` indicam o lado "muitos"; `1:1` onde anotado.)

## Decisões de modelagem (travadas)
- **Aluno normalizado:** pessoa (`sissa_aluno`) + matrícula (`sissa_matricula`). **Risco, grupos e intervenções referenciam a matrícula**, não uma tabela achatada de "estudante".
- **Intervenção é individual:** uma linha por matrícula (sem `grupo_id`, sem N:N intervenção↔aluno). Selecionar N alunos cria N intervenções.
- **Grupo é um agrupador/favorito** de matrículas (`sissa_grupo_matricula`); **não** faz intervenção.
- **`disciplina`, `semestre`, `unidade`, `professor`, `turma` são entidades** (FK), não texto livre.
- **Multi-instituição:** cada usuário pertence a uma instituição (`usuario.instituicao_id`); o curso chega à instituição por `curso → unidade → instituicao`.
- **Escopo de acesso por curso:** coordenador de unidade vê **todos os cursos da sua unidade**; os demais perfis, **um curso**. Implementado pela N:N `sissa_usuario_curso` e **aplicado no servidor** (leitura exige ator e filtra pelos cursos dele).
- **Fonte única de risco:** uma função (`fu_sissa_classificar`) decide o nível Alto/Médio/Baixo; a trigger e `fu_sissa_calcular_risco` delegam a ela.

## Tabelas da fonte (`uni_*`)
Espelham o sistema acadêmico da instituição e são tratadas como read-only:
`uni_curso`, `uni_disciplina`, `uni_semestre`, `uni_turma`, `uni_aluno`,
`uni_matricula`, `uni_inscricao_turma`, `uni_evasao`. A importação de estudantes
lê daqui e cria `sissa_aluno` + `sissa_matricula` + `sissa_risco_evasao`.

## Objetos programáveis
Funções, procedures, triggers, views, índices (com benchmark ≥20%) e as 3 roles
(`admin_sissa`, `leitura_sissa`, `risco_anonimo_sissa`) estão documentados em
detalhe no **`README.md`** (seção "Objetos SQL implementados"). Convenções de
nome: `fu_` função · `pr_` procedure · `tg_` trigger (função `fn_tg_…`) · `vw_` view.
