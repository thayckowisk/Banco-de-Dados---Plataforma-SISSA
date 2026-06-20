<div align="center">

# SISSA — Plataforma de Gestão de Risco de Evasão

**Sistema de Identificação de Situações de risco de evasão de Alunos**

Projeto acadêmico — Banco de Dados N2 · UFG

![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.18-000000?logo=express&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

---

## Sumário

- [Sobre o projeto](#sobre-o-projeto)
- [Dois sistemas em um](#dois-sistemas-em-um)
- [Pré-requisitos](#pré-requisitos)
- [Como rodar](#como-rodar)
- [Credenciais de acesso](#credenciais-de-acesso)
- [Arquitetura do banco de dados](#arquitetura-do-banco-de-dados)
- [Parte 2 — Trabalho em Grupo: requisitos atendidos](#parte-2--trabalho-em-grupo-requisitos-atendidos)
- [Objetos SQL implementados](#objetos-sql-implementados)
- [API REST](#api-rest)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Testes](#testes)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Autores](#autores)

---

## Sobre o projeto

O SISSA é uma plataforma web acadêmica desenvolvida para a disciplina de **Banco de Dados (N2)** da Universidade Federal de Goiás. Todo o backend de negócio é implementado em **PL/pgSQL** (funções, procedimentos, triggers, views, índices e segurança). A API REST é **Node.js + Express** e o frontend é uma **SPA em Vanilla JS**.

O repositório está dividido em **duas frentes** independentes, acessíveis a partir da mesma tela de login:

| Frente | O que é | Situação |
|--------|---------|----------|
| **Parte 1 — Controle de Acesso** | Gestão de usuários, grupos, papéis e permissões (Atividades **A1** e **A2** individuais/dupla). | ✅ **Concluída e congelada** — não recebe mais alterações. |
| **Parte 2 — SISSA: Gestão de Risco de Evasão** | Plataforma pedagógica para coordenadores e tutores monitorarem o risco de evasão e registrarem intervenções (**Trabalho em Grupo N2.A1**). | 🚧 **Frente ativa** — foco de desenvolvimento e documentação. |

> **Importante:** os cenários de função, procedimento, trigger, view, índice e segurança da **Parte 2** são **diferentes** dos cenários explorados na Parte 1 (atividades em dupla), conforme exigido pelo enunciado do Trabalho em Grupo.

---

## Dois sistemas em um

```
http://localhost:3000
│
├── [Login principal]  →  PARTE 1 · Sistema de Controle de Acesso
│     email: admin@gmail.com  /  senha: admin
│
└── [Botão "Sistema Sissa →"]  →  PARTE 2 · Plataforma de Risco de Evasão (login CAFe)
      Busca "UFG" → Prosseguir → login com email institucional + senha (ex: adailton@ufg.com / 1234)
```

A **Parte 2** é o módulo aberto ao clicar em **"Sistema Sissa →"** no canto inferior direito da tela de login. Toda a documentação detalhada da Parte 2 está na seção [Parte 2 — Trabalho em Grupo: requisitos atendidos](#parte-2--trabalho-em-grupo-requisitos-atendidos).

---

## Pré-requisitos

- **PostgreSQL 14+** — [postgresql.org](https://www.postgresql.org/download/)
- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **psql** disponível no PATH

---

## Como rodar

### 1. Criar o banco de dados

```bash
# macOS / Linux
createdb sissa

# Windows (PowerShell)
psql -U postgres -c "CREATE DATABASE sissa;"
```

### 2. Executar os scripts SQL em ordem

```bash
# Parte 1 — Controle de Acesso
psql -U SEU_USUARIO -d sissa -f sql/01_ddl.sql
psql -U SEU_USUARIO -d sissa -f sql/02_functions_a1.sql
psql -U SEU_USUARIO -d sissa -f sql/03_triggers_views_a2.sql
psql -U SEU_USUARIO -d sissa -f sql/04_audit_assertions.sql   # (opcional: 67 asserções)

# Parte 2 — SISSA: Gestão de Risco de Evasão
psql -U SEU_USUARIO -d sissa -f sql/05_sissa_domain.sql            # tabelas, funções, procedures, triggers, views, roles e seed
psql -U SEU_USUARIO -d sissa -f sql/06_roster_universidade.sql     # snapshot acadêmico (origem da importação de estudantes)
psql -U SEU_USUARIO -d sissa -f sql/07_sissa_indices_performance.sql  # (opcional: benchmark de índices, Req. 5)
```

> Os arquivos `05`, `06` e `07` são **idempotentes** — podem ser re-executados sem erros.
> O `07` é uma demonstração de performance (gera massa de ~500 mil linhas, mede e remove); não é necessário para rodar a aplicação.

### 3. Instalar dependências e iniciar o servidor

```bash
cd backend
npm install
node server.js
```

O servidor sobe em **http://localhost:3000**

### 4. Acessar o sistema

Abra **http://localhost:3000** no navegador.

---

## Credenciais de acesso

### Sistema de Controle de Acesso (tela inicial)

| Perfil | E-mail | Senha | Permissões |
|--------|--------|-------|------------|
| Administrador | `admin@gmail.com` | `admin` | CRUD completo: criar, editar e excluir usuários e grupos |
| Usuário comum | `user@gmail.com` | `user` | Somente leitura |

---

### Plataforma SISSA — Gestão de Risco de Evasão

**Como acessar:** na tela de login, clique em **"Sistema Sissa →"** (canto inferior direito) → busque **"UFG"** → clique em *Prosseguir para login em UFG* → informe um dos e-mails abaixo.

> Cada usuário cadastrado tem uma **senha de 4 dígitos** (verificada no login). E-mails não cadastrados acessam apenas a área pública (sem checagem de senha).

#### Acesso à área privada (e-mails cadastrados)

| Nome | E-mail | Senha | Perfil |
|------|--------|-------|--------|
| Adailton Araújo | `adailton@ufg.com` | `1234` | Coordenador de curso |
| Beatriz de Barros Vianna Cardoso | `beatriz.de.bastos.vianna@gmail.com` | `2345` | Coordenador de ensino |
| Laís Hauptli Cândido | `laishcandido@gmail.com` | `3456` | Coordenador de unidade |
| Kalebe Xavier | `kalebe.xavier@ifsp.edu.br` | `4567` | Tutor Físico |
| Juliana Moraes | `juliana.moraes@ifsp.edu.br` | `5678` | Tutor |
| Beatriz Cardoso | `beatriz.cardoso@ifsp.edu.br` | `6789` | Tutor |

#### Acesso à área pública

Use **qualquer e-mail não cadastrado** (ex: `visitante@gmail.com`) com qualquer senha → acesso somente à área pública (sem dados de estudantes).

---

## Arquitetura do banco de dados

### Módulo 1 — Controle de Acesso

```
modulo
  └── categoria_funcionalidade
        └── funcionalidade
              └── grupo_funcionalidade (habilitado) ←── grupo ──→ usuario_grupo ←── usuario
                                                                                         └── usuario_papel ←── papel
auditoria  ←── triggers em todas as tabelas acima
```

| Tabela | Descrição |
|--------|-----------|
| `usuario` | Usuários do sistema de controle de acesso |
| `grupo` | Grupos de acesso |
| `papel` | Papéis atribuíveis a usuários |
| `modulo` | Módulos do sistema |
| `categoria_funcionalidade` | Categorias dentro de um módulo |
| `funcionalidade` | Funcionalidades individuais habilitáveis |
| `usuario_grupo` | N:N usuário ↔ grupo |
| `usuario_papel` | N:N usuário ↔ papel |
| `grupo_funcionalidade` | N:N grupo ↔ funcionalidade com flag `habilitado` |
| `auditoria` | Log automático de todas as operações DML |

### Módulo 2 — SISSA (Gestão de Risco de Evasão)

```
sissa_instituicao
  └── sissa_curso
        ├── sissa_estudante ──→ sissa_risco_evasao (1:1, trigger updated_at)
        │         └── sissa_grupo_estudante ←── sissa_grupo_intervencao ──→ sissa_intervencao
        │                                                                          └── sissa_intervencao_estudante
        └── sissa_usuario_sissa ──→ sissa_usuario_curso
              └── sissa_perfil
```

| Tabela | Descrição |
|--------|-----------|
| `sissa_instituicao` | Instituições (código MEC, nome, tipo) |
| `sissa_curso` | Cursos vinculados a uma instituição |
| `sissa_perfil` | Perfis de usuário SISSA |
| `sissa_usuario_sissa` | Usuários da plataforma SISSA |
| `sissa_usuario_curso` | N:N usuário ↔ curso |
| `sissa_estudante` | Estudantes matriculados |
| `sissa_risco_evasao` | Indicadores de risco (1:1 com estudante) |
| `sissa_grupo_intervencao` | Grupos pedagógicos de intervenção |
| `sissa_grupo_estudante` | N:N grupo ↔ estudante |
| `sissa_intervencao` | Registros de intervenção realizadas |
| `sissa_intervencao_estudante` | N:N intervenção ↔ estudante |

---

## Parte 2 — Trabalho em Grupo: requisitos atendidos

Esta é a frente ativa do projeto (módulo **"Sistema Sissa →"**). Todo o domínio está em `sql/05_sissa_domain.sql` (+ `06` roster e `07` benchmark). Mapeamento direto dos **6 requisitos** do enunciado:

| Req | Conceito | Cenário identificado nos requisitos | Implementação |
|-----|----------|--------------------------------------|---------------|
| **1** | 2 **funções** | Calcular o risco de um estudante; consolidar KPIs de risco de um curso | `fu_sissa_calcular_risco(estudante_id)` · `fu_sissa_resumo_curso(curso_id)` |
| **2** | 2 **procedimentos** | Registrar intervenção a partir de um grupo (uma intervenção individual por aluno, com autoria); manutenção em lote do ciclo de vida dos grupos | `CALL pr_sissa_criar_intervencao_grupo(...)` · `CALL pr_sissa_atualizar_status_grupos(...)` (PROCEDURE reais, `INOUT`) |
| **3** | 2+ **triggers** | Classificar risco automaticamente; manter `updated_at`; reativar grupo ao receber intervenção | `tg_sissa_classificar_risco` · `tg_sissa_risco_evasao_timestamp` · `tg_sissa_grupo_inativo_auto` |
| **4** | 2+ **views** | Lista de risco dos alunos do curso; resumo gerencial de intervenções; **view anônima** de risco | `vw_sissa_estudantes_risco` · `vw_sissa_grupos` · `vw_sissa_resumo_intervencoes` · `vw_sissa_risco_anonimo` |
| **5** | 2 **índices** + massa + ganho ≥ 20 % | Consulta de risco por curso; identificação por matrícula | `(curso_id, risco)` → **≈84 %** · `(matricula)` → **≈99 %** (benchmark em `07`, massa de 500 mil linhas) |
| **6** | 3 **grupos de usuários** (segurança) | Admin total; leitura geral; acesso externo **sem dados que identifiquem o aluno** | `admin_sissa` (CRUD) · `leitura_sissa` (SELECT) · `risco_anonimo_sissa` (SELECT só em `vw_sissa_risco_anonimo`) |

> Os detalhes de cada objeto (assinaturas, colunas, eventos) estão na seção **Objetos SQL implementados → Trabalho em Grupo — Domínio SISSA**. A verificação automatizada de todos esses requisitos está em `test-sissa.js` (**190 testes**, ver [Testes](#testes)).

Como extensão de segurança, cada perfil tem um **nível de permissão** hierárquico (ver [Níveis de permissão por perfil](#níveis-de-permissão-por-perfil-controle-de-acesso-hierárquico)): o coordenador edita tudo e, à medida que o cargo diminui, menos ações ficam disponíveis (um tutor não altera um coordenador).

### Telas da Parte 2 (frontend)

1. **Login CAFe** — busca de instituição (UFG) e autenticação federada
2. **Estudantes em risco** — lista por curso com *gauge* de risco, filtros e importação do cadastro acadêmico
3. **Grupos de intervenção** — CRUD de grupos a partir da lista de estudantes
4. **Intervenções** — registro/edição de intervenções (individuais ou de grupo)
5. **Usuários SISSA** — gestão de coordenadores/tutores e seus cursos

---

## Objetos SQL implementados

### Atividade 1 — Funções e Procedimentos (`sql/02_functions_a1.sql`)

| # | Objeto | Tipo | Entrada | Saída | Descrição |
|---|--------|------|---------|-------|-----------|
| 1 | `fu_validar_cadastro` | FUNCTION | `email VARCHAR` | `BOOLEAN` | `TRUE` se o e-mail já existe na base |
| 2 | `fu_validar_email` | FUNCTION | `email VARCHAR` | `BOOLEAN` | Valida formato via regex RFC 5322 |
| 3 | `fu_formatar_tempo_acesso` | FUNCTION | `ultimo_acesso TIMESTAMPTZ` | `VARCHAR` | Retorna tempo decorrido: "3 horas", "15 dias", "Nunca acessou" |
| 4 | `pr_excluir_usuario` | FUNCTION | `usuario_id INTEGER` | `BOOLEAN` | Exclui usuário; bloqueia se pertencer ao grupo Administrador |
| 5 | `fu_migrar_usuarios_grupo` | FUNCTION | `origem, destino VARCHAR` | `TABLE` | Move todos os usuários da origem para o destino |
| 6 | `pr_copiar_grupo` | FUNCTION | `origem, novo_grupo VARCHAR` | `INTEGER` | Cria novo grupo com cópia das permissões; retorna qtd. habilitadas |
| 7 | `fu_verificar_engajamento` | FUNCTION | — | `TABLE` | Classifica usuários: Alto / Médio / Baixo / Inexistente |
| 8 | `pr_criar_usuario_adm` | FUNCTION | `email, nome_grupo VARCHAR` | `VOID` | Cria usuário admin com todas as funcionalidades habilitadas |

### Atividade 2 — Triggers e Views (`sql/03_triggers_views_a2.sql`)

| # | Objeto | Tipo | Descrição |
|---|--------|------|-----------|
| 1 | `pr_remover_dependencia_usuario` | FUNCTION | Remove linhas de `usuario_papel` e `usuario_grupo` antes do DELETE |
| 2 | `tg_acionar_remocao_dependencia` | TRIGGER | BEFORE DELETE ON usuario |
| 3 | `tg_fn_auditoria` + 9 triggers | TRIGGER | AFTER INSERT/UPDATE/DELETE em todas as tabelas → registra em `auditoria` |
| 4 | `vw_consulta_usuario` | VIEW | Usuários com grupos, papéis e tempo de acesso formatado |
| 5 | `vwm_consulta_usuario` | MAT. VIEW | Versão materializada + UNIQUE INDEX(id) |
| 6 | `vw_consulta_grupo` | VIEW | Grupos com total de permissões e total de usuários |
| 7 | `vmw_consulta_grupo` | MAT. VIEW | Versão materializada + UNIQUE INDEX(id) |
| 8 | `vw_consulta_permissoes_grupo` | VIEW | Matriz grupo × funcionalidade com flag habilitado |
| 9 | `vmw_consulta_permissoes_grupo` | MAT. VIEW | Versão materializada + UNIQUE INDEX(grupo_id, funcionalidade_id) |
| 10 | Refresh automático a cada 2h | — | Alternativas: **pg_cron** e **crontab do SO** |

### Trabalho em Grupo — Domínio SISSA (`sql/05_sissa_domain.sql`)

#### Funções

| Objeto | Entrada | Saída | Descrição |
|--------|---------|-------|-----------|
| `fu_sissa_calcular_risco` | `estudante_id INTEGER` | `VARCHAR` | Calcula nível de risco (Alto/Médio/Baixo) pelos indicadores acadêmicos do estudante |
| `fu_sissa_resumo_curso` | `curso_id INTEGER` | `TABLE` | Retorna KPIs do curso: total de estudantes, contagem por risco, média de reprovações, % alto risco |
| `fu_sissa_nivel_usuario` | `usuario_id INTEGER` | `INTEGER` | Nível (1..5) do perfil do usuário (controle de acesso) |
| `fu_sissa_pode` | `usuario_id, acao` | `BOOLEAN` | Se o nível do usuário possui a ação na matriz `sissa_nivel_acao` |
| `fu_sissa_pode_gerenciar_usuario` | `ator_id, alvo_id` | `BOOLEAN` | Regra hierárquica: só gerencia quem é de nível estritamente menor |

#### Procedimentos

Implementados como **`CREATE PROCEDURE`** reais do PostgreSQL (invocados com **`CALL`**; o valor de retorno é devolvido por parâmetro **`INOUT`**).

| Objeto | Invocação | Descrição |
|--------|-----------|-----------|
| `pr_sissa_criar_intervencao_grupo(grupo_id, data, semestre_id, disciplina_id, forma_meio, assunto, interacao, tipo, acompanhamento, obs, autoria_id, INOUT total)` | `CALL pr_sissa_criar_intervencao_grupo(1, CURRENT_DATE, 5, 1, 'Chat', 'Apoio', 'Pró-ativa', 'Conteúdo', 'Síncrono', 'obs', 3, 0);` | Percorre as matrículas do grupo e cria **uma intervenção individual por matrícula** (intervenção é individual), gravando o autor (`autoria_id`) em cada uma; devolve a **quantidade criada** em `INOUT total` |
| `pr_sissa_atualizar_status_grupos(INOUT total)` | `CALL pr_sissa_atualizar_status_grupos(0);` | Rotina de manutenção em lote: inativa grupos sem intervenção há mais de 180 dias; devolve o total inativado em `INOUT total` |

#### Triggers

| Trigger | Evento | Descrição |
|---------|--------|-----------|
| `tg_sissa_classificar_risco` | BEFORE INSERT/UPDATE em `sissa_risco_evasao` | Classifica automaticamente o nível de risco (`Alto`/`Médio`/`Baixo`) a partir dos indicadores (reprovações, média global, CH do semestre) — garante consistência venha a escrita da importação, da API ou de SQL direto |
| `tg_sissa_risco_evasao_timestamp` | BEFORE INSERT/UPDATE em `sissa_risco_evasao` | Atualiza `updated_at` automaticamente |
| `tg_sissa_grupo_inativo_auto` | AFTER INSERT em `sissa_intervencao` | Reativa automaticamente o grupo se ele estiver Inativo ao receber nova intervenção |

#### Views

| View | Descrição |
|------|-----------|
| `vw_sissa_estudantes_risco` | Estudantes com todos os indicadores de risco, curso e instituição |
| `vw_sissa_grupos` | Grupos com contagem de estudantes, autoria e perfil |
| `vw_sissa_risco_anonimo` | Indicadores de risco **sem nome nem matrícula** do estudante (para `risco_anonimo_sissa`) |
| `vw_sissa_resumo_intervencoes` | KPIs por grupo: total de intervenções, estudantes atendidos, objetivos atingidos |
| `vw_sissa_perfil_permissoes` | Matriz legível perfil × nível × ação (controle de acesso por nível) |

#### Níveis de permissão por perfil (controle de acesso hierárquico)

Cada perfil tem um **nível** (`sissa_perfil.nivel`, 5 = mais alto). A matriz de ações fica na tabela **`sissa_nivel_acao`** (data-driven) e é aplicada por funções no banco, validada no **backend** (header `x-sissa-usuario-id`) e refletida no **frontend** (botões ocultos conforme a permissão). Regra-chave: **ninguém edita/exclui um usuário de nível igual ou superior ao seu** (um tutor não altera um coordenador).

| Nível | Perfil | ver | criar interv. | editar interv. | excluir interv. | gerenciar grupo | excluir grupo | gerenciar estud. | gerenciar usuário | excluir usuário |
|:---:|--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **5** | Coordenador de unidade | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **4** | Coordenador de ensino  | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **3** | Coordenador de curso   | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| **2** | Tutor Físico           | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| **1** | Tutor                  | ✅ | ✅ | ✅¹ | — | — | — | — | — | — |

¹ O Tutor só edita **as próprias** intervenções (campo `autoria_id`). Funções de apoio: `fu_sissa_pode(usuario_id, acao)`, `fu_sissa_pode_gerenciar_usuario(ator_id, alvo_id)`, `fu_sissa_nivel_usuario(usuario_id)`. Coord. de unidade e de ensino têm o mesmo conjunto de ações, mas o de unidade (nível 5) pode **gerenciar** o de ensino (nível 4), e não o contrário.

#### Índices de performance (Requisito 5)

Duas necessidades de índice identificadas nos requisitos, validadas por **benchmark com massa de dados** (`sql/07_sissa_indices_performance.sql` — gera 500 mil linhas, mede com e sem índice e remove a massa ao final):

| # | Necessidade (requisito) | Índice demonstrado | Consulta | Sem índice | Com índice | **Ganho** |
|---|--------------------------|--------------------|----------|-----------|-----------|-----------|
| 1 | "Consulta de risco de evasão dos alunos do curso" (filtro curso + risco) | `(curso_id, risco)` | `WHERE curso_id=? AND risco=?` | ~210 ms | ~34 ms | **≈ 84 %** |
| 2 | Identificação do estudante por matrícula (importação / vínculo único) | `(matricula)` | `WHERE matricula=?` | ~213 ms | ~0,3 ms | **≈ 99 %** |

> Ambos superam com folga o mínimo de **20 %** exigido. O `EXPLAIN ANALYZE` confirma a troca de **Seq Scan → Index/Bitmap Index Scan**. Os índices reais equivalentes já estão criados no schema: `idx_sissa_est_curso_nome (curso_id, nome)`, `idx_sissa_risco_comp (risco, estudante_id, media_global)` e `idx_sissa_estudante_mat (matricula)`.

Para reexecutar o benchmark a qualquer momento:

```sql
SELECT * FROM fu_sissa_benchmark_indice(500000, 25);
```

#### Roles de segurança

| Role | Permissões |
|------|-----------|
| `admin_sissa` | SELECT, INSERT, UPDATE, DELETE em todas as tabelas e views SISSA + sequences |
| `leitura_sissa` | SELECT em todas as tabelas e views SISSA |
| `risco_anonimo_sissa` | SELECT somente em `vw_sissa_risco_anonimo` (sem dados identificadores) |

---

## API REST

### Controle de Acesso (`/api/...`)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/usuarios` | Lista usuários |
| `GET` | `/api/usuarios/:id` | Busca usuário por ID |
| `POST` | `/api/usuarios` | Cria usuário com grupos e papéis |
| `PUT` | `/api/usuarios/:id` | Atualiza usuário, grupos e papéis |
| `DELETE` | `/api/usuarios/:id` | Exclui usuário via `pr_excluir_usuario` |
| `POST` | `/api/usuarios/migrar` | Migra usuários entre grupos |
| `POST` | `/api/usuarios/admin` | Cria usuário administrador |
| `GET` | `/api/grupos` | Lista grupos com permissões e usuários |
| `POST` | `/api/grupos` | Cria grupo com permissões |
| `PUT` | `/api/grupos/:id` | Atualiza grupo e permissões |
| `DELETE` | `/api/grupos/:id` | Exclui grupo |
| `POST` | `/api/grupos/copiar` | Copia grupo via `pr_copiar_grupo` |
| `GET` | `/api/papeis` | Lista papéis disponíveis |
| `GET` | `/api/funcionalidades` | Lista funcionalidades por módulo/categoria |
| `GET` | `/api/auditoria` | Últimas 100 entradas do log |
| `GET` | `/api/engajamento` | Classificação de engajamento de todos os usuários |

### Plataforma SISSA (`/api/sissa/...`)

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/sissa/auth` | Autenticação CAFe — retorna `tipo`, `nivel` e `permissoes` do usuário |
| `GET` | `/api/sissa/permissoes` | Matriz de permissões por perfil/nível |
| `GET` | `/api/sissa/estudantes` | Lista estudantes com indicadores de risco |
| `POST` | `/api/sissa/estudantes` | Cria estudante (risco derivado por trigger/função) |
| `GET` | `/api/sissa/roster` | Lista alunos do cadastro acadêmico (origem da importação) |
| `POST` | `/api/sissa/estudantes/importar` | Importa aluno do roster para a plataforma |
| `GET` | `/api/sissa/estatisticas/risco` | Contagem e % por nível de risco (gauge) |
| `GET` | `/api/sissa/resumo-curso/:curso_id` | KPIs do curso via `fu_sissa_resumo_curso` |
| `GET` | `/api/sissa/grupos` | Lista grupos de intervenção |
| `POST` | `/api/sissa/grupos` | Cria grupo com estudantes |
| `GET` | `/api/sissa/grupos/:id` | Detalhe do grupo com estudantes |
| `PUT` | `/api/sissa/grupos/:id` | Atualiza grupo e membros |
| `DELETE` | `/api/sissa/grupos/:id` | Exclui grupo |
| `GET` | `/api/sissa/grupos/:id/estudantes` | Estudantes de um grupo com dados de risco |
| `GET` | `/api/sissa/intervencoes` | Lista intervenções (filtros: grupo_id, data, busca) |
| `POST` | `/api/sissa/intervencoes` | Registra nova intervenção com estudantes |
| `PUT` | `/api/sissa/intervencoes/:id` | Atualiza intervenção |
| `DELETE` | `/api/sissa/intervencoes/:id` | Exclui intervenção |
| `GET` | `/api/sissa/usuarios` | Lista usuários SISSA (filtros: perfil_id, curso_id) |
| `POST` | `/api/sissa/usuarios` | Cria usuário SISSA com cursos |
| `PUT` | `/api/sissa/usuarios/:id` | Atualiza usuário e cursos |
| `DELETE` | `/api/sissa/usuarios/:id` | Exclui usuário SISSA |
| `GET` | `/api/sissa/cursos` | Lista cursos com instituição |
| `GET` | `/api/sissa/perfis` | Lista perfis SISSA |
| `GET` | `/api/sissa/instituicoes` | Lista instituições |

---

## Estrutura do projeto

```
SISSA/
├── README.md                        # Este arquivo
│
├── sql/
│   │   # ── Parte 1 — Controle de Acesso (concluída) ──
│   ├── 01_ddl.sql                   # Schema: tabelas do controle de acesso + seed
│   ├── 02_functions_a1.sql          # Ativ. 1: 8 funções/procedures PL/pgSQL
│   ├── 03_triggers_views_a2.sql     # Ativ. 2: triggers, views e mat-views
│   ├── 04_audit_assertions.sql      # 67 asserções SQL de auditoria
│   │   # ── Parte 2 — SISSA: Gestão de Risco de Evasão (frente ativa) ──
│   ├── 05_sissa_domain.sql          # Domínio SISSA: tabelas, 2 funções, 2 procedures,
│   │                                #   3 triggers, 4 views, índices, 3 roles e seed
│   ├── 06_roster_universidade.sql   # Snapshot acadêmico (uni_*) p/ importar estudantes
│   └── 07_sissa_indices_performance.sql  # Req. 5: massa de dados + benchmark de índices
│
├── backend/
│   ├── db.js                        # Pool de conexão PostgreSQL (pg)
│   ├── server.js                    # Servidor Express + rotas globais
│   └── routes/
│       ├── usuarios.js              # Parte 1: CRUD controle de acesso
│       ├── grupos.js                # Parte 1: CRUD grupos + permissões
│       └── sissa.js                 # Parte 2: API completa da plataforma SISSA
│
├── frontend/
│   └── index.html                   # SPA Vanilla JS — ambas as frentes
│                                    #   Parte 1: login principal + controle de acesso
│                                    #   Parte 2: login CAFe, estudantes, grupos,
│                                    #   intervenções, gestão de usuários SISSA
│
├── test-runner.js                   # Parte 1: 91 testes (controle de acesso)
├── test-sissa.js                    # Parte 2: 190 testes (domínio SISSA + níveis)
│
└── docs_tarefas/
    ├── Atividade Avaliativa N2.A1_.pdf
    ├── Atividade Avaliativa N2.A2_.pdf
    └── Trabalho em Grupo N2.A1_.pdf
```

---

## Testes

> Para os testes de API, o servidor precisa estar rodando (`cd backend && node server.js`).

### Parte 1 — Controle de Acesso

```bash
node test-runner.js
# → 91/91 testes passando

psql -U SEU_USUARIO -d sissa -f sql/04_audit_assertions.sql
# → 67/67 asserções de auditoria passando
```

### Parte 2 — SISSA: Gestão de Risco de Evasão

```bash
node test-sissa.js
# → 190/190 testes passando  (servidor precisa estar rodando)
```

Cobertura do `test-sissa.js` (14 suítes): schema/DDL e constraints, **funções**, **procedimentos** (`CALL`), **triggers**, **views** (incluindo o anonimato da `vw_sissa_risco_anonimo`), **índices** (com benchmark de ganho ≥ 20 %), **segurança/roles** (incl. `SET ROLE` bloqueando acesso indevido), **níveis de permissão** (gradiente de ações por perfil + regra hierárquica) e todas as rotas `/api/sissa/*` (autenticação, estudantes, roster/importação, grupos, intervenções e usuários). Os dados de teste são removidos automaticamente ao final.

```bash
# Benchmark de índices isolado (Req. 5)
psql -U SEU_USUARIO -d sissa -f sql/07_sissa_indices_performance.sql
# → 2 cenários, ambos com ganho > 20% (≈84% e ≈99%)
```

---

## Variáveis de ambiente

Configuradas em `backend/db.js` via variáveis de ambiente ou valores padrão:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=sissa
PGUSER=seu_usuario_postgresql
PGPASSWORD=           # vazio se sem senha
PORT=3000
```

---

## Autores

| Nome | E-mail |
|------|--------|
| Thayckowisk Correia Campos | thayckowisk@discente.ufg.br |
| Thiago Honorato Ferreira | thiago.honorato@discente.ufg.br |
| Arthur Henrique de Souza Paro | arthurparo@discente.ufg.br |
| Henryque de Oliveira Affiune | henryque_oliveira@discente.ufg.br |

Disciplina: **Banco de Dados — N2** · Instituto de Informática · UFG

---

<div align="center">
  <sub>Desenvolvido para fins acadêmicos · UFG 2026</sub>
</div>
