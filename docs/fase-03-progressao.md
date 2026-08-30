# Fase 03 — Progressão (Guild XP e Níveis)

## 1. Objetivo

Transformar a atividade dos membros em progressão coletiva: a guilda acumula **Guild XP**
e sobe de **Nv.1 a Nv.50**, desbloqueando capacidade (vagas) e cosmético (frames, cores,
banner). Todo XP nasce de um `guild_event`, é calculado no servidor e é auditável evento a
evento. Nada que se desbloqueia aqui dá vantagem competitiva.

## 2. Escopo

| Entra | Detalhe |
|---|---|
| Tabela de ganho de XP | Valores fechados por atividade e fonte |
| Handler de XP sobre `guild_event` | Consome o pipeline da fase 02, não cria outro |
| Ledger de XP | Lançamento por evento, com estorno |
| Teto diário e anti-abuso | Cap por membro/canal/dia, cooldown de watch, reversão |
| Curva de níveis 1→50 | Fórmula + recálculo de nível |
| Desbloqueios por nível | Vagas (10 → 40) e cosméticos |
| Contribuição por membro | Quanto cada membro rendeu para a guilda (leitura) |
| API de progressão | Consulta, heartbeat de watch, ajuste de moderação |

### Fora do escopo

| Não entra | Onde fica |
|---|---|
| **Prestígio, ranking, temporada, conquistas** | Fase 04 |
| Guerras, territórios, pontos de guerra | Fase 05 |
| Emblem Creator, loja, compra de cosmético com Bits | Fase 06 |
| Anúncio no chat de "guilda subiu de nível" | Fase 07 (esta fase só emite o evento) |
| Criação/aprovação de guilda, cargos, entrada/saída | Fases 01 e 02 |

> **XP ≠ Prestígio.** Guild XP é **acumulado e permanente**: mede quanto a guilda viveu,
> nunca reseta, nunca decai e não é comparável entre guildas de idades diferentes.
> Prestígio (fase 04) é **competitivo e sazonal**: reseta a cada temporada e é o único
> número que define ranking. Subir de nível não dá Prestígio. Nenhum desbloqueio desta
> fase altera Prestígio, pontuação de guerra ou qualquer número da fase 04.

## 3. Tabela de ganho de XP

Cap diário por membro: **200 XP** (seção 4). Todos os valores são por evento.

| Atividade | Guild XP | Fonte | `guild_event.type` | Limite próprio |
|---|---|---|---|---|
| Assistir à live (tick) | **+1** | Heartbeat da extensão + Get Streams | `watch_tick` | 1 tick / 10 min, máx **18/dia** |
| Participar de evento | **+5** | Comando do bot / API de moderação | `event_participate` | máx **4/dia** |
| Ganhar portal/evento | **+10** | Comando do bot / API de moderação | `event_win` | máx **2/dia** |
| Seguir o canal | **+25** (bônus único) | EventSub `channel.follow` | `follow_bonus` | 1× por usuário/canal, vitalício |
| Sub Prime ou Tier 1 | **+50** | EventSub `channel.subscribe` / `.message` | `sub` | — |
| Sub Tier 2 | **+100** | EventSub `channel.subscribe` | `sub` | — |
| Sub Tier 3 | **+150** | EventSub `channel.subscribe` | `sub` | — |
| Gift Sub | **+40** por unidade, para a guilda do **presenteador** | EventSub `channel.subscription.gift` | `sub_gift` | máx **10 unidades/dia** |
| Bits | **+1 a cada 10 Bits** | EventSub `channel.cheer` | `bits` | máx **100 XP/dia** |
| Resgate marcado como XP | **+5** | Channel Points `channel.channel_points_custom_reward_redemption.add` | `redeem_xp` | máx **3/dia**, só recompensas com flag `guild_xp` |

### Justificativa de cada valor fechado

