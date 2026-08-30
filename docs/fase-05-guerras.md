# Fase 05 — Guerras e Territórios

Depende de: **04 competição** (Prestígio, ranking, temporadas). Assume 01–04 entregues.
Lê `docs/ARQUITETURA.md` como contrato: tudo nasce de `guild_event`, o servidor é a
autoridade, o tempo real vai por Twitch PubSub, toda tabela carrega `channel_id`.

---

## 1. Objetivo

Permitir que uma guilda desafie outra por um período fechado, com placar ao vivo na
extensão, e transformar o resultado em Prestígio da temporada corrente. Sobre esse
mesmo motor, disputar territórios configuráveis por canal — que valem Prestígio
recorrente e cosmético, nunca bônus mecânico.

---

## 2. Escopo

- Desafio entre guildas do **mesmo canal** (`!desafiarguilda VOID` e botão na extensão).
- Três formatos de guerra com duração, condição de vitória e Prestígio fechados.
- Ledger de **pontos de guerra (WP)** derivado de `guild_event`, com tabela de pesos própria.
- Roster simétrico por guerra (neutraliza diferença de tamanho entre guildas).
- Placar ao vivo via PubSub + endpoint de fallback.
- Territórios como **dado configurável por canal** (config page do broadcaster), mapa,
  conquista por guerra ou por disputa, defesa, liberação por ghosting/inatividade.
- Apuração, anti-conluio e integração com temporada.

## 3. Fora do escopo

| Fora | Onde vive |
|---|---|
| Matriz de permissões por cargo | Fase 02 (aqui só se diz **qual** cargo age) |
| Fórmula de XP e nível de guilda | Fase 03 |
| Cálculo de Prestígio, ranking, reset de temporada | Fase 04 |
| Arte do mapa, emblemas, molduras cosméticas | Fase 06 |
| Anúncio no chat do resultado da guerra | Fase 07 (esta fase só emite o `guild_event`) |
| Guerras entre canais diferentes | v2 — arquitetura veta cross-canal |
| Qualquer bônus de guerra/território comprável com Bits | Vetado pelo princípio do projeto |
| Aposta de Bits no resultado | Vetado — vira vantagem competitiva paga |

---

## 4. Guerra: ciclo de vida

```
              líder/oficial da desafiante
              POST /wars  ·  !desafiarguilda VOID
                          │
                          ▼
                    ┌───────────┐
                    │  pending  │
                    └─────┬─────┘
        líder/oficial     │            job war:expire (roda a cada 60s)
        da desafiada      │            sem resposta até challenge_expires_at
      ┌───────────────────┼───────────────────────┐
      ▼                   ▼                       ▼
┌────────────┐      ┌────────────┐          ┌───────────┐
│  declined  │      │  accepted  │          │  expired  │
└────────────┘      └──────┬─────┘          └───────────┘
   (terminal)              │  job war:start em starts_at        (conta p/ ghosting, R5)
                          │  rosters travados (locked_at)
                          ▼
                    ┌───────────┐   broadcaster/mod POST /wars/{id}/cancel
                    │  active   │───────────────────────────────┐
                    └─────┬─────┘   ou guilda vira banned/      │
                          │         suspended/dissolvida (R13)  ▼
                          │                              ┌───────────┐
   job war:end            │                              │ cancelled │
   ends_at atingido, ou   │                              └───────────┘
   stream.offline > 15min │                                (0 Prestígio)
   (só formato skirmish)  │
                          ▼
                    ┌───────────┐
                    │   ended   │  placar congelado · janela de contestação 10 min
                    └─────┬─────┘
                          │ job war:settle
              ┌───────────┴───────────┐
              ▼                       ▼
       ┌───────────┐          ┌──────────────┐
       │  settled  │          │  no_contest  │  vencedor < min_points (R8)
       └───────────┘          └──────────────┘  ou 0 × 0
   Prestígio creditado,           0 Prestígio,
   território transferido         território não muda de dono
```

### Transições — gatilho e prazo

| De → Para | Quem dispara | Prazo / timeout |
|---|---|---|
| — → `pending` | `leader` ou `officer` da desafiante | — |
| `pending` → `accepted` | `leader` ou `officer` da desafiada | dentro da janela de resposta |
| `pending` → `declined` | `leader` ou `officer` da desafiada | dentro da janela de resposta |
| `pending` → `expired` | job `war:expire` (60 s) | `skirmish` 2 h · `campaign` 24 h · `special` 24 h |
| `accepted` → `active` | job `war:start` | `skirmish` +5 min · `campaign` 00:00 UTC do dia seguinte · `special` no `opens_at` |
| `active` → `ended` | job `war:end` (60 s) | em `ends_at`; `skirmish` também em `stream.offline` > 15 min |
| `active` → `cancelled` | broadcaster/mod, ou hook de ban/dissolução | imediato |
| `ended` → `cancelled` | broadcaster/mod (contestação) | até 10 min após `ended` |
| `ended` → `settled` \| `no_contest` | job `war:settle` | 10 min após `ended` |

