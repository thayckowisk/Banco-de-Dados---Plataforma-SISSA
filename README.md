# Plataforma SISSA — Módulo de Controle de Acesso

Projeto da disciplina de Banco de Dados (N2) — UFG  
Aluno: Thiago Honorato Ferreira | thiago.honorato@discente.ufg.br

---

## Acesso ao sistema

| Conta | E-mail | Senha | Perfil |
|-------|--------|-------|--------|
| Administrador | `admin@gmail.com` | `admin` | Acesso total: criar, editar e excluir usuários e grupos |
| Usuário comum | `user@gmail.com` | `user` | Somente leitura: visualiza usuários e grupos |

---

## O que é o SISSA

SISSA é uma plataforma de controle de acesso que gerencia **usuários**, **grupos** e **permissões** (funcionalidades). O sistema permite:

- Cadastrar e gerenciar usuários com grupos e papéis
- Criar grupos com conjuntos de permissões habilitadas
- Visualizar engajamento dos usuários (último acesso)
- Auditoria automática de todas as operações no banco de dados
- Migrar usuários entre grupos
- Copiar grupos com suas permissões

---

## Pré-requisitos

- **PostgreSQL 14+** (Homebrew no macOS: `brew install postgresql@15`)
- **Node.js 18+** (`brew install node`)
- **psql** disponível no PATH

---

## Como rodar

### 1. Criar o banco de dados

```bash
createdb sissa
```

### 2. Executar os scripts SQL em ordem

```bash
psql -d sissa -f sql/01_ddl.sql
psql -d sissa -f sql/02_functions_a1.sql
psql -d sissa -f sql/03_triggers_views_a2.sql
```

> **macOS (Homebrew):** O superusuário padrão é o seu nome de usuário do sistema, sem senha. Caso necessário, passe `-U seu_usuario`.

### 3. Instalar dependências e iniciar o backend

```bash
cd backend
npm install
node server.js
```

O servidor sobe em **http://localhost:3000**

### 4. Acessar o frontend

Abra o navegador em **http://localhost:3000** e faça login com uma das contas acima.

---

## Estrutura do projeto

```
Trabalhov2/
├── sql/
│   ├── 01_ddl.sql                  # Schema: tabelas e dados iniciais
│   ├── 02_functions_a1.sql         # Atividade 1: funções e procedures PL/pgSQL
│   ├── 03_triggers_views_a2.sql    # Atividade 2: triggers e views
│   └── 04_audit_assertions.sql     # Testes de auditoria (asserções SQL)
├── backend/
│   ├── db.js                       # Conexão com PostgreSQL (pg pool)
│   ├── server.js                   # Servidor Express
│   └── routes/
│       ├── usuarios.js             # CRUD de usuários
│       └── grupos.js               # CRUD de grupos e permissões
├── Banco-de-Dados---Plataforma-SISSA/
│   └── index.html                  # Frontend SPA (Vanilla JS)
└── test-runner.js                  # Testes automáticos (Node.js)
```

---

## Funcionalidades do sistema

### Login
- Tela de login com e-mail e senha
- Conta admin vê todos os botões de ação (criar, editar, excluir)
- Conta usuário comum tem apenas leitura (botões de ação ocultos via CSS)

### Tela Usuários
- Lista todos os usuários cadastrados com e-mail, nome, grupos, papéis e último acesso formatado
- Campo de busca por e-mail ou nome
- **Admin:** botões para adicionar, editar e excluir usuários
- Exclusão bloqueada para usuários do grupo "Administrador"

### Tela Grupos
- Lista grupos com total de permissões habilitadas e total de usuários
- Coluna **Usuários** exibe um badge clicável que abre um **popup flutuante** com os membros do grupo
- **Admin:** botões para adicionar e editar grupos com suas permissões

### Engajamento
- Classifica usuários por frequência de acesso: **Alto** (≤2 dias), **Médio** (≤7 dias), **Baixo** (≤30 dias), **Inexistente**

---

## Banco de dados — Arquitetura

### Tabelas principais