| Valor | Uma linha |
|---|---|
| Watch +1 / 10 min, 18 ticks | 3 h de live = 18 XP: presença é a base da curva, não o atalho dela. |
| Evento +5 / vitória +10 | Vitória vale 2× participação — recompensa sem punir quem só apareceu. |
| Follow +25 | Bônus de entrada equivalente a ~1,4 live assistida; único, então não é farmável. |
| Sub T1 +50 | Metade do teto diário: um sub compensa um dia inteiro sem live, não uma semana. |
| Sub T2 +100 / T3 +150 | Progressão **sublinear** ao preço (2×/5× em dinheiro → 2×/3× em XP): dinheiro não escala vantagem linearmente. |
| Gift +40 | 20 % abaixo do sub próprio, e o **presenteado não ganha XP** — mata auto-gift entre contas da mesma guilda. |
| Bits 1:10, teto 100 | 1.000 Bits/dia satura o canal de Bits; acima disso a guilda não avança mais rápido. |
| Resgate +5, máx 3 | Igual a participar de evento: o streamer controla o gatilho, o cap controla o abuso. |

Piso e teto reais de um membro em um dia: **0 XP** (ausente) → **73 XP** (ativo, sem gastar
dinheiro: 18 + 20 + 20 + 15) → **200 XP** (cap, gastando). Razão máxima gasto/grátis ≈ **2,7×**,
limitada por dia e não acumulável — ver risco RS-1.

## 4. Anti-abuso

### 4.1 Teto diário

| Regra | Valor |
|---|---|
| Chave do teto | `(channel_id, user_id, day)` — **por canal e por usuário**, nunca por guilda |
| Teto | **200 XP / dia** |
| Virada do dia | 00:00 **UTC** (fixo; não segue fuso do canal — evita janela dupla) |
| Excedente | Descartado, não acumula e não vira crédito futuro |
| Registro do excedente | `guild_xp_entry` com `amount` cortado e `payload.capped = true` |

O teto ser por **canal + usuário** (e não por guilda) é o que faz trocar de guilda não
render nada: o contador do membro segue o membro.

### 4.2 Cooldown de "assistir à live"

| Item | Regra |
|---|---|
| Heartbeat da extensão | a cada **60 s**, painel visível e aba em foco |
| Tick | **+1 XP** a cada **bucket de 10 min** (`floor(epoch/600)`) |
| Condição do tick | ≥ **8 dos 10** heartbeats do bucket recebidos **e** stream em `live` pela Twitch API |
| Idempotência | `external_id = watch:{user_id}:{bucket}` → `UNIQUE (channel_id, type, external_id)` mata replay |
| Máximo | **18 ticks/dia** (3 h). Live mais longa não rende mais XP de presença |
| Offline | Stream offline → 0 ticks. VOD e raid recebida não contam |

### 4.3 Viewbot e multi-conta

| Sinal | Ação automática |
|---|---|
| Conta Twitch com menos de **7 dias** | Não gera `watch_tick` nem `redeem_xp`; sub e Bits continuam valendo |
| Conta sem nenhum evento de chat/interação em **7 dias** consecutivos gerando ticks | `quarantine`: ticks viram `amount = 0`, ficam registrados, sem bloquear a conta |
| Mais de **3 contas** com o mesmo `ip_hash` em 24 h | Contas além da 3ª têm ticks zerados no período |
| Heartbeats do canal > **1,5×** o viewer count da Helix no mesmo minuto | Todos os ticks daquele bucket, no canal inteiro, viram `amount = 0` |
| Guilda com > **60 %** dos membros em quarentena | Guilda entra em `review` e o painel de moderação (fase 01) recebe o caso |

`ip_hash` é HMAC-SHA256 do IP com sal por canal, retido **72 h**, nunca exposto em API.
Nenhuma dessas regras bane sozinha: zeram XP e abrem caso para humano.

### 4.4 Estorno de sub e chargeback de Bits

XP **nunca é deletado** — é compensado por lançamento negativo, para o ledger continuar
batendo com `guild_event`.

| Caso | Detecção | Efeito |
|---|---|---|
| Sub cancelado/reembolsado até **72 h** após a compra | `channel.subscription.end` + job diário de reconciliação (BullMQ) | Lançamento `xp_reversal` de `-valor original`, `external_id = reversal:{external_id_original}` |
| Sub cancelado depois de 72 h | — | Nada. É fim de assinatura normal, não fraude |
| Bits estornados (chargeback) | Job de reconciliação diário contra o relatório de Bits | `xp_reversal` de `-valor original` |
| Gift sub estornado | `channel.subscription.end` das unidades presenteadas | `xp_reversal` proporcional às unidades canceladas |

