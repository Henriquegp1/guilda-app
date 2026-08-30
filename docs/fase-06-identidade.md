# Fase 06 — Identidade Visual e Economia

Depende da **fase 02** (cargos e permissões). Roda em paralelo às fases 03–05.
Contrato base: [docs/ARQUITETURA.md](../docs/ARQUITETURA.md). Nada aqui redefine
criação de guilda, fila de moderação, auditoria ou cargos — isso é fase 01 e 02.

## 1. Objetivo

Dar a cada guilda uma identidade visual própria sem abrir a porta para upload de
imagem arbitrária, através de um **Emblem Creator** que combina peças de um catálogo
curado. E fechar a economia de Bits: o que Bits compram, o que custam, e a linha que
separa cosmético de vantagem competitiva.

## 2. Escopo

| Dentro | Fora |
|---|---|
| Emblem Creator (catálogo de camadas) | Upload de imagem própria |
| Armazenamento declarativo do brasão (JSON de ids) | Editor livre de vetor / desenho à mão |
| Renderização SVG no cliente + PNG no EBS | Animação do emblema (só efeito estático na v1) |
| Slots de emblema por guilda | Emblema por membro / avatar individual |
| Troca de nome e TAG paga em Bits | Preço de **criação** de guilda (fase 01) |
| Tabela de preços e entitlements | Régua de qual nível desbloqueia o quê (fase 03) |
| Moderação de identidade (nome, TAG, brasão) | Fila de aprovação de guilda nova (fase 01) |
| Crédito de identidade por rejeição | Estorno de Bits na Twitch (não existe API) |

### Upload de imagem própria — condições de entrada

Fica para uma fase posterior (candidata: pós-07). Entra só quando **todas** valerem:

1. Fila de moderação de identidade com SLA medido e < 24h de p95 há 30 dias.
2. Pipeline de scan automático (hash de conteúdo conhecido + classificador NSFW) antes
   de qualquer olho humano.
3. Aprovação **obrigatória** antes de qualquer exibição pública — nunca "publica e revisa".
4. Restrito a guildas `active` com nível mínimo (fase 03 define) e sem strike de identidade.

Até lá, o catálogo é a única fonte de pixels.

## 3. Anatomia do brasão

Seis camadas, sempre nesta ordem de renderização (de baixo para cima). `shape` recorta
tudo acima dela via `clipPath` — nenhuma camada vaza da silhueta.

| # | Camada | Papel | Opções v1 | Grátis | Desbloqueável (fase 03) | Paga (Bits) | Obrigatória? |
|---|---|---|---|---|---|---|---|
| 1 | `shape` | silhueta do escudo | 8 | 4 | 3 | 1 | sim |
| 2 | `background` | fundo: liso, gradiente ou padrão | 12 | 5 | 5 | 2 | sim |
| 3 | `palette` | par de cores aplicado a fundo/borda/símbolo | 16 | 6 | 8 | 2 | sim |
| 4 | `border` | moldura sobre a silhueta | 6 | 3 | 2 | 1 | não (`none` válido) |
| 5 | `symbol` | símbolo central | 40 | 18 | 18 | 4 | sim |
| 6 | `effect` | chamas, brilho, fumaça, partículas estáticas | 6 | 0 | 2 | 4 | não (`none` válido) |

**Total v1: 88 assets.** Combinações válidas só com peças grátis: 4 × 5 × 6 × 4 × 18 × 1 =
**8.640**. Suficiente para não haver colisão visual em canal pequeno sem gastar 1 Bit.

- `palette` é uma camada lógica, não desenhada: define `color_primary`, `color_secondary`
  e `color_accent`, que os assets das outras camadas consomem via `currentColor` /
  variáveis CSS. Nenhum asset carrega cor fixa.
- `border: none` e `effect: none` são ids reais (`border.none`, `effect.none`), não `null`.
  Isso mantém o JSON com forma fixa.
- O exemplo do brief (🛡️ + 🐉 + vermelho/preto + chamas) = `shape.heater` +
  `symbol.dragon` + `palette.crimson_black` + `effect.flames`.

## 4. Representação e renderização

### O brasão é dado, não imagem

Um brasão é um JSON de ~8 campos com ids do catálogo. Nunca um blob. Consequências
diretas: cabe numa coluna `jsonb`, versiona, difere, é auditável, e a moderação lê
**seis ids** em vez de olhar um pixel — é por isso que essa decisão barateia moderação
mais que qualquer classificador. Uma guilda não consegue desenhar uma suástica se
nenhuma peça do catálogo desenha uma.

