# Fase 02 — Membros e Cargos

Depende da fase 01 (guilda criada, aprovada e ativa). Segue `docs/ARQUITETURA.md`:
multi-tenant por `channel_id`, servidor é a autoridade, toda mudança de quadro vira
`guild_event`.

## 1. Objetivo

Fazer a guilda ter gente dentro e hierarquia definida: entrar por chat ou pela
extensão, sair, ser expulso, e distribuir poder em cinco cargos para que a guilda
não pare quando o líder some. O limite de vagas é aplicado aqui; o número vem da fase 03.

## 2. Escopo

| Entrega |
|---|
| Modo de entrada da guilda: `open` \| `approval` \| `closed` |
| Entrada direta em guilda aberta (chat e extensão) |
| Pedido de entrada + fila de aprovação para guilda por aprovação |
| Convite nominal (single-use, expirável) para guilda fechada |
| Saída voluntária, expulsão, cooldown de reentrada |
| Cargos `leader > officer > veteran > member > recruit` e matriz de permissões |
| Promoção, rebaixamento, transferência de liderança, sucessão automática |
| Aplicação de `guild.member_limit` em toda entrada |
| Histórico de saída (`guild_membership_history`) |
| Eventos de quadro em `guild_event` |

### Fora do escopo

| Item | Fase que cobre |
|---|---|
| Valor de `member_limit` por nível da guilda | 03 — progressão |
| XP individual ou coletivo por membro que entra/sai | 03 — progressão |
| Contribuição do membro no ranking / temporada | 04 — competição |
| Execução de guerra (aqui só existe a **permissão** de declarar) | 05 — guerras |
| Cargos com cor/ícone, emblema, cosmético de cargo | 06 — identidade |
| Anúncio automático no chat das entradas/saídas | 07 — integração |
| Criação/aprovação/banimento de guilda, painel de moderação, auditoria | 01 — fundação (pronto) |
| Guilda cross-canal | fora da v1 (ARQUITETURA) |

## 3. Fluxos

### 3.1 Entrar em guilda aberta

```
1. viewer: !guilda entrar VOID   ou   [ ENTRAR NA GUILDA ]
2. EBS valida JWT -> channel_id, user_id
3. checa: guild.status='active' AND join_mode='open'
4. checa: viewer sem membership ativa no canal        -> ALREADY_IN_GUILD
5. checa: cooldown de reentrada expirado              -> JOIN_COOLDOWN
6. SELECT guild FOR UPDATE; count(members) < member_limit -> GUILD_FULL
7. INSERT guild_member (role='recruit')
8. INSERT guild_event type='member.joined'
9. resposta: "@viewer entrou na [VOID] Void Walkers como Recruta."
```

### 3.2 Pedir entrada e ser aprovado (`join_mode='approval'`)

```
viewer                        EBS                        líder/oficial
  |  !guilda entrar VOID       |                              |
  |--------------------------->| INSERT guild_join_request     |
  |                            |   status='pending'            |
  |  "pedido enviado"          | guild_event=join.requested    |
  |<---------------------------|----------------------------->| badge na fila
  |                            |                              |
  |                            |   POST /requests/:id/approve  |
  |                            |<-----------------------------|
  |                            | trava guild, revalida vagas   |
  |                            | + cooldown do solicitante     |
  |                            | request->'approved'           |
  |                            | INSERT guild_member 'recruit' |
  |  "você entrou na [VOID]"   | guild_event=join.approved     |
  |<---------------------------|                              |
```

Recusa: `status='rejected'`, `guild_event=join.rejected`, viewer pode pedir de novo
depois de 24 h (R12).

### 3.3 Convite em guilda fechada (`join_mode='closed'`)

```
1. líder/oficial: !guilda convidar @fulano   ou   painel > Convidar
2. EBS: alvo não é membro, guilda não está cheia, sem convite pendente pro mesmo alvo
3. INSERT guild_invite (invitee_user_id, code, expires_at = now()+72h, status='pending')
4. guild_event=invite.created; extensão do convidado mostra [ ACEITAR CONVITE ]
5a. aceita  -> revalida vagas/cooldown -> INSERT guild_member 'recruit'
               invite.status='accepted'; guild_event=invite.accepted
5b. recusa  -> invite.status='declined'
5c. 72 h    -> job marca 'expired' (R14)
```

Em guilda fechada, `!guilda entrar` responde `GUILD_CLOSED` e **não** cria pedido.