Rosters são editáveis enquanto `pending` ou `accepted`; travam na entrada em `active`.

---

## 5. Formatos de guerra

Valores fechados. `min_points` é o piso de atividade (R8) — abaixo dele a guerra apura
como `no_contest`.

| Formato | Chave | Duração | Início | Condição de vitória | `min_points` | Prestígio: vencedor / perdedor / empate (cada) |
|---|---|---|---|---|---|---|
| Escaramuça (uma live) | `skirmish` | até 6 h, ou fim da live (`stream.offline` > 15 min), o que vier primeiro | 5 min após aceitar | maior WP no congelamento | 200 | **150 / 40 / 80** |
| Campanha (uma semana) | `campaign` | 7 dias corridos | 00:00 UTC do dia seguinte ao aceite | maior WP acumulado | 800 | **500 / 120 / 250** |
| Evento especial | `special` | 1 a 14 dias, janela definida pelo broadcaster | `opens_at` da janela | maior WP; desempate por nº de territórios detidos, depois por WP do último dia | 1500 | **900 / 200 / 450** |

Notas fechadas:

- Prestígio nunca é negativo. Perder rende menos que vencer, jamais tira Prestígio — perda
  de pontos empurra guilda pequena para fora do sistema.
- Só `special` pode ter `stake_territory_id`; `skirmish` e `campaign` valem só Prestígio.
  Motivo: território não deve trocar de dono numa live morna de terça.
- `campaign` e `special` não pausam quando a live cai — o relógio é de parede. O que para é
  a geração de WP de presença, porque não há live para assistir.

---

## 6. Pontuação de guerra (WP)

### Por que WP não é XP

WP é um ledger próprio, derivado do **mesmo** `guild_event`, com tabela de pesos e janela
próprias. Não reusa XP porque: (a) XP é acumulado e permanente — guilda velha venceria por
inércia; (b) XP conta eventos pagos (cheer, sub), e guerra não pode aceitar dinheiro;
(c) XP é da guilda inteira, WP é só do roster; (d) WP zera a cada guerra sem tocar em
progressão. Um handler novo lendo `guild_event`, não um pipeline novo.

### Tabela de pontos

Só contam eventos de membros no roster (R9), com `guild_event.created_at` dentro de
`[starts_at, ends_at)`.

| Ação | `guild_event.type` | WP | Teto por membro / dia UTC |
|---|---|---:|---:|
| Primeira presença do dia na live | `daily_checkin` | 30 | 30 |
| Bloco de 10 min assistidos (live online) | `watch_tick` | 1 | 60 |
| Mensagem no chat (máx. 1 contabilizada por minuto) | `chat_message` | 1 | 30 |
| Resgate de channel points marcado como "ação de guerra" | `channel_points_redeem` | 10 | 50 |
| Acerto em quiz / minigame do canal | `minigame_win` | 15 | 75 |
| Participação em raid do canal | `raid_participation` | 25 | 25 |
| Vitória em duelo do RPG do canal (via fase 07) | `rpg_duel_win` | 20 | 100 |
| Conquista desbloqueada durante a guerra | `achievement_unlocked` | 40 | 80 |
| Cheer / sub / gift / qualquer evento monetário | `bits_cheer`, `sub`, `sub_gift`, `bits_*` | **0** | — |

- **Teto global: 250 WP por membro por dia UTC.** Excedente é descartado, não acumula.
- Qualquer `type` fora desta tabela vale 0. Adicionar tipo = adicionar linha aqui, nunca
  cair num `default` genérico.
- Os nomes de `type` seguem o catálogo da fase 03; se um nome divergir lá, esta tabela
  segue o nome da fase 03 e o peso permanece.

### Desequilíbrio de tamanho (50 × 10)

**Decisão: roster simétrico. Sem banda de matchmaking, sem normalização.** Ao criar a
guerra, `roster_size = min(ativos_7d(A), ativos_7d(B), 25)`, mínimo 3; cada lado inscreve
exatamente esse número de membros (auto-preenchido por atividade recente, editável pelo
líder/oficial até a guerra ficar `active`). Banda por nível ou tamanho fragmentaria canais
com 4 guildas — ninguém acharia oponente; normalização por média vira fórmula que o viewer
não entende e o suporte não explica. Simetria de roster é uma regra só, visível na tela.

---

## 7. Placar ao vivo

```
🔴 GUERRA DE GUILDAS
VOID 1.450   ⚔️   ECLIPSE 1.320
```

