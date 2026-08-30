# Fase 01 — Fundação

Pré-requisito de leitura: [docs/ARQUITETURA.md](../docs/ARQUITETURA.md). Esta fase não
redefine stack, modelo base, `guild_event`, idempotência nem multi-tenant.

## 1. Objetivo

Ao fim desta fase um viewer consegue criar uma guilda pagando em Bits (pelo painel da
extensão ou iniciando por `!criarguilda`), e o streamer/mod tem uma fila de aprovação e
um conjunto de ações administrativas sobre guildas. Nada vira público sem passar pela
moderação, e toda decisão de mod fica registrada em `audit_log`.

## 2. Escopo

- Formulário de criação: nome, TAG, descrição, lema, cor principal, cor secundária,
  emblema (**placeholder**: seleção de um preset do catálogo fixo, sem editor).
- Cobrança em Bits via Bits-in-Extensions; guilda só existe depois do recibo validado.
- Comando de chat `!criarguilda <Nome>` — reserva o nome e devolve o viewer ao painel
  para completar o formulário e pagar.
- Estado inicial `pending` ("Aguardando aprovação"); guilda invisível ao público.
- Fila de moderação com nome, TAG, criador, preview do emblema e ações APROVAR/REJEITAR.
- Ações administrativas: suspender, alterar nome, alterar descrição, remover emblema,
  transferir liderança, banir.
- `guild_member` recebe a linha do líder (`role = 'leader'`).
- `member_limit` com default 10 (campo e default apenas).
- `audit_log` para toda ação de moderação.
- Eventos `guild.created` / `guild.approved` / `guild.rejected` / `guild.moderated` em
  `guild_event`.

### Fora do escopo

| Item | Fase |
|---|---|
| Entrar/sair da guilda, convites, cargos além de `leader`, modos aberta/aprovação/fechada | 02 |
| Regra de crescimento de `member_limit` por nível, XP, níveis | 03 |
| Prestígio, ranking, temporadas, conquistas | 04 |
| Guerras, territórios | 05 |
| Emblem Creator, loja cosmética, renomear/trocar TAG pago, qualquer Bits além da criação | 06 |
| Anúncio automático no chat de aprovação/rejeição | 07 |
| Guildas cross-canal, upload de imagem própria | v2 / nunca |

## 3. Fluxos

### 3.1 Criação + pagamento (caminho feliz)

```
1. Viewer abre o painel → POST /guilds (nome, tag, descrição, lema, cores, emblema)
2. EBS valida formato + palavrão + colisão de nome/TAG (transação)
   └─ INSERT guild (status='pending', payment_status='awaiting',
                    reserved_until = now() + 15 min)
3. EBS responde { guild_id, sku, bits_cost }
4. Extensão chama twitch.bits.useBits(sku) → Twitch cobra o viewer
5. Extensão recebe o recibo JWT → POST /guilds/:id/transaction { receipt }
6. EBS valida assinatura do recibo com o Extension Secret, confere
   product.sku, product.cost.amount e channelId
   └─ INSERT guild_event (type='guild.created',
                          external_id = transaction.id)   -- idempotência
   └─ UPDATE guild SET payment_status='paid', reserved_until=NULL
   └─ INSERT guild_member (guild_id, leader_user_id, 'leader')
7. Guilda entra na fila de moderação. Viewer vê "Aguardando aprovação".
```

Caminho por chat: `!criarguilda NomeDaGuilda` → bot do canal chama
`POST /chat/guild-drafts` → mesma validação do passo 2, guilda criada só com `name` e
`reserved_until`; o viewer completa o resto em `PATCH /guilds/:id` e segue do passo 4.

### 3.2 Falha / abandono de pagamento

```
Passo 4 ou 5 não completa em 15 min
  └─ job reaper (BullMQ, roda a cada 1 min)
       DELETE FROM guild WHERE payment_status='awaiting' AND reserved_until < now()
  └─ nome e TAG voltam a ficar livres. Nada em audit_log (não houve ação humana).
```

### 3.3 Aprovação

```
Mod abre a fila → GET /mod/guilds?status=pending
POST /mod/guilds/:id/approve
  └─ UPDATE guild SET status='active', reviewed_by_user_id, reviewed_at
  └─ INSERT guild_event (type='guild.approved')
  └─ INSERT audit_log (action='guild.approve', before={status:'pending'},
                       after={status:'active'})
```