### 3.4 Sair

```
1. !guilda sair  (confirmação na extensão: modal "Sair da [VOID]?")
2. se role='leader' e guilda tem outro membro -> LEADER_MUST_TRANSFER (R17)
3. DELETE guild_member
4. INSERT guild_membership_history (reason='left', cooldown_until = now()+24h)
5. guild_event=member.left
6. se era o último membro -> guild.status='suspended', guild_event=guild.emptied (R18)
```

### 3.5 Ser expulso

```
1. ator com permissão: !guilda expulsar @fulano
2. checa hierarquia: alvo estritamente abaixo do ator (R7)
3. DELETE guild_member
4. INSERT guild_membership_history (reason='kicked', actor_user_id,
                                    cooldown_until = now()+72h)  -- cooldown só p/ esta guilda
5. guild_event=member.kicked; audit_log (fase 01) recebe o registro
```

### 3.6 Promover / rebaixar

```
1. ator: !guilda promover @fulano
2. novo cargo = próximo acima do atual do alvo
3. rejeita se novo cargo >= cargo do ator      -> CANNOT_PROMOTE_TO_OWN_ROLE (R8)
4. rejeita se cargo atual do alvo >= do ator   -> CANNOT_TARGET_HIGHER_ROLE (R7)
5. UPDATE guild_member SET role, role_changed_at, role_changed_by
6. guild_event=member.promoted | member.demoted
```

Rebaixar segue o mesmo caminho para baixo; rebaixar quem já é `recruit` retorna
`INVALID_ROLE_TRANSITION` (não vira expulsão implícita).

### 3.7 Transferir liderança

```
1. líder: !guilda lider @fulano   (alvo precisa ser membro ativo, qualquer cargo)
2. transação única:
     UPDATE guild_member SET role='officer' WHERE user_id = líder_atual
     UPDATE guild_member SET role='leader'  WHERE user_id = alvo
     UPDATE guild SET leader_user_id = alvo
3. guild_event=guild.leadership_transferred
4. o índice único parcial de líder garante que nunca há 0 ou 2 líderes (R19)
```

Sucessão automática (líder sumido/banido) usa exatamente essa transação, com
`actor='system'` — ver R20.

## 4. Matriz de permissões

`✔` permitido · `✘` negado · `—` não se aplica.
"Broadcaster/mod" é o canal, atua por cima de qualquer guilda (fase 01) e está aqui só
para deixar claro que nenhuma ação de guilda é inacessível ao dono do canal.

| Ação | Recruta | Membro | Veterano | Oficial | Líder | Broadcaster/Mod |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Ver lista de membros e cargos | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Ver fila de pedidos pendentes | ✘ | ✘ | ✔ | ✔ | ✔ | ✔ |
| Sair da guilda | ✔ | ✔ | ✔ | ✔ | ✘¹ | — |
| Convidar (gerar convite) | ✘ | ✘ | ✔ | ✔ | ✔ | ✔ |
| Revogar convite que **ele** criou | ✘ | ✘ | ✔ | ✔ | ✔ | ✔ |
| Revogar convite de terceiros | ✘ | ✘ | ✘ | ✔ | ✔ | ✔ |
| Aprovar pedido de entrada | ✘ | ✘ | ✘ | ✔ | ✔ | ✔ |
| Recusar pedido de entrada | ✘ | ✘ | ✘ | ✔ | ✔ | ✔ |
| Expulsar membro | ✘ | ✘ | ✘ | ✔² | ✔² | ✔ |
| Promover — até que cargo | ✘ | ✘ | ✘ | até **Veterano** | até **Oficial** | até Oficial |
| Rebaixar | ✘ | ✘ | ✘ | ✔² | ✔² | ✔ |
| Editar descrição / lema | ✘ | ✘ | ✘ | ✔³ | ✔³ | ✔ |
| Mudar modo de entrada | ✘ | ✘ | ✘ | ✘ | ✔ | ✔ |
| Declarar guerra (fase 05) | ✘ | ✘ | ✘ | ✔ | ✔ | ✔ |
| Transferir liderança | ✘ | ✘ | ✘ | ✘ | ✔ | ✔⁴ |
| Dissolver guilda | ✘ | ✘ | ✘ | ✘ | ✔ | ✔ |