| Item | Decisão |
|---|---|
| Transporte | Twitch PubSub, tópico `broadcast` do canal, mensagem `war.board` |
| Agregação | Um único `war.board` traz **todas** as guerras ativas do canal (até 8 pares), não uma mensagem por guerra — o limite é 1 msg/s e 5 KB por tópico |
| Frequência | 1 mensagem a cada **5 s** enquanto houver guerra `active`; nenhuma se o placar não mudou desde o último envio |
| Fonte do número | Contadores em Redis (`war:{id}:score:{guild_id}`), incrementados pelo handler de WP; flush para `war.score_*` no Postgres a cada 30 s e sempre na transição para `ended` |
| Ordenação | Campo `seq` monotônico por guerra. Cliente descarta mensagem com `seq` ≤ último visto |
| Atraso | Placar exibido é sempre "até 5 s atrás". A UI não promete tempo real ao segundo |
| Sem mensagem há 30 s | Selo `reconectando` no card e fallback por polling em `GET /wars/{id}/score` a cada 20 s |
| Reconexão | Ao reabrir o painel, `GET /wars/active` reidrata o estado inteiro antes de reassinar o PubSub |
| Fim da guerra | Mensagem `war.ended` com placar final e `winner_guild_id`; o card fica congelado com selo `apurando` até chegar `war.settled` |
| Live cai — `skirmish` | `stream.offline` por mais de 15 min ⇒ `ended` imediato com o placar do momento do offline. Volta antes dos 15 min ⇒ nada acontece, WP de presença simplesmente não foi gerado no intervalo |
| Live cai — `campaign` / `special` | Guerra continua; relógio de parede não pausa; WP de presença só volta a correr quando a live volta |
| Live cai antes de `starts_at` (`skirmish`) | Guerra vai a `cancelled`, 0 Prestígio, sem contar cooldown de par |

O servidor é a única fonte do placar. A extensão nunca soma WP localmente, nem para
"suavizar" a animação entre atualizações.

---

## 8. Territórios: modelo

```
Floresta Sombria — VOID        Fortaleza Carmesim — Eclipse
Ruínas Antigas — Arcadia       Templo Celestial — Nightfall
```

### Mapa é dado, não código

Territórios vivem na tabela `territory`, criados pelo broadcaster na config page: nome,
slug, posição (`map_x`, `map_y` numa grade 0–1000), chave de arte e `prestige_per_day`.
O frontend renderiza o que o `GET /territories` devolver. Canal novo nasce com 0
territórios e um botão "usar mapa exemplo" que insere 6. Máximo **12 habilitados por canal**.

### Regras de posse

| Pergunta | Resposta fechada |
|---|---|
| Como se conquista? | Duas vias, só duas: (a) vencer uma guerra `special` cujo `stake_territory_id` é aquele território, detido pela defensora; (b) vencer uma **disputa** — janela aberta pelo broadcaster sobre território `neutral`, em que N guildas acumulam WP e a de maior WP leva |
| Como se defende? | Não existe "defender ativamente". Detentor mantém enquanto (1) responder aos desafios territoriais e (2) continuar ativo. Vencer a guerra de stake mantém a posse e reinicia `protected_until` |
| Proteção pós-conquista | 48 h. Desafio com esse stake dentro da janela → `409 TERRITORY_PROTECTED` |
| Ghosting do detentor | 2 desafios territoriais **expirados** (não respondidos) em 7 dias ⇒ território liberado (`release_reason='ghosting'`) e disputa aberta automática de 48 h. Recusar explicitamente não libera — só ignorar |
| Decaimento | Não há decaimento por tempo. Há por **inatividade**: 14 dias sem nenhum `guild_event` da guilda detentora ⇒ liberado (`release_reason='inactivity'`) |
| Guilda dissolvida / banida / suspensa | Todos os seus territórios voltam a `neutral` na hora (`guild_dissolved` / `guild_banned`). O histórico em `territory_holding` permanece com `released_at` |
| Teto por guilda | 4 territórios simultâneos. Guerra ou disputa que levaria ao 5º é recusada com `TERRITORY_CAP_REACHED` |
| Fim de temporada | Territórios **não** resetam. Prestígio reseta (fase 04); a posse continua e volta a render na temporada nova |

### O que um território vale

**Prestígio por temporada + cosmético. Zero bônus mecânico.**

- `prestige_per_day` (padrão **10**, configurável 0–25 por território), creditado no fecho
  diário às 00:05 UTC, **só se a guilda detentora registrou ≥ 1 `guild_event` naquele dia**.
- Cosmético: nome do território no perfil da guilda, cor da guilda no mapa, pin no card do
  ranking.

Justificativa (curta): bônus mecânico (ex.: +10% Guild XP) compõe com si mesmo — quem
domina o mapa domina mais rápido, e a fase 04 vira monopólio em duas temporadas. Pior: a
criação de guilda custa Bits, então qualquer bônus derivado transformaria Bits em vantagem
competitiva por via indireta, contra o princípio do projeto. Prestígio diário exige
atividade contínua para render, o que é exatamente o comportamento que o produto quer.

---

## 9. Modelo de dados (delta desta fase)

Não altera `guild`, `guild_member` nem `guild_event`. Só lê `guild_event`.