### 3.4 Rejeição

```
POST /mod/guilds/:id/reject { reason, fields: ["name","description","emblem"] }
  └─ UPDATE guild SET status='rejected_draft'? → NÃO.
     Rejeição usa status='suspended' + reject_reason, guilda continua existindo
     e o líder pode corrigir os campos apontados e reenviar (POST /guilds/:id/resubmit,
     volta a 'pending'). O nome/TAG continua reservado para ele.
  └─ INSERT guild_event (type='guild.rejected')
  └─ INSERT audit_log (action='guild.reject', after={reason, fields})
```

Rejeição **não** devolve Bits (a Twitch não expõe estorno programático — ver §8).

### 3.5 Ação de moderação genérica

```
POST /mod/guilds/:id/{suspend|ban|transfer-leader}  ou  PATCH /mod/guilds/:id
  └─ UPDATE guild ...
  └─ INSERT audit_log (actor_user_id do JWT, action, target='guild:<id>', before, after)
  └─ INSERT guild_event (type='guild.moderated', payload={action})
```

## 4. Modelo de dados (delta desta fase)

`channel`, `guild`, `guild_member`, `guild_event` e `audit_log` já existem no modelo base.
Abaixo só o que esta fase acrescenta.

```sql
-- guild: campos do formulário de criação e do ciclo de pagamento/revisão
ALTER TABLE guild
  ADD COLUMN creator_user_id     text        NOT NULL,
  ADD COLUMN motto               varchar(80),
  ADD COLUMN color_primary       char(7)     NOT NULL DEFAULT '#9146FF',
  ADD COLUMN color_secondary     char(7)     NOT NULL DEFAULT '#EFEFF1',
  ADD COLUMN emblem_preset       varchar(32),          -- catálogo fixo; fase 06 substitui
  ADD COLUMN payment_status      text        NOT NULL DEFAULT 'awaiting',
  ADD COLUMN bits_amount         integer,
  ADD COLUMN bits_transaction_id text,
  ADD COLUMN reserved_until      timestamptz,          -- só enquanto awaiting
  ADD COLUMN reviewed_by_user_id text,
  ADD COLUMN reviewed_at         timestamptz,
  ADD COLUMN reject_reason       varchar(280);

ALTER TABLE guild ALTER COLUMN member_limit SET DEFAULT 10;

ALTER TABLE guild
  ADD CONSTRAINT guild_status_chk
    CHECK (status IN ('pending','active','suspended','banned')),
  ADD CONSTRAINT guild_payment_status_chk
    CHECK (payment_status IN ('awaiting','paid','refunded')),
  ADD CONSTRAINT guild_name_fmt_chk
    CHECK (name ~ '^[A-Za-z0-9]([A-Za-z0-9 ]{1,22}[A-Za-z0-9])$'),
  ADD CONSTRAINT guild_tag_fmt_chk
    CHECK (tag ~ '^[A-Z0-9]{2,5}$'),
  ADD CONSTRAINT guild_desc_len_chk
    CHECK (description IS NULL OR char_length(description) <= 280),
  ADD CONSTRAINT guild_color_fmt_chk
    CHECK (color_primary ~ '^#[0-9A-F]{6}$' AND color_secondary ~ '^#[0-9A-F]{6}$'),
  -- pago obriga transação; não-pago proíbe
  ADD CONSTRAINT guild_paid_has_tx_chk
    CHECK ((payment_status = 'awaiting') = (bits_transaction_id IS NULL)),
  ADD CONSTRAINT guild_reservation_chk
    CHECK ((payment_status = 'awaiting') = (reserved_until IS NOT NULL));

-- Unicidade por canal, case-insensitive, incluindo pendentes, suspensas e banidas.
CREATE UNIQUE INDEX guild_channel_name_uniq ON guild (channel_id, lower(name));
CREATE UNIQUE INDEX guild_channel_tag_uniq  ON guild (channel_id, tag);

-- Uma transação de Bits nunca cria duas guildas.
CREATE UNIQUE INDEX guild_bits_tx_uniq ON guild (bits_transaction_id)
  WHERE bits_transaction_id IS NOT NULL;

-- Um viewer lidera no máximo uma guilda viva por canal.
CREATE UNIQUE INDEX guild_one_per_leader_uniq ON guild (channel_id, leader_user_id)
  WHERE status <> 'banned';

CREATE INDEX guild_mod_queue_idx ON guild (channel_id, created_at)
  WHERE status = 'pending' AND payment_status = 'paid';
CREATE INDEX guild_reaper_idx ON guild (reserved_until)
  WHERE payment_status = 'awaiting';

-- audit_log: consulta pelo painel de moderação
CREATE INDEX audit_log_channel_idx ON audit_log (channel_id, created_at DESC);
CREATE INDEX audit_log_target_idx  ON audit_log (target, created_at DESC);

-- guild_member: FKs e cargo (o resto dos cargos é fase 02)
ALTER TABLE guild_member
  ADD CONSTRAINT guild_member_guild_fk FOREIGN KEY (guild_id)
    REFERENCES guild(id) ON DELETE CASCADE;
```