¹ Líder só sai depois de transferir a liderança (R17); guilda com 1 membro é exceção (R18).
² Só contra cargo **estritamente inferior** ao do ator (R7). Oficial não expulsa oficial.
³ Reentra na fila de moderação da fase 01 (`status` do texto volta a `pending`).
⁴ Broadcaster/mod só transfere liderança em caso de sucessão travada (líder banido); vira `audit_log`.

Regra única por trás da tabela: **ninguém age sobre igual ou superior, e ninguém cria
alguém do próprio nível.**

## 5. Modelo de dados (delta)

Só o que a fase 02 acrescenta. As tabelas base estão em `docs/ARQUITETURA.md`.

```sql
-- ---------- guild: modo de entrada e lema ----------
CREATE TYPE join_mode AS ENUM ('open', 'approval', 'closed');

ALTER TABLE guild
  ADD COLUMN join_mode    join_mode   NOT NULL DEFAULT 'approval',
  ADD COLUMN motto        varchar(80),
  ADD COLUMN member_count integer     NOT NULL DEFAULT 0,   -- denormalizado, mantido na mesma tx
  ADD CONSTRAINT guild_member_count_ck
      CHECK (member_count >= 0 AND member_count <= member_limit);

-- necessária para a FK composta de guild_member
ALTER TABLE guild ADD CONSTRAINT guild_id_channel_uk UNIQUE (id, channel_id);

-- ---------- guild_member: tenant, trilha de cargo, procedência ----------
ALTER TABLE guild_member
  ADD COLUMN channel_id      bigint      NOT NULL,
  ADD COLUMN invited_by_user_id text,
  ADD COLUMN role_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN role_changed_by text,
  ADD CONSTRAINT guild_member_guild_fk
      FOREIGN KEY (guild_id, channel_id) REFERENCES guild (id, channel_id) ON DELETE CASCADE;

-- R1: um viewer, uma guilda por canal
CREATE UNIQUE INDEX guild_member_one_per_channel_uk
  ON guild_member (channel_id, user_id);

-- R19: exatamente um líder por guilda
CREATE UNIQUE INDEX guild_member_single_leader_uk
  ON guild_member (guild_id) WHERE role = 'leader';

CREATE INDEX guild_member_by_guild_ix ON guild_member (guild_id, role);

-- ---------- pedidos de entrada ----------
CREATE TYPE join_request_status AS ENUM
  ('pending', 'approved', 'rejected', 'cancelled', 'expired');

CREATE TABLE guild_join_request (
  id              bigserial PRIMARY KEY,
  channel_id      bigint      NOT NULL REFERENCES channel (id),
  guild_id        bigint      NOT NULL,
  user_id         text        NOT NULL,
  message         varchar(140),
  status          join_request_status NOT NULL DEFAULT 'pending',
  decided_by_user_id text,
  decided_at      timestamptz,
  expires_at      timestamptz NOT NULL,           -- created_at + 7 dias (R11)
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gjr_guild_fk FOREIGN KEY (guild_id, channel_id)
      REFERENCES guild (id, channel_id) ON DELETE CASCADE,
  CONSTRAINT gjr_decided_ck CHECK (
      (status = 'pending' AND decided_at IS NULL)
   OR (status <> 'pending' AND decided_at IS NOT NULL)),
  CONSTRAINT gjr_expires_ck CHECK (expires_at > created_at)
);

-- no máximo 1 pedido pendente por viewer por guilda
CREATE UNIQUE INDEX gjr_one_pending_per_guild_uk
  ON guild_join_request (guild_id, user_id) WHERE status = 'pending';

-- R13: no máximo 3 pendentes por viewer por canal -> validado na aplicação
CREATE INDEX gjr_pending_by_user_ix
  ON guild_join_request (channel_id, user_id) WHERE status = 'pending';
CREATE INDEX gjr_queue_ix
  ON guild_join_request (guild_id, created_at) WHERE status = 'pending';

-- ---------- convites ----------
CREATE TYPE invite_status AS ENUM
  ('pending', 'accepted', 'declined', 'revoked', 'expired');

CREATE TABLE guild_invite (
  id                bigserial PRIMARY KEY,
  channel_id        bigint      NOT NULL REFERENCES channel (id),
  guild_id          bigint      NOT NULL,
  invitee_user_id   text        NOT NULL,          -- convite é nominal, não link público
  code              varchar(24) NOT NULL,          -- opaco, usado no deep link da extensão
  created_by_user_id text       NOT NULL,
  status            invite_status NOT NULL DEFAULT 'pending',
  expires_at        timestamptz NOT NULL,          -- created_at + 72 h (R14)
  responded_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gi_guild_fk FOREIGN KEY (guild_id, channel_id)
      REFERENCES guild (id, channel_id) ON DELETE CASCADE,
  CONSTRAINT gi_code_uk UNIQUE (channel_id, code),
  CONSTRAINT gi_no_self_invite_ck CHECK (invitee_user_id <> created_by_user_id),
  CONSTRAINT gi_expires_ck CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX gi_one_pending_per_invitee_uk
  ON guild_invite (guild_id, invitee_user_id) WHERE status = 'pending';

-- ---------- histórico de saída e cooldown ----------
CREATE TYPE exit_reason AS ENUM ('left', 'kicked', 'disbanded', 'purged');

CREATE TABLE guild_membership_history (
  id             bigserial PRIMARY KEY,
  channel_id     bigint      NOT NULL REFERENCES channel (id),
  guild_id       bigint      NOT NULL,              -- sem FK: sobrevive à dissolução da guilda
  user_id        text        NOT NULL,
  role_at_exit   text        NOT NULL,
  reason         exit_reason NOT NULL,
  actor_user_id  text,                              -- NULL em saída voluntária
  joined_at      timestamptz NOT NULL,
  left_at        timestamptz NOT NULL DEFAULT now(),
  cooldown_until timestamptz,                       -- NULL = sem cooldown (R12)
  CONSTRAINT gmh_actor_ck CHECK (reason <> 'kicked' OR actor_user_id IS NOT NULL),
  CONSTRAINT gmh_period_ck CHECK (left_at >= joined_at)
);

CREATE INDEX gmh_cooldown_ix
  ON guild_membership_history (channel_id, user_id, cooldown_until DESC);
```