Efeitos colaterais da reversão:

- `guild.xp` pode cair e **`guild.level` pode cair junto** (R9).
- Cosmético já desbloqueado e aplicado **não é retirado** — identidade visual não pisca.
- **Vagas voltam** ao limite do novo nível; membros acima do limite entram em `overflow`:
  continuam na guilda, geram XP, mas nenhuma vaga nova pode ser preenchida até a guilda
  voltar ao nível (R10).

### 4.5 XP retroativo e farm de troca de guilda

| Pergunta | Resposta |
|---|---|
| Membro entra hoje, traz o XP de ontem? | **Não.** XP é creditado à guilda que o membro tinha **no instante do evento**. Sem backfill, sem exceção. |
| Evento de quem não estava em guilda? | Gravado em `guild_event` com `guild_id = NULL` e lançado no ledger com `amount = 0`. Serve para auditoria e fase 04, não vira XP depois. |
| XP sai com o membro que sai? | **Não.** XP pertence à guilda. `guild_member_xp` é histórico de contribuição, não saldo transferível. |
| Farm "entrar, despejar sub, sair"? | Membro que saiu de outra guilda nos **últimos 7 dias** só gera XP para a nova após **24 h** (`guild_member.xp_eligible_at`). Quem nunca teve guilda, ou está fora há mais de 7 dias, gera XP na hora. |
| Mercenário que roda guildas? | O teto diário é por canal: 5 guildas no mesmo dia continuam somando no máximo 200 XP no total. |

## 5. Curva de níveis

**XP acumulado para atingir o nível N:**

```
XP_total(N) = 250 × (N − 1) × N          para N em [1, 50]
XP_do_nivel(N) = XP_total(N) − XP_total(N−1) = 500 × (N − 1)
```

Custo do nível cresce **linear**, acumulado cresce **quadrático**: cada nível novo custa
500 XP a mais que o anterior. Nv.50 é o teto — XP continua acumulando acima de 612.500
(para histórico e para a fase 04), mas o nível não passa de 50.

### Marcos

Referência: guilda cheia, **60 XP/dia por membro ativo** (perfil "ativo sem gastar", seção 3).

| Nível | XP acumulado | XP do nível | Vagas na faixa | XP/dia de referência | Dias na faixa | Dias acumulados |
|---|---|---|---|---|---|---|
| 1 | 0 | — | 10–12 | 660 | — | 0 |
| 5 | 5.000 | 2.000 | 12 | 720 | 8 | **~8 d** |
| 10 | 22.500 | 4.500 | 15–17 | 960 | 24 | **~1 mês** |
| 20 | 95.000 | 9.500 | 20–22 | 1.260 | 76 | **~3,5 meses** |
| 30 | 217.500 | 14.500 | 25–28 | 1.560 | 97 | **~7 meses** |
| 40 | 390.000 | 19.500 | 32–36 | 2.040 | 111 | **~10 meses** |
| 50 | 612.500 | 24.500 | 40 | 2.040 | 109 | **~14 meses** |

Leitura: **Nv.10 em ~1 mês** de guilda diariamente ativa (o marco que o cliente citou),
**Nv.50 em ~14 meses**. As vagas crescendo junto mantêm cada faixa em ~3 meses em vez de
virar parede — a curva é quadrática, o tempo percebido é quase linear. Guilda que joga
metade dos dias dobra esses prazos.

## 6. Desbloqueios por nível

Regra dura: **capacidade e cosmético, nunca poder**. Nada aqui altera Prestígio, ranking,
pontos de guerra ou qualquer multiplicador de XP.

| Nível | Vagas | Desbloqueio |
|---|---|---|
| 1 | **10** | Emblema base, cor padrão, descrição de 140 caracteres |
| 3 | 10 | Descrição estendida para 280 caracteres |
| 5 | **12** | Paleta de 6 cores de guilda |
| 8 | 12 | Lema da guilda (40 caracteres, passa por moderação da fase 01) |
| 10 | **15** | Frame de emblema **Bronze**, cor especial, banner personalizado (catálogo) |
| 12 | 15 | Aba pública de histórico de XP da guilda |
| 15 | **17** | Frame **Prata** |
| 18 | 17 | Badge da guilda ao lado do nome dos membros no painel |
| 20 | **20** | Paleta de 12 cores, banner animado (loop) |
| 25 | **22** | Frame **Ouro** |
| 30 | **25** | Moldura de banner, emote da guilda no painel (não no chat) |
| 35 | **28** | Frame **Platina** |
| 40 | **32** | Cor em gradiente, banner com brilho |
| 45 | **36** | Frame **Diamante** |
| 50 | **40** *(teto)* | Frame **Lendário** animado, cor exclusiva Nv.50, banner assinado |

