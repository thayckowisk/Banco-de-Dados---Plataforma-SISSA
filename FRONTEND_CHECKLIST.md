# Frontend Validation Checklist — SISSA Platform
## `Banco-de-Dados---Plataforma-SISSA/index.html`

> **How to use:** Open the app at `http://localhost:3000`. Work through each item in order.
> Mark each item ✅ (pass) or ❌ (fail). Every button and modal is covered.
> Backend must be running and database must be seeded before starting.

---

## Pre-Flight

| # | Check | Expected | Result |
|---|-------|----------|--------|
| P1 | Open `http://localhost:3000` | Page loads, shows Login screen with blue gradient background | |
| P2 | Open DevTools Console (F12) | No JS errors on initial load | |
| P3 | Open DevTools Network tab | No failed requests on initial load | |

---

## Screen 1 — Login

**Element:** `#login` (the initial active screen)

| # | Action | Expected | Result |
|---|--------|----------|--------|
| L1 | Observe login page | Centered white card, blue gradient bg, robot/user SVG icon visible | |
| L2 | Observe "Entrar com Microsoft" button | Shows Microsoft logo (4-colored squares) + text, border visible | |
| L3 | Hover over the button | Background shifts to `#f7f7f7` (slight grey) | |
| L4 | **Click "Entrar com Microsoft"** | Button text changes to "Carregando...", button is disabled during fetch | |
| L5 | After data loads | Navigates to Screen 2 (Usuários tab), button re-enables | |
| L6 | If backend is offline | Toast appears: "Falha ao carregar dados." in red | |

---

## Screen 2 — Permissões > Usuários

**Element:** `#usuarios`

### 2A — Page Layout

| # | Action | Expected | Result |
|---|--------|----------|--------|
| U1 | Observe sidebar | 6 nav icons + 2 bottom icons (settings, logout), "Permissões" icon active (blue highlight) | |
| U2 | Observe header | "Permissões" title with icon | |
| U3 | Observe tabs | "Usuários" tab is underlined in blue, "Grupos" tab is grey | |

### 2B — Users Table

| # | Action | Expected | Result |
|---|--------|----------|--------|
| U4 | Observe user table | Columns: USUÁRIO, FUNCIONALIDADES, PAPEL, ÚLTIMO ACESSO, (actions) | |
| U5 | Observe users loaded | Rows populated dynamically from API (not hardcoded) | |
| U6 | Observe a user with long group list | Shows truncated text `"..."` in the FUNCIONALIDADES cell | |
| U7 | **Hover over truncated group cell** | Popup appears showing full group list; roles section below if applicable | |
| U8 | Observe user with `NULL` last access | Shows "Nunca acessou" in italic grey (`time-never` class) | |
| U9 | Observe user with recent access | Shows formatted time e.g. "3 horas", "30 minutos" | |

### 2C — Search

| # | Action | Expected | Result |
|---|--------|----------|--------|
| U10 | Click search input, type `adailton` | Table filters client-side to show only matching users | |
| U11 | Clear search input | All users reappear | |
| U12 | Type `zzz_nomatch_xyz` | Table shows "Nenhum usuário encontrado." row | |

### 2D — Add User Button → Modal

| # | Action | Expected | Result |
|---|--------|----------|--------|
| U13 | **Click "Adicionar usuário" button** | Modal `#modal-add-user` opens with dark backdrop | |
| U14 | Observe modal content | Shows user icon, "Adicionar usuário" title, E-mail field (required), Grupo checkboxes (required), Papel select (optional) | |
| U15 | Observe Grupo field | Populated with checkboxes from current groups (dynamic) | |
| U16 | Observe Papel field | `<select>` populated with current roles (dynamic) | |
| U17 | **Click outside modal (backdrop)** | Modal closes | |
| U18 | Re-open modal, **click "×" button** | Modal closes | |

### 2E — Add User — Validation

| # | Action | Expected | Result |
|---|--------|----------|--------|
| U19 | Open modal, leave email empty, **click "Adicionar"** | Email error appears: "E-mail inválido" (or similar) | |
| U20 | Type `notanemail`, click "Adicionar" | Email error shown, no API call made | |
| U21 | Type valid email, leave ALL groups unchecked, click "Adicionar" | Group error appears: "O campo grupo é obrigatório" | |
| U22 | Type invalid email AND leave groups unchecked | Both error messages show simultaneously | |