```json
{
  "v": 1,
  "catalog_version": 3,
  "shape": "shape.heater",
  "background": "bg.diagonal_split",
  "palette": "palette.crimson_black",
  "border": "border.rope",
  "symbol": "symbol.dragon",
  "effect": "effect.flames"
}
```

### Onde renderiza

| Superfície | Formato | Quem gera | Cache |
|---|---|---|---|
| Painel da extensão, criador ao vivo | **SVG inline** montado no cliente a partir do JSON | cliente | sprite sheet do catálogo em memória |
| Lista de guildas, ranking (fases 04/05) | SVG 48px do mesmo sprite | cliente | idem |
| Painel de moderação | **PNG 256×256** | EBS | CDN, `immutable`, chave = hash do JSON |
| Chat / overlay do bot (fase 07) | **PNG 112×112** e 28×28 | EBS | idem |
| Compartilhamento externo | PNG 512×512 | EBS | idem |

- O cliente baixa **um** `catalog.svg` (sprite `<symbol>` de todos os assets liberados) +
  `catalog.json` (metadados). Trocar de peça no criador não faz request.
- O EBS renderiza PNG com o mesmo SVG, server-side (`resvg`), em job assíncrono na fila
  ao publicar o brasão. Não há render sob demanda no caminho de request.
- Chave do arquivo: `emblem/{sha256(json_canônico)}/{size}.png`. Brasões idênticos
  compartilham arquivo; republicar o mesmo brasão custa zero render.
- `emblem_render_url` fica materializado em `guild_emblem` — nem o chat nem o ranking
  montam URL na mão.

### Thumbnail para moderação

O painel de moderação recebe **PNG + o JSON de ids lado a lado**. O moderador vê a
imagem e a lista textual (`symbol.dragon`, `effect.flames`), então pode banir uma
*combinação* sem precisar descrever o desenho. Ver §8.

## 5. Catálogo de assets

- Catálogo é **versionado por número inteiro monotônico** (`catalog_version`), não por
  data. Toda publicação de brasão grava a versão vigente.
- Asset id é **estável e imutável**: `{layer}.{slug}` (`symbol.dragon`). Renomear slug é
  proibido; um asset "novo" ganha id novo.
- **Adicionar** asset: bump de versão, nada mais. Brasões existentes não mudam.
- **Alterar arte** de um asset existente: só correção visual sem mudar leitura (kerning,
  antialias). Mudança de leitura = asset novo. Alteração força re-render dos brasões que
  o usam (job em fila, hash muda).
- **Remover** asset: nunca deleta a linha. `status` vai para:

| status | No criador | Brasões existentes | Render |
|---|---|---|---|
| `active` | selecionável | ok | ok |
| `deprecated` | oculto para quem não usa | continua exibindo normal | ok |
| `revoked` | oculto para todos | **substituído** pelo `fallback_asset_id` da camada | re-render forçado |

- `revoked` é só para conteúdo problemático (violação legal, simbologia descoberta
  depois). Guilda afetada recebe notificação + **crédito de identidade** igual ao que
  pagou por aquele asset, se pagou (R14).
- Cada camada tem um fallback obrigatório e imutável, sempre grátis:
  `shape.heater`, `bg.solid`, `palette.slate`, `border.none`, `symbol.blank`, `effect.none`.
- Assets pagos são **entitlements da guilda**, não do brasão. Deprecar um asset não
  remove o entitlement de quem comprou.

## 6. Economia

Preços fechados. 100 Bits ≈ US$ 1,00 (referência Twitch).

| Item | Bits | Repetível? | Cooldown | Aprovação de mod? | Escopo |
|---|---|---|---|---|---|
| Criar guilda | *definido na fase 01* | não | — | sim (fase 01) | guilda |
| Trocar nome da guilda | **500** | sim | **30 dias** | **sim** | guilda |
| Trocar TAG da guilda | **300** | sim | **30 dias** | **sim** | guilda |
| Slot de emblema extra (2º ao 5º) | **250** | sim, até 5 slots | 24h entre compras | não | guilda |
| Trocar o brasão dentro de um slot | **0** | sim | 60s (anti-spam) | não* | guilda |
| Asset pago — `symbol` | **300** | 1× por asset | — | não | guilda (permanente) |
| Asset pago — `shape` / `background` / `palette` / `border` | **200** | 1× por asset | — | não | guilda (permanente) |
| Efeito visual especial (`effect`) | **400** | 1× por asset | — | não | guilda (permanente) |
| Pacote de efeito (3 efeitos, os 4 pagos menos 1 à escolha) | **1000** | 1× | — | não | guilda (permanente) |

