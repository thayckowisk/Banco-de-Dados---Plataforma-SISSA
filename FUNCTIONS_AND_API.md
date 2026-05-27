# FUNCTIONS_AND_API.md — SISSA Platform: Access Control Module

---

## Section 1: PostgreSQL Functions & Procedures (Activity 1)

### 1. `fu_validar_cadastro`

| | |
|---|---|
| **Signature** | `fu_validar_cadastro(p_email VARCHAR) RETURNS BOOLEAN` |
| **Description** | Checks whether an email is already registered in the `usuario` table (case-insensitive). |
| **Parameters** | `p_email` — the email address to look up |
| **Returns** | `TRUE` if the email exists, `FALSE` otherwise |

```sql
-- Example
SELECT fu_validar_cadastro('admin@ufg.br');
-- Returns: TRUE / FALSE
```

---

### 2. `fu_validar_email`

| | |
|---|---|
| **Signature** | `fu_validar_email(p_email VARCHAR) RETURNS BOOLEAN` |
| **Description** | Validates whether a string conforms to RFC email format rules using a regex. |
| **Parameters** | `p_email` — raw string typed by the user |
| **Returns** | `TRUE` if valid format, `FALSE` if malformed |

```sql
-- Examples
SELECT fu_validar_email('user@empresa.com.br');  -- TRUE
SELECT fu_validar_email('not-an-email');          -- FALSE
```

---

### 3. `fu_formatar_tempo_acesso`

| | |
|---|---|
| **Signature** | `fu_formatar_tempo_acesso(p_ultimo_acesso TIMESTAMP) RETURNS VARCHAR` |
| **Description** | Converts a timestamp into a human-readable elapsed time string in Portuguese. Handles NULL (never accessed). |
| **Parameters** | `p_ultimo_acesso` — last access timestamp (nullable) |
| **Returns** | Formatted string: e.g. `'3 segundos'`, `'10 minutos'`, `'5 horas'`, `'15 dias'`, `'3 meses'`, `'2 anos'`, `'Nunca acessou'` |

```sql
-- Example
SELECT fu_formatar_tempo_acesso(NOW() - INTERVAL '3 hours');
-- Returns: '3 horas'

SELECT fu_formatar_tempo_acesso(NULL);
-- Returns: 'Nunca acessou'
```

---

### 4. `pr_excluir_usuario`

| | |
|---|---|
| **Signature** | `pr_excluir_usuario(p_usuario_id INTEGER) RETURNS BOOLEAN` |
| **Description** | Deletes a user if they exist and do not belong to the 'Administrador' group. Returns `FALSE` on any blocking condition. The BEFORE DELETE trigger removes FK dependencies first. |
| **Parameters** | `p_usuario_id` — PK of the user to delete |
| **Returns** | `TRUE` if deleted successfully, `FALSE` if blocked (not found / admin group) |

```sql
-- Example
SELECT pr_excluir_usuario(5);
-- Returns: TRUE / FALSE
```

---

### 5. `fu_migrar_usuarios_grupo`

| | |
|---|---|
| **Signature** | `fu_migrar_usuarios_grupo(p_grupo_origem VARCHAR, p_grupo_destino VARCHAR) RETURNS TABLE(nome VARCHAR, email VARCHAR, ultimo_acesso TIMESTAMP)` |
| **Description** | Moves all users from the origin group to the destination group. Returns the list of migrated users. Raises an EXCEPTION if either group does not exist. |
| **Parameters** | `p_grupo_origem` — name of the source group; `p_grupo_destino` — name of the destination group |
| **Returns** | TABLE with one row per migrated user: nome, email, ultimo_acesso |

```sql
-- Example
SELECT * FROM fu_migrar_usuarios_grupo('Seleção de editais', 'Análise de editais');
```

---

### 6. `pr_copiar_grupo`

| | |
|---|---|
| **Signature** | `pr_copiar_grupo(p_grupo_origem VARCHAR, p_novo_grupo VARCHAR) RETURNS INTEGER` |
| **Description** | Creates a new group as an exact copy of an existing group, including all its `grupo_funcionalidade` rows. |
| **Parameters** | `p_grupo_origem` — name of the existing group; `p_novo_grupo` — name for the new group |
| **Returns** | Count of permissions with `habilitado = TRUE` in the new group |

```sql
-- Example
SELECT pr_copiar_grupo('Seleção de editais', 'Seleção de editais - Cópia');
-- Returns: 8 (number of enabled permissions copied)
```

---

### 7. `fu_verificar_engajamento`

| | |
|---|---|
| **Signature** | `fu_verificar_engajamento() RETURNS TABLE(nome VARCHAR, email VARCHAR, ultimo_acesso TIMESTAMP, engajamento VARCHAR)` |
| **Description** | Returns all users classified by engagement level based on last access date. |
| **Returns** | TABLE ordered by engagement level (Alto → Inexistente) then last access descending |

| Level | Condition |
|-------|-----------|
| `Alto` | accessed within last 2 days |
| `Médio` | accessed within last 7 days |
| `Baixo` | accessed within last 30 days |
| `Inexistente` | never accessed OR more than 30 days ago |