### Tipos novos em `guild_event`

Sem pipeline próprio: tudo cai em `guild_event` (ARQUITETURA §guild_event).

| `type` | `payload` |
|---|---|
| `member.joined` | `{ user_id, role, via: 'open'\|'request'\|'invite' }` |
| `member.left` | `{ user_id, role_at_exit }` |
| `member.kicked` | `{ user_id, role_at_exit, actor_user_id }` |
| `member.promoted` / `member.demoted` | `{ user_id, from_role, to_role, actor_user_id }` |
| `join.requested` / `join.approved` / `join.rejected` | `{ request_id, user_id, actor_user_id? }` |
| `invite.created` / `invite.accepted` / `invite.declined` | `{ invite_id, invitee_user_id, actor_user_id }` |
| `guild.leadership_transferred` | `{ from_user_id, to_user_id, mode: 'manual'\|'succession' }` |
| `guild.join_mode_changed` | `{ from, to, actor_user_id }` |
| `guild.emptied` / `guild.disbanded` | `{ actor_user_id?, member_count_at_exit }` |

`external_id` fica `NULL` nesses eventos (não vêm de webhook da Twitch); a chave de
idempotência é a própria transação + constraint de estado.

## 6. API

Base `/api/v1`, JWT da Twitch obrigatório. `:gid` = guild id. Todo erro segue
`{ error: { code, message } }`.