\* exceto se a combinação cair na denylist (§8) — aí entra na fila.

**Justificativa da faixa:** trocar nome (500) é o item mais caro depois da criação porque
suja o ranking e o histórico — o preço é fricção deliberada, não receita. Cosmético fica
em 200–400 (US$ 2–4), faixa de skin barata de jogo free-to-play, comprável por um viewer
médio sem virar decisão financeira. Slot a 250 é o piso para desestimular acúmulo ocioso.

Todo débito de Bits usa o fluxo de Bits da Extensão (transaction receipt JWT) e é
idempotente por `transaction_id` — mesma regra da fase 01, mesma tabela de reconciliação.

## 7. A linha do pay-to-win

**Trava de design. Qualquer fase futura que queira furar esta tabela abre uma seção
"Impacto na arquitetura" e a decisão é do produto, não do backlog.**

| Bits compram | Bits **nunca** compram |
|---|---|
| Criar uma guilda | Entrar em uma guilda |
| Trocar nome | Guild XP, nível ou velocidade de XP |
| Trocar TAG | Prestígio, posição no ranking, pontos de temporada |
| Slots extras de emblema | Limite de membros |
| Peças de brasão (shape, fundo, paleta, borda, símbolo) | Conquistas, títulos de temporada |
| Efeitos visuais | Ponto de guerra, território, vantagem de combate |
| — | Pular cooldown de guerra, de entrada ou de troca de cargo |
| — | Cargo, permissão ou promoção |
| — | Prioridade na fila de moderação |
| — | Desbloqueio antecipado de asset travado por nível |

Regra de bolso para decidir um item novo: **se dois viewers com o mesmo tempo de jogo
terminam a temporada em posições diferentes por causa dele, não pode ser vendido.**

A última linha é a mais fácil de furar: asset travado por nível **não** tem preço. Ou é
nível, ou é Bits, nunca os dois caminhos para a mesma peça.

## 8. Moderação de identidade

| Mudança | Passa por aprovação? | Antes de aprovar, o público vê | Prazo alvo |
|---|---|---|---|
| Nome da guilda | **sim, sempre** | o nome antigo | 24h |
| TAG | **sim, sempre** | a TAG antiga | 24h |
| Descrição | sim (fase 01) | a antiga | 24h |
| Brasão — combinação normal | **não** | o novo, imediato | — |
| Brasão — combinação na denylist | **sim** | o brasão antigo | 24h |
| Compra de asset / slot | não | — | — |

**Por que brasão normal não passa por fila:** o catálogo é curado; o espaço de saída já
foi moderado na entrada. Passar 8.640 combinações inócuas por humano queima a fila e
atrasa nome e TAG, que são o risco real (texto livre).

**Denylist de combinação (`emblem_denied_combo`):** pares/triplas de asset ids que
sozinhos são inofensivos e juntos não são. Nasce vazia, cresce por denúncia. Um par na
denylist com `action='review'` manda para a fila; com `action='block'` o EBS recusa a
publicação na hora (`EMBLEM_COMBO_BLOCKED`).

**Denúncia:** qualquer viewer denuncia um brasão pelo painel. 3 denúncias distintas em
24h → brasão volta ao último estado aprovado e entra na fila (`EMBLEM_UNDER_REVIEW`).

**Reversão:** moderador chama `POST /mod/guilds/:id/identity/revert`, que restaura a
entrada anterior de `guild_identity_history`. Nome, TAG e brasão têm histórico completo;
reverter é sempre um `INSERT` de nova versão apontando para a antiga, nunca `UPDATE`
destrutivo. Tudo grava em `audit_log` (fase 01).

**Reprovação — quem pagou:** Bits gastos em extensão **não são estornáveis pela Twitch**;
não existe API de refund para o desenvolvedor. Então:

| Situação | O que acontece |
|---|---|
| Nome/TAG rejeitado pelo mod | **Crédito de identidade** de 100% do valor, na conta da guilda. Nova tentativa consome o crédito, não Bits. |
| Nome/TAG rejeitado 3× seguidas | Crédito mantido, mas `identity_change_locked_until = now() + 7 dias`. |
| Asset `revoked` pelo catálogo depois da compra | Crédito de 100%. |
| Guilda banida por conduta | **Sem crédito, sem reembolso.** Entitlements ficam congelados. |
| Guilda dissolvida pelo líder | Sem crédito. Entitlements morrem com a guilda. |

Crédito é escriturado em `guild_identity_credit`, expira em **180 dias**, é intransferível
entre guildas e **não vira Bits nem dinheiro** — só desconto em item desta fase.

## 9. Modelo de dados (delta)