```sql
-- Example
SELECT * FROM fu_verificar_engajamento();
```

---

### 8. `pr_criar_usuario_adm`

| | |
|---|---|
| **Signature** | `pr_criar_usuario_adm(p_email VARCHAR DEFAULT 'admin@ufg.br', p_nome_grupo VARCHAR DEFAULT 'Administrador') RETURNS VOID` |
| **Description** | Creates an admin user and group if they do not exist. Enables ALL functionalities for the group and links the user to it. Uses `fu_validar_cadastro` to prevent duplicate user creation. |
| **Parameters** | `p_email` — admin email (default: admin@ufg.br); `p_nome_grupo` — group name (default: Administrador) |

```sql
-- Example
SELECT pr_criar_usuario_adm('admin@ufg.br', 'Administrador');
```

---

## Section 2: PostgreSQL Triggers & Views (Activity 2)

### Procedures

| Object | Description |
|--------|-------------|
| `pr_remover_dependencia_usuario(id)` | Deletes all `usuario_papel` and `usuario_grupo` rows for a given user ID. Called by the deletion trigger. |

### Triggers

| Trigger | Table | Timing | Event | Description |
|---------|-------|--------|-------|-------------|
| `tg_acionar_remocao_dependencia` | `usuario` | BEFORE | DELETE | Calls `pr_remover_dependencia_usuario(OLD.id)` so FK constraints are satisfied before the row is removed. |
| `tg_audit_modulo` | `modulo` | AFTER | INSERT, UPDATE, DELETE | Writes to `auditoria`. |
| `tg_audit_categoria_funcionalidade` | `categoria_funcionalidade` | AFTER | INSERT, UPDATE, DELETE | Writes to `auditoria`. |
| `tg_audit_funcionalidade` | `funcionalidade` | AFTER | INSERT, UPDATE, DELETE | Writes to `auditoria`. |
| `tg_audit_usuario` | `usuario` | AFTER | INSERT, UPDATE, DELETE | Writes to `auditoria`. |
| `tg_audit_grupo` | `grupo` | AFTER | INSERT, UPDATE, DELETE | Writes to `auditoria`. |
| `tg_audit_papel` | `papel` | AFTER | INSERT, UPDATE, DELETE | Writes to `auditoria`. |
| `tg_audit_usuario_grupo` | `usuario_grupo` | AFTER | INSERT, UPDATE, DELETE | Writes to `auditoria`. |
| `tg_audit_usuario_papel` | `usuario_papel` | AFTER | INSERT, UPDATE, DELETE | Writes to `auditoria`. |
| `tg_audit_grupo_funcionalidade` | `grupo_funcionalidade` | AFTER | INSERT, UPDATE, DELETE | Writes to `auditoria`. |

### Views & Materialized Views

| Object | Type | Purpose |
|--------|------|---------|
| `vw_consulta_usuario` | VIEW | User list: id, email, nome, ultimo_acesso, ultimo_acesso_fmt, grupos (comma-sep), papeis (comma-sep) |
| `vwm_consulta_usuario` | MATERIALIZED VIEW | Cached user list (UNIQUE INDEX on id). Refresh after every user write. |
| `vw_consulta_grupo` | VIEW | Group list: id, nome, total_permissoes (enabled count), total_usuarios |
| `vmw_consulta_grupo` | MATERIALIZED VIEW | Cached group list (UNIQUE INDEX on id). |
| `vw_consulta_permissoes_grupo` | VIEW | Full cross join of grupos × funcionalidades with habilitado flag per combination |
| `vmw_consulta_permissoes_grupo` | MATERIALIZED VIEW | Cached permissions matrix (UNIQUE INDEX on grupo_id, funcionalidade_id). |

---

## Section 3: REST API Endpoints

Base URL: `http://localhost:3000`

---

### Users

#### `GET /api/usuarios`
List all users from `vwm_consulta_usuario`.

