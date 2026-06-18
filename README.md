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
- [Objetos SQL implementados](#objetos-sql-implementados)
- [API REST](#api-rest)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Testes](#testes)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Autores](#autores)

---

## Sobre o projeto

O SISSA é uma plataforma web acadêmica desenvolvida para a disciplina de **Banco de Dados (N2)** da Universidade Federal de Goiás. Ele reúne **dois sistemas integrados**:

1. **Controle de Acesso** — gerencia usuários, grupos e permissões do sistema (Atividades A1 e A2 individuais).
2. **Gestão de Risco de Evasão** — plataforma pedagógica para coordenadores e tutores monitorarem risco de evasão de estudantes e registrarem intervenções (Trabalho em Grupo N2.A1).

Todo o backend de negócio é implementado em **PL/pgSQL** (funções, procedimentos, triggers, views). O backend é uma API REST em **Node.js + Express** e o frontend é uma **SPA em Vanilla JS**.

---

## Dois sistemas em um

```
http://localhost:3000
│
├── [Login principal]  →  Sistema de Controle de Acesso
│     email: admin@gmail.com  /  senha: admin
│
└── [Botão "Sistema Sissa →"]  →  Plataforma de Risco de Evasão (CAFe)
      Busca "UFG" → Prosseguir → login com email institucional + senha (ex: adailton@ufg.com / 1234)
```

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
psql -U SEU_USUARIO -d sissa -f sql/01_ddl.sql
psql -U SEU_USUARIO -d sissa -f sql/02_functions_a1.sql
psql -U SEU_USUARIO -d sissa -f sql/03_triggers_views_a2.sql
psql -U SEU_USUARIO -d sissa -f sql/04_audit_assertions.sql
psql -U SEU_USUARIO -d sissa -f sql/05_sissa_domain.sql
```

> O arquivo `05_sissa_domain.sql` é idempotente — pode ser re-executado sem erros.

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

#### Procedimentos

| Objeto | Descrição |
|--------|-----------|
| `pr_sissa_criar_intervencao_grupo(grupo_id, data, semestre, forma, assunto, formato, interacao, tipo, acompanhamento, obs)` | Cria uma intervenção para o grupo e vincula automaticamente todos os estudantes do grupo |
| `pr_sissa_atualizar_status_grupos()` | Inativa grupos sem intervenção há mais de 180 dias; retorna total inativados |

#### Triggers

| Trigger | Evento | Descrição |
|---------|--------|-----------|
| `tg_sissa_risco_evasao_timestamp` | BEFORE INSERT/UPDATE em `sissa_risco_evasao` | Atualiza `updated_at` automaticamente |
| `tg_sissa_grupo_inativo_auto` | AFTER INSERT em `sissa_intervencao` | Reativa automaticamente o grupo se ele estiver Inativo ao receber nova intervenção |

#### Views

| View | Descrição |
|------|-----------|
| `vw_sissa_estudantes_risco` | Estudantes com todos os indicadores de risco, curso e instituição |
| `vw_sissa_grupos` | Grupos com contagem de estudantes, autoria e perfil |
| `vw_sissa_risco_anonimo` | Indicadores de risco **sem nome nem matrícula** do estudante (para `risco_anonimo_sissa`) |
| `vw_sissa_resumo_intervencoes` | KPIs por grupo: total de intervenções, estudantes atendidos, objetivos atingidos |

#### Índices de performance

| Índice | Tabela | Colunas | Ganho |
|--------|--------|---------|-------|
| `idx_sissa_risco_comp` | `sissa_risco_evasao` | `(risco, estudante_id, media_global)` | Index Only Scan confirmado |
| `idx_sissa_est_curso_nome` | `sissa_estudante` | `(curso_id, nome)` | Elimina Seq Scan em buscas por curso |

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
| `POST` | `/api/sissa/auth` | Autenticação CAFe — retorna `tipo: 'privado'` ou `'publico'` |
| `GET` | `/api/sissa/estudantes` | Lista estudantes com indicadores de risco |
| `POST` | `/api/sissa/estudantes` | Cria estudante |
| `GET` | `/api/sissa/estatisticas/risco` | Contagem e % por nível de risco (gauge) |
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
│   ├── 01_ddl.sql                   # Schema: tabelas do controle de acesso + seed
│   ├── 02_functions_a1.sql          # Ativ. 1: 8 funções/procedures PL/pgSQL
│   ├── 03_triggers_views_a2.sql     # Ativ. 2: triggers, views e mat-views
│   ├── 04_audit_assertions.sql      # 67 asserções SQL de auditoria
│   └── 05_sissa_domain.sql          # Trabalho em Grupo: schema SISSA completo
│                                    #   (tabelas, funções, procedures, triggers,
│                                    #    views, índices, roles e seed data)
│
├── backend/
│   ├── db.js                        # Pool de conexão PostgreSQL (pg)
│   ├── server.js                    # Servidor Express + rotas globais
│   └── routes/
│       ├── usuarios.js              # CRUD controle de acesso
│       ├── grupos.js                # CRUD grupos + permissões
│       └── sissa.js                 # API completa da plataforma SISSA
│
├── frontend/
│   └── index.html                   # SPA Vanilla JS — ambos os sistemas
│                                    #   Login principal, controle de acesso,
│                                    #   login CAFe SISSA, estudantes, grupos,
│                                    #   intervenções, gestão de usuários SISSA
│
└── docs_tarefas/
    ├── Atividade Avaliativa N2.A1_.pdf
    ├── Atividade Avaliativa N2.A2_.pdf
    └── Trabalho em Grupo N2.A1_.pdf
```

---

## Testes

### Testes automáticos (Node.js)

```bash
node test-runner.js
# → 91/91 testes passando
```

### Asserções SQL de auditoria

```bash
psql -U SEU_USUARIO -d sissa -f sql/04_audit_assertions.sql
# → 67/67 asserções passando
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

arthurparo@discente.ufg.br

Disciplina: **Banco de Dados — N2** · Instituto de Informática · UFG

---

<div align="center">
  <sub>Desenvolvido para fins acadêmicos · UFG 2026</sub>
</div>