Só o que esta fase acrescenta. `channel`, `guild`, `guild_member`, `guild_event` e
`audit_log` vêm da arquitetura base.

```sql
-- ---------- catálogo (global, não por canal) ----------
CREATE TABLE emblem_catalog_version (
  version      int PRIMARY KEY,
  published_at timestamptz NOT NULL DEFAULT now(),
  notes        text
);

CREATE TYPE emblem_layer  AS ENUM ('shape','background','palette','border','symbol','effect');
CREATE TYPE asset_tier    AS ENUM ('free','level','paid');
CREATE TYPE asset_status  AS ENUM ('active','deprecated','revoked');

CREATE TABLE emblem_asset (
  id                 text PRIMARY KEY,             -- 'symbol.dragon'
  layer              emblem_layer NOT NULL,
  tier               asset_tier   NOT NULL,
  status             asset_status NOT NULL DEFAULT 'active',
  price_bits         int,                          -- só para tier='paid'
  unlock_level       int,                          -- só para tier='level' (régua na fase 03)
  svg_symbol_id      text NOT NULL,                -- id dentro do sprite catalog.svg
  is_layer_fallback  boolean NOT NULL DEFAULT false,
  added_in_version   int  NOT NULL REFERENCES emblem_catalog_version(version),
  revoked_in_version int  REFERENCES emblem_catalog_version(version),
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT asset_id_matches_layer CHECK (id LIKE layer::text || '.%'
                                        OR (layer='background' AND id LIKE 'bg.%')),
  CONSTRAINT paid_has_price     CHECK ((tier='paid')  = (price_bits   IS NOT NULL)),
  CONSTRAINT level_has_level    CHECK ((tier='level') = (unlock_level IS NOT NULL)),
  CONSTRAINT price_sane         CHECK (price_bits IS NULL OR price_bits BETWEEN 50 AND 2000),
  CONSTRAINT fallback_is_free   CHECK (NOT is_layer_fallback OR tier='free'),
  CONSTRAINT revoked_has_version CHECK ((status='revoked') = (revoked_in_version IS NOT NULL))
);

-- exatamente um fallback por camada
CREATE UNIQUE INDEX one_fallback_per_layer
  ON emblem_asset (layer) WHERE is_layer_fallback;

CREATE TABLE emblem_denied_combo (
  id         bigserial PRIMARY KEY,
  asset_ids  text[]  NOT NULL,                     -- 2 ou 3 ids, ordenados
  action     text    NOT NULL CHECK (action IN ('review','block')),
  reason     text    NOT NULL,
  created_by text    NOT NULL,                     -- user_id do mod/admin
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT combo_size CHECK (array_length(asset_ids,1) BETWEEN 2 AND 3),
  UNIQUE (asset_ids)
);

-- ---------- brasão da guilda ----------
CREATE TABLE guild_emblem (
  id               bigserial PRIMARY KEY,
  channel_id       uuid NOT NULL REFERENCES channel(id),
  guild_id         uuid NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  slot_index       smallint NOT NULL CHECK (slot_index BETWEEN 1 AND 5),
  layers           jsonb    NOT NULL,              -- ver §4
  layers_hash      text     GENERATED ALWAYS AS (encode(sha256(layers::text::bytea),'hex')) STORED,
  catalog_version  int  NOT NULL REFERENCES emblem_catalog_version(version),
  status           text NOT NULL DEFAULT 'published'
                     CHECK (status IN ('draft','pending_review','published','reverted')),
  render_url       text,                           -- NULL até o job de render terminar
  is_active        boolean NOT NULL DEFAULT false,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT layers_complete CHECK (
    layers ? 'shape' AND layers ? 'background' AND layers ? 'palette'
    AND layers ? 'border' AND layers ? 'symbol' AND layers ? 'effect'
    AND layers ? 'v'
  )
);

-- um slot por guilda; exatamente um brasão ativo por guilda
CREATE UNIQUE INDEX guild_emblem_slot_uq
  ON guild_emblem (guild_id, slot_index) WHERE status = 'published';
CREATE UNIQUE INDEX guild_emblem_one_active
  ON guild_emblem (guild_id) WHERE is_active;
CREATE INDEX guild_emblem_hash_idx ON guild_emblem (layers_hash);

-- ---------- entitlements ----------
CREATE TABLE guild_entitlement (
  channel_id  uuid NOT NULL REFERENCES channel(id),
  guild_id    uuid NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('asset','slot')),
  ref         text NOT NULL,                       -- asset_id, ou 'slot:2'..'slot:5'
  source      text NOT NULL CHECK (source IN ('bits','credit','grant','bundle')),
  purchase_id bigint REFERENCES bits_purchase(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, kind, ref),
  CONSTRAINT bits_source_has_purchase CHECK ((source='bits') = (purchase_id IS NOT NULL))
);

-- ---------- compras ----------
CREATE TABLE bits_purchase (
  id              bigserial PRIMARY KEY,
  channel_id      uuid NOT NULL REFERENCES channel(id),
  guild_id        uuid REFERENCES guild(id),
  user_id         text NOT NULL,                   -- quem pagou
  sku             text NOT NULL,                   -- 'guild.rename','emblem.slot','asset.symbol.dragon'
  bits_amount     int  NOT NULL CHECK (bits_amount >= 0),
  credit_amount   int  NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  transaction_id  text,                            -- id da Twitch; NULL se 100% crédito
  state           text NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending','settled','failed','voided')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz,
  CONSTRAINT paid_something CHECK (bits_amount + credit_amount > 0),
  CONSTRAINT bits_need_tx   CHECK ((bits_amount = 0) OR (transaction_id IS NOT NULL))
);

-- idempotência: webhook/receipt duplicado não cobra duas vezes
CREATE UNIQUE INDEX bits_purchase_tx_uq
  ON bits_purchase (channel_id, transaction_id) WHERE transaction_id IS NOT NULL;

CREATE TABLE guild_identity_credit (
  id           bigserial PRIMARY KEY,
  channel_id   uuid NOT NULL REFERENCES channel(id),
  guild_id     uuid NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  delta_bits   int  NOT NULL CHECK (delta_bits <> 0),   -- + emissão, − consumo
  reason       text NOT NULL,                            -- 'rejected:name','asset_revoked','spend'
  purchase_id  bigint REFERENCES bits_purchase(id),
  expires_at   timestamptz,                              -- só em emissão: now()+180d
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_expiry CHECK ((delta_bits > 0) = (expires_at IS NOT NULL))
);
CREATE INDEX credit_guild_idx ON guild_identity_credit (guild_id, created_at);

-- ---------- histórico de nome / TAG ----------
CREATE TABLE guild_identity_history (
  id             bigserial PRIMARY KEY,
  channel_id     uuid NOT NULL REFERENCES channel(id),
  guild_id       uuid NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  field          text NOT NULL CHECK (field IN ('name','tag')),
  old_value      text NOT NULL,
  new_value      text NOT NULL,
  purchase_id    bigint REFERENCES bits_purchase(id),
  state          text NOT NULL DEFAULT 'pending_review'
                   CHECK (state IN ('pending_review','approved','rejected','reverted')),
  requested_by   text NOT NULL,
  reviewed_by    text,
  reviewed_at    timestamptz,
  reject_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT value_changed CHECK (old_value IS DISTINCT FROM new_value),
  CONSTRAINT reviewed_pair CHECK ((state IN ('pending_review')) OR (reviewed_at IS NOT NULL))
);

-- uma troca em análise por campo por guilda
CREATE UNIQUE INDEX identity_one_pending
  ON guild_identity_history (guild_id, field) WHERE state = 'pending_review';
CREATE INDEX identity_history_guild_idx ON guild_identity_history (guild_id, created_at DESC);

-- ---------- reserva do nome antigo ----------
CREATE TABLE guild_name_reservation (
  channel_id  uuid NOT NULL REFERENCES channel(id),
  field       text NOT NULL CHECK (field IN ('name','tag')),
  value_norm  text NOT NULL,                       -- lower(unaccent(trim(value)))
  guild_id    uuid NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  PRIMARY KEY (channel_id, field, value_norm)
);
CREATE INDEX reservation_expiry_idx ON guild_name_reservation (expires_at);
```