| Query param | Type | Description |
|-------------|------|-------------|
| `search` | string | Optional filter on email or nome (case-insensitive LIKE) |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 2,
      "email": "adailton@positivo.com.br",
      "nome": "Adailton Araújo",
      "ultimo_acesso": "2026-05-27T09:00:00Z",
      "ultimo_acesso_fmt": "3 horas",
      "grupos": "Cadastro de contratos, Seleção de editais",
      "papeis": "Analista de proposta"
    }
  ]
}
```

---

#### `GET /api/usuarios/:id`
Get single user by ID from `vw_consulta_usuario`.

**Response 200:** `{ success, data: { ...userRow } }`  
**Response 404:** `{ success: false, error: "Usuário não encontrado" }`

---

#### `POST /api/usuarios`
Create a new user.

**Request body:**
```json
{
  "email": "novo@empresa.com.br",
  "grupo_ids": [2, 5],
  "papel_ids": [1]
}
```

**Validations:** email format (`fu_validar_email`), duplicate check (`fu_validar_cadastro`), group required.

| Status | Meaning |
|--------|---------|
| 201 | Created — `{ success: true, data: { id } }` |
| 400 | Validation error (invalid email / missing group) |
| 409 | Duplicate email |
| 500 | Server error |

---

#### `PUT /api/usuarios/:id`
Update user email, groups, and roles.

**Request body:** same as POST. Groups and roles are fully replaced.

| Status | Meaning |
|--------|---------|
| 200 | Updated — `{ success: true }` |
| 400 | Validation error |
| 404 | User not found |
| 500 | Server error |

---

#### `DELETE /api/usuarios/:id`
Delete a user. Calls `pr_excluir_usuario`. Blocked if user is in the Administrador group.

| Status | Meaning |
|--------|---------|
| 200 | Deleted — `{ success: true }` |
| 403 | Cannot delete (admin group or other restriction) |
| 500 | Server error |

---

#### `POST /api/usuarios/migrar`
Migrate all users from one group to another.

**Request body:** `{ "grupo_origem": "Seleção de editais", "grupo_destino": "Análise de editais" }`  
**Response 200:** `{ success: true, data: [{ nome, email, ultimo_acesso }] }` — list of migrated users.

---

#### `POST /api/usuarios/admin`
Create admin user and group.

**Request body:** `{ "email": "admin@ufg.br", "nome_grupo": "Administrador" }`  
**Response 200:** `{ success: true }`

---

#### `GET /api/usuarios/engajamento/lista`
Returns users classified by engagement level.

**Response 200:** `{ success: true, data: [{ nome, email, ultimo_acesso, engajamento }] }`

---

### Groups

#### `GET /api/grupos`
List all groups from `vmw_consulta_grupo`.

| Query param | Description |
|-------------|-------------|
| `search` | Filter by group name |

**Response 200:** `{ success: true, data: [{ id, nome, total_permissoes, total_usuarios }] }`

---

#### `GET /api/grupos/:id`
Get group details including permissions and linked users.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 4,
    "nome": "Liderança de editais",
    "total_permissoes": 12,
    "total_usuarios": 2,
    "permissoes": [{ "funcionalidade_id": 1, "funcionalidade": "Visualizar editais", "habilitado": true, ... }],
    "usuarios": [{ "id": 2, "email": "adailton@positivo.com.br", "nome": "Adailton Araújo" }]
  }
}
```

---

#### `POST /api/grupos`
Create a new group with permissions and optionally link users.

**Request body:**
```json
{
  "nome": "Novo Grupo",
  "permissoes": [
    { "funcionalidade_id": 1, "habilitado": true },
    { "funcionalidade_id": 2, "habilitado": false }
  ],
  "usuario_ids": [2, 3]
}
```

| Status | Meaning |
|--------|---------|
| 201 | Created — `{ success: true, data: { id } }` |
| 400 | Missing name |
| 409 | Group name already exists |

---

#### `PUT /api/grupos/:id`
Update group name, permissions, and users (users are fully replaced).

**Request body:** same as POST.

| Status | Meaning |
|--------|---------|
| 200 | Updated — `{ success: true }` |
| 404 | Group not found |

---

#### `DELETE /api/grupos/:id`
Delete a group. Blocked if users are still linked to it.

| Status | Meaning |
|--------|---------|
| 200 | Deleted — `{ success: true }` |
| 403 | Users still linked to this group |
| 404 | Group not found |

---

#### `POST /api/grupos/copiar`
Copy an existing group (with all its permissions) under a new name. Calls `pr_copiar_grupo`.

**Request body:** `{ "grupo_origem": "Seleção de editais", "novo_grupo": "Seleção de editais - Cópia" }`  
**Response 200:** `{ success: true, data: { total_habilitadas: 8 } }`

---

#### `GET /api/grupos/permissoes/:id`
Get the full permissions matrix for a specific group.

**Response 200:** `{ success: true, data: [{ grupo_id, grupo_nome, modulo, categoria, funcionalidade_id, funcionalidade, habilitado }] }`

---

### Other Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/papeis` | List all roles: `[{ id, nome }]` |
| `GET` | `/api/funcionalidades` | List all features with modulo+categoria: `[{ id, nome, categoria, categoria_id, modulo, modulo_id }]` |
| `GET` | `/api/auditoria` | Last 100 audit entries: `[{ id, data_hora, nome_entidade, operacao }]` |
| `GET` | `/api/engajamento` | Engagement classification (alias for `fu_verificar_engajamento()`) |
| `GET` | `/health` | Health check: `{ status: "ok", timestamp }` |

---

## Running the Application

### 1. Setup database
```bash
psql -U postgres -c "CREATE DATABASE sissa;"
psql -U postgres -d sissa -f sql/01_ddl.sql
psql -U postgres -d sissa -f sql/02_functions_a1.sql
psql -U postgres -d sissa -f sql/03_triggers_views_a2.sql
```

### 2. Install dependencies and start backend
```bash
cd backend
npm install
npm start
# Server running at http://localhost:3000
```

### 3. Open the frontend
Navigate to `http://localhost:3000` in your browser — the backend serves the frontend automatically.