| Tabela | Descrição |
|--------|-----------|
| `usuario` | Usuários da plataforma |
| `grupo` | Grupos de acesso |
| `papel` | Papéis (roles) |
| `funcionalidade` | Funcionalidades do sistema |
| `categoria_funcionalidade` | Categoria de funcionalidades |
| `modulo` | Módulos do sistema |
| `usuario_grupo` | Associação usuário ↔ grupo |
| `usuario_papel` | Associação usuário ↔ papel |
| `grupo_funcionalidade` | Permissões de grupo (habilitado/desabilitado) |
| `auditoria` | Registro automático de todas as operações |

### Atividade 1 — Funções e Procedures (`02_functions_a1.sql`)

| Objeto | Tipo | Descrição |
|--------|------|-----------|
| `fu_validar_cadastro(email)` | FUNCTION | Verifica se e-mail já existe |
| `fu_validar_email(email)` | FUNCTION | Valida formato de e-mail (regex RFC) |
| `fu_formatar_tempo_acesso(ts)` | FUNCTION | Retorna tempo decorrido em português (ex: "3 horas") |
| `pr_excluir_usuario(id)` | FUNCTION | Exclui usuário (bloqueia se for Administrador) |
| `fu_migrar_usuarios_grupo(origem, destino)` | FUNCTION | Move todos os usuários de um grupo para outro |
| `pr_copiar_grupo(origem, novo)` | FUNCTION | Cria cópia de um grupo com todas as permissões |
| `fu_verificar_engajamento()` | FUNCTION | Classifica todos os usuários por engajamento |
| `pr_criar_usuario_adm(email, grupo)` | FUNCTION | Cria usuário administrador com todas as permissões |

### Atividade 2 — Triggers e Views (`03_triggers_views_a2.sql`)

| Objeto | Tipo | Descrição |
|--------|------|-----------|
| `tg_acionar_remocao_dependencia` | TRIGGER | Remove vínculos (grupos/papéis) antes de deletar usuário |
| `tg_fn_auditoria` + triggers em 9 tabelas | TRIGGER | Registra INSERT/UPDATE/DELETE automaticamente na tabela `auditoria` |
| `vw_consulta_usuario` | VIEW | Usuários com grupos, papéis e último acesso formatado |
| `vwm_consulta_usuario` | MATERIALIZED VIEW | Versão materializada para performance |
| `vw_consulta_grupo` | VIEW | Grupos com total de permissões e usuários |
| `vmw_consulta_grupo` | MATERIALIZED VIEW | Versão materializada |
| `vw_consulta_permissoes_grupo` | VIEW | Todas as funcionalidades × grupos (CROSS JOIN) |
| `vmw_consulta_permissoes_grupo` | MATERIALIZED VIEW | Versão materializada |

---

## API REST

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/usuarios` | Lista usuários (aceita `?search=termo`) |
| GET | `/api/usuarios/:id` | Busca usuário por ID |
| POST | `/api/usuarios` | Cria usuário com grupos e papéis |
| PUT | `/api/usuarios/:id` | Atualiza usuário |
| DELETE | `/api/usuarios/:id` | Exclui usuário |
| POST | `/api/usuarios/migrar` | Migra usuários entre grupos |
| POST | `/api/usuarios/admin` | Cria usuário administrador |
| GET | `/api/grupos` | Lista grupos |
| GET | `/api/grupos/:id` | Busca grupo com seus usuários e permissões |
| POST | `/api/grupos` | Cria grupo |
| PUT | `/api/grupos/:id` | Atualiza grupo e permissões |
| DELETE | `/api/grupos/:id` | Exclui grupo |
| POST | `/api/grupos/copiar` | Copia grupo com permissões |
| GET | `/api/papeis` | Lista papéis |
| GET | `/api/funcionalidades` | Lista funcionalidades organizadas por módulo |
| GET | `/api/auditoria` | Últimas 100 entradas de auditoria |
| GET | `/api/engajamento` | Engajamento de todos os usuários |

---

## Testes

### Testes automáticos (Node.js + API)

```bash
node test-runner.js
```

Executa 91 testes cobrindo funções SQL, procedures, triggers, views e todos os endpoints da API.

### Asserções SQL de auditoria

```bash
psql -d sissa -f sql/04_audit_assertions.sql
```

Executa 67 asserções diretamente no banco verificando o comportamento da tabela de auditoria.

---

## Variáveis de ambiente (opcionais)

Crie um arquivo `.env` dentro de `backend/` para sobrescrever as configurações padrão:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=sissa
PGUSER=seu_usuario
PGPASSWORD=sua_senha
PORT=3000
```
