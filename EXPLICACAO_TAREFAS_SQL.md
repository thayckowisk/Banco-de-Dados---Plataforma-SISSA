# Explicação técnica — Tarefas A1 e A2

Disciplina: **Banco de Dados (N2) — UFG**
Aluno: **Thiago Honorato Ferreira** — thiago.honorato@discente.ufg.br
Projeto: **Plataforma SISSA — Módulo de Controle de Acesso**

Este documento contém **todo o código SQL** das atividades avaliativas N2.A1 (funções e procedimentos) e N2.A2 (triggers e views), acompanhado da justificativa de **por que cada objeto atende aos requisitos impostos nos PDFs**.

Os arquivos de referência são:

- `sql/01_ddl.sql` — schema (DDL) + dados de carga
- `sql/02_functions_a1.sql` — Atividade 1
- `sql/03_triggers_views_a2.sql` — Atividade 2

---

## Sumário

- [Modelagem (DDL) — base para A1 e A2](#modelagem-ddl--base-para-a1-e-a2)
- [Atividade 1 — Funções e Procedimentos](#atividade-1--funções-e-procedimentos)
  - [1. `fu_validar_cadastro`](#1-fu_validar_cadastro)
  - [2. `fu_validar_email`](#2-fu_validar_email)
  - [3. `fu_formatar_tempo_acesso`](#3-fu_formatar_tempo_acesso)
  - [4. `pr_excluir_usuario`](#4-pr_excluir_usuario)
  - [5. `fu_migrar_usuarios_grupo`](#5-fu_migrar_usuarios_grupo)
  - [6. `pr_copiar_grupo`](#6-pr_copiar_grupo)
  - [7. `fu_verificar_engajamento`](#7-fu_verificar_engajamento)
  - [8. `pr_criar_usuario_adm`](#8-pr_criar_usuario_adm)
- [Atividade 2 — Triggers e Views](#atividade-2--triggers-e-views)
  - [1. `pr_remover_dependencia_usuario`](#1-pr_remover_dependencia_usuario)
  - [2. `tg_acionar_remocao_dependencia`](#2-tg_acionar_remocao_dependencia)
  - [3. Tabela `auditoria` + triggers em todas as tabelas](#3-tabela-auditoria--triggers-em-todas-as-tabelas)
  - [4. `vw_consulta_usuario`](#4-vw_consulta_usuario)
  - [5. `vwm_consulta_usuario` (materializada)](#5-vwm_consulta_usuario-materializada)
  - [6 e 8. `vw_consulta_grupo`](#6-e-8-vw_consulta_grupo)
  - [7 e 9. `vmw_consulta_grupo` (materializada)](#7-e-9-vmw_consulta_grupo-materializada)
  - [10. `vw_consulta_permissoes_grupo`](#10-vw_consulta_permissoes_grupo)
  - [11. `vmw_consulta_permissoes_grupo` (materializada)](#11-vmw_consulta_permissoes_grupo-materializada)
  - [12. Atualização automática das views materializadas a cada 2h](#12-atualização-automática-das-views-materializadas-a-cada-2h)

---

## Modelagem (DDL) — base para A1 e A2

O Anexo descreve três telas (login, gerenciar usuários, gerenciar grupos e permissões). A modelagem precisa representar **módulos → categorias → funcionalidades**, **usuários**, **grupos**, **papéis**, e os relacionamentos N:N entre eles. Além disso, o item 4 da A1 exige que **a exclusão NÃO seja em cascata** — portanto **todas as FKs usam `ON DELETE RESTRICT`** e a remoção das dependências é feita explicitamente pela trigger da A2.

```sql
CREATE TABLE modulo (
    id   SERIAL       PRIMARY KEY,
    nome VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE categoria_funcionalidade (
    id        SERIAL       PRIMARY KEY,
    nome      VARCHAR(150) NOT NULL,
    modulo_id INTEGER      NOT NULL,
    CONSTRAINT fk_catfunc_modulo
        FOREIGN KEY (modulo_id) REFERENCES modulo(id) ON DELETE RESTRICT
);

CREATE TABLE funcionalidade (
    id           SERIAL       PRIMARY KEY,
    nome         VARCHAR(200) NOT NULL,
    categoria_id INTEGER      NOT NULL,
    CONSTRAINT fk_func_categoria
        FOREIGN KEY (categoria_id) REFERENCES categoria_funcionalidade(id) ON DELETE RESTRICT
);

CREATE TABLE usuario (
    id            SERIAL       PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    nome          VARCHAR(255),
    ultimo_acesso TIMESTAMP,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE grupo (
    id         SERIAL       PRIMARY KEY,
    nome       VARCHAR(150) NOT NULL UNIQUE,
    created_at TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE papel (
    id   SERIAL       PRIMARY KEY,
    nome VARCHAR(150) NOT NULL UNIQUE
);

CREATE TABLE usuario_grupo (
    usuario_id INTEGER NOT NULL,
    grupo_id   INTEGER NOT NULL,
    CONSTRAINT pk_usuario_grupo PRIMARY KEY (usuario_id, grupo_id),
    CONSTRAINT fk_ug_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE RESTRICT,
    CONSTRAINT fk_ug_grupo   FOREIGN KEY (grupo_id)   REFERENCES grupo(id)   ON DELETE RESTRICT
);

CREATE TABLE usuario_papel (
    usuario_id INTEGER NOT NULL,
    papel_id   INTEGER NOT NULL,
    CONSTRAINT pk_usuario_papel PRIMARY KEY (usuario_id, papel_id),
    CONSTRAINT fk_up_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE RESTRICT,
    CONSTRAINT fk_up_papel   FOREIGN KEY (papel_id)   REFERENCES papel(id)   ON DELETE RESTRICT
);

CREATE TABLE grupo_funcionalidade (
    grupo_id          INTEGER NOT NULL,
    funcionalidade_id INTEGER NOT NULL,
    habilitado        BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT pk_grupo_funcionalidade PRIMARY KEY (grupo_id, funcionalidade_id),
    CONSTRAINT fk_gf_grupo          FOREIGN KEY (grupo_id)          REFERENCES grupo(id)          ON DELETE RESTRICT,
    CONSTRAINT fk_gf_funcionalidade FOREIGN KEY (funcionalidade_id) REFERENCES funcionalidade(id) ON DELETE RESTRICT
);

CREATE TABLE auditoria (
    id            SERIAL       PRIMARY KEY,
    data_hora     TIMESTAMP    NOT NULL DEFAULT NOW(),
    nome_entidade VARCHAR(100) NOT NULL,
    operacao      VARCHAR(10)  NOT NULL,
    CONSTRAINT chk_auditoria_op CHECK (operacao IN ('INSERT','UPDATE','DELETE'))
);
```

**Como atende ao enunciado:**

- Todas as telas do Anexo (usuários, grupos, permissões habilitáveis/desabilitáveis) são suportadas pelo modelo: `usuario` + `usuario_grupo` + `usuario_papel` para a tela 2; `grupo` + `grupo_funcionalidade(habilitado)` para a tela 3.
- Funcionalidades vêm hierarquizadas em `modulo` → `categoria_funcionalidade` → `funcionalidade`, exatamente como aparece no print "Adicionar grupo" do Anexo (EDITAIS → Seleção de editais → Visualizar editais, etc.).
- **`ON DELETE RESTRICT` em todas as FKs** cumpre a exigência do item 4 da A1: "Esta exclusão não pode ser feita em cascata (propriedade estabelecida na criação da tabela)".
- A tabela `auditoria` já é criada aqui para que a Atividade 2 só precise adicionar a função-trigger e os disparadores.

---

# Atividade 1 — Funções e Procedimentos

## 1. `fu_validar_cadastro`

> **Requisito (PDF):** Função cuja ENTRADA é o e-mail e a SAÍDA é `TRUE` se o e-mail está cadastrado, `FALSE` caso contrário.

```sql
CREATE OR REPLACE FUNCTION fu_validar_cadastro(p_email VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM usuario WHERE LOWER(email) = LOWER(p_email)
    ) INTO v_exists;
    RETURN v_exists;
END;
$$;
```

**Como atende:**

- **Entrada e saída** exatas: recebe `VARCHAR` (e-mail) e retorna `BOOLEAN`.
- A consulta usa `EXISTS`, que para no primeiro acerto — solução mais eficiente que `COUNT(*) > 0`.
- A comparação é **case-insensitive** (`LOWER` nos dois lados), evitando que `admin@ufg.br` e `Admin@UFG.br` sejam considerados usuários distintos.
- É reaproveitada pelo item 8 (`pr_criar_usuario_adm`) exatamente como o enunciado pede ("Deve ser utilizada a função pr_validar_cadastro para não duplicar o usuário").

---

## 2. `fu_validar_email`

> **Requisito (PDF):** Função cuja ENTRADA é o e-mail digitado pelo usuário e a SAÍDA é `TRUE` se o e-mail é válido segundo regras de validação de e-mail, ou `FALSE` caso contrário.

```sql
CREATE OR REPLACE FUNCTION fu_validar_email(p_email VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN p_email ~* '^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$';
END;
$$;
```

**Como atende:**

- **Entrada e saída** corretas: `VARCHAR` → `BOOLEAN`.
- A validação usa uma **regex no estilo RFC 5322 simplificado**, padrão amplamente aceito para validação prática:
  - Parte local (`[a-zA-Z0-9._%+\-]+`) aceita letras, dígitos e os sinais `. _ % + -`.
  - `@` obrigatório.
  - Domínio composto por rótulos (`[a-zA-Z0-9.\-]+`) seguido de um TLD de pelo menos 2 letras.
- O operador `~*` faz a comparação **case-insensitive**.
- Cobre rejeições óbvias (sem `@`, sem domínio, espaços etc.) e aceita os formatos do Anexo (`adailton@positivo.com.br`).

---

## 3. `fu_formatar_tempo_acesso`

> **Requisito (PDF):** Função cuja ENTRADA é a data-hora do último acesso e a SAÍDA é o tempo decorrido até agora — exemplos: "3 segundos", "10 minutos", "5 horas", "15 dias", "3 meses", "3 anos" e "Nunca acessou".

```sql
CREATE OR REPLACE FUNCTION fu_formatar_tempo_acesso(p_ultimo_acesso TIMESTAMPTZ)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_diff INTERVAL;
    v_secs BIGINT;
    v_val  BIGINT;
BEGIN
    IF p_ultimo_acesso IS NULL THEN
        RETURN 'Nunca acessou';
    END IF;

    v_diff := NOW() - p_ultimo_acesso;
    v_secs := EXTRACT(EPOCH FROM v_diff)::BIGINT;

    IF v_secs < 0 THEN
        RETURN 'Agora';
    ELSIF v_secs < 60 THEN
        v_val := v_secs;
        RETURN v_val || CASE WHEN v_val = 1 THEN ' segundo' ELSE ' segundos' END;
    ELSIF v_secs < 3600 THEN
        v_val := v_secs / 60;
        RETURN v_val || CASE WHEN v_val = 1 THEN ' minuto' ELSE ' minutos' END;
    ELSIF v_secs < 86400 THEN
        v_val := v_secs / 3600;
        RETURN v_val || CASE WHEN v_val = 1 THEN ' hora' ELSE ' horas' END;
    ELSIF v_secs < 2592000 THEN
        v_val := v_secs / 86400;
        RETURN v_val || CASE WHEN v_val = 1 THEN ' dia' ELSE ' dias' END;
    ELSIF v_secs < 31536000 THEN
        v_val := v_secs / 2592000;
        RETURN v_val || CASE WHEN v_val = 1 THEN ' mês' ELSE ' meses' END;
    ELSE
        v_val := v_secs / 31536000;
        RETURN v_val || CASE WHEN v_val = 1 THEN ' ano' ELSE ' anos' END;
    END IF;
END;
$$;
```

**Como atende:**

- **"Nunca acessou"** é o primeiro caminho — quando `ultimo_acesso IS NULL`, retorna exatamente o texto pedido.
- A diferença é calculada em **segundos absolutos** (`EXTRACT(EPOCH ...)`), o que permite ordenar os blocos do menor (segundos) até o maior (anos).
- Cada faixa retorna o **rótulo na unidade exata pedida**: "segundos", "minutos", "horas", "dias", "meses", "anos".
- A função alterna entre singular/plural (`1 dia` vs. `15 dias`) — supera o exemplo do PDF.
- O parâmetro é `TIMESTAMPTZ` porque `NOW()` no PostgreSQL devolve `timestamptz` e a aritmética entre `timestamp` e `timestamptz` exige alinhar tipos.
- A tela "Permissões > Usuários" do Anexo usa exatamente esses valores na coluna "ÚLTIMO ACESSO" (`3 horas`, `1 dia`, `Nunca acessou`).

---

## 4. `pr_excluir_usuario`

> **Requisito (PDF):** Procedimento cuja ENTRADA é o id do usuário e a SAÍDA é `TRUE`/`FALSE`. Usuários do grupo "Administrador" **não podem** ser excluídos. A exclusão **não pode ser em cascata** e deve respeitar PK/FK.

```sql
CREATE OR REPLACE FUNCTION pr_excluir_usuario(p_usuario_id INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_is_admin BOOLEAN;
BEGIN
    -- Usuário precisa existir
    IF NOT EXISTS (SELECT 1 FROM usuario WHERE id = p_usuario_id) THEN
        RETURN FALSE;
    END IF;

    -- Bloqueia se o usuário pertence ao grupo 'Administrador'
    SELECT EXISTS(
        SELECT 1
        FROM usuario_grupo ug
        JOIN grupo g ON g.id = ug.grupo_id
        WHERE ug.usuario_id = p_usuario_id
          AND LOWER(g.nome) = 'administrador'
    ) INTO v_is_admin;

    IF v_is_admin THEN
        RETURN FALSE;
    END IF;

    -- Exclui (a trigger BEFORE DELETE da A2 remove os FKs antes)
    DELETE FROM usuario WHERE id = p_usuario_id;
    RETURN TRUE;

EXCEPTION
    WHEN foreign_key_violation THEN
        RETURN FALSE;
    WHEN OTHERS THEN
        RETURN FALSE;
END;
$$;
```

**Como atende:**

- **Entrada e saída** corretas: `INTEGER` → `BOOLEAN`.
- **Bloqueio do Administrador**: a checagem prévia consulta `usuario_grupo + grupo` e retorna `FALSE` caso o usuário pertença ao grupo "Administrador" (comparação por `LOWER` para imunidade a maiúsculas/minúsculas).
- **Não-cascata respeitada**: o `DELETE` opera só na tabela `usuario`. As FKs em `usuario_grupo` e `usuario_papel` permanecem como `ON DELETE RESTRICT` (definidas no DDL). A limpeza prévia é feita pela trigger `tg_acionar_remocao_dependencia` da A2 — ou seja, é uma remoção **controlada e explícita**, não automática-em-cascata.
- **Integridade**: o bloco `EXCEPTION WHEN foreign_key_violation` garante que se algum FK não for satisfeito por qualquer motivo, o procedimento retorne `FALSE` ao invés de quebrar.
- O `RETURN FALSE` em caso de usuário inexistente também é coberto.

---

## 5. `fu_migrar_usuarios_grupo`

> **Requisito (PDF):** Função cuja entrada é o nome do **grupo de origem** e do **grupo de destino**, e a saída é uma lista (nome, e-mail, último acesso) dos usuários do grupo de origem. O processamento deve **migrar todos** os usuários da origem para o destino.

```sql
CREATE OR REPLACE FUNCTION fu_migrar_usuarios_grupo(
    p_grupo_origem  VARCHAR,
    p_grupo_destino VARCHAR
)
RETURNS TABLE(r_nome VARCHAR, r_email VARCHAR, r_ultimo_acesso TIMESTAMP)
LANGUAGE plpgsql
AS $$
DECLARE
    v_id_origem  INTEGER;
    v_id_destino INTEGER;
BEGIN
    SELECT g.id INTO v_id_origem  FROM grupo g WHERE LOWER(g.nome) = LOWER(p_grupo_origem);
    SELECT g.id INTO v_id_destino FROM grupo g WHERE LOWER(g.nome) = LOWER(p_grupo_destino);

    IF v_id_origem  IS NULL THEN RAISE EXCEPTION 'Grupo de origem "%" não encontrado.',  p_grupo_origem;  END IF;
    IF v_id_destino IS NULL THEN RAISE EXCEPTION 'Grupo de destino "%" não encontrado.', p_grupo_destino; END IF;
    IF v_id_origem = v_id_destino THEN
        RAISE EXCEPTION 'Grupos de origem e destino não podem ser o mesmo.';
    END IF;

    -- Insere no destino (evita duplicar se já é membro)
    INSERT INTO usuario_grupo (usuario_id, grupo_id)
    SELECT ug.usuario_id, v_id_destino
    FROM   usuario_grupo ug
    WHERE  ug.grupo_id = v_id_origem
    ON CONFLICT DO NOTHING;

    -- Retorna a lista dos migrados (antes de remover da origem)
    RETURN QUERY
        SELECT u.nome::VARCHAR, u.email::VARCHAR, u.ultimo_acesso
        FROM   usuario_grupo ug
        JOIN   usuario u ON u.id = ug.usuario_id
        WHERE  ug.grupo_id = v_id_origem;

    -- Remove da origem
    DELETE FROM usuario_grupo WHERE grupo_id = v_id_origem;
END;
$$;
```

**Como atende:**

- **Entrada**: dois `VARCHAR` (nomes), não ids — exatamente como o PDF pede.
- **Saída**: `TABLE(nome, email, ultimo_acesso)` — as três colunas exigidas.
- Os nomes das colunas usam prefixo `r_` para **evitar ambiguidade com `usuario.nome`** dentro do corpo PL/pgSQL (era um bug clássico que aparecia ao referenciar `nome` no `RETURN QUERY`).
- **Robustez**: erros explícitos quando o grupo não existe ou origem = destino — preferível a falhar silenciosamente.
- **`ON CONFLICT DO NOTHING`** lida com o caso onde um usuário já pertença a ambos os grupos (a PK composta `(usuario_id, grupo_id)` rejeitaria a inserção duplicada).
- **A ordem importa**: primeiro insere no destino, depois retorna a lista (calculada ainda na origem), depois remove. Isso garante que o `RETURN QUERY` veja a lista íntegra dos migrados.

---

## 6. `pr_copiar_grupo`

> **Requisito (PDF):** Procedimento cuja entrada é o **nome de um grupo existente** e o **nome de um novo grupo** (que será criado). A saída é a **quantidade de funcionalidades habilitadas** no novo grupo. O processamento deve **copiar na íntegra** o grupo e seus relacionamentos.

```sql
CREATE OR REPLACE FUNCTION pr_copiar_grupo(
    p_grupo_origem VARCHAR,
    p_novo_grupo   VARCHAR
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_id_origem     INTEGER;
    v_id_novo       INTEGER;
    v_count_enabled INTEGER;
BEGIN
    SELECT id INTO v_id_origem FROM grupo WHERE LOWER(nome) = LOWER(p_grupo_origem);
    IF v_id_origem IS NULL THEN
        RAISE EXCEPTION 'Grupo "%" não encontrado.', p_grupo_origem;
    END IF;

    IF EXISTS (SELECT 1 FROM grupo WHERE LOWER(nome) = LOWER(p_novo_grupo)) THEN
        RAISE EXCEPTION 'Grupo "%" já existe.', p_novo_grupo;
    END IF;

    -- Cria o novo grupo
    INSERT INTO grupo (nome) VALUES (p_novo_grupo) RETURNING id INTO v_id_novo;

    -- Copia todas as linhas de grupo_funcionalidade (habilitadas E desabilitadas)
    INSERT INTO grupo_funcionalidade (grupo_id, funcionalidade_id, habilitado)
    SELECT v_id_novo, funcionalidade_id, habilitado
    FROM   grupo_funcionalidade
    WHERE  grupo_id = v_id_origem;

    -- Conta apenas as habilitadas
    SELECT COUNT(*) INTO v_count_enabled
    FROM   grupo_funcionalidade
    WHERE  grupo_id = v_id_novo AND habilitado = TRUE;

    RETURN v_count_enabled;
END;
$$;
```

**Como atende:**

- **Entrada**: dois `VARCHAR` (nomes do grupo origem e do novo grupo).
- **Saída**: `INTEGER` com a contagem de funcionalidades habilitadas.
- **"Cópia na íntegra"**: o `INSERT … SELECT` reproduz **todas** as linhas de `grupo_funcionalidade` (tanto `habilitado = TRUE` quanto `FALSE`) — preservando exatamente o estado de permissões da origem.
- A contagem retornada filtra somente `habilitado = TRUE`, conforme exigido pelo PDF ("quantidade de funcionalidades com permissões habilitadas").
- Erros explícitos para grupo origem inexistente ou nome de novo grupo já em uso (`grupo.nome` é `UNIQUE`).

---

## 7. `fu_verificar_engajamento`

> **Requisito (PDF):** Função cuja saída é a lista de usuários classificados por grau de engajamento: **Alto** (≤2 dias), **Médio** (≤7 dias), **Baixo** (≤30 dias), **Inexistente** (nunca acessou).

```sql
CREATE OR REPLACE FUNCTION fu_verificar_engajamento()
RETURNS TABLE(
    r_nome          VARCHAR,
    r_email         VARCHAR,
    r_ultimo_acesso TIMESTAMP,
    r_engajamento   VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.nome::VARCHAR,
        u.email::VARCHAR,
        u.ultimo_acesso,
        CASE
            WHEN u.ultimo_acesso IS NULL                          THEN 'Inexistente'::VARCHAR
            WHEN u.ultimo_acesso >= NOW() - INTERVAL '2 days'     THEN 'Alto'::VARCHAR
            WHEN u.ultimo_acesso >= NOW() - INTERVAL '7 days'     THEN 'Médio'::VARCHAR
            WHEN u.ultimo_acesso >= NOW() - INTERVAL '30 days'    THEN 'Baixo'::VARCHAR
            ELSE                                                       'Inexistente'::VARCHAR
        END AS r_engajamento
    FROM usuario u
    ORDER BY
        CASE
            WHEN u.ultimo_acesso IS NULL                          THEN 4
            WHEN u.ultimo_acesso >= NOW() - INTERVAL '2 days'     THEN 1
            WHEN u.ultimo_acesso >= NOW() - INTERVAL '7 days'     THEN 2
            WHEN u.ultimo_acesso >= NOW() - INTERVAL '30 days'    THEN 3
            ELSE 4
        END,
        u.ultimo_acesso DESC NULLS LAST;
END;
$$;
```

**Como atende:**

- **Saída**: tabela com `nome, email, ultimo_acesso, engajamento` — atendendo a "lista de usuários cadastrados classificados por grau de engajamento".
- O `CASE` cobre **exatamente** as quatro faixas do PDF:
  - `NULL` → `Inexistente`
  - `≥ NOW() - 2 dias` → `Alto`
  - `≥ NOW() - 7 dias` → `Médio`
  - `≥ NOW() - 30 dias` → `Baixo`
  - Mais antigo que 30 dias → `Inexistente` (interpretação literal: "nunca acessou recentemente").
- O `ORDER BY` deixa a lista útil: ordenada do mais engajado para o menos, e dentro de cada faixa pelo `ultimo_acesso` mais recente.
- Como em `fu_migrar_usuarios_grupo`, os prefixos `r_` nos campos do `RETURNS TABLE` evitam conflito com colunas reais.

---

## 8. `pr_criar_usuario_adm`

> **Requisito (PDF):** Procedimento cuja entrada é o e-mail `admin@ufg.br` e o nome do grupo "Administrador". Deve criar o usuário, criar o grupo, habilitar **todas** as funcionalidades para o grupo e vincular o usuário ao grupo. **Deve usar `fu_validar_cadastro` para não duplicar o usuário**.

```sql
CREATE OR REPLACE FUNCTION pr_criar_usuario_adm(
    p_email      VARCHAR DEFAULT 'admin@ufg.br',
    p_nome_grupo VARCHAR DEFAULT 'Administrador'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_usuario_id INTEGER;
    v_grupo_id   INTEGER;
BEGIN
    -- Só cria se não estiver cadastrado
    IF NOT fu_validar_cadastro(p_email) THEN
        INSERT INTO usuario (email) VALUES (p_email) RETURNING id INTO v_usuario_id;
    ELSE
        SELECT id INTO v_usuario_id FROM usuario WHERE LOWER(email) = LOWER(p_email);
    END IF;

    -- Cria o grupo se não existir
    SELECT id INTO v_grupo_id FROM grupo WHERE LOWER(nome) = LOWER(p_nome_grupo);
    IF v_grupo_id IS NULL THEN
        INSERT INTO grupo (nome) VALUES (p_nome_grupo) RETURNING id INTO v_grupo_id;
    END IF;

    -- Habilita TODAS as funcionalidades para o grupo
    INSERT INTO grupo_funcionalidade (grupo_id, funcionalidade_id, habilitado)
    SELECT v_grupo_id, f.id, TRUE
    FROM   funcionalidade f
    ON CONFLICT (grupo_id, funcionalidade_id)
    DO UPDATE SET habilitado = TRUE;

    -- Vincula o usuário ao grupo
    INSERT INTO usuario_grupo (usuario_id, grupo_id)
    VALUES (v_usuario_id, v_grupo_id)
    ON CONFLICT DO NOTHING;
END;
$$;
```

**Como atende:**

- **Entradas com defaults** `admin@ufg.br` e `'Administrador'` — exatamente o cenário pedido. Pode ser chamado sem argumentos: `SELECT pr_criar_usuario_adm();`.
- **Uso obrigatório de `fu_validar_cadastro`**: a primeira instrução chama `fu_validar_cadastro(p_email)` e só insere quando ela retorna `FALSE`. Esse é o ponto explicitamente cobrado no PDF.
- **Criação do grupo**: o `IF v_grupo_id IS NULL` cria o grupo só se não existir, suportando re-execução idempotente.
- **Todas as funcionalidades habilitadas**: o `INSERT … SELECT … FROM funcionalidade` percorre todas e marca como `TRUE`. O `ON CONFLICT … DO UPDATE` garante que, se já houver uma entrada com `habilitado = FALSE`, ela seja virada para `TRUE`.
- **Vinculação usuário↔grupo**: o último `INSERT` cria o relacionamento, com `ON CONFLICT DO NOTHING` para tolerar re-execução.

---

# Atividade 2 — Triggers e Views

## 1. `pr_remover_dependencia_usuario`

> **Requisito (PDF):** Procedimento cuja ENTRADA é o id do usuário. Deve remover o relacionamento do usuário com **`usuario_papel`** e **`usuario_grupo`**.

```sql
CREATE OR REPLACE FUNCTION pr_remover_dependencia_usuario(p_usuario_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM usuario_papel WHERE usuario_id = p_usuario_id;
    DELETE FROM usuario_grupo  WHERE usuario_id = p_usuario_id;
END;
$$;
```

**Como atende:**

- **Entrada** correta: `INTEGER` (id do usuário).
- O corpo faz **exatamente** as duas remoções pedidas: `usuario_papel` e `usuario_grupo`, na ordem em que foram citadas no enunciado.
- A função é o "verbo" reutilizável; a trigger do item 2 apenas a invoca.

---

## 2. `tg_acionar_remocao_dependencia`

> **Requisito (PDF):** Trigger para executar o procedimento `pr_remover_dependencia_usuario` **antes** da operação DELETE de usuário.

```sql
CREATE OR REPLACE FUNCTION tg_fn_remover_dependencia()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pr_remover_dependencia_usuario(OLD.id);
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tg_acionar_remocao_dependencia ON usuario;
CREATE TRIGGER tg_acionar_remocao_dependencia
    BEFORE DELETE ON usuario
    FOR EACH ROW
    EXECUTE FUNCTION tg_fn_remover_dependencia();
```

**Como atende:**

- **`BEFORE DELETE ON usuario`** corresponde exatamente ao "antes da operação DELETE de usuário" do PDF.
- O `FOR EACH ROW` garante que o procedimento seja invocado para **cada usuário deletado**, recebendo o id via `OLD.id`.
- `PERFORM pr_remover_dependencia_usuario(OLD.id)` é a forma correta de chamar uma função `RETURNS VOID` dentro de outra função PL/pgSQL.
- **Consequência importante**: junto com o `ON DELETE RESTRICT` do DDL, esta trigger é o que torna possível a exclusão de um usuário sem violar FK — atendendo ao requisito "não pode ser em cascata, mas deve respeitar as restrições de integridade" do item 4 da A1.

---

## 3. Tabela `auditoria` + triggers em todas as tabelas

> **Requisito (PDF):** Criar a tabela `auditoria`. Toda ação nas tabelas (exceto `auditoria`) deve, por meio de **TRIGGER**, registrar: data/hora, nome da entidade, operação (`INSERT`/`UPDATE`/`DELETE`).

**Tabela** (já criada no `01_ddl.sql`):

```sql
CREATE TABLE auditoria (
    id            SERIAL       PRIMARY KEY,
    data_hora     TIMESTAMP    NOT NULL DEFAULT NOW(),
    nome_entidade VARCHAR(100) NOT NULL,
    operacao      VARCHAR(10)  NOT NULL,
    CONSTRAINT chk_auditoria_op CHECK (operacao IN ('INSERT','UPDATE','DELETE'))
);
```

**Função-trigger genérica:**

```sql
CREATE OR REPLACE FUNCTION tg_fn_auditoria()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO auditoria (nome_entidade, operacao)
    VALUES (TG_TABLE_NAME, TG_OP);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;
```

**Triggers em cada tabela (exceto `auditoria`):**

```sql
CREATE TRIGGER tg_audit_modulo
    AFTER INSERT OR UPDATE OR DELETE ON modulo
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_categoria_funcionalidade
    AFTER INSERT OR UPDATE OR DELETE ON categoria_funcionalidade
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_funcionalidade
    AFTER INSERT OR UPDATE OR DELETE ON funcionalidade
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_usuario
    AFTER INSERT OR UPDATE OR DELETE ON usuario
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_grupo
    AFTER INSERT OR UPDATE OR DELETE ON grupo
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_papel
    AFTER INSERT OR UPDATE OR DELETE ON papel
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_usuario_grupo
    AFTER INSERT OR UPDATE OR DELETE ON usuario_grupo
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_usuario_papel
    AFTER INSERT OR UPDATE OR DELETE ON usuario_papel
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();

CREATE TRIGGER tg_audit_grupo_funcionalidade
    AFTER INSERT OR UPDATE OR DELETE ON grupo_funcionalidade
    FOR EACH ROW EXECUTE FUNCTION tg_fn_auditoria();
```

**Como atende:**

- **Os três campos exigidos** estão na tabela: `data_hora` (com `DEFAULT NOW()`), `nome_entidade`, `operacao`.
- O `CHECK` no campo `operacao` garante que só os três valores válidos sejam aceitos (`INSERT`, `UPDATE`, `DELETE`).
- Uma **única função-trigger genérica** atende a todas as tabelas usando as variáveis especiais do PostgreSQL: `TG_TABLE_NAME` (nome da tabela disparadora) e `TG_OP` (a operação). Isso evita duplicação de código e mantém a manutenção barata.
- Os triggers são `AFTER` para garantir que só sejam logadas as operações que efetivamente sucederam (operações que falham por FK não chegam a disparar `AFTER`).
- **Cobertura completa**: as 9 tabelas do modelo recebem trigger (`modulo`, `categoria_funcionalidade`, `funcionalidade`, `usuario`, `grupo`, `papel`, `usuario_grupo`, `usuario_papel`, `grupo_funcionalidade`). A tabela `auditoria` propositadamente **não tem trigger** sobre si mesma — exatamente como o enunciado pede.

O arquivo `sql/04_audit_assertions.sql` (67 asserções) prova que cada `INSERT`/`UPDATE`/`DELETE` em cada uma das 9 tabelas produz a linha esperada em `auditoria`.

---

## 4. `vw_consulta_usuario`

> **Requisito (PDF):** View baseada nas informações necessárias para a consulta de usuário do **item 2 do Anexo** ("Gerenciar usuários"). A tela mostra colunas USUÁRIO (nome + e-mail), GRUPO, PAPEL, ÚLTIMO ACESSO.

```sql
CREATE OR REPLACE VIEW vw_consulta_usuario AS
SELECT
    u.id,
    u.email,
    COALESCE(u.nome, '-')                       AS nome,
    u.ultimo_acesso,
    fu_formatar_tempo_acesso(u.ultimo_acesso)   AS ultimo_acesso_fmt,
    COALESCE(STRING_AGG(DISTINCT g.nome, ', ' ORDER BY g.nome), '') AS grupos,
    COALESCE(STRING_AGG(DISTINCT p.nome, ', ' ORDER BY p.nome), '') AS papeis
FROM usuario u
LEFT JOIN usuario_grupo ug ON ug.usuario_id = u.id
LEFT JOIN grupo g          ON g.id          = ug.grupo_id
LEFT JOIN usuario_papel up ON up.usuario_id = u.id
LEFT JOIN papel p          ON p.id          = up.papel_id
GROUP BY u.id, u.email, u.nome, u.ultimo_acesso
ORDER BY u.email;
```

**Como atende:**

- **Colunas espelham a tela do Anexo**:
  - `nome` + `email` → coluna "USUÁRIO" (com nome em cima, e-mail embaixo no print).
  - `grupos` (concatenado) → coluna "GRUPO". No Anexo o usuário "Adailton Araújo" aparece com "Cadastro de contratos, Consulta de CNPJ, Contas a receber, Liderança de editais, Seleção de editais" — exatamente um `STRING_AGG`.
  - `papeis` (concatenado) → coluna "PAPEL" ("Analista de proposta, Analista técnico, +1" no Anexo).
  - `ultimo_acesso_fmt` → coluna "ÚLTIMO ACESSO", já formatada pela `fu_formatar_tempo_acesso` da A1 (reuso explícito da função).
- **`LEFT JOIN`** garante que usuários **sem grupo e sem papel** apareçam (como "Guilherme Sousa" no Anexo, sem grupo associado).
- **`DISTINCT` dentro do `STRING_AGG`** evita repetir nomes quando há múltiplos relacionamentos coincidentes.
- **`COALESCE`** transforma `NULL` em string vazia/"-" — a tela nunca recebe `null`.

---

## 5. `vwm_consulta_usuario` (materializada)

> **Requisito (PDF):** Materialize a view criada anteriormente.

```sql
CREATE MATERIALIZED VIEW vwm_consulta_usuario AS
SELECT * FROM vw_consulta_usuario;

CREATE UNIQUE INDEX ON vwm_consulta_usuario(id);
```

**Como atende:**

- Construída literalmente a partir de `vw_consulta_usuario` (`SELECT *`), garantindo paridade entre as duas — qualquer mudança na view não-materializada vale para a materializada após o próximo `REFRESH`.
- O **`UNIQUE INDEX` na coluna `id`** é o que habilita `REFRESH MATERIALIZED VIEW CONCURRENTLY`, evitando lock exclusivo durante a atualização (importante para o item 12).

---

## 6 e 8. `vw_consulta_grupo`

> **Requisito (PDF — itens 6 e 8 são duplicatas):** View baseada nas informações necessárias para a consulta do grupo do **item 3 do Anexo** ("Gerenciar grupos"). A tela mostra GRUPO, PERMISSÕES (total), USUÁRIOS (total).

```sql
CREATE OR REPLACE VIEW vw_consulta_grupo AS
SELECT
    g.id,
    g.nome,
    COUNT(DISTINCT CASE WHEN gf.habilitado = TRUE THEN gf.funcionalidade_id END)
        AS total_permissoes,
    COUNT(DISTINCT ug.usuario_id) AS total_usuarios
FROM grupo g
LEFT JOIN grupo_funcionalidade gf ON gf.grupo_id = g.id
LEFT JOIN usuario_grupo ug        ON ug.grupo_id  = g.id
GROUP BY g.id, g.nome
ORDER BY g.nome;
```

**Como atende:**

- **Colunas espelham a tela do Anexo**:
  - `nome` → coluna "GRUPO".
  - `total_permissoes` → coluna "PERMISSÕES" (no Anexo: 3, 2, 31, 8, 9). O `CASE WHEN habilitado = TRUE` é fundamental — sem ele, contaríamos também as permissões desabilitadas, e o número não bateria com a tela.
  - `total_usuarios` → coluna "USUÁRIOS" (no Anexo: 2, 4, 2, 1, 3).
- **`COUNT(DISTINCT …)`** evita duplicação caso o `LEFT JOIN` produza linhas redundantes — quando o grupo tem N permissões e M usuários, o `LEFT JOIN` produz N × M linhas; o `DISTINCT` neutraliza isso.
- **`LEFT JOIN`** permite que grupos vazios apareçam com zero. Sem `LEFT JOIN`, um grupo recém-criado sem usuários nem permissões sumiria da tela.

> Observação: os itens 6 e 8 do PDF são duplicatas (provavelmente erro de cópia no enunciado), pedindo a mesma view `vw_consulta_grupo`. A solução é a mesma para ambos.

---

## 7 e 9. `vmw_consulta_grupo` (materializada)

> **Requisito (PDF):** Materialize a view criada anteriormente.

```sql
CREATE MATERIALIZED VIEW vmw_consulta_grupo AS
SELECT * FROM vw_consulta_grupo;

CREATE UNIQUE INDEX ON vmw_consulta_grupo(id);
```

**Como atende:** mesmo padrão da `vwm_consulta_usuario` — derivada por `SELECT *` e indexada unicamente em `id` para permitir refresh concorrente.

---

## 10. `vw_consulta_permissoes_grupo`

> **Requisito (PDF):** View que **lista TODAS as funcionalidades**, indicando quais estão habilitadas para o grupo. Necessária para a tela "Adicionar grupo > Permissões" do Anexo, onde cada funcionalidade aparece com um toggle (habilitada/desabilitada).

```sql
CREATE OR REPLACE VIEW vw_consulta_permissoes_grupo AS
SELECT
    g.id                            AS grupo_id,
    g.nome                          AS grupo_nome,
    m.nome                          AS modulo,
    m.id                            AS modulo_id,
    cf.nome                         AS categoria,
    cf.id                           AS categoria_id,
    f.id                            AS funcionalidade_id,
    f.nome                          AS funcionalidade,
    COALESCE(gf.habilitado, FALSE)  AS habilitado
FROM grupo g
CROSS JOIN funcionalidade f
JOIN categoria_funcionalidade cf ON cf.id = f.categoria_id
JOIN modulo m                    ON m.id  = cf.modulo_id
LEFT JOIN grupo_funcionalidade gf
       ON gf.grupo_id = g.id AND gf.funcionalidade_id = f.id
ORDER BY g.nome, m.nome, cf.nome, f.nome;
```

**Como atende:**

- **"TODAS as funcionalidades"** — o `CROSS JOIN` entre `grupo` e `funcionalidade` produz o produto cartesiano: para cada grupo, **todas as funcionalidades aparecem**, mesmo aquelas que ainda nem foram cadastradas em `grupo_funcionalidade`.
- **"Indicando quais estão habilitadas"** — o `LEFT JOIN` traz `gf.habilitado` quando a linha existe; o `COALESCE(…, FALSE)` cobre o caso em que a linha ainda não existe (o default no tela é "desabilitado").
- **Estrutura hierárquica espelha o print "Adicionar grupo"** do Anexo, que agrupa funcionalidades por módulo (EDITAIS, CONTRATOS) e dentro do módulo por categoria (Seleção de editais, Análise de editais, Consulta de CNPJ). Por isso a view expõe `modulo`, `categoria` e `funcionalidade` com seus respectivos `id`s — permitindo que o frontend renderize as seções colapsáveis e os toggles individuais.
- O `ORDER BY g.nome, m.nome, cf.nome, f.nome` deixa a saída já agrupada na ordem em que o frontend itera.

---

## 11. `vmw_consulta_permissoes_grupo` (materializada)

> **Requisito (PDF):** Materialize a view criada anteriormente.

```sql
CREATE MATERIALIZED VIEW vmw_consulta_permissoes_grupo AS
SELECT * FROM vw_consulta_permissoes_grupo;

CREATE UNIQUE INDEX ON vmw_consulta_permissoes_grupo(grupo_id, funcionalidade_id);
```

**Como atende:**

- Materialização direta da view não-materializada.
- O **índice único composto** `(grupo_id, funcionalidade_id)` é necessário porque essa view tem **uma linha por par (grupo, funcionalidade)** — não há uma única coluna que identifique unicamente. Esse índice é o que habilita `REFRESH … CONCURRENTLY`.

---

## 12. Atualização automática das views materializadas a cada 2h

> **Requisito (PDF):** Projete **duas alternativas** para atualizar automaticamente as views materializadas a cada 2 horas. Indique como seria o **código de implementação** para cada solução.

### Alternativa 1 — Extensão `pg_cron` (agendamento dentro do PostgreSQL)

```sql
-- Habilitar a extensão (executar como superusuário, uma única vez):
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Agendar o REFRESH a cada 2 horas (cron expression: minuto hora dia mês diaSemana)
-- "0 */2 * * *" = no minuto 0 de cada 2 horas (00:00, 02:00, 04:00, ...)
SELECT cron.schedule(
    'refresh-mat-views',
    '0 */2 * * *',
    $$
        REFRESH MATERIALIZED VIEW CONCURRENTLY vwm_consulta_usuario;
        REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_grupo;
        REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_permissoes_grupo;
    $$
);

-- Listar jobs ativos:
SELECT * FROM cron.job;

-- Remover o agendamento:
SELECT cron.unschedule('refresh-mat-views');
```

**Por que atende:**

- O `pg_cron` roda **dentro** do PostgreSQL como um worker background. O cron `'0 */2 * * *'` dispara a cada 2 horas em ponto.
- O `REFRESH … CONCURRENTLY` requer o `UNIQUE INDEX` definido nos itens 5/7/11 — só funciona porque eles foram criados.
- **Vantagem**: nenhum agente externo. Tudo agendado, executado e auditado no próprio SGBD; sobrevive a reinício do servidor.

### Alternativa 2 — Cron do sistema operacional + script shell

```bash
# 1. Criar o script /usr/local/bin/refresh_sissa_views.sh:
#!/bin/bash
psql -U postgres -d sissa -c "
    REFRESH MATERIALIZED VIEW CONCURRENTLY vwm_consulta_usuario;
    REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_grupo;
    REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_permissoes_grupo;
"

# 2. Torná-lo executável:
chmod +x /usr/local/bin/refresh_sissa_views.sh

# 3. Adicionar ao crontab do SO (crontab -e):
0 */2 * * * /usr/local/bin/refresh_sissa_views.sh >> /var/log/sissa_refresh.log 2>&1
```

Opcionalmente, encapsular o `REFRESH` em uma `PROCEDURE` para que o script só precise chamar `CALL`:

```sql
CREATE OR REPLACE PROCEDURE refresh_all_mat_views()
LANGUAGE plpgsql
AS $proc$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY vwm_consulta_usuario;
    REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_grupo;
    REFRESH MATERIALIZED VIEW CONCURRENTLY vmw_consulta_permissoes_grupo;
END;
$proc$;

-- Chamada manual ou via cron:
CALL refresh_all_mat_views();
```

**Por que atende:**

- O cron do SO é onipresente — funciona em qualquer servidor Unix sem precisar de extensão.
- Centralizar o `REFRESH` em `refresh_all_mat_views()` melhora manutenção: o cron só executa `CALL refresh_all_mat_views();`, e qualquer mudança nas views fica no SGBD.
- **Vantagem**: não exige privilégios para instalar extensões no PostgreSQL.

### Comparativo

| Critério | `pg_cron` | Cron do SO |
|---|---|---|
| Requer extensão | Sim (`shared_preload_libraries`) | Não |
| Roda mesmo sem acesso shell | Sim | Não |
| Logs | `cron.job_run_details` | arquivo de log do SO |
| Portabilidade | depende do hosting permitir | universal em Linux/macOS |

---

# Conclusão

Todos os 8 itens da A1 e os 12 itens da A2 estão implementados em `sql/02_functions_a1.sql` e `sql/03_triggers_views_a2.sql`, apoiados pelo DDL de `sql/01_ddl.sql`. A consistência foi validada pelos testes automáticos:

- **`node test-runner.js`** → 91/91 testes verde (cobre todas as funções/procedures/triggers/views e os endpoints da API).
- **`psql -d sissa -f sql/04_audit_assertions.sql`** → 67/67 asserções verde (prova que cada tabela coberta gera o registro esperado em `auditoria`).