```sql
CREATE TYPE war_format AS ENUM ('skirmish','campaign','special');
CREATE TYPE war_status AS ENUM ('pending','accepted','declined','expired',
                                'active','ended','settled','no_contest','cancelled');

CREATE TABLE war (
  id                   BIGSERIAL PRIMARY KEY,
  channel_id           BIGINT      NOT NULL REFERENCES channel(id),
  format               war_format  NOT NULL,
  status               war_status  NOT NULL DEFAULT 'pending',
  challenger_guild_id  BIGINT      NOT NULL REFERENCES guild(id),
  defender_guild_id    BIGINT      NOT NULL REFERENCES guild(id),
  stake_territory_id   BIGINT      REFERENCES territory(id),
  roster_size          SMALLINT    NOT NULL CHECK (roster_size BETWEEN 3 AND 25),
  min_points           INT         NOT NULL CHECK (min_points > 0),
  declared_by          TEXT        NOT NULL,          -- twitch user_id
  responded_by         TEXT,
  challenge_expires_at TIMESTAMPTZ NOT NULL,
  starts_at            TIMESTAMPTZ,
  ends_at              TIMESTAMPTZ,
  ended_at             TIMESTAMPTZ,
  settled_at           TIMESTAMPTZ,
  season_id            BIGINT      REFERENCES season(id),
  score_challenger     INT         NOT NULL DEFAULT 0 CHECK (score_challenger >= 0),
  score_defender       INT         NOT NULL DEFAULT 0 CHECK (score_defender   >= 0),
  winner_guild_id      BIGINT      REFERENCES guild(id),
  prestige_multiplier  NUMERIC(3,2) NOT NULL DEFAULT 1.00
                         CHECK (prestige_multiplier BETWEEN 0 AND 1),
  prestige_awarded     JSONB,      -- {"<guild_id>": 500, "<guild_id>": 120}
  cancel_reason        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT war_distinct_guilds CHECK (challenger_guild_id <> defender_guild_id),
  CONSTRAINT war_window   CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT war_winner   CHECK (winner_guild_id IS NULL
                                 OR winner_guild_id IN (challenger_guild_id, defender_guild_id)),
  CONSTRAINT war_stake    CHECK (stake_territory_id IS NULL OR format = 'special'),
  CONSTRAINT war_settled  CHECK (status <> 'settled' OR (settled_at IS NOT NULL
                                                         AND prestige_awarded IS NOT NULL)),
  CONSTRAINT war_cancel   CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL)
);
CREATE INDEX war_channel_status_idx ON war (channel_id, status, ends_at);

-- R1: no máximo UMA guerra aberta por guilda, em qualquer papel.
-- Linhas inseridas para os dois lados ao criar a guerra, removidas ao sair
-- de (pending, accepted, active). A PK é a trava — não é validação de aplicação.
CREATE TABLE war_slot (
  channel_id BIGINT NOT NULL REFERENCES channel(id),
  guild_id   BIGINT NOT NULL REFERENCES guild(id),
  war_id     BIGINT NOT NULL REFERENCES war(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, guild_id)
);

CREATE TABLE war_roster (
  war_id    BIGINT      NOT NULL REFERENCES war(id) ON DELETE CASCADE,
  guild_id  BIGINT      NOT NULL REFERENCES guild(id),
  user_id   TEXT        NOT NULL,
  added_by  TEXT        NOT NULL,
  locked_at TIMESTAMPTZ,
  PRIMARY KEY (war_id, user_id)
);
CREATE INDEX war_roster_side_idx ON war_roster (war_id, guild_id);
-- contagem == war.roster_size por lado: validada na transação de PUT /roster
-- e reconferida no job war:start (guerra sem roster completo vai a cancelled).

CREATE TABLE war_point (
  id         BIGSERIAL   PRIMARY KEY,
  war_id     BIGINT      NOT NULL REFERENCES war(id) ON DELETE CASCADE,
  guild_id   BIGINT      NOT NULL REFERENCES guild(id),
  user_id    TEXT        NOT NULL,
  event_id   BIGINT      NOT NULL REFERENCES guild_event(id),
  event_type TEXT        NOT NULL,
  points     SMALLINT    NOT NULL CHECK (points > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- idempotência: um guild_event nunca vira dois pontos na mesma guerra
  CONSTRAINT war_point_once UNIQUE (war_id, event_id)
);
CREATE INDEX war_point_tally_idx ON war_point (war_id, guild_id);
CREATE INDEX war_point_cap_idx   ON war_point (war_id, user_id, created_at);

CREATE TABLE territory (
  id               BIGSERIAL   PRIMARY KEY,
  channel_id       BIGINT      NOT NULL REFERENCES channel(id),
  slug             TEXT        NOT NULL,
  name             TEXT        NOT NULL,
  map_x            SMALLINT    NOT NULL CHECK (map_x BETWEEN 0 AND 1000),
  map_y            SMALLINT    NOT NULL CHECK (map_y BETWEEN 0 AND 1000),
  art_key          TEXT,
  prestige_per_day SMALLINT    NOT NULL DEFAULT 10
                     CHECK (prestige_per_day BETWEEN 0 AND 25),
  enabled          BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, slug),
  UNIQUE (channel_id, name)
);

CREATE TABLE territory_holding (
  id                BIGSERIAL   PRIMARY KEY,
  territory_id      BIGINT      NOT NULL REFERENCES territory(id) ON DELETE CASCADE,
  guild_id          BIGINT      NOT NULL REFERENCES guild(id),
  acquired_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  acquired_via      TEXT        NOT NULL CHECK (acquired_via IN ('war','dispute','admin')),
  source_war_id     BIGINT      REFERENCES war(id),
  source_dispute_id BIGINT      REFERENCES territory_dispute(id),
  protected_until   TIMESTAMPTZ NOT NULL,
  released_at       TIMESTAMPTZ,
  release_reason    TEXT CHECK (release_reason IN ('lost_war','lost_dispute','ghosting',
                                                   'inactivity','guild_dissolved',
                                                   'guild_banned','admin')),
  CONSTRAINT holding_release_pair CHECK ((released_at IS NULL) = (release_reason IS NULL)),
  CONSTRAINT holding_order        CHECK (released_at IS NULL OR released_at >= acquired_at)
);
-- um território tem no máximo UM dono vigente
CREATE UNIQUE INDEX territory_current_owner ON territory_holding (territory_id)
  WHERE released_at IS NULL;
CREATE INDEX territory_holding_guild_idx ON territory_holding (guild_id)
  WHERE released_at IS NULL;

CREATE TABLE territory_dispute (
  id              BIGSERIAL   PRIMARY KEY,
  channel_id      BIGINT      NOT NULL REFERENCES channel(id),
  territory_id    BIGINT      NOT NULL REFERENCES territory(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','closed','void')),
  opened_by       TEXT        NOT NULL,
  opens_at        TIMESTAMPTZ NOT NULL,
  closes_at       TIMESTAMPTZ NOT NULL,
  min_points      INT         NOT NULL DEFAULT 300 CHECK (min_points > 0),
  season_id       BIGINT      REFERENCES season(id),
  winner_guild_id BIGINT      REFERENCES guild(id),
  CONSTRAINT dispute_window CHECK (closes_at > opens_at),
  CONSTRAINT dispute_closed CHECK (status <> 'closed' OR winner_guild_id IS NOT NULL
                                   OR min_points > 0)
);
CREATE UNIQUE INDEX dispute_one_open ON territory_dispute (territory_id)
  WHERE status = 'open';

CREATE TABLE territory_dispute_entry (
  dispute_id BIGINT      NOT NULL REFERENCES territory_dispute(id) ON DELETE CASCADE,
  guild_id   BIGINT      NOT NULL REFERENCES guild(id),
  points     INT         NOT NULL DEFAULT 0 CHECK (points >= 0),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dispute_id, guild_id)
);
```