### 2F — Add User — Success

| # | Action | Expected | Result |
|---|--------|----------|--------|
| U23 | Type `qa_test@sissa.test`, check one group, click "Adicionar" | Button shows "Salvando...", becomes disabled | |
| U24 | After success | Modal closes, green toast "Usuário adicionado com sucesso!" appears | |
| U25 | Observe table | New user `qa_test@sissa.test` appears in the list | |
| U26 | Duplicate email | Open modal, use same email, click "Adicionar" → red toast "E-mail já cadastrado" | |

### 2G — Edit User

| # | Action | Expected | Result |
|---|--------|----------|--------|
| U27 | **Click the edit (pencil) icon** on any user row | Modal `#modal-edit-user` opens | |
| U28 | Observe modal pre-fill | Email field is pre-filled with the user's email | |
| U29 | Observe groups pre-checked | Groups the user belongs to are already checked | |
| U30 | Observe papel pre-selected | If user has a role, it is pre-selected in the dropdown | |
| U31 | Change email to `qa_updated@sissa.test`, click "Salvar" | Button shows "Salvando...", success toast shown | |
| U32 | Observe table after save | Updated email reflected in the table | |
| U33 | Try to save with empty email | Email error shown, no API call | |
| U34 | **Click "×" or "Cancelar"** | Modal closes without saving | |

### 2H — Delete User

| # | Action | Expected | Result |
|---|--------|----------|--------|
| U35 | **Click the trash icon** on a deletable user | `window.confirm` dialog appears: "Tem certeza que deseja excluir...?" | |
| U36 | Click "Cancel" on confirm | No deletion, table unchanged | |
| U37 | Click trash icon on `admin@ufg.br`, confirm deletion | Red toast: "Não foi possível excluir: usuário não existe ou é Administrador" | |
| U38 | Click trash icon on `qa_test@sissa.test`, confirm | Green toast "Usuário excluído com sucesso!", row disappears from table | |

### 2I — Sidebar Navigation (from Usuários screen)

| # | Action | Expected | Result |
|---|--------|----------|--------|
| U39 | **Click "Grupos" tab** (top tabs, not sidebar) | Navigates to Screen 3 (Grupos), tab highlight changes | |
| U40 | Click logout icon (bottom of sidebar `[→]`) | Returns to Login screen (Screen 1) | |

---

## Screen 3 — Permissões > Grupos

**Element:** `#grupos`

### 3A — Groups Table

| # | Action | Expected | Result |
|---|--------|----------|--------|
| G1 | Observe groups table | Columns: GRUPO, PERMISSÕES, USUÁRIOS | |
| G2 | Observe rows loaded | Groups from API; permission counts and user counts shown | |
| G3 | Observe `↗` badge in USUÁRIOS column | Styled in blue | |

### 3B — Search

| # | Action | Expected | Result |
|---|--------|----------|--------|
| G4 | Type `admin` in search | Only "Administrador" group shown | |
| G5 | Clear search | All groups shown | |
| G6 | Type `zzz_nomatch` | "Nenhum grupo encontrado." row shown | |

### 3C — Add Group Button

| # | Action | Expected | Result |
|---|--------|----------|--------|
| G7 | **Click "Adicionar grupo" button** | Navigates to Screen 4 (Adicionar grupo > Permissões tab) | |
| G8 | Click "Usuários" tab (top tabs) | Navigates to Screen 2 | |
| G9 | Click logout icon | Returns to Screen 1 | |

---

## Screen 4 — Adicionar Grupo > Permissões

**Element:** `#add-group-perms`

### 4A — Layout

| # | Action | Expected | Result |
|---|--------|----------|--------|
| A1 | Observe page title | "Adicionar grupo" with `+` icon | |
| A2 | Observe tabs | "Permissões" active (blue), "Usuários" grey | |
| A3 | Observe group name card | Text input with placeholder "Digite o nome do grupo" | |
| A4 | Observe EDITAIS section | Module header in all-caps, two sub-sections: "Seleção de editais" and "Análise de editais" | |
| A5 | Observe CONTRATOS section | Module header, sub-section "Consulta de CNPJ" with "Gerenciar consulta" row | |
| A6 | Count total toggle switches | 13 toggles total (5 + 7 + 1) | |