`channel.settings` (jsonb) passa a ler estas chaves nesta fase:

| Chave | Default | Uso |
|---|---|---|
| `creation_enabled` | `true` | Desliga criação no canal |
| `creation_bits_cost` | `500` | Custo esperado; validado contra o recibo |
| `creation_sku` | `guild_creation_500` | SKU do produto de Bits |
| `name_denylist` | `[]` | Palavras extras bloqueadas além da lista global |
| `default_member_limit` | `10` | Valor gravado em `guild.member_limit` |

Tipos usados em `guild_event.type` nesta fase: `guild.created`, `guild.approved`,
`guild.rejected`, `guild.moderated`. Só `guild.created` tem `external_id`
(= id da transação de Bits).

## 5. API

Base `/api/v1`. Todas exigem JWT da Twitch. `mod` = `role in (broadcaster, moderator)`.

| Método | Rota | Quem | Request | Response 2xx | Erros |
|---|---|---|---|---|---|
| `POST` | `/guilds` | viewer | `{name, tag, description?, motto?, color_primary, color_secondary, emblem_preset?}` | `201 {guild_id, sku, bits_cost, reserved_until}` | `VALIDATION_ERROR` 400, `GUILD_NAME_INVALID` 400, `GUILD_TAG_INVALID` 400, `GUILD_NAME_FORBIDDEN` 422, `GUILD_NAME_TAKEN` 409, `GUILD_TAG_TAKEN` 409, `ALREADY_HAS_GUILD` 409, `CREATION_DISABLED` 403, `RATE_LIMITED` 429 |
| `PATCH` | `/guilds/:id` | criador, enquanto `awaiting` ou `suspended` com `reject_reason` | campos do formulário | `200 {guild}` | `FORBIDDEN` 403, `GUILD_NOT_FOUND` 404, `GUILD_NOT_EDITABLE` 409, + validação |
| `POST` | `/guilds/:id/transaction` | criador | `{receipt}` (JWT do Bits) | `200 {guild_id, status:"pending"}` | `PAYMENT_INVALID_RECEIPT` 400, `PAYMENT_SKU_MISMATCH` 400, `PAYMENT_ALREADY_USED` 409, `RESERVATION_EXPIRED` 410 |
| `POST` | `/guilds/:id/resubmit` | líder, guilda rejeitada | — | `200 {status:"pending"}` | `FORBIDDEN` 403, `GUILD_NOT_REJECTED` 409 |
| `GET` | `/guilds/:id` | qualquer | — | `200 {guild}` — campos não-públicos (`bits_*`, `reject_reason`) só para líder e mod | `GUILD_NOT_FOUND` 404 |
| `GET` | `/guilds?cursor=&limit=` | qualquer | — | `200 {items:[guild], next_cursor}` — só `status='active'` | — |
| `POST` | `/chat/guild-drafts` | bot do canal (JWT de serviço assinado pelo EBS) | `{user_id, name}` | `201 {guild_id, panel_url}` | mesmos de `POST /guilds` |
| `GET` | `/mod/guilds?status=pending&cursor=&limit=` | mod | — | `200 {items:[{id,name,tag,creator_user_id,emblem_preset,colors,description,created_at}], total, next_cursor}` | `FORBIDDEN` 403 |
| `POST` | `/mod/guilds/:id/approve` | mod | — | `200 {status:"active"}` | `GUILD_NOT_PENDING` 409, `FORBIDDEN` 403 |
| `POST` | `/mod/guilds/:id/reject` | mod | `{reason, fields:["name"\|"description"\|"emblem"]}` | `200 {status:"suspended"}` | `GUILD_NOT_PENDING` 409, `VALIDATION_ERROR` 400 |
| `PATCH` | `/mod/guilds/:id` | mod | `{name?, description?, emblem_preset?}` (`null` em `emblem_preset` remove) | `200 {guild}` | `GUILD_NAME_TAKEN` 409, + validação |
| `POST` | `/mod/guilds/:id/suspend` | mod | `{reason}` | `200 {status:"suspended"}` | `GUILD_ALREADY_SUSPENDED` 409 |
| `POST` | `/mod/guilds/:id/unsuspend` | mod | — | `200 {status:"active"}` | `GUILD_NOT_SUSPENDED` 409 |
| `POST` | `/mod/guilds/:id/ban` | mod | `{reason}` | `200 {status:"banned"}` | `GUILD_ALREADY_BANNED` 409 |
| `POST` | `/mod/guilds/:id/transfer-leader` | mod | `{user_id}` | `200 {leader_user_id}` | `USER_NOT_MEMBER` 422, `ALREADY_HAS_GUILD` 409 |
| `GET` | `/mod/audit-log?target=&actor=&cursor=&limit=` | mod | — | `200 {items:[audit_log], next_cursor}` | `FORBIDDEN` 403 |

