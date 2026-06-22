# Guia de Demonstração — SISSA (na tela)

Roteiro para demonstrar a plataforma **no frontend**: como subir, com quais credenciais
entrar e o que clicar em cada tela. Para ver **o que cada passo faz no banco** (o SQL por
trás de cada objeto), use o `GUIA_APRESENTACAO.md`.

## Como subir
```bash
dropdb --if-exists sissa && createdb sissa
psql -d sissa -f sql/01_ddl.sql
psql -d sissa -f sql/05_sissa_domain.sql
psql -d sissa -f sql/06_roster_universidade.sql
cd backend && node server.js          # http://localhost:3000
```

## Logins (área privada)
O login CAFe é só um provedor de identidade; a **instituição vem do cadastro do usuário**.
Na tela de login, busque **UFG** ou **IFSP**, prossiga e use:

### UFG — Licenciatura em Física / Matemática
| Nome | E-mail | Senha | Perfil | Nível | Cursos |
|------|--------|-------|--------|:----:|--------|
| Laís Hauptli Cândido | `laishcandido@gmail.com` | `3456` | Coordenador de unidade | 4 | Física + Matemática |
| Beatriz de Barros V. Cardoso | `beatriz.de.bastos.vianna@gmail.com` | `2345` | Coordenador de ensino | 3 | Física |
| Adailton Araújo | `adailton@ufg.com` | `1234` | Coordenador de curso | 2 | Física |
| Kalebe Xavier | `kalebe.xavier@ufg.br` | `4567` | Tutor | 1 | Física |
| Juliana Moraes | `juliana.moraes@ufg.br` | `5678` | Tutor | 1 | Física |
| Beatriz Cardoso | `beatriz.cardoso@ufg.br` | `6789` | Tutor | 1 | Física |

### IFSP — Tecnologia em ADS
| Nome | E-mail | Senha | Perfil | Nível | Cursos |
|------|--------|-------|--------|:----:|--------|
| Ricardo Tavares Lima | `ricardo.tavares@ifsp.edu.br` | `7890` | Coordenador de unidade | 4 | ADS |
| Patrícia Nunes Rocha | `patricia.rocha@ifsp.edu.br` | `8901` | Coordenador de curso | 2 | ADS |

**O que cada perfil pode fazer:** Tutor (1) registra/edita as próprias intervenções;
Coordenador de curso (2) gerencia grupos, estudantes e usuários; Coordenador de ensino (3)
acrescenta excluir usuário; Coordenador de unidade (4) idem e enxerga **todos os cursos da
sua unidade** (por isso Laís vê Física **e** Matemática). Os demais perfis enxergam **um curso**.

### Área pública (sem login)
Use qualquer e-mail **não cadastrado** (ex.: `visitante@qualquer.com`, senha livre) → cai
na **área pública**, que mostra risco de evasão **anonimizado** (sem nome/matrícula).

> Cadastro completo (instituições, unidades, cursos, semestres, alunos, grupos) está no
> `GUIA_APRESENTACAO.md` → **Visão geral do cadastro**.

## Roteiro de demonstração (na tela)
Cada passo aponta a seção do `GUIA_APRESENTACAO.md` que mostra o **mesmo efeito no banco**.

1. **Isolamento multi-instituição.** Entre como `juliana.moraes@ufg.br` → cabeçalho **UFG**,
   curso Física, grupos A/B/C e 6 intervenções. Saia, entre como `ricardo.tavares@ifsp.edu.br`
   → cabeçalho **IFSP**, curso ADS, sem grupos/intervenções. *(no banco: §4 Views e §6 Roles)*
2. **Coordenador de unidade vê 2 cursos.** Entre como `laishcandido@gmail.com` → a seleção de
   curso oferece **Física e Matemática**; os outros perfis caem direto em um único curso.
   *(no banco: Visão geral do cadastro)*
3. **Permissão por nível.** Como **Tutor** (Kalebe), os botões de gerenciar usuário / excluir
   grupo **não aparecem**; como **Coordenador**, aparecem. *(no banco: §4 `vw_sissa_perfil_permissoes`)*
4. **Gauge de risco.** Na tela de Estudantes, veja o **% Alto/Médio/Baixo** do curso e a coluna
   de risco de cada aluno. *(no banco: §1 Funções — `fu_sissa_resumo_curso` / `fu_sissa_calcular_risco`)*
5. **Intervenção a partir de um grupo.** Abra um grupo e use *"nova intervenção a partir do
   grupo"*: cria **uma intervenção por aluno** do grupo de uma vez. *(no banco: §2 Procedimentos)*
6. **Reativação automática.** Registre uma intervenção para um aluno de um grupo **Inativo** →
   o grupo volta a **Ativo** sozinho. *(no banco: §3 Triggers)*
7. **Manutenção de grupos.** O botão **Manutenção** inativa grupos parados há muito tempo (no
   seed recém-criado, inativa o Grupo A). *(no banco: §2 Procedimentos)*
8. **Área pública.** Saia e entre com um e-mail **não cadastrado** → risco **anonimizado**, sem
   nome nem matrícula. *(no banco: §4 `vw_sissa_risco_anonimo` e §6 Roles)*

> Os passos 5–7 **alteram dados**. Para reapresentar do zero, reconstrua o banco (bloco
> **Como subir**) — o Grupo A volta a Ativo e as intervenções originais voltam.