Ghosting (R5) e cooldown de par (R6) são **derivados** de `war` — nenhuma tabela nova.

---

## 10. API

Base `/api/v1`. Todas exigem JWT da Twitch. Erros no formato
`{ error: { code, message } }`. Cargos citados vêm da matriz da fase 02.

| Método | Rota | Quem chama | Request | Response | Erros |
|---|---|---|---|---|---|
| POST | `/wars` | `leader`/`officer` da desafiante | `{defender_tag, format, stake_territory_id?}` | `201 War` | `400 WAR_SELF_CHALLENGE` · `403 WAR_FORBIDDEN_ROLE` · `409 GUILD_WAR_SLOT_TAKEN` · `409 WAR_COOLDOWN_PAIR` · `409 WAR_BLOCKED_GHOSTING` · `409 GUILD_NOT_ACTIVE` · `409 WAR_CROSSES_SEASON` · `409 TERRITORY_PROTECTED` · `409 TERRITORY_NOT_HELD_BY_DEFENDER` · `409 TERRITORY_CAP_REACHED` · `422 WAR_ROSTER_TOO_SMALL` |
| POST | `/wars/{id}/accept` | `leader`/`officer` da desafiada | `{}` | `200 War` | `403 WAR_FORBIDDEN_ROLE` · `409 WAR_NOT_PENDING` · `409 WAR_EXPIRED` · `409 GUILD_WAR_SLOT_TAKEN` |
| POST | `/wars/{id}/decline` | `leader`/`officer` da desafiada | `{reason?}` | `200 War` | `403 WAR_FORBIDDEN_ROLE` · `409 WAR_NOT_PENDING` |
| PUT | `/wars/{id}/roster` | `leader`/`officer` do próprio lado | `{user_ids: []}` | `200 {roster}` | `403 WAR_FORBIDDEN_ROLE` · `409 WAR_ROSTER_LOCKED` · `422 WAR_ROSTER_SIZE_MISMATCH` · `422 USER_NOT_GUILD_MEMBER` |
| GET | `/wars/{id}` | qualquer viewer do canal | — | `200 War + rosters` | `404 WAR_NOT_FOUND` |
| GET | `/wars/{id}/score` | extensão (fallback do PubSub) | — | `200 {seq, challenger, defender, updated_at}` | `404 WAR_NOT_FOUND` |
| GET | `/wars/active` | extensão (reidratação) | — | `200 [WarBoard]` | — |
| GET | `/wars?guild_id=&status=&cursor=&limit=` | qualquer viewer | — | `200 {items, next_cursor}` | — |
| POST | `/wars/{id}/cancel` | `broadcaster`/`moderator` | `{reason}` | `200 War` | `403 FORBIDDEN` · `409 WAR_NOT_CANCELLABLE` |
| GET | `/territories` | qualquer viewer | — | `200 [Territory + dono vigente]` | — |
| POST | `/territories` | `broadcaster` | `{slug, name, map_x, map_y, art_key?, prestige_per_day?}` | `201 Territory` | `403 FORBIDDEN` · `409 TERRITORY_SLUG_TAKEN` · `409 TERRITORY_LIMIT_REACHED` |
| PATCH | `/territories/{id}` | `broadcaster` | campos parciais | `200 Territory` | `403 FORBIDDEN` · `404 TERRITORY_NOT_FOUND` |
| DELETE | `/territories/{id}` | `broadcaster` | — | `204` | `403 FORBIDDEN` · `409 TERRITORY_IN_USE` (guerra/disputa aberta) |
| POST | `/territories/{id}/holdings` | `broadcaster` | `{guild_id \| null, reason}` | `200 Holding` | `403 FORBIDDEN` · `409 TERRITORY_CAP_REACHED` — grava em `audit_log` |
| POST | `/territories/{id}/disputes` | `broadcaster`/`moderator` | `{opens_at, closes_at, min_points?}` | `201 Dispute` | `403 FORBIDDEN` · `409 DISPUTE_ALREADY_OPEN` · `409 TERRITORY_HELD` · `422 DISPUTE_WINDOW_INVALID` |
| POST | `/disputes/{id}/join` | `leader`/`officer` | `{}` | `200 Entry` | `403 WAR_FORBIDDEN_ROLE` · `409 DISPUTE_CLOSED` · `409 DISPUTE_ALREADY_JOINED` · `409 GUILD_WAR_SLOT_TAKEN` · `409 TERRITORY_CAP_REACHED` |
| GET | `/disputes/{id}` | qualquer viewer | — | `200 Dispute + placar` | `404 DISPUTE_NOT_FOUND` |