Formato de erro conforme arquitetura: `{ "error": { "code", "message" } }`.

## 6. Regras de negócio

| # | Regra |
|---|---|
| **R1** | Nome: 3–24 caracteres, `[A-Za-z0-9 ]`, sem espaço no início/fim e sem espaço duplo. Único por `channel_id`, case-insensitive (`lower(name)`). |
| **R2** | TAG: 2–5 caracteres, `[A-Z0-9]`, normalizada para maiúscula antes de gravar. Única por `channel_id`. |
| **R3** | Descrição ≤ 280 caracteres; lema ≤ 80; cores em `#RRGGBB` maiúsculo. Emblema: um id do catálogo de presets, ou `null`. |
| **R4** | Nome e TAG passam por denylist (lista global + `channel.settings.name_denylist`), comparação sobre a forma normalizada (minúscula, sem espaços, `leetspeak` revertido: `0→o 1→i 3→e 4→a 5→s 7→t`). Match → `GUILD_NAME_FORBIDDEN`, nada é gravado, nada é cobrado. |
| **R5** | Um viewer lidera no máximo **uma** guilda não-banida por canal (`guild_one_per_leader_uniq`). Segunda tentativa → `ALREADY_HAS_GUILD` 409. Ele pode liderar guildas em canais diferentes. |
| **R6** | **Guilda pendente ocupa o nome.** `pending`, `active`, `suspended` e `banned` participam do índice único. Só o rascunho `awaiting` expirado libera o nome, e ele é apagado, não guardado. |
| **R7** | Rascunho `awaiting` reserva nome/TAG por 15 minutos (`reserved_until`). O job reaper apaga rascunhos expirados a cada minuto. Pagar depois de expirado → `RESERVATION_EXPIRED` 410 e o recibo fica registrado para reconciliação manual (§8). |
| **R8** | Nenhuma guilda é criada sem recibo de Bits validado: assinatura contra o Extension Secret, `channel_id` do recibo igual ao do JWT, `product.sku` igual a `creation_sku` e `product.cost.amount` ≥ `creation_bits_cost`. Divergência → `PAYMENT_SKU_MISMATCH`, guilda permanece `awaiting`. |
| **R9** | Idempotência do pagamento: `INSERT guild_event (type='guild.created', external_id=transaction.id)` sob `UNIQUE (channel_id, type, external_id)`, no mesmo `BEGIN` do `UPDATE guild`. Reenvio do mesmo recibo → `200` com o estado atual (não `409`); recibo já usado por **outra** guilda → `PAYMENT_ALREADY_USED` 409. |
| **R10** | Pagamento falho ou não concluído: a guilda nunca chega em `pending`, não aparece na fila de moderação, não é visível a ninguém além do criador, e some com o reaper (R7). Sem estorno a fazer porque a Twitch não cobrou. |
| **R11** | Reembolso/chargeback detectado na reconciliação: `payment_status='refunded'` e `status='suspended'`, com `audit_log(action='guild.refund_suspend', actor_user_id='system')`. A guilda não é apagada — membros e histórico ficam. Mod pode reativar manualmente se julgar erro. |
| **R12** | Rejeição não estorna Bits e não apaga a guilda: `status='suspended'` + `reject_reason` + `fields`. O líder corrige os campos apontados e chama `/resubmit` (volta a `pending`) sem pagar de novo. Reenvios ilimitados. |
| **R13** | Guilda banida: `status='banned'`, `guild_member` **preservado** (auditoria), mas todos os membros passam a contar como sem guilda para efeito das fases 02+; nome e TAG continuam bloqueados para impedir recriação. Ban é reversível só por `PATCH` explícito de mod para `suspended` — não existe `unban` de um clique. |
| **R14** | `member_limit` grava `channel.settings.default_member_limit` (10) na criação e não muda nesta fase. Nenhum endpoint desta fase aceita `member_limit` do cliente. |
| **R15** | Rate limit por `user_id`: 3 `POST /guilds` por hora e 10 por dia; `!criarguilda` compartilha o mesmo balde. Excedido → `RATE_LIMITED` 429. |
| **R16** | `creation_enabled=false` bloqueia `POST /guilds` e `/chat/guild-drafts` com `CREATION_DISABLED` 403. Guildas já pendentes continuam moderáveis. |
| **R17** | O líder inicial é sempre o criador; `leader_user_id = creator_user_id` na criação. `creator_user_id` é imutável, inclusive após transferência de liderança. |
| **R18** | A linha `guild_member (guild_id, leader_user_id, 'leader')` é criada na confirmação do pagamento (R9), na mesma transação. Transferência de liderança troca os `role` das duas linhas; o alvo precisa já ser membro (`USER_NOT_MEMBER` 422). |
| **R19** | Guildas `pending`, `suspended` e `banned` não aparecem em `GET /guilds` nem em nenhuma listagem pública. `GET /guilds/:id` devolve o registro para o líder e para mods; para os demais, `404`. |
| **R20** | Toda mutação de mod grava `audit_log` na mesma transação da mutação. Falha ao gravar auditoria = rollback da mutação. |