### 4B — Toggle Behavior

| # | Action | Expected | Result |
|---|--------|----------|--------|
| A7 | Observe some toggles on initial load | "Visualizar editais" starts ON (blue, thumb right) | |
| A8 | **Click an OFF toggle** | Toggle animates to ON state (blue background, thumb slides right) | |
| A9 | **Click an ON toggle** | Toggle animates to OFF state (grey background, thumb slides left) | |
| A10 | Inspect toggle element in DevTools | Has `data-funcionalidade-id` attribute with numeric ID (1–13) | |

### 4C — Validation & Submission

| # | Action | Expected | Result |
|---|--------|----------|--------|
| A11 | Leave name empty, **click "Adicionar"** | Red toast "Informe o nome do grupo.", cursor focuses on input | |
| A12 | Type `QA Test Group`, toggle some permissions ON, **click "Adicionar"** | Button shows "Salvando...", becomes disabled | |
| A13 | After success | Green toast "Grupo criado com sucesso!", navigates to Screen 3 (Grupos list) | |
| A14 | Observe Grupos table | `QA Test Group` appears with correct permission count | |
| A15 | Try duplicate name | Red toast "Grupo com este nome já existe" (409 from API) | |

### 4D — Cancel

| # | Action | Expected | Result |
|---|--------|----------|--------|
| A16 | **Click "Cancelar" button** | Navigates back to Screen 3 (Grupos), no data saved | |

### 4E — Tab Navigation

| # | Action | Expected | Result |
|---|--------|----------|--------|
| A17 | **Click "Usuários" tab** | Navigates to Screen 5 (Adicionar grupo > Usuários), keeping entered name | |

---

## Screen 5 — Adicionar Grupo > Usuários

**Element:** `#add-group-users`

### 5A — Layout & Dynamic List

| # | Action | Expected | Result |
|---|--------|----------|--------|
| B1 | Observe page title | "Adicionar grupo" with `+` icon | |
| B2 | Observe tabs | "Usuários" tab active (blue), "Permissões" grey | |
| B3 | Observe user list | Dynamically populated from `state.usuarios` (not hardcoded) | |
| B4 | Observe each user item | Shows name (bold) + email, plus groups line below if they have groups | |
| B5 | Observe "+N" badge | Users with more than 3 groups show `+N` overflow label in blue | |

### 5B — Checkbox Interaction

| # | Action | Expected | Result |
|---|--------|----------|--------|
| B6 | **Click a user checkbox** | Checkbox becomes checked | |
| B7 | **Click the user row label** | Also toggles the checkbox (label is linked via `for` attribute) | |
| B8 | Check multiple users | Multiple checkboxes can be selected simultaneously | |

### 5C — "Adicionar usuário" link

| # | Action | Expected | Result |
|---|--------|----------|--------|
| B9 | **Click "Adicionar usuário" link** (top right of user list card) | Opens `#modal-add-user` modal (same modal as Screen 2) | |
| B10 | Add a new user through this modal | After success, user appears in the checkbox list | |

### 5D — Submit & Cancel

| # | Action | Expected | Result |
|---|--------|----------|--------|
| B11 | Check some users, **click "Adicionar"** | Calls `submitAddGroupFromUsers()`, which calls `submitAddGroup()` — same submission as Screen 4 | |
| B12 | After success | Green toast, navigates to Screen 3, grupo_funcionalidade AND usuario_grupo rows created in DB | |
| B13 | **Click "Cancelar"** | Navigates to Screen 3, no data saved | |

### 5E — Tab Navigation

| # | Action | Expected | Result |
|---|--------|----------|--------|
| B14 | **Click "Permissões" tab** | Navigates back to Screen 4, group name input preserved | |
| B15 | Click logout icon | Returns to Screen 1 | |

---

## Toast Notification System