Nenhum endpoint aceita pontos vindos do cliente. Não existe `POST /wars/{id}/points`.

Eventos emitidos para a fase 07 (via `guild_event`): `war.declared`, `war.accepted`,
`war.declined`, `war.started`, `war.ended`, `war.settled`, `territory.captured`,
`territory.lost`, `dispute.opened`, `dispute.closed`.

---

## 11. Regras de negócio

**Guerra — abertura e resposta**

- **R1** — Uma guilda tem no máximo **1** guerra aberta (`pending`, `accepted`, `active`)
  por vez, em qualquer papel. Garantido pela PK de `war_slot`. Violação → `409 GUILD_WAR_SLOT_TAKEN`.
- **R2** — Declarar, aceitar, recusar e editar roster: só `leader` e `officer`. Qualquer
  outro cargo → `403 WAR_FORBIDDEN_ROLE`.
- **R3** — Ambas as guildas precisam estar com `guild.status = 'active'` no momento da
  criação e do aceite. Caso contrário → `409 GUILD_NOT_ACTIVE`.
- **R4** — Desafio expira sem resposta: `skirmish` 2 h, `campaign` e `special` 24 h.
- **R5** — *Ghosting:* 3 desafios levados a `expired` pela mesma guilda em 7 dias ⇒ ela
  fica impedida de **declarar** guerra por 72 h (`409 WAR_BLOCKED_GHOSTING`); continua
  podendo aceitar. Recusa explícita (`declined`) **não** pune — recusar é uma resposta legítima.
- **R6** — *Cooldown de par:* a mesma dupla (A,B) só abre nova guerra 24 h após a anterior
  sair do estado aberto → `409 WAR_COOLDOWN_PAIR`.

**Guerra — pontuação**

- **R7** — WP só é gravado para `user_id` presente em `war_roster` daquela guerra, com
  `guild_event.created_at` em `[starts_at, ends_at)` e `type` na tabela do §6.
- **R8** — Piso de atividade: se o maior placar < `war.min_points`, ou o placar é 0 × 0, a
  guerra apura como `no_contest`: 0 Prestígio para os dois, território não muda de dono, e
  a guerra não conta para o teto semanal do R11.
- **R9** — Teto de 250 WP por membro por dia UTC; excedente descartado, não acumula para
  o dia seguinte.
- **R10** — Eventos monetários (`bits_cheer`, `sub`, `sub_gift`, qualquer `bits_*`) valem
  **0 WP**, sempre, em qualquer formato. Bits não compram guerra.

**Guerra — anti-conluio e apuração**