## 7. Moderação e auditoria

Fila: `GET /mod/guilds?status=pending` — o total do cabeçalho "GUILDAS PENDENTES — 4" vem
de `total` na resposta, contando `status='pending' AND payment_status='paid'`.

Toda linha de `audit_log` carrega `channel_id`, `actor_user_id` (do JWT, ou `'system'`
para jobs), `action`, `target = 'guild:<uuid>'`, `before` e `after` (jsonb com apenas
os campos alterados) e `created_at`.

| `action` | Grava `before`/`after` | Reversível |
|---|---|---|
| `guild.approve` | `status` | Sim — `suspend` |
| `guild.reject` | `status`, `reject_reason`, `fields` | Sim — `resubmit` do líder ou `approve` |
| `guild.rename` | `name` | Sim — outro `PATCH` (valor antigo está no log) |
| `guild.edit_description` | `description` | Sim |
| `guild.remove_emblem` | `emblem_preset` | Sim — o preset antigo está em `before` |
| `guild.suspend` | `status`, `reason` | Sim — `unsuspend` |
| `guild.unsuspend` | `status` | Sim |
| `guild.transfer_leader` | `leader_user_id` | Sim — nova transferência |
| `guild.ban` | `status`, `reason` | Parcial — `PATCH` de mod para `suspended`; nome/TAG seguem bloqueados |
| `guild.refund_suspend` | `payment_status`, `status` | Manual |

`audit_log` é append-only: sem `UPDATE`, sem `DELETE`, sem endpoint de escrita direta.
O reaper de rascunhos (R7) não gera auditoria — não houve ator humano nem cobrança.

## 8. Riscos e decisões em aberto