Vagas: **10 na fase 01 → 40 no Nv.50**. `guild.member_limit` é derivado do nível, nunca
editado à mão, exceto por ajuste de moderação auditado (R13).

## 7. Modelo de dados

### 7.1 Impacto na arquitetura

`guild_event` da `docs/ARQUITETURA.md` não carrega o autor do evento, e o teto diário é por
usuário. Esta fase adiciona **duas colunas** à tabela base — decidido antes de codar:

```sql
ALTER TABLE guild_event ADD COLUMN actor_user_id text;      -- NULL = evento da guilda inteira
ALTER TABLE guild_event ADD COLUMN external_id  text;       -- formaliza a coluna que a UNIQUE já pressupõe
ALTER TABLE guild_event ALTER COLUMN guild_id DROP NOT NULL; -- evento de quem não tem guilda
CREATE UNIQUE INDEX guild_event_ext_uk ON guild_event (channel_id, type, external_id)
  WHERE external_id IS NOT NULL;
```

### 7.2 Delta da fase

```sql
-- Lançamento de XP. Uma linha por evento processado. Fonte da verdade dos agregados.
CREATE TABLE guild_xp_entry (
  id          bigserial PRIMARY KEY,
  channel_id  uuid    NOT NULL REFERENCES channel(id),
  guild_id    uuid             REFERENCES guild(id),        -- NULL = sem guilda no instante
  user_id     text,                                          -- NULL = crédito da guilda
  event_id    uuid    NOT NULL REFERENCES guild_event(id),
  amount      integer NOT NULL,                              -- pode ser 0 (capado/quarentena) ou negativo (estorno)
  reason      text    NOT NULL,                              -- = guild_event.type ou 'xp_reversal'
  capped      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT xp_entry_event_uk UNIQUE (event_id),            -- reprocessar evento não credita 2×
  CONSTRAINT xp_entry_range    CHECK (amount BETWEEN -1000 AND 1000)
);
CREATE INDEX xp_entry_guild_idx ON guild_xp_entry (guild_id, created_at DESC);

-- Teto diário: por CANAL + USUÁRIO. Não por guilda — é o que mata o guild-hop.
CREATE TABLE member_xp_daily (
  channel_id  uuid NOT NULL REFERENCES channel(id),
  user_id     text NOT NULL,
  day         date NOT NULL,                                 -- UTC
  xp_granted  integer NOT NULL DEFAULT 0,
  watch_ticks smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id, day),
  CONSTRAINT daily_cap    CHECK (xp_granted BETWEEN 0 AND 200),
  CONSTRAINT daily_ticks  CHECK (watch_ticks BETWEEN 0 AND 18)
);

-- Contribuição histórica do membro dentro da guilda. Leitura/vaidade, não saldo.
CREATE TABLE guild_member_xp (
  guild_id   uuid NOT NULL REFERENCES guild(id),
  user_id    text NOT NULL,
  channel_id uuid NOT NULL REFERENCES channel(id),
  xp_total   bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id),
  CONSTRAINT member_xp_nonneg CHECK (xp_total >= 0)
);

-- Snapshot diário: auditoria, gráfico de evolução e rollback de recálculo errado.
CREATE TABLE guild_level_snapshot (
  channel_id   uuid NOT NULL REFERENCES channel(id),
  guild_id     uuid NOT NULL REFERENCES guild(id),
  day          date NOT NULL,
  xp_total     bigint   NOT NULL,
  level        smallint NOT NULL,
  member_count smallint NOT NULL,
  member_limit smallint NOT NULL,
  PRIMARY KEY (guild_id, day),
  CONSTRAINT snap_level CHECK (level BETWEEN 1 AND 50)
);

-- Quarentena anti-abuso. Sem linha = conta limpa.
CREATE TABLE xp_quarantine (
  channel_id uuid NOT NULL REFERENCES channel(id),
  user_id    text NOT NULL,
  reason     text NOT NULL,                                  -- 'new_account'|'no_interaction'|'ip_cluster'|'viewer_mismatch'
  until      timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- Cosmético desbloqueado e não retirável (seção 4.4).
CREATE TABLE guild_unlock (
  guild_id     uuid NOT NULL REFERENCES guild(id),
  unlock_key   text NOT NULL,                                -- 'frame_gold', 'banner_animated', ...
  level_earned smallint NOT NULL,
  unlocked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, unlock_key),
  CONSTRAINT unlock_level CHECK (level_earned BETWEEN 1 AND 50)
);

-- Agregados na tabela base
ALTER TABLE guild ADD CONSTRAINT guild_level_range  CHECK (level BETWEEN 1 AND 50);
ALTER TABLE guild ADD CONSTRAINT guild_xp_nonneg    CHECK (xp >= 0);
ALTER TABLE guild ADD CONSTRAINT guild_limit_range  CHECK (member_limit BETWEEN 10 AND 40);
ALTER TABLE guild_member ADD COLUMN xp_eligible_at timestamptz NOT NULL DEFAULT now();
```