| Método | Rota | Quem pode | Request | Response 2xx | Erros |
|---|---|---|---|---|---|
| GET | `/guilds/:gid/members` | qualquer viewer do canal | `?cursor=&limit=` | `{ members:[{user_id,display_name,role,joined_at}], next_cursor }` | `GUILD_NOT_FOUND` |
| POST | `/guilds/:gid/join` | viewer sem guilda no canal | `{ message? }` | `201 {status:'joined',role:'recruit'}` ou `202 {status:'pending',request_id}` | `ALREADY_IN_GUILD` `GUILD_FULL` `GUILD_CLOSED` `GUILD_NOT_ACTIVE` `JOIN_COOLDOWN` `REQUEST_ALREADY_PENDING` `RATE_LIMITED` |
| DELETE | `/guilds/:gid/members/me` | membro | — | `204` | `NOT_A_MEMBER` `LEADER_MUST_TRANSFER` |
| GET | `/guilds/:gid/requests` | veterano+ | `?status=pending&cursor=` | `{ requests:[{id,user_id,message,created_at,expires_at}], next_cursor }` | `FORBIDDEN_ROLE` |
| POST | `/guilds/:gid/requests/:rid/approve` | oficial+ | — | `200 {status:'approved'}` | `FORBIDDEN_ROLE` `REQUEST_NOT_FOUND` `REQUEST_NOT_PENDING` `GUILD_FULL` `ALREADY_IN_GUILD` `JOIN_COOLDOWN` |
| POST | `/guilds/:gid/requests/:rid/reject` | oficial+ | `{ reason? }` | `200 {status:'rejected'}` | `FORBIDDEN_ROLE` `REQUEST_NOT_FOUND` `REQUEST_NOT_PENDING` |
| DELETE | `/guilds/:gid/requests/mine` | autor do pedido | — | `204` (status→`cancelled`) | `REQUEST_NOT_FOUND` |
| POST | `/guilds/:gid/invites` | veterano+ | `{ invitee_user_id }` | `201 {invite_id, code, expires_at}` | `FORBIDDEN_ROLE` `GUILD_FULL` `TARGET_ALREADY_IN_GUILD` `INVITE_ALREADY_PENDING` `RATE_LIMITED` |
| GET | `/guilds/:gid/invites` | veterano+ | `?status=pending` | `{ invites:[...] }` | `FORBIDDEN_ROLE` |
| DELETE | `/guilds/:gid/invites/:iid` | autor do convite ou oficial+ | — | `204` (status→`revoked`) | `FORBIDDEN_ROLE` `INVITE_NOT_FOUND` `INVITE_NOT_PENDING` |
| GET | `/me/invites` | viewer | — | `{ invites:[{invite_id,guild:{tag,name},expires_at}] }` | — |
| POST | `/invites/:code/accept` | o convidado | — | `200 {guild_id, role:'recruit'}` | `INVITE_NOT_FOUND` `INVITE_EXPIRED` `INVITE_NOT_PENDING` `GUILD_FULL` `ALREADY_IN_GUILD` `JOIN_COOLDOWN` |
| POST | `/invites/:code/decline` | o convidado | — | `204` | `INVITE_NOT_FOUND` `INVITE_NOT_PENDING` |
| DELETE | `/guilds/:gid/members/:uid` | oficial+ | `{ reason? }` | `204` | `FORBIDDEN_ROLE` `CANNOT_TARGET_HIGHER_ROLE` `TARGET_NOT_MEMBER` `CANNOT_KICK_LEADER` |
| PATCH | `/guilds/:gid/members/:uid/role` | oficial+ | `{ role }` | `200 {user_id, from_role, to_role}` | `FORBIDDEN_ROLE` `CANNOT_TARGET_HIGHER_ROLE` `CANNOT_PROMOTE_TO_OWN_ROLE` `INVALID_ROLE_TRANSITION` `TARGET_NOT_MEMBER` |
| POST | `/guilds/:gid/leadership` | líder (ou mod, R20) | `{ to_user_id }` | `200 {leader_user_id}` | `FORBIDDEN_ROLE` `TARGET_NOT_MEMBER` |
| PATCH | `/guilds/:gid/settings` | ver matriz | `{ join_mode?, description?, motto? }` | `200 {join_mode, description_status}` | `FORBIDDEN_ROLE` `INVALID_JOIN_MODE` `TEXT_REJECTED` |
| DELETE | `/guilds/:gid` | líder | `{ confirm_tag }` | `204` | `FORBIDDEN_ROLE` `CONFIRM_MISMATCH` |

Notas:
- `403 FORBIDDEN_ROLE` é sempre por cargo dentro da guilda; `401` é JWT inválido (fase 01).
- Toda rota que altera quadro roda em uma transação com `SELECT ... FROM guild WHERE id=:gid FOR UPDATE`.
- `PATCH /settings` com `description`/`motto` devolve o texto para a fila de moderação da fase 01.

## 7. Regras de negócio