A unicidade viva de `guild.name` / `guild.tag` por canal continua sendo da fase 01.
`guild_name_reservation` é a camada extra: bloqueia nomes **liberados recentemente**.

## 10. API

Base `/api/v1`. JWT da Twitch obrigatório em tudo. Erros: `{ error: { code, message } }`.

| Método | Rota | Quem chama | Request | Response | Erros |
|---|---|---|---|---|---|
| GET | `/emblem/catalog` | extensão | `?version=` (opcional) | `{ version, assets[], sprite_url, denied_combos_hash }` | — |
| GET | `/guilds/:id/emblem` | extensão | — | `{ active, slots[] }` | `GUILD_NOT_FOUND` |
| GET | `/guilds/:id/emblem/entitlements` | extensão | — | `{ assets[], slots_owned, credit_bits }` | `FORBIDDEN` |
| POST | `/guilds/:id/emblem/preview` | extensão | `{ layers }` | `{ valid, violations[], render_url? }` | `INVALID_LAYERS` |
| PUT | `/guilds/:id/emblem/slots/:slot` | líder/oficial | `{ layers }` | `{ emblem_id, status, render_url }` | `FORBIDDEN`, `SLOT_NOT_OWNED`, `ASSET_NOT_OWNED`, `ASSET_LOCKED_BY_LEVEL`, `ASSET_REVOKED`, `EMBLEM_COMBO_BLOCKED`, `EMBLEM_UNDER_REVIEW`, `RATE_LIMITED` |
| POST | `/guilds/:id/emblem/active` | líder | `{ slot }` | `{ active_slot }` | `FORBIDDEN`, `SLOT_NOT_OWNED` |
| POST | `/guilds/:id/emblem/slots` | líder | `{ transaction_receipt }` | `{ slot, purchase_id }` | `SLOT_LIMIT_REACHED`, `PURCHASE_INVALID`, `RATE_LIMITED` |
| POST | `/guilds/:id/store/assets` | líder/oficial | `{ asset_id, transaction_receipt?, use_credit? }` | `{ entitlement, purchase_id, credit_remaining }` | `ASSET_NOT_PURCHASABLE`, `ALREADY_OWNED`, `INSUFFICIENT_CREDIT`, `PURCHASE_INVALID` |
| POST | `/guilds/:id/identity/name` | líder | `{ value, transaction_receipt?, use_credit? }` | `{ request_id, state:'pending_review' }` | `FORBIDDEN`, `NAME_TAKEN`, `NAME_RESERVED`, `NAME_INVALID`, `IDENTITY_COOLDOWN`, `IDENTITY_LOCKED`, `IDENTITY_PENDING`, `PURCHASE_INVALID` |
| POST | `/guilds/:id/identity/tag` | líder | `{ value, transaction_receipt?, use_credit? }` | idem | idem (`TAG_*`) |
| GET | `/guilds/:id/identity/history` | extensão | `?cursor=&limit=` | `{ items[], next_cursor }` | `GUILD_NOT_FOUND` |
| POST | `/guilds/:id/emblem/report` | qualquer viewer | `{ reason }` | `{ reported: true }` | `ALREADY_REPORTED`, `RATE_LIMITED` |
| GET | `/mod/identity/queue` | mod/broadcaster | `?type=&cursor=&limit=` | `{ items[] }` — cada item traz `layers`, `png_url`, `old_value`, `new_value` | `FORBIDDEN` |
| POST | `/mod/identity/:requestId/approve` | mod/broadcaster | — | `{ state:'approved' }` | `FORBIDDEN`, `NOT_PENDING`, `NAME_TAKEN` |
| POST | `/mod/identity/:requestId/reject` | mod/broadcaster | `{ reason }` | `{ state:'rejected', credit_issued_bits }` | `FORBIDDEN`, `NOT_PENDING` |
| POST | `/mod/guilds/:id/identity/revert` | mod/broadcaster | `{ field: 'name'\|'tag'\|'emblem', reason }` | `{ reverted_to }` | `FORBIDDEN`, `NOTHING_TO_REVERT` |
| POST | `/mod/emblem/combos` | broadcaster | `{ asset_ids[], action, reason }` | `{ id }` | `FORBIDDEN`, `COMBO_EXISTS` |

