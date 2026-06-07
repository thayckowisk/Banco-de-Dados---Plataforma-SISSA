<div align="center">

# SISSA — Plataforma de Controle de Acesso

**Sistema Integrado de Suporte ao Acesso**

Projeto acadêmico — Banco de Dados N2 · UFG

![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791?logo=postgresql&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.18-000000?logo=express&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

---

## Sumário

- [Sobre o projeto](#sobre-o-projeto)
- [Funcionalidades](#funcionalidades)
- [Pré-requisitos](#pré-requisitos)
- [Como rodar](#como-rodar)
- [Credenciais de acesso](#credenciais-de-acesso)
- [Arquitetura do banco de dados](#arquitetura-do-banco-de-dados)
- [Objetos SQL implementados](#objetos-sql-implementados)
  - [Atividade 1 — Funções e Procedimentos](#atividade-1--funções-e-procedimentos)
  - [Atividade 2 — Triggers e Views](#atividade-2--triggers-e-views)
- [API REST](#api-rest)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Testes](#testes)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Autores](#autores)

---

## Sobre o projeto

O SISSA é uma plataforma web de controle de acesso desenvolvida como trabalho avaliativo da disciplina de **Banco de Dados (N2)** da Universidade Federal de Goiás. O sistema gerencia usuários, grupos de acesso e permissões por funcionalidade, com toda a lógica de negócio implementada diretamente no PostgreSQL via **PL/pgSQL** (funções, procedimentos, triggers e views).

O backend é uma API REST em **Node.js + Express** e o frontend é uma **SPA em Vanilla JS** servida pelo próprio backend.

---

## Funcionalidades

| Módulo | Descrição |
|--------|-----------|
| **Usuários** | Cadastro, edição e exclusão de usuários com grupos e papéis; busca por nome/e-mail; exclusão bloqueada para administradores |
| **Grupos** | Criação e edição de grupos com permissões granulares por funcionalidade; exibição de membros |
| **Permissões** | Matriz completa de funcionalidades × grupos com toggles habilitado/desabilitado por módulo e categoria |
| **Engajamento** | Classificação automática de usuários por frequência de acesso: Alto / Médio / Baixo / Inexistente |
| **Auditoria** | Registro automático via triggers de toda operação INSERT/UPDATE/DELETE em qualquer tabela do sistema |
| **Migrar usuários** | Move todos os usuários de um grupo de origem para um grupo de destino |
| **Copiar grupo** | Cria um novo grupo com as mesmas permissões de um grupo existente |

---

## Pré-requisitos

- **PostgreSQL 14+** — [postgresql.org](https://www.postgresql.org/download/)
- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **psql** disponível no PATH

---

## Como rodar

### 1. Criar o banco de dados

```bash
# Linux / macOS
createdb sissa

# Windows (PowerShell)
psql -U postgres -c "CREATE DATABASE sissa;"
```

### 2. Executar os scripts SQL em ordem

```bash
psql -U postgres -d sissa -f sql/01_ddl.sql
psql -U postgres -d sissa -f sql/02_functions_a1.sql
psql -U postgres -d sissa -f sql/03_triggers_views_a2.sql
```

> Substitua `postgres` pelo seu usuário PostgreSQL local se necessário.

### 3. Configurar variáveis de ambiente

```bash
cp backend/.env.example backend/.env
# edite backend/.env com suas credenciais
```

### 4. Instalar dependências e iniciar o servidor

```bash
cd backend
npm install
node server.js
```

O servidor sobe em **http://localhost:3000**

### 5. Acessar o sistema

Abra **http://localhost:3000** no navegador e faça login com uma das contas abaixo.

---

## Credenciais de acesso

| Perfil | E-mail | Senha | Permissões |
|--------|--------|-------|------------|
| Administrador | `admin@gmail.com` | `admin` | CRUD completo: criar, editar e excluir usuários e grupos |
| Usuário comum | `user@gmail.com` | `user` | Somente leitura |

---

## Arquitetura do banco de dados

### Modelo de dados

```
modulo
  └── categoria_funcionalidade
        └── funcionalidade
              └── grupo_funcionalidade (habilitado) ←── grupo ──→ usuario_grupo ←── usuario
                                                                                         └── usuario_papel ←── papel
```

### Tabelas

| Tabela | Descrição |
|--------|-----------|
| `usuario` | Usuários da plataforma (email, nome, ultimo_acesso) |
| `grupo` | Grupos de acesso |
| `papel` | Papéis/roles atribuíveis a usuários |
| `modulo` | Módulos do sistema (ex.: EDITAIS, CONTRATOS) |
| `categoria_funcionalidade` | Categorias dentro de um módulo |
| `funcionalidade` | Funcionalidades individuais habilitáveis |
| `usuario_grupo` | N:N usuário ↔ grupo |
| `usuario_papel` | N:N usuário ↔ papel |
| `grupo_funcionalidade` | N:N grupo ↔ funcionalidade com flag `habilitado` |
| `auditoria` | Log automático de todas as operações DML |

> Todas as FKs usam `ON DELETE RESTRICT` — nenhuma exclusão em cascata. A limpeza de dependências é feita explicitamente pela trigger `tg_acionar_remocao_dependencia`.

---

## Objetos SQL implementados

### Atividade 1 — Funções e Procedimentos

> Arquivo: `sql/02_functions_a1.sql`

| # | Objeto | Tipo | Entrada | Saída | Descrição |
|---|--------|------|---------|-------|-----------|
| 1 | `fu_validar_cadastro` | FUNCTION | `email VARCHAR` | `BOOLEAN` | `TRUE` se o e-mail já existe na base |
| 2 | `fu_validar_email` | FUNCTION | `email VARCHAR` | `BOOLEAN` | Valida formato via regex RFC 5322 |
| 3 | `fu_formatar_tempo_acesso` | FUNCTION | `ultimo_acesso TIMESTAMPTZ` | `VARCHAR` | Retorna tempo decorrido: "3 horas", "15 dias", "Nunca acessou" |
| 4 | `pr_excluir_usuario` | FUNCTION | `usuario_id INTEGER` | `BOOLEAN` | Exclui usuário; bloqueia se pertencer ao grupo Administrador |
| 5 | `fu_migrar_usuarios_grupo` | FUNCTION | `origem, destino VARCHAR` | `TABLE(nome, email, ultimo_acesso)` | Move todos os usuários da origem para o destino |
| 6 | `pr_copiar_grupo` | FUNCTION | `origem, novo_grupo VARCHAR` | `INTEGER` | Cria novo grupo com cópia das permissões; retorna qtd. habilitadas |
| 7 | `fu_verificar_engajamento` | FUNCTION | — | `TABLE(nome, email, ultimo_acesso, engajamento)` | Classifica usuários: Alto / Médio / Baixo / Inexistente |
| 8 | `pr_criar_usuario_adm` | FUNCTION | `email, nome_grupo VARCHAR` | `VOID` | Cria usuário admin com todas as funcionalidades habilitadas; usa `fu_validar_cadastro` |

### Atividade 2 — Triggers e Views

> Arquivo: `sql/03_triggers_views_a2.sql`

| # | Objeto | Tipo | Descrição |
|---|--------|------|-----------|
| 1 | `pr_remover_dependencia_usuario` | FUNCTION | Remove linhas de `usuario_papel` e `usuario_grupo` antes do DELETE |
| 2 | `tg_acionar_remocao_dependencia` | TRIGGER | BEFORE DELETE ON usuario — chama `pr_remover_dependencia_usuario` |
| 3 | `tg_fn_auditoria` + 9 triggers | TRIGGER | AFTER INSERT/UPDATE/DELETE em todas as tabelas — registra em `auditoria` |
| 4 | `vw_consulta_usuario` | VIEW | Usuários com grupos, papéis e tempo de acesso formatado |
| 5 | `vwm_consulta_usuario` | MATERIALIZED VIEW | Versão materializada de `vw_consulta_usuario` + UNIQUE INDEX(id) |
| 6/8 | `vw_consulta_grupo` | VIEW | Grupos com total de permissões habilitadas e total de usuários |
| 7/9 | `vmw_consulta_grupo` | MATERIALIZED VIEW | Versão materializada de `vw_consulta_grupo` + UNIQUE INDEX(id) |
| 10 | `vw_consulta_permissoes_grupo` | VIEW | CROSS JOIN grupo × funcionalidade com flag habilitado por grupo |
| 11 | `vmw_consulta_permissoes_grupo` | MATERIALIZED VIEW | Versão materializada + UNIQUE INDEX(grupo_id, funcionalidade_id) |
| 12 | Refresh automático a cada 2h | — | Duas alternativas documentadas: **pg_cron** e **crontab do SO** |

> As views materializadas usam `REFRESH MATERIALIZED VIEW CONCURRENTLY`, que exige o índice único. O backend também executa o refresh após cada operação de escrita.

---

## API REST

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/usuarios` | Lista usuários (suporta `?search=termo`) |
| `GET` | `/api/usuarios/:id` | Busca usuário por ID |
| `POST` | `/api/usuarios` | Cria usuário com grupos e papéis |
| `PUT` | `/api/usuarios/:id` | Atualiza usuário, grupos e papéis |
| `DELETE` | `/api/usuarios/:id` | Exclui usuário via `pr_excluir_usuario` |
| `POST` | `/api/usuarios/migrar` | Migra usuários entre grupos |
| `POST` | `/api/usuarios/admin` | Cria usuário administrador |
| `GET` | `/api/grupos` | Lista grupos com permissões e usuários |
| `GET` | `/api/grupos/:id` | Detalhe do grupo com permissões e membros |
| `POST` | `/api/grupos` | Cria grupo com permissões |
| `PUT` | `/api/grupos/:id` | Atualiza grupo, permissões e membros |
| `DELETE` | `/api/grupos/:id` | Exclui grupo (bloqueado se tiver usuários) |
| `POST` | `/api/grupos/copiar` | Copia grupo via `pr_copiar_grupo` |
| `GET` | `/api/grupos/permissoes/:id` | Matriz de permissões de um grupo |
| `GET` | `/api/papeis` | Lista papéis disponíveis |
| `GET` | `/api/funcionalidades` | Lista funcionalidades por módulo/categoria |
| `GET` | `/api/auditoria` | Últimas 100 entradas do log de auditoria |
| `GET` | `/api/engajamento` | Classificação de engajamento de todos os usuários |

---

## Estrutura do projeto

```
SISSA/
├── .gitignore
├── README.md                        # Este arquivo
├── EXPLICACAO_TAREFAS_SQL.md        # Código SQL completo + justificativas por item
├── test-runner.js                   # 91 testes automáticos (Node.js)
│
├── sql/
│   ├── 01_ddl.sql                   # Schema: tabelas e dados de carga
│   ├── 02_functions_a1.sql          # Atividade 1: funções e procedures PL/pgSQL
│   ├── 03_triggers_views_a2.sql     # Atividade 2: triggers, views e mat-views
│   └── 04_audit_assertions.sql      # 67 asserções SQL de auditoria
│
├── backend/
│   ├── .env.example                 # Template de variáveis de ambiente
│   ├── db.js                        # Pool de conexão PostgreSQL (pg)
│   ├── server.js                    # Servidor Express + rotas globais
│   └── routes/
│       ├── usuarios.js              # CRUD de usuários, migrar, admin
│       └── grupos.js                # CRUD de grupos, copiar, permissões
│
├── frontend/
│   └── index.html                   # SPA Vanilla JS (login, usuários, grupos, auditoria, engajamento)
│
└── docs_tarefas/
    ├── Atividade Avaliativa N2.A1_.pdf
    ├── Atividade Avaliativa N2.A2_.pdf
    └── Trabalho em Grupo N2.A1_.pdf
```

---

## Testes

### Testes automáticos (Node.js)

Cobre todas as funções, procedures, triggers, views e endpoints da API.

```bash
node test-runner.js
# → 91/91 testes passando
```

### Asserções SQL de auditoria

Prova que cada operação DML em cada tabela gera o registro correto em `auditoria`.

```bash
psql -U postgres -d sissa -f sql/04_audit_assertions.sql
# → 67/67 asserções passando
```

---

## Variáveis de ambiente

Copie `backend/.env.example` para `backend/.env` e preencha com suas credenciais:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=sissa
PGUSER=postgres
PGPASSWORD=sua_senha
PORT=3000
```

> O arquivo `.env` está no `.gitignore` e nunca deve ser commitado.

---

## Autores

| Nome | E-mail |
|------|--------|
| Thayckowisk Correia Campos | thayckowisk@discente.ufg.br |
| Thiago Honorato Ferreira | thiago.honorato@discente.ufg.br |

Disciplina: **Banco de Dados — N2** · Instituto de Informática · UFG

---

<div align="center">
  <sub>Desenvolvido para fins acadêmicos · UFG 2026</sub>
</div>