| # | Regra | Como testar |
|---|---|---|
| **R1** | Um viewer pertence a **no máximo uma** guilda por canal, e pode estar em guildas de canais diferentes ao mesmo tempo. Garantido por `guild_member_one_per_channel_uk`. | Entrar em B estando em A no mesmo canal → `ALREADY_IN_GUILD`. Entrar em canal diferente → 201. |
| **R2** | Entrada só é permitida se `guild.status = 'active'`. Guilda `pending`, `suspended` ou `banned` recusa entradas, pedidos e convites. | `GUILD_NOT_ACTIVE`. |
| **R3** | Toda entrada valida `member_count < member_limit` **dentro** da transação que insere, com a linha de `guild` travada. `member_limit` é lido de `guild` e é **derivado do nível** (fase 03, R10): **10** no Nv.1, 15 no Nv.10, teto 40 no Nv.50. Nunca escrito à mão. | 2 aprovações concorrentes na última vaga: uma 200, outra `GUILD_FULL`. |
| **R4** | Guilda cheia **não** rejeita nem cancela pedidos pendentes: eles ficam na fila. A aprovação é que falha com `GUILD_FULL`. Assim que alguém sai, o próximo pedido pendente já pode ser aprovado. | Encher, tentar aprovar → `GUILD_FULL`; expulsar 1, aprovar de novo → 200. |
| **R5** | Guilda cheia continua aceitando **novos** pedidos (fila) mas recusa **novos convites** com `GUILD_FULL` — convite é promessa de vaga. | — |
| **R6** | Todo novo membro entra como `recruit`, qualquer que seja a via (aberta, pedido ou convite). Não existe entrada direta em cargo. | Checar `role` após cada um dos 3 fluxos. |
| **R7** | Um ator só age (expulsar, promover, rebaixar) sobre membro de cargo **estritamente inferior** ao seu. Oficial não toca em oficial nem no líder. | Oficial expulsa oficial → `CANNOT_TARGET_HIGHER_ROLE`. |
| **R8** | **Nenhum cargo promove alguém ao próprio nível.** Oficial promove até `veteran`; líder promove até `officer`. Único caminho para `leader` é a transferência de liderança (R19). | Oficial promove a `officer` → `CANNOT_PROMOTE_TO_OWN_ROLE`. |
| **R9** | Promoção e rebaixamento andam **um degrau por vez** na escada `recruit < member < veteran < officer < leader`. Pular degrau → `INVALID_ROLE_TRANSITION`. | `PATCH role` de `recruit` para `officer` → erro. |
| **R10** | Rebaixar um `recruit` é inválido; expulsão é ação separada e explícita. | `INVALID_ROLE_TRANSITION`. |
| **R11** | Pedido pendente expira em **7 dias** (`expires_at`); job diário marca `expired`. Pedido expirado não bloqueia um novo. | Avançar relógio, rodar job, repetir pedido → 202. |
| **R12** | **Cooldown de reentrada** (anti-farm de troca de guilda), por canal: saída voluntária = **24 h** para entrar em *qualquer* guilda do canal; expulsão = **72 h** para a *mesma* guilda e 24 h para as demais; pedido recusado = **24 h** para pedir de novo à mesma guilda. Dissolução (`disbanded`) = **sem cooldown**. Aplicado na entrada, na aprovação e no aceite de convite. | `JOIN_COOLDOWN` com `retry_after` na mensagem; após o prazo, 201. |
| **R13** | Anti-spam: máximo **3 pedidos pendentes** por viewer por canal e **5 pedidos por hora**; máximo **10 convites pendentes** por guilda. | 4º pedido → `RATE_LIMITED`. |
| **R14** | Convite é **nominal e de uso único**, expira em **72 h**. Aceito/recusado/revogado/expirado não volta a `pending`. Convite para quem já é membro é recusado na criação. | Aceitar 2x → `INVITE_NOT_PENDING`. |
| **R15** | Em `join_mode='closed'`, `POST /join` retorna `GUILD_CLOSED` e **não** cria `guild_join_request`. Em `open`, não cria pedido — entra direto. Mudar o modo não afeta pedidos já pendentes. | Após `approval → closed`, aprovar pendente ainda funciona. |
| **R16** | Só o **líder** muda `join_mode`. Mudança gera `guild.join_mode_changed` e entra no `audit_log`. | Oficial tenta → `FORBIDDEN_ROLE`. |
| **R17** | O líder **não sai nem é expulso** enquanto houver outro membro: precisa transferir a liderança antes. Broadcaster/mod pode forçar a transferência. | `LEADER_MUST_TRANSFER` / `CANNOT_KICK_LEADER`. |
| **R18** | Líder sozinho pode sair: a guilda vira `status='suspended'` com 0 membros e emite `guild.emptied`. Guilda vazia por 30 dias é dissolvida pelo job (`purged`); nome e TAG entram na quarentena de 30 dias de ARQUITETURA §Ciclo de vida de nome e TAG. | Sair como único membro → guilda `suspended`. |
| **R19** | **A guilda nunca fica sem líder e nunca tem dois.** Índice único parcial `role='leader'` por guilda; transferência é uma transação única que rebaixa o antigo líder a `officer`. Guilda com 0 membros é o único estado sem líder — e não é `active`. | Tentar inserir 2º líder → violação de unique. |
| **R20** | **Líder sumido ou banido da Twitch:** sem nenhum evento do líder em `guild_event` por **30 dias**, ou marcado como banido/removido pela fase 01, o job de sucessão promove automaticamente o membro mais antigo do cargo mais alto disponível (oficial → veterano → membro → recruta), com `mode:'succession'` e registro em `audit_log`. Se a guilda só tinha o líder, aplica-se a R18. Broadcaster/mod pode antecipar a sucessão manualmente. | Simular inatividade, rodar job → novo líder, evento `guild.leadership_transferred`. |
| **R21** | Dissolver a guilda exige o líder e confirmação da TAG no corpo. Todos os membros vão para `guild_membership_history` com `reason='disbanded'` e **sem** cooldown; a guilda sai de `active`. | `CONFIRM_MISMATCH` com TAG errada. |
| **R22** | Toda mudança de quadro grava exatamente **um** `guild_event` na mesma transação da mudança. Ação repetida sobre estado já final (aprovar 2x, expulsar quem já saiu) retorna erro de estado e **não** gera evento novo. | Contar linhas de `guild_event` após replay do comando. |
| **R23** | Ações de moderação do canal (broadcaster/mod) sobre quadro de guilda geram `audit_log` (fase 01) além do `guild_event`. | — |
| **R24** | `member_count` é atualizado na mesma transação de todo INSERT/DELETE em `guild_member` e a `CHECK` impede ultrapassar `member_limit`. Se `member_limit` cair abaixo do atual (rebaixamento de nível na fase 03), ninguém é expulso: a guilda entra em `overflow` (fase 03, R10) e recusa entradas até `member_count < member_limit`. | Reduzir `member_limit`, tentar entrar → `GUILD_FULL`. |