| # | Scenario | Expected | Result |
|---|----------|----------|--------|
| T1 | Successful user creation | Green toast with "✓" or success message, bottom-right corner | |
| T2 | Failed action (e.g. duplicate) | Red toast with error message | |
| T3 | Toast auto-dismisses | Toast disappears after ~3 seconds without interaction | |
| T4 | Multiple rapid actions | Previous toast replaced or stacked correctly (no overflow) | |

---

## Skeleton / Loading States

| # | Scenario | Expected | Result |
|---|----------|----------|--------|
| S1 | Initial login while data loads | Skeleton placeholder rows show in tables (pulsing grey bars) | |
| S2 | After load completes | Skeleton rows replaced with real data | |

---

## Cross-Screen Consistency

| # | Check | Expected | Result |
|---|-------|----------|--------|
| X1 | After adding a user from Screen 2 → check Screen 3 | Group's `total_usuarios` count increments | |
| X2 | After deleting a user from Screen 2 → check Screen 3 | Group's `total_usuarios` count decrements | |
| X3 | After adding a group from Screen 4 → check Screen 2 → open "Adicionar usuário" modal | New group appears in the modal's group checkbox list | |
| X4 | Navigate Login → Usuários → Grupos → back to Usuários | Tabs and data remain consistent | |
| X5 | All sidebar icons are inert (no navigation except logout) | Clicking other sidebar icons does not navigate away or cause errors | |

---

## Error / Edge Cases

| # | Scenario | Expected | Result |
|---|----------|----------|--------|
| E1 | Backend goes offline mid-session, then attempt any action | Red toast "Erro de conexão..." appears, app remains functional | |
| E2 | Open two tabs, add user in one | Second tab does not auto-refresh (expected — no WS) | |
| E3 | XSS attempt: add user with email `<script>alert(1)</script>@test.com` | Email rejected by frontend validation; if somehow stored, rendered as escaped `&lt;script&gt;` | |
| E4 | Very long group name in Grupos table | Name wraps or truncates gracefully, layout not broken | |

---

## Cleanup After QA Session

After completing all checklist items, remove test data:

```bash
# From project root
node -e "
const { Pool } = require('./backend/node_modules/pg');
const p = new Pool({ database: 'sissa', user: 'postgres', password: 'postgres' });
(async () => {
  await p.query(\"DELETE FROM usuario WHERE email LIKE 'qa_%'\");
  await p.query(\"DELETE FROM grupo_funcionalidade WHERE grupo_id IN (SELECT id FROM grupo WHERE nome LIKE 'QA %')\");
  await p.query(\"DELETE FROM grupo WHERE nome LIKE 'QA %'\");
  console.log('QA data cleaned.');
  await p.end();
})();
"
```

---

## Summary Scorecard

| Screen | Total Checks | Passed | Failed |
|--------|-------------|--------|--------|
| Pre-flight | 3 | | |
| Screen 1 — Login | 6 | | |
| Screen 2 — Usuários (Layout) | 3 | | |
| Screen 2 — Table | 6 | | |
| Screen 2 — Search | 3 | | |
| Screen 2 — Add User Modal | 6 | | |
| Screen 2 — Validation | 4 | | |
| Screen 2 — Success/Duplicate | 4 | | |
| Screen 2 — Edit User | 8 | | |
| Screen 2 — Delete User | 4 | | |
| Screen 2 — Navigation | 2 | | |
| Screen 3 — Grupos Table | 3 | | |
| Screen 3 — Search | 3 | | |
| Screen 3 — Navigation | 3 | | |
| Screen 4 — Layout | 6 | | |
| Screen 4 — Toggles | 4 | | |
| Screen 4 — Validation & Submit | 5 | | |
| Screen 4 — Cancel & Tabs | 2 | | |
| Screen 5 — Layout | 5 | | |
| Screen 5 — Checkboxes | 3 | | |
| Screen 5 — Add User Link | 2 | | |
| Screen 5 — Submit & Cancel | 3 | | |
| Screen 5 — Navigation | 2 | | |
| Toast System | 4 | | |
| Loading States | 2 | | |
| Cross-Screen | 5 | | |
| Error Cases | 4 | | |
| **TOTAL** | **105** | | |