`transaction_receipt` é o JWT de recibo dos Bits da Extensão. O EBS valida assinatura,
`channel_id`, produto e valor antes de conceder qualquer coisa; nunca confia no
`sku` que o cliente mandou.

## 11. Regras de negócio

**Brasão e catálogo**

- **R1.** Um brasão só é aceito se as 6 camadas estiverem presentes e todos os ids
  existirem em `emblem_asset` com `status <> 'revoked'`. Faltou uma → `INVALID_LAYERS`.
- **R2.** Cada asset `tier='paid'` exige entitlement da guilda. Sem entitlement →
  `ASSET_NOT_OWNED`. Comprar é da guilda, não do usuário — quem sai da guilda não leva.
- **R3.** Cada asset `tier='level'` exige `guild.level >= unlock_level`. Sem nível →
  `ASSET_LOCKED_BY_LEVEL`. **Não existe atalho pago.** (Trava do §7.)
- **R4.** Toda guilda nasce com 1 slot (`slot_index=1`) preenchido com o brasão padrão
  (todos os fallbacks) já no fluxo de criação da fase 01. Nunca existe guilda sem brasão.
- **R5.** Máximo de 5 slots por guilda. Slots 2–5 exigem entitlement `slot:N` e só podem
  ser comprados em ordem. Exceder → `SLOT_LIMIT_REACHED`.