`guild.xp` e `guild.level` são **cache derivado** de `guild_xp_entry`. Um job de
reconciliação semanal recomputa `SUM(amount)` por guilda e alerta na divergência; o ledger
sempre ganha.

## 8. API

Base `/api/v1`, JWT da Twitch obrigatório (`docs/ARQUITETURA.md`). Nenhuma rota aceita
valor de XP vindo do cliente.

| Método | Rota | Quem chama | Request | Response | Erros |
|---|---|---|---|---|---|
| GET | `/guilds/:id/progression` | Extensão (painel) | — | `{ level, xp, xp_next_level, xp_to_next, member_limit, unlocks[] }` | `GUILD_NOT_FOUND` |
| GET | `/guilds/:id/xp/contributions` | Extensão | `?cursor=&limit=` (máx 50) | `{ items[{ user_id, display_name, xp_total, rank }], next_cursor }` | `GUILD_NOT_FOUND`, `NOT_IN_GUILD` |
| GET | `/guilds/:id/xp/history` | Extensão (Nv.12+) | `?days=` (máx 90) | `{ days[{ day, xp, level }] }` | `UNLOCK_NOT_AVAILABLE` |
| POST | `/xp/watch-tick` | Extensão (a cada 60 s) | `{ nonce }` | `202 { counted, ticks_today, xp_today, xp_remaining }` | `STREAM_OFFLINE`, `WATCH_TICK_TOO_SOON`, `XP_DAILY_CAP_REACHED` |
| GET | `/me/xp/daily` | Extensão | — | `{ xp_today, xp_remaining, cap: 200, ticks_today, eligible_at }` | — |
| GET | `/channels/:id/xp/table` | Extensão (público) | — | `{ rules[{ type, xp, cap }], cap_daily: 200 }` | — |
| POST | `/guilds/:id/unlocks/:key/apply` | Líder | `{ value }` (cor, banner, frame) | `200 { applied }` | `FORBIDDEN_ROLE`, `UNLOCK_NOT_AVAILABLE`, `INVALID_VALUE` |
| POST | `/mod/guilds/:id/xp/adjust` | Broadcaster/mod | `{ amount, reason }` (\|amount\| ≤ 5.000) | `200 { xp, level }` | `FORBIDDEN_ROLE`, `INVALID_ADJUSTMENT` |
| POST | `/mod/events/grant` | Bot do streamer (JWT de mod) | `{ user_ids[], type: event_participate\|event_win, external_id }` | `202 { granted, skipped }` | `FORBIDDEN_ROLE`, `EVENT_DUPLICATE`, `INVALID_TYPE` |
| POST | `/webhooks/twitch/eventsub` | Twitch | Payload EventSub | `204` | `401` assinatura inválida |

`/webhooks/twitch/eventsub` fica **fora** de `/api/v1`: valida HMAC do header
`Twitch-Eventsub-Message-Signature`, não JWT. É a única rota do sistema sem JWT.