## 8. Comandos de chat

Prefixo `!guilda`. Alvo por `@usuario`. Guilda por TAG (única no canal — ARQUITETURA).
Toda resposta é uma linha só; erro responde o mesmo `code` da API em texto.

| Sintaxe | Quem pode | Resposta esperada |
|---|---|---|
| `!guilda entrar <TAG>` | viewer sem guilda no canal | aberta: `@vc entrou na [VOID] como Recruta.` · aprovação: `Pedido enviado para [VOID]. 3 pedidos na fila.` · fechada: `[VOID] é fechada, só entra por convite.` |
| `!guilda sair` | membro | `@vc saiu da [VOID]. Pode entrar em outra guilda em 24h.` · líder: `Transfira a liderança antes de sair: !guilda lider @alguem` |
| `!guilda membros` | qualquer um | `[VOID] 14/15 — Líder: @x · Oficiais: @y, @z · +11 membros` |
| `!guilda pedidos` | veterano+ | `[VOID] 3 pendentes: @a (2d), @b (1d), @c (3h)` |
| `!guilda aceitar @user` | oficial+ | `@user entrou na [VOID] como Recruta.` · `[VOID] está cheia (20/20).` |
| `!guilda recusar @user` | oficial+ | `Pedido de @user recusado.` |
| `!guilda convidar @user` | veterano+ | `Convite enviado para @user. Expira em 72h.` |
| `!guilda aceitar-convite <TAG>` | convidado | `@vc entrou na [VOID] como Recruta.` |
| `!guilda recusar-convite <TAG>` | convidado | `Convite de [VOID] recusado.` |
| `!guilda expulsar @user` | oficial+ | `@user foi removido da [VOID] por @ator.` · `Você não pode expulsar alguém de cargo igual ou superior.` |
| `!guilda promover @user` | oficial+ | `@user agora é Veterano da [VOID].` · `Você não pode promover ao seu próprio cargo.` |
| `!guilda rebaixar @user` | oficial+ | `@user agora é Membro da [VOID].` |
| `!guilda lider @user` | líder | `@user agora lidera a [VOID]. @antigo virou Oficial.` |
| `!guilda modo <aberta\|aprovacao\|fechada>` | líder | `[VOID] agora é por aprovação.` |
| `!guilda dissolver <TAG>` | líder | `[VOID] foi dissolvida. 14 membros liberados.` |

Paridade: **todo comando de chat tem equivalente na extensão** (seção 6); nada é
exclusivo do chat ou do painel.

## 9. Riscos e decisões em aberto