- **R6.** Exatamente um brasão `is_active` por guilda, sempre. Trocar o ativo é grátis e
  instantâneo, limitado a 10 trocas/hora por guilda (`RATE_LIMITED`).
- **R7.** Editar o brasão dentro de um slot é grátis, cooldown de 60s por guilda.
- **R8.** Publicar brasão cuja combinação bate em `emblem_denied_combo`:
  `action='block'` → recusa (`EMBLEM_COMBO_BLOCKED`); `action='review'` → grava
  `pending_review`, público continua vendo o brasão anterior.
- **R9.** 3 denúncias de usuários distintos em 24h sobre o mesmo `layers_hash` no mesmo
  canal → brasão volta ao anterior e entra na fila. Quarta denúncia não reabre nada.
- **R10.** Asset marcado `revoked` → todo brasão que o usa é reescrito com o fallback da
  camada e re-renderizado em fila, em até 1h. A guilda é notificada.

**Nome e TAG**

- **R11.** Troca de nome e de TAG tem cooldown de **30 dias por campo, por guilda**,
  contado da última troca **aprovada**. Rejeitada não conta. Motivo: ranking e histórico
  de temporada precisam de nome estável para o viewer reconhecer a guilda. →
  `IDENTITY_COOLDOWN` com `retry_after`.
- **R12.** O nome/TAG antigo fica **reservado 30 dias** para a própria guilda em
  `guild_name_reservation`. Nesse prazo, ninguém mais no canal pode tomá-lo
  (`NAME_RESERVED`), e a guilda de origem pode voltar a ele **sem pagar e sem cooldown**
  (uma vez). Passados os 30 dias, o nome cai no pool geral.
- **R13.** Uma troca pendente por campo por guilda. Segunda tentativa → `IDENTITY_PENDING`.
- **R14.** Rejeição de nome/TAG emite crédito de 100% em `guild_identity_credit`,
  válido 180 dias. 3 rejeições consecutivas → bloqueio de novas solicitações por 7 dias
  (`IDENTITY_LOCKED`); o crédito permanece.
- **R15.** Aprovação revalida unicidade no momento do commit — outro nome pode ter sido
  aprovado antes. Colisão → `NAME_TAKEN`, volta para `pending_review`, sem consumir a
  cobrança.
- **R16.** Rename e mudança de TAG **não** alteram `guild.id`. Ranking, XP, prestígio,
  conquistas e histórico de guerra seguem colados no id. O ranking exibe
  "NovoNome (ex-AntigoNome)" pelos 14 dias seguintes.

**Dinheiro**

- **R17.** Bits gastos **não são reembolsáveis em Bits ou dinheiro** — a Twitch não expõe
  estorno para extensões. A única compensação é crédito de identidade (§8), que não sai
  desta fase e não vira saldo transferível.
- **R18.** Toda cobrança é idempotente por `(channel_id, transaction_id)`. Recibo
  reenviado retorna o mesmo `purchase_id`, `200`, sem cobrar de novo.
- **R19.** Concessão de entitlement e registro de compra acontecem na **mesma transação**.
  Se o render falhar depois, a compra vale; render é assíncrono e retentável.
- **R20.** Compra com crédito parcial é permitida: consome crédito primeiro (FIFO por
  `expires_at`), o resto vai em Bits. Crédito insuficiente e sem recibo →
  `INSUFFICIENT_CREDIT`.
- **R21.** Compra só é aceita de membro com permissão de identidade (fase 02: `leader`,
  e `officer` para assets/brasão; **rename e TAG só `leader`**).

**Guilda banida / dissolvida**

- **R22.** `guild.status='banned'` → brasão despublicado na hora: painel, ranking e chat
  passam a exibir o placeholder `emblem.banned`; `render_url` fica retido, não deletado
  (evidência de moderação). Entitlements ficam congelados, não removidos.
- **R23.** Guilda banida não gera crédito e não pode comprar nada
  (`GUILD_NOT_ELIGIBLE`). Se for desbanida, brasão e entitlements voltam como estavam.
- **R24.** Guilda dissolvida: entitlements e créditos morrem junto (`ON DELETE CASCADE`);
  nome e TAG entram em reserva de 30 dias antes de voltar ao pool (R12).
- **R25.** Toda mudança aprovada, rejeitada, revertida ou congelada grava em `audit_log`
  (fase 01) e emite `guild_event` do tipo `identity.changed` / `emblem.changed` —
  a fase 07 anuncia no chat a partir daí, não de um pipeline próprio.

## 12. Riscos e decisões em aberto