- **R11** — *Anti-conluio.* (a) Se a mesma dupla já apurou uma guerra `settled` nos últimos
  14 dias, `prestige_multiplier = 0.25`. (b) Cada guilda apura no máximo **2** guerras com
  Prestígio integral por semana ISO; da 3ª em diante `prestige_multiplier = 0`. Guerras
  `no_contest` e `cancelled` não contam para o teto.
- **R12** — *Temporada.* A guerra é atribuída à temporada vigente em `ends_at`. Uma guerra
  não pode ser **aceita** se `ends_at > season.ends_at` → `409 WAR_CROSSES_SEASON`. Assim
  nenhuma guerra atravessa fecho de temporada e o ranking congela sem esperar apuração.
- **R13** — *Guilda banida/suspensa/dissolvida durante a guerra.* A guerra vai a
  `cancelled` (`cancel_reason`), **0 Prestígio para os dois lados**, território em jogo não
  muda de dono, guerra não conta para R6 nem R11. Zero de propósito: premiar o lado
  restante criaria incentivo a denunciar o adversário no meio da guerra.
- **R14** — Empate: os dois recebem o valor de empate do formato; território em jogo
  permanece com o dono atual e tem `protected_until` renovado.
- **R15** — Contestação: `broadcaster`/`moderator` pode cancelar uma guerra `ended` em até
  10 min. Depois de `settled`, só reversão manual com registro em `audit_log`.
- **R16** — Idempotência: `UNIQUE (war_id, event_id)` em `war_point`. Reprocessar a fila
  não dobra placar. O Redis é cache; a verdade é a soma de `war_point`, reconferida na
  transição para `ended`.

**Territórios**

- **R17** — Território muda de dono **só** por apuração de guerra `special` com
  `stake_territory_id` ou por fechamento de disputa. Exceção: `POST /territories/{id}/holdings`
  do broadcaster, sempre com `audit_log`.
- **R18** — `protected_until = acquired_at + 48 h`. Desafio com esse stake dentro da janela
  → `409 TERRITORY_PROTECTED`.
- **R19** — Ghosting territorial: 2 desafios com aquele stake levados a `expired` pelo
  detentor em 7 dias ⇒ liberação (`ghosting`) + disputa aberta automática de 48 h.
- **R20** — Inatividade: 14 dias sem nenhum `guild_event` da guilda detentora ⇒ liberação
  (`inactivity`). Não há decaimento por tempo puro.
- **R21** — Guilda que sai de `active` (banida, suspensa, dissolvida) libera todos os
  territórios imediatamente, com `release_reason` correspondente. Histórico preservado.
- **R22** — Teto de 4 territórios por guilda e 12 territórios habilitados por canal.
- **R23** — Rendimento: `prestige_per_day` creditado às 00:05 UTC, **só** se a guilda
  detentora registrou ≥ 1 `guild_event` no dia anterior. Território não dá nenhum bônus
  mecânico (§8).
- **R24** — Disputa só abre sobre território `neutral` (sem holding vigente) →
  `409 TERRITORY_HELD`. Participar de disputa ocupa o `war_slot` da guilda (R1).
- **R25** — Disputa com todas as entradas abaixo de `min_points` fecha como `void`: ninguém
  leva, território segue neutro.
- **R26** — Fim de temporada não altera posse de território. Prestígio reseta pela fase 04;
  o rendimento diário recomeça na temporada nova.

---

## 12. Riscos e decisões em aberto

| # | Assunto | Situação | Recomendação |
|---|---|---|---|
| D1 | **Escopo: territórios são a parte mais cara e menos essencial** | Honestamente: territórios são ~60% do custo desta fase (mapa, config page, disputas, jobs de liberação, 4 tabelas) e a guerra funciona 100% sem eles. São também o item mais vendável visualmente e o mais fácil de morrer sem uso | Quebrar em **05a — guerras** (§4–7, 9–11 sem território) e **05b — territórios**. Entregar 05a, medir guerras/semana por canal durante 3 semanas; só fazer 05b se houver ≥ 2 guerras apuradas por canal ativo por semana |
| D2 | Arte do mapa | Não há artista definido; `art_key` está no schema mas sem pipeline | v1 = grade de cards com nome, cor e emblema da guilda dona. Mapa ilustrado só depois da fase 06 (Emblem Creator), reusando o pipeline de asset de lá |
| D3 | `watch_tick` é falsificável | Aba aberta em background gera presença sem espectador | Exigir `document.visibilityState === 'visible'` + heartbeat assinado pelo EBS + teto diário do R9. Aceitar o resíduo — não vale antifraude pesada num placar de guilda |
| D4 | Fuso horário | Tudo em UTC; canais BR viram o dia no meio da madrugada e o teto do R9 reseta às 21h local | Aberto. Recomendação: `channel.settings.timezone` e aplicar o dia do R9/R23 nele. Custo baixo, fica para 05b |
| D5 | Limite do PubSub | 1 msg/s e 5 KB por tópico; um canal grande pode ter 10+ guerras ativas | Já mitigado: `war.board` agregado, 8 guerras por mensagem, o resto só via `GET`. Se estourar, particionar por tópico `war-board-{n}` |
| D6 | Bônus mecânico de território | Fechado como **não** na v1 (§8) | Não reabrir sem dado. Se reabrir, só bônus não-competitivo (moldura, emote de canal), nunca XP/Prestígio |
| D7 | `rpg_duel_win` | Depende do bot do canal e da fase 07 | O peso fica na tabela do §6; se a fase 07 não entregar, a linha simplesmente não gera evento. Sem branch no código |
| D8 | Guerras em canal com 2 guildas | O par sempre repete, e o R11(a) derruba o Prestígio a 0.25 quase sempre | Aberto. Recomendação: aplicar R11(a) só quando o canal tiver ≥ 4 guildas `active`; abaixo disso, cooldown de par de 72 h em vez de multiplicador |
| D9 | Valores de Prestígio (§5) | Escolhidos por proporção com a fase 04, não por telemetria | Revisar após a primeira temporada com guerras. Manter os números em `channel.settings` para ajuste sem deploy |