| # | Assunto | Situação |
|---|---|---|
| 1 | ~~Default de `member_limit`~~ — **resolvido:** derivado do nível pela fase 03 (10 → 40). |
| 2 | Números de cooldown (24 h / 72 h) e de expiração (7 d / 72 h) não vieram do brief. São arbitrários e devem virar `channel.settings` se o streamer reclamar. | Aberto. |
| 3 | Sucessão automática em 30 dias pode ser lenta demais para um canal ativo, e rápida demais para um líder que só saiu de férias. | Aberto: talvez janela configurável por canal. |
| 4 | Auto-promoção de `recruit` para `member` por tempo ou por atividade não está no brief. Sem isso, alguém tem que promover manualmente todo mundo. | Aberto. Depende do XP individual da fase 03. |
| 5 | `user_id` da Twitch vs `opaque_user_id`: convite nominal exige identidade real; viewer que não deu consentimento de identidade na extensão não pode ser convidado. | Precisa de fallback (convidar por nome de chat?) ou aceitar a limitação. |
| 6 | Cooldown por canal é burlável por viewer com contas alternativas. Não há mitigação barata. | Aceito como risco. |
| 7 | ~~Nome e TAG liberados na hora~~ — **resolvido:** quarentena única de 30 dias em ARQUITETURA §Ciclo de vida de nome e TAG. |
| 8 | Lema (`motto`) é texto livre e passa pela moderação da fase 01; isso aumenta a fila de moderação do streamer. | Aceito. |

## 10. Critérios de aceite

Quadro e cargos:
- [ ] Viewer entra em guilda `open` por chat e pelo botão da extensão, e sai como `recruit` em ambos.
- [ ] Viewer em uma guilda recebe `ALREADY_IN_GUILD` ao tentar entrar em outra do mesmo canal, e entra normalmente em guilda de outro canal.
- [ ] Pedido em guilda `approval` aparece na fila para veterano+, e só oficial+ consegue aprovar/recusar.
- [ ] `!guilda entrar` em guilda `closed` responde `GUILD_CLOSED` e não cria registro em `guild_join_request`.
- [ ] Convite nominal expira em 72 h, é de uso único e não pode ser aceito por outro viewer.

Limites e concorrência:
- [ ] Duas aprovações simultâneas na última vaga: exatamente uma entra; a outra recebe `GUILD_FULL`.
- [ ] Guilda cheia mantém pedidos pendentes na fila; após uma saída, o pendente é aprovável sem refazer o pedido.
- [ ] `member_count` bate com `SELECT count(*) FROM guild_member` em toda auditoria de consistência.

Permissões (a matriz da seção 4 vira suíte de teste):
- [ ] Cada célula `✘` da matriz retorna `403 FORBIDDEN_ROLE`; cada `✔` retorna 2xx.
- [ ] Oficial não expulsa, promove nem rebaixa outro oficial (`CANNOT_TARGET_HIGHER_ROLE`).
- [ ] Oficial não consegue criar outro oficial; líder não consegue criar outro líder por `PATCH role` (`CANNOT_PROMOTE_TO_OWN_ROLE`).
- [ ] Promoção pula-degrau é rejeitada (`INVALID_ROLE_TRANSITION`).

Liderança:
- [ ] Líder com outros membros não consegue sair sem transferir (`LEADER_MUST_TRANSFER`).
- [ ] Transferência é atômica: em nenhum instante existem 0 ou 2 líderes; o índice único parcial nunca é violado.
- [ ] Job de sucessão promove o oficial mais antigo após 30 dias sem evento do líder, ou imediatamente se a fase 01 marcou o líder como banido.
- [ ] Último membro sai → guilda `suspended` + evento `guild_emptied`.

Cooldown e histórico:
- [ ] Saída voluntária impede nova entrada por 24 h no mesmo canal; a mensagem informa o tempo restante.
- [ ] Expulsão impede reentrada na mesma guilda por 72 h.
- [ ] Dissolução não gera cooldown para nenhum membro.
- [ ] Toda saída tem exatamente uma linha em `guild_membership_history` com `reason` e `role_at_exit` corretos.

Eventos e auditoria:
- [ ] Cada uma das 7 transições da seção 3 grava exatamente um `guild_event` do tipo esperado.
- [ ] Comando repetido sobre estado já final não gera evento duplicado.
- [ ] Ação de broadcaster/mod sobre quadro aparece em `audit_log` com `before`/`after`.