| # | Risco / questão | Situação |
|---|---|---|
| 1 | **Bits é assíncrono e reembolsável.** O recibo JWT chega ao cliente, mas a Twitch confirma a transação depois, no relatório do desenvolvedor, e pode estornar (chargeback, fraude, suporte). Uma guilda pode existir e estar aprovada com um pagamento que depois some. | Mitigação nesta fase: job diário de reconciliação lê o relatório de transações e aplica R11. Aceito conscientemente que existe uma janela de horas com guilda ativa e Bits não confirmado. |
| 2 | Recibo válido mas reserva expirada (R7) — o viewer pagou e não tem guilda. | Registrado em `guild_event` órfão para o mod resolver manualmente. **Em aberto:** vale ressuscitar o rascunho automaticamente em vez de exigir mod? |
| 3 | O cliente pode nunca chamar `/guilds/:id/transaction` (fechou a aba). Só o relatório de reconciliação revela. | **Em aberto:** aceitar perda até o job diário, ou exigir polling do relatório em minutos? |
| 4 | Autenticação do bot de chat (`/chat/guild-drafts`). Não existe JWT da Twitch para o bot. | **Resolvido:** token de canal emitido pelo EBS e rotacionado na página de config — ver ARQUITETURA §Quem chama o EBS. Comando de chat só inicia fluxo; pagar exige o painel. |
| 5 | Denylist de palavrão é fraca por natureza — leetspeak, PT/EN, e nomes ofensivos que passam por qualquer lista. | Aceito: a moderação humana é a defesa real. A denylist só evita o caso óbvio antes de cobrar Bits. |
| 6 | Guilda banida bloqueia nome/TAG para sempre (R13). Em canais grandes isso vai esgotar TAGs de 2–3 letras. | **Em aberto:** liberar nome/TAG de guilda banida após N dias? |
| 7 | Rejeição não estorna, e o viewer pagou. | **Resolvido pela fase 06:** crédito de identidade de 100% do valor, válido 180 dias, intransferível. A Twitch não expõe API de estorno de Bits. |
| 8 | `emblem_preset` é placeholder e a fase 06 provavelmente troca a coluna. | Aceito: coluna simples de descartar; nada além do painel lê ela nesta fase. |

## 9. Critérios de aceite

- [ ] `POST /guilds` com nome de 2 ou 25 caracteres, com acento, ou com `_` → `GUILD_NAME_INVALID` 400.
- [ ] `POST /guilds` com TAG `void` → gravada como `VOID`; TAG de 1 ou 6 caracteres → `GUILD_TAG_INVALID` 400.
- [ ] Dois `POST /guilds` simultâneos com `"Void"` e `"void"` no mesmo canal: um `201`, outro `GUILD_NAME_TAKEN` 409 (garantido pelo índice único, não por `SELECT` prévio).
- [ ] O mesmo nome em dois canais diferentes: ambos `201`.
- [ ] Guilda `awaiting` bloqueia o nome; após 16 minutos sem pagamento a linha some e o nome é reutilizável.
- [ ] `POST /guilds/:id/transaction` com recibo assinado por outra chave → `PAYMENT_INVALID_RECEIPT` 400 e guilda permanece `awaiting`.
- [ ] Mesmo recibo enviado 3 vezes → uma linha em `guild_event`, uma em `guild_member`, respostas `200` idênticas.
- [ ] Recibo com `cost.amount` menor que `creation_bits_cost` → `PAYMENT_SKU_MISMATCH` 400.
- [ ] Guilda `awaiting` não aparece em `GET /mod/guilds?status=pending`; após pagamento aparece, com `total` correto.
- [ ] `GET /guilds` (público) não retorna guildas `pending`, `suspended` nem `banned`.
- [ ] `POST /mod/guilds/:id/approve` chamado por viewer sem role de mod → `FORBIDDEN` 403.
- [ ] Aprovar → `status='active'`, uma linha em `guild_event` (`guild.approved`) e uma em `audit_log` com `actor_user_id` do mod.
- [ ] Rejeitar → `status='suspended'`, `reject_reason` preenchido; líder edita e `resubmit` volta para `pending` sem nova cobrança.
- [ ] `PATCH /mod/guilds/:id` com `emblem_preset: null` remove o emblema e `audit_log.before` contém o preset anterior.
- [ ] Banir → `status='banned'`, linhas de `guild_member` intactas, nome ainda bloqueado para um novo `POST /guilds`.
- [ ] Transferir liderança para não-membro → `USER_NOT_MEMBER` 422; para membro → `role` das duas linhas trocado e `creator_user_id` inalterado.
- [ ] Segundo `POST /guilds` do mesmo viewer no mesmo canal com guilda viva → `ALREADY_HAS_GUILD` 409; no canal B → `201`.
- [ ] `member_limit` da guilda criada = 10 e nenhum endpoint aceita esse campo do cliente.
- [ ] Forçar erro no `INSERT audit_log` durante `approve` → guilda continua `pending` (rollback, R20).
- [ ] `GET /mod/audit-log?target=guild:<id>` devolve todas as ações da guilda em ordem decrescente, com paginação por cursor.