---

## 13. Critérios de aceite

**Guerra — ciclo**

- [ ] `leader` e `officer` conseguem declarar guerra pela extensão e por `!desafiarguilda TAG`; `veteran`, `member` e `recruit` recebem `403 WAR_FORBIDDEN_ROLE`.
- [ ] Segundo desafio para uma guilda já em guerra retorna `409 GUILD_WAR_SLOT_TAKEN`, tanto no papel de desafiante quanto de desafiada.
- [ ] Desafio `skirmish` não respondido em 2 h vira `expired` em até 60 s do vencimento; `campaign` em 24 h.
- [ ] Guerra aceita entra em `active` no `starts_at` correto de cada formato e trava os rosters (`locked_at` preenchido).
- [ ] Guerra `active` vai a `ended` em `ends_at`; `skirmish` também vai a `ended` após 15 min de `stream.offline`.
- [ ] `ended` vira `settled` 10 min depois, com `prestige_awarded` preenchido e Prestígio visível no ranking da fase 04.

**Pontuação**

- [ ] Cada linha da tabela do §6 gera exatamente o WP declarado, com `war_point.event_type` correspondente.
- [ ] `bits_cheer`, `sub` e `sub_gift` durante a guerra geram **0** linhas em `war_point`.
- [ ] Evento de membro fora do roster não gera WP.
- [ ] Membro que atinge 250 WP no dia para de pontuar até 00:00 UTC.
- [ ] Reprocessar a fila de eventos não altera `score_challenger`/`score_defender` (teste de idempotência).
- [ ] Guilda de 50 contra guilda de 10: `roster_size = 10` nos dois lados; WP de membro fora do roster de 10 não conta.
- [ ] Guerra com vencedor abaixo de `min_points` apura como `no_contest` e credita 0 Prestígio.

**Placar**

- [ ] Placar na extensão bate com `GET /wars/{id}/score` com defasagem ≤ 5 s.
- [ ] Sem mensagem PubSub por 30 s, a UI mostra `reconectando` e passa a fazer polling de 20 s.
- [ ] Recarregar o painel reidrata o placar por `GET /wars/active` antes de reassinar.
- [ ] Mensagem PubSub com `seq` antigo é descartada pelo cliente (teste de reordenação).

**Anti-conluio e temporada**

- [ ] Mesma dupla apurando 2 guerras em 14 dias: a segunda sai com `prestige_multiplier = 0.25`.
- [ ] 3ª guerra da mesma guilda na semana ISO sai com `prestige_multiplier = 0`.
- [ ] Aceitar guerra cujo `ends_at` passa do fim da temporada retorna `409 WAR_CROSSES_SEASON`.
- [ ] Banir uma guilda durante guerra `active` leva a guerra a `cancelled` com 0 Prestígio para os dois lados.

**Territórios**

- [ ] Broadcaster cria, edita, reordena e desabilita territórios pela config page; o mapa da extensão reflete sem redeploy do frontend.
- [ ] 13º território habilitado no canal retorna `409 TERRITORY_LIMIT_REACHED`.
- [ ] Vencer guerra `special` com stake transfere a posse: holding antiga com `released_at` + `lost_war`, holding nova com `protected_until = now + 48 h`.
- [ ] `SELECT` de holdings vigentes nunca devolve dois donos para o mesmo território (constraint testada com escrita concorrente).
- [ ] Desafio de stake dentro das 48 h de proteção retorna `409 TERRITORY_PROTECTED`.
- [ ] 2 desafios territoriais expirados em 7 dias liberam o território com `ghosting` e abrem disputa de 48 h.
- [ ] 14 dias sem `guild_event` da detentora liberam o território com `inactivity`.
- [ ] Banir/dissolver guilda libera todos os seus territórios na hora e mantém o histórico.
- [ ] Território rende `prestige_per_day` no fecho diário só quando a guilda teve atividade no dia; sem atividade, rende 0.
- [ ] Nenhum endpoint, evento ou cálculo desta fase concede bônus de XP, Prestígio extra ou limite de membros a partir de compra em Bits.