Códigos de erro desta fase: `XP_DAILY_CAP_REACHED`, `WATCH_TICK_TOO_SOON`, `STREAM_OFFLINE`,
`UNLOCK_NOT_AVAILABLE`, `EVENT_DUPLICATE`, `INVALID_ADJUSTMENT`, `NOT_IN_GUILD`,
`GUILD_NOT_ACTIVE`, `XP_MEMBER_NOT_ELIGIBLE`.

## 9. Regras de negócio

| # | Regra |
|---|---|
| **R1** | Todo XP nasce de um `guild_event` e gera exatamente uma linha em `guild_xp_entry` (`UNIQUE (event_id)`). Sem evento, sem XP. |
| **R2** | Nenhum endpoint aceita quantidade de XP do cliente. O servidor deriva o valor da tabela da seção 3. |
| **R3** | Evento com `external_id` repetido em `(channel_id, type)` é ignorado com `202` e `skipped`, nunca credita duas vezes. |
| **R4** | O XP vai para a guilda que o membro tinha no instante do evento (`guild_member` no `created_at` do evento). Sem guilda → `amount = 0`. |
| **R5** | O teto de 200 XP/dia é aplicado por `(channel_id, user_id, day UTC)`. O excedente é cortado no lançamento, com `capped = true`. |
| **R6** | `watch_tick` só é creditado com stream `live`, ≥ 8 heartbeats no bucket de 10 min e `watch_ticks < 18` no dia. |
| **R7** | Conta com menos de 7 dias, em quarentena ativa, ou fora de guilda gera lançamento com `amount = 0` — o evento continua gravado. |
| **R8** | Membro que saiu de outra guilda nos últimos 7 dias tem `xp_eligible_at = joined_at + 24 h`; antes disso seus eventos rendem `amount = 0` para a nova guilda. |
| **R9** | `guild.level` = maior N com `XP_total(N) ≤ guild.xp`, recalculado na mesma transação de todo lançamento. Sobe e **desce**. Teto 50. |
| **R10** | `guild.member_limit` é derivado do nível pela tabela da seção 6. Se o limite cair abaixo do número de membros, ninguém é expulso: a guilda fica em `overflow` e não admite entradas até `member_count < member_limit`. |
| **R11** | Cosmético desbloqueado nunca é retirado por queda de nível (`guild_unlock` é append-only), mas só pode ser **aplicado** enquanto o nível ≥ `level_earned`. |
| **R12** | Estorno gera lançamento negativo com `external_id = reversal:{original}`, nunca UPDATE nem DELETE no lançamento original. |
| **R13** | Ajuste de moderação exige `role in (broadcaster, moderator)`, `\|amount\| ≤ 5.000`, `reason` não vazio, e grava em `audit_log` com `before`/`after`. |
| **R14** | Guilda em `status != active` (fase 01) não acumula XP; os eventos ficam gravados com `amount = 0`. |
| **R15** | Nenhum desbloqueio desta fase altera Prestígio, ranking, ponto de guerra ou taxa de ganho de XP. Multiplicador de XP por nível **não existe**. |
| **R16** | Subida de nível emite `guild_event` do tipo `guild.level_up` (payload `{ from, to, unlocks[] }`) para a fase 07 anunciar. Queda de nível **não** emite evento público. |
| **R17** | O snapshot diário roda 00:10 UTC e é imutável; a reconciliação semanal compara `guild.xp` com `SUM(guild_xp_entry.amount)` e alerta se divergir em qualquer valor. |

## 10. Riscos e decisões em aberto

