# Guia de Demonstração — SISSA

Tudo que você precisa para demonstrar a plataforma: como subir, com quais
credenciais entrar e o que está cadastrado em cada instituição. Os dados vêm do
seed (`sql/05_sissa_domain.sql` + `sql/06_roster_universidade.sql`); reconstrua o
banco antes de demonstrar para garantir o estado abaixo.

## Como subir
```bash
dropdb --if-exists sissa && createdb sissa
psql -d sissa -f sql/01_ddl.sql
psql -d sissa -f sql/05_sissa_domain.sql
psql -d sissa -f sql/06_roster_universidade.sql
cd backend && node server.js          # http://localhost:3000
```
> Conexão local por *peer auth* (socket): rode o servidor com
> `PGHOST=/var/run/postgresql node server.js` se o `localhost` pedir senha.

## Logins (área privada)
O login CAFe é só um provedor de identidade; a **instituição vem do cadastro do
usuário**. Na tela de login, busque **UFG** ou **IFSP**, prossiga e use:

### UFG — Licenciatura em Física (piloto)
| Nome | E-mail | Senha | Perfil | Nível | Cursos |
|------|--------|-------|--------|:----:|--------|
| Laís Hauptli Cândido | `laishcandido@gmail.com` | `3456` | Coordenador de unidade | 4 | Física + Matemática |
| Beatriz de Barros V. Cardoso | `beatriz.de.bastos.vianna@gmail.com` | `2345` | Coordenador de ensino | 3 | Física |
| Adailton Araújo | `adailton@ufg.com` | `1234` | Coordenador de curso | 2 | Física |
| Kalebe Xavier | `kalebe.xavier@ufg.br` | `4567` | Tutor | 1 | Física |
| Juliana Moraes | `juliana.moraes@ufg.br` | `5678` | Tutor | 1 | Física |
| Beatriz Cardoso | `beatriz.cardoso@ufg.br` | `6789` | Tutor | 1 | Física |

### IFSP — Tecnologia em Análise e Desenvolvimento de Sistemas (ADS)
| Nome | E-mail | Senha | Perfil | Nível | Cursos |
|------|--------|-------|--------|:----:|--------|
| Ricardo Tavares Lima | `ricardo.tavares@ifsp.edu.br` | `7890` | Coordenador de unidade | 4 | ADS |
| Patrícia Nunes Rocha | `patricia.rocha@ifsp.edu.br` | `8901` | Coordenador de curso | 2 | ADS |

**O que cada perfil pode fazer** (matriz `sissa_nivel_acao`): Tutor (1) registra/edita
as próprias intervenções; Coordenador de curso (2) gerencia grupos, estudantes e
usuários; Coordenador de ensino (3) acrescenta excluir usuário; Coordenador de
unidade (4) idem e enxerga **todos os cursos da sua unidade** (por isso Laís vê
Física **e** Matemática). Os demais perfis enxergam **um curso**.

### Área pública (sem login)
Use qualquer e-mail **não cadastrado** (ex.: `visitante@qualquer.com`, senha
livre) → cai na **área pública**, que mostra risco de evasão **anonimizado**
(sem nome/matrícula), servido pela view `vw_sissa_risco_anonimo`.

## O que está cadastrado

### Instituições (4) e unidades (5)
| Instituição | Sigla | Unidade(s) | Tem dados de piloto? |
|-------------|:----:|-----------|:--------------------:|
| Universidade Federal de Goiás | UFG | Regional Goiânia (GYN) | ✅ |
| Instituto Federal de São Paulo | IFSP | Câmpus São Paulo (SPO), Câmpus Guarulhos (GRU) | ✅ |
| Instituto Federal de Rondônia | IFRO | Câmpus Colorado do Oeste (COL) | — (cursos sem alunos/usuários) |
| Instituto Federal do Mato Grosso | IFMT | Câmpus Cuiabá (CBA) | — |

> Só **UFG** e **IFSP** têm usuários, então só elas aparecem no seletor de login.
> IFRO/IFMT existem para mostrar que o modelo é multi-instituição de verdade.

### Cursos (6)
| Curso | Código | Instituição | Semestres | Alunos |
|-------|:------:|:----------:|:--------:|:-----:|
| Licenciatura em Física | LFI | UFG | 8 | **12** |
| Licenciatura em Matemática | LMA | UFG | 8 | 0 |
| Bacharelado em Agronomia | 52921 | UFG | 10 | 0 |
| Tecnologia em ADS | ADS | IFSP | 6 | **10** |
| Técnico em Agroecologia | 12075 | IFRO | 6 | 0 |
| Técnico em Administração | 50 | IFRO | 4 | 0 |

### Alunos e risco de evasão (22 no total)
| Curso | Alunos | Alto risco | Médio | Baixo |
|-------|:-----:|:---------:|:----:|:----:|
| Física (UFG) | 12 | 4 | 4 | 4 |
| ADS (IFSP) | 10 | 3 | 3 | 4 |

O nível de risco (Alto/Médio/Baixo) é calculado pela função
`fu_sissa_classificar` a partir de média global, reprovações e carga horária,
e gravado automaticamente por trigger.

### Disciplinas, turmas e semestres
- **Semestres:** 2023/1, 2023/2, 2024/1, 2024/2, 2025/1, 2025/2.
- **Disciplinas:** Física (5: Física Geral I/II, Eletromagnetismo, Mecânica
  Clássica, Cálculo I) · Matemática (1: Álgebra Linear) · ADS (3: Lógica de
  Programação, Banco de Dados, Engenharia de Software).
- **Turmas:** 9 turmas, 4 professores; o nº de turmas de um aluno é **derivado**
  de `sissa_inscricao_turma` (78 inscrições no total).

### Grupos de intervenção (3, todos de Física)
| Grupo | Status | Membros |
|-------|:------:|:------:|
| Grupo A | **Ativo** | 4 |
| Grupo B | Inativo | 4 |
| Grupo C | Inativo | 5 |

Há **6 intervenções** semeadas (todas em Física). Grupo é só um *favorito* de
matrículas; a intervenção é **individual** (uma linha por aluno).

## Roteiro sugerido de demonstração
1. **Multi-instituição:** logar como `juliana.moraes@ufg.br` → cabeçalho **UFG**,
   curso Física, grupos A/B/C e 6 intervenções. Sair, logar como
   `ricardo.tavares@ifsp.edu.br` → cabeçalho **IFSP**, curso ADS, grupos e
   intervenções vazios. Mostra a isolação por instituição/curso.
2. **Coordenador de unidade vê 2 cursos:** logar como `laishcandido@gmail.com`
   → a seleção de curso oferece **Física e Matemática**.
3. **Permissão por nível:** como **Tutor** (Kalebe) os botões de gerenciar
   usuário/excluir grupo não aparecem; como **Coordenador** aparecem.
4. **Gauge de risco** na tela de estudantes: % Alto/Médio/Baixo do curso
   (alimentado por `fu_sissa_resumo_curso`).
5. **Intervenção a partir de um grupo:** dá `CALL` na procedure
   `pr_sissa_criar_intervencao_grupo` (uma intervenção individual por membro).
6. **Reativação automática:** registrar uma intervenção para um membro de um
   grupo `Inativo` o reativa (trigger `tg_sissa_grupo_inativo_auto`).
7. **Área pública:** entrar com e-mail não cadastrado → risco anonimizado.