| # | Assunto | Risco | Recomendação |
|---|---|---|---|
| D1 | Preço em Bits fixo vs. por canal | Canal pequeno acha 500 Bits caro; canal grande acha barato | Fixar global na v1. Multiplicador por canal (0,5×–2×) em `channel.settings` só se houver reclamação medida. |
| D2 | Fila de moderação de rename | Streamer pequeno não modera em 24h; guilda paga e espera | **Auto-aprovação opcional** por canal para nome que passa em denylist textual + sem histórico de strike. Default: desligado. |
| D3 | Efeito animado | Chamas animadas vendem muito melhor que estáticas | Fora da v1 (custo de CPU em PNG e de bateria no mobile). Reavaliar com APNG/Lottie depois da 07. |
| D4 | Squatting de nome | Guilda de 1 membro segura nome bom | R12 cobre só o pós-troca. Adicionar expiração de guilda inativa é fase 02/03, não aqui. |
| D5 | Crédito como moeda paralela | Crédito virar "segunda moeda" e confundir | Manter escopo mínimo: só itens desta fase, 180 dias, sem transferência. Não expor saldo como "carteira". |
| D6 | 40 símbolos é pouco | Colisão visual em canal grande (>200 guildas) | Aceitar na v1 — 8.640 combinações grátis. Medir taxa de `layers_hash` duplicado; se > 5%, catálogo v2 com +40 símbolos. |
| D7 | Custo de render PNG | Pico de render em evento sazonal | Fila + dedup por hash já cobrem. Se o p95 do job passar de 30s, mover render para worker dedicado. |
| D8 | Quem paga o rename | Oficial paga e líder desfaz de graça | R21 já restringe a `leader`. Em aberto: se o líder sair, o crédito acompanha a guilda (recomendo sim, é da guilda). |

## 13. Critérios de aceite

**Emblem Creator**

- [ ] Criador exibe as 6 camadas na ordem de renderização e atualiza o preview sem request.
- [ ] Assets `level` aparecem travados com o nível exigido; assets `paid` com o preço.
- [ ] Nenhum caminho da UI permite comprar um asset `tier='level'`.
- [ ] Guilda nova nasce com brasão de fallback ativo, sem gastar Bits.
- [ ] 8.640 combinações são montáveis sem entitlement nenhum.

**Representação e render**

- [ ] `guild_emblem.layers` nunca guarda imagem; só ids + `catalog_version`.
- [ ] Dois brasões com o mesmo JSON compartilham o mesmo arquivo PNG (mesmo hash).
- [ ] PNG 256/112/28 gerados pelo EBS e servidos por CDN com cache imutável.
- [ ] Painel de moderação mostra PNG **e** a lista de ids do brasão.

**Catálogo**

- [ ] Adicionar asset novo faz bump de versão e não altera nenhum brasão existente.
- [ ] `revoked` substitui pelo fallback da camada em ≤ 1h e emite crédito a quem pagou.
- [ ] `emblem_asset` nunca sofre `DELETE`; teste de migração cobre isso.

**Economia**

- [ ] Preços cobrados batem exatamente com a tabela do §6.
- [ ] Recibo de Bits reenviado 3× gera 1 `bits_purchase` e 1 entitlement.
- [ ] Compra e entitlement na mesma transação; falha de render não desfaz a compra.
- [ ] Crédito consome FIFO por `expires_at` e o restante vai em Bits.

**Pay-to-win**

- [ ] Nenhum SKU concede XP, Prestígio, nível, membro, cargo ou vantagem de guerra.
- [ ] Teste automatizado varre `emblem_asset` + tabela de SKUs e falha se aparecer um
      item fora da coluna "Bits compram" do §7.
- [ ] Guilda que nunca gastou 1 Bit consegue chegar ao topo do ranking no ambiente de teste.

**Identidade e moderação**

- [ ] Rename só por `leader`; oficial recebe `FORBIDDEN`.
- [ ] Segunda troca dentro de 30 dias → `IDENTITY_COOLDOWN` com `retry_after`.
- [ ] Nome antigo indisponível para terceiros por 30 dias, e retomável pela dona sem custo.
- [ ] Rejeição emite crédito de 100% e mantém nome antigo público o tempo todo.
- [ ] Combinação em denylist `block` é recusada; `review` mantém o brasão anterior no ar.
- [ ] 3 denúncias distintas em 24h revertem o brasão e abrem item na fila.
- [ ] Guilda banida exibe placeholder em painel, ranking e chat, e não compra nada.
- [ ] Toda aprovação/rejeição/reversão aparece em `audit_log` e em `guild_event`.