| # | Risco / questão | Recomendação |
|---|---|---|
| **RS-1** | Quem gasta chega a 200 XP/dia; quem só assiste chega a 73. Razão 2,7× — é vantagem comprada? | Manter. O desbloqueio é vaga e cosmético, e o ranking (fase 04) usa Prestígio, que **não** tem fonte monetária. Revisar se o dado real mostrar guildas top dominadas por gasto. |
| **RS-2** | Mais vagas → mais XP/dia → mais vagas. Feedback positivo favorece guilda grande. | Aceito nesta fase (XP é idade, não competição). Fase 04 deve normalizar Prestígio **por membro ativo**, não por total. Decidir na fase 04. |
| **RS-3** | Heartbeat da extensão é falsificável por quem monta requisição fora do painel. | Mitigado por JWT + `nonce` + cruzamento com viewer count (4.3). Fecha o buraco econômico, não o técnico: 18 XP/dia não paga o esforço. |
| **RS-4** | Twitch não entrega evento de chargeback de Bits em tempo real. | Job diário de reconciliação. Janela de até 24 h com XP indevido é aceitável — é reversível por R12. |
| **RS-5** | `channel.follow` exige escopo de moderador; nem todo canal vai conceder. | Se o escopo faltar, `follow_bonus` fica desabilitado no canal e a `/channels/:id/xp/table` reflete isso. Não bloqueia a fase. |
| **RS-6** | Cliente não definiu se o streamer pode ajustar a tabela de XP por canal. | **Recomendo não permitir na v1.** Tabela fixa = comparação entre canais possível na fase 04 e uma única regra para suportar. Reabrir depois de 3 canais em produção. |
| **RS-7** | Nv.50 em ~14 meses pode ser longo demais para a vida útil de um canal. | Manter. Nv.10 em 1 mês e Nv.20 em 3,5 meses carregam o engajamento inicial; o topo é para quem fica. Ajustar a constante 250 se o retorno cair. |
| **RS-8** | Catálogo concreto de frames, banners e cores é da fase 06. | Nesta fase só o `unlock_key` e o nível. Fase 06 entrega os assets; se atrasar, entra placeholder monocromático. |

## 11. Critérios de aceite

- [ ] Evento EventSub reenviado com o mesmo `external_id` não gera segundo `guild_xp_entry`.
- [ ] Sub Tier 1 credita exatamente 50 XP; Tier 2, 100; Tier 3, 150; gift, 40 por unidade, ao presenteador.
- [ ] Presenteado com gift sub recebe **0** XP pelo gift.
- [ ] 1.500 Bits em um dia creditam 100 XP (teto de Bits), não 150.
- [ ] Membro que gera 300 XP de fontes válidas em um dia recebe 200; o excedente aparece com `capped = true` e não retorna no dia seguinte.
- [ ] 3 h de live contínua rendem 18 `watch_tick`; a 4ª hora rende 0.
- [ ] Requisição de `watch-tick` com stream offline retorna `STREAM_OFFLINE` e não credita.
- [ ] Replay do mesmo bucket de watch tick não credita duas vezes.
- [ ] Conta criada há 3 dias gera `watch_tick` com `amount = 0` e o evento fica registrado.
- [ ] Membro que sai da guilda A e entra na B no mesmo dia gera `amount = 0` para B nas primeiras 24 h.
- [ ] Membro sem guilda que doa Bits não gera XP retroativo ao entrar em guilda no dia seguinte.
- [ ] Membro que sai não reduz `guild.xp`; `guild_member_xp` dele permanece no histórico.
- [ ] Sub reembolsado em 48 h gera `xp_reversal` negativo e `guild.xp` cai no mesmo valor.
- [ ] Queda de XP que cruza um marco reduz `guild.level` e `guild.member_limit`; membros excedentes permanecem e a guilda recusa novas entradas com `GUILD_FULL`.
- [ ] Cosmético já desbloqueado continua em `guild_unlock` após queda de nível.
- [ ] Guilda com 22.500 XP está no Nv.10 com `member_limit = 15`; com 22.499, Nv.9 e `member_limit = 12`.
- [ ] Guilda com 700.000 XP está no Nv.50 com `member_limit = 40`.
- [ ] `POST /mod/guilds/:id/xp/adjust` com JWT de viewer retorna `FORBIDDEN_ROLE`; com `amount = 9000` retorna `INVALID_ADJUSTMENT`.
- [ ] Todo ajuste de moderação aparece em `audit_log` com `before` e `after`.
- [ ] Nenhum endpoint da fase aceita campo de XP no request body do cliente.
- [ ] Guilda `suspended` não acumula XP e os eventos ficam gravados com `amount = 0`.
- [ ] `SUM(guild_xp_entry.amount)` por guilda é idêntico a `guild.xp` após 10.000 eventos simulados.
- [ ] Subida de nível emite `guild_event` `guild.level_up`; queda não emite.
- [ ] Nenhum desbloqueio consultável pela API altera Prestígio ou taxa de ganho de XP.
