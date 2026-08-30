# Fase 04 — Competição

Prestígio, ranking, temporadas e conquistas. Depende da fase 03 (Guild XP e níveis).
Contrato base: [docs/ARQUITETURA.md](../docs/ARQUITETURA.md). Nada aqui redefine aquilo.

## 1. Objetivo

Dar ao canal uma disputa com começo, meio e fim: guildas acumulam **Prestígio** durante
uma temporada, um ranking público mostra a posição ao vivo, e no fim há campeã, vice e
terceiro. O Prestígio reseta na virada de temporada; a guilda não.

## 2. Escopo

- Fonte, cálculo e persistência de **Prestígio** por temporada.
- **Ranking** por canal: cálculo, desempate, paginação por cursor, cache.
- **Temporadas**: ciclo de vida, encerramento automático, apuração, pódio, arquivamento.
- **Conquistas de guilda**: catálogo, detecção a partir de `guild_event`, progresso, exibição no perfil.
- Endpoints de leitura para a extensão e de administração para o broadcaster.

### Fora do escopo

| Item | Onde fica |
|---|---|
| Guerras entre guildas, placar ao vivo, territórios | Fase 05 |
| Emblema/moldura/título de campeã (arte e loja) | Fase 06 |
| Anúncio do pódio no chat pelo bot | Fase 07 |
| Ranking cross-canal | Fora da v1 (ARQUITETURA) |
| Decaimento de Prestígio dentro da temporada | Decisão em aberto D2 |
| Qualquer fonte de Prestígio comprável com Bits/sub | Proibido por princípio (R3) |

## 3. XP vs Prestígio

São dois eixos separados de propósito. XP é a **história** da guilda; Prestígio é o
**desempenho desta temporada**. Um não converte no outro em nenhuma direção.

| | Guild XP (fase 03) | Prestígio (fase 04) |
|---|---|---|
| O que gera | Atividade sustentada dos membros (presença, participação, marcos internos) | Resultado competitivo: vencer eventos, pódios, objetivos semanais |
| O que faz | Sobe **nível**, destrava limite de membros, cargos e slots | Define **posição no ranking** e o pódio da temporada |
| Reseta? | **Nunca.** Acumulativo, `guild.xp` / `guild.level` | **Sim**, a cada temporada (linha nova em `guild_season_prestige`) |
| Curva | Monotônica, só sobe | Zera na virada; dentro da temporada só sobe (piso 0) |
| Quem vê | Perfil da guilda, todos os membros | Ranking público do canal, todos os viewers |
| Rótulo na UI | "Nível 12 · 48.900 XP" | "**Poder**" (ex.: `15.420 Poder`) |
| Coluna | `guild.xp`, `guild.level` | `guild_season_prestige.prestige` |

> **"Poder" é o rótulo de UI do Prestígio da temporada corrente.** Uma palavra só na
> interface, uma coluna só no banco. Não existe uma terceira métrica.

Por que separar: se o ranking usasse XP, a guilda mais antiga seria campeã para sempre e
uma guilda nova nunca teria motivo para competir. XP recompensa permanecer; Prestígio
recompensa vencer **agora**.

## 4. Fórmula de Prestígio

Prestígio da temporada = soma do `prestige_ledger` da guilda naquela temporada. Nada é
calculado em tempo de leitura; toda entrada nasce de um `guild_event` (ARQUITETURA §
`guild_event é o eixo do sistema`).

### 4.1 Fontes e pontos (valores fechados, v1)

| Fonte | `guild_event.type` | Pontos | Teto |
|---|---|---:|---|
| Vencer um evento do canal | `event.win` | **500** | — |
| 2º lugar em evento | `event.placement` (`rank=2`) | **300** | — |
| 3º lugar em evento | `event.placement` (`rank=3`) | **150** | — |
| Participação válida de membro em evento | `event.participate` | **10** por membro | **20 membros / evento** (máx. 200) |
| Objetivo semanal da guilda concluído | `weekly.objective_completed` | **250** | 1 por semana ISO |
| Subir de nível durante a temporada | `guild.level_up` | **100** | — |
| Bônus de sequência: vencer eventos em 3 dias distintos dentro de 7 dias corridos | derivado de `event.win` | **+200** | 1 por janela de 7 dias |
| Correção manual do broadcaster | `prestige.manual_adjust` | valor informado (±) | ver R14 |

Referência de escala: 1 vitória (500) + participação cheia (200) ≈ 700. Os `15.420` do
mockup são ~22 vitórias limpas em 90 dias — ritmo de uma guilda ativa, não de um bot.

### 4.2 Viés de tamanho

Uma guilda de 50 **não** vence uma de 10 por default: as fontes de resultado
(`event.win`, `placement`, `weekly`, `level_up`) são **flat por guilda**, e a única fonte
por-cabeça (`event.participate`) tem teto de **20 contribuintes por evento** — acima disso
o membro extra vale 0. Escolhemos teto de top-N em vez de per capita porque per capita
pune recrutar, que é justamente o loop que a fase 02 existe para incentivar.

## 5. Ranking

Um ranking por canal, por temporada. Ordena por `prestige` DESC da temporada corrente.

### 5.1 Tempo real vs janela

| Camada | Atualização | Serve |
|---|---|---|
| `guild_season_prestige` (Postgres) | Síncrona, na mesma transação do `prestige_ledger` | Verdade |
| ZSET Redis `rank:{season_id}` | `ZINCRBY` na mesma escrita | Posição ao vivo de **uma** guilda (`ZREVRANK`) |
| `ranking_snapshot` (+ `_row`) | Job a cada **60 s**, e uma vez `is_final` no encerramento | Página do ranking, paginada e estável |

A lista pública é uma **janela de 60 s**. Isso é deliberado: paginar sobre dados que mudam
a cada cheer produz guildas duplicadas e guildas puladas entre páginas. Só o card "sua
guilda" é ao vivo, via `ZREVRANK` — é onde o viewer percebe latência.

### 5.2 Desempate

Aplicado nesta ordem, na geração do snapshot:

1. `prestige` DESC
2. `last_gain_at` ASC — quem chegou àquele Prestígio primeiro fica à frente
3. `guild.created_at` ASC
4. `guild.id` ASC — desempate final, garante ordem total

Consequência: **nunca há duas guildas na mesma `position`**. O pódio sempre tem 1, 2 e 3
distintos (R11).

### 5.3 Paginação e cache

- Cursor opaco (base64) = `{snapshot_id, position}`. A página seguinte lê
  `WHERE snapshot_id = :s AND position > :p ORDER BY position LIMIT :limit`.
- O `snapshot_id` viajar no cursor é o que torna a paginação consistente: a página 3 vem
  do mesmo retrato da página 1, mesmo que o ranking tenha mudado. Snapshot expirado
  (> 10 min) → `CURSOR_EXPIRED`, cliente recomeça da página 1.
- `limit` default 25, máximo 100.
- Cache: `rank:{season_id}:snap:{snapshot_id}:{cursor}` no Redis, TTL 90 s.
- Snapshots não-finais com mais de 24 h são apagados por job diário; o `is_final` fica para sempre.

### 5.4 O que a extensão mostra

```
🥇 VOID — 15.420 Poder      🥈 Eclipse — 13.850      🥉 Crimson — 12.700
4º Nightfall — 10.300       5º Arcadia — 9.850
```

- Pódio (1–3) com medalha; 4º em diante com número ordinal.
- Números formatados em pt-BR (separador de milhar `.`).
- Cabeçalho: nome da temporada + contagem regressiva para `ends_at`.
- Card fixo "sua guilda": posição ao vivo, Prestígio e delta de posição vs. o snapshot anterior.
- Temporada em `freezing`: banner "Apuração em andamento", lista congelada.

## 6. Temporadas

### 6.1 Duração: 90 dias

Fixa em 90 dias na v1. Justificativa:

- 4 temporadas/ano alinham com trimestre: o streamer produz premiação e anúncio 4× ao ano, não 6×.
- Uma guilda criada no dia 45 ainda tem 45 dias e ~6 objetivos semanais — tempo real de disputa.
- Abaixo de 60 dias o reset vira ruído; acima de 90 volta o problema que o reset existe para resolver.

A duração vive em dados (`season.starts_at` / `ends_at`), não em código: mudar para 60 é
uma linha em `season`, não um deploy.

### 6.2 Ciclo de vida

```
scheduled ──(starts_at)──> active ──(ends_at)──> freezing ──(apuração ok)──> closed ──(+30d)──> archived
```

| Status | Aceita Prestígio? | Ranking visível? | Observação |
|---|---|---|---|
| `scheduled` | não | não | criada com antecedência; janela não pode sobrepor outra (R8) |
| `active` | sim | sim, ao vivo | no máximo uma por canal |
| `freezing` | não | sim, congelado | janela de **1 hora** após `ends_at` |
| `closed` | não | sim, snapshot final | pódio publicado |
| `archived` | não | só via histórico | 30 dias após `closed` |

**Janela de congelamento — 1 hora.** Entre `ends_at` e a publicação do pódio o ranking fica
read-only, o job tira o `ranking_snapshot` final, grava `season_award` e emite
`season.ended`. A temporada seguinte tem `starts_at = ends_at` da anterior e já está
`active` — atividade durante a apuração não se perde, cai na temporada nova (R9).

### 6.3 O que reseta vs o que persiste

| Item | Reseta? | Onde vive |
|---|---|---|
| Prestígio competitivo | **Sim** — linha nova por temporada | `guild_season_prestige` |
| Posição no ranking | **Sim** | `ranking_snapshot_row` |
| Objetivos semanais e bônus de sequência | **Sim** | ledger da temporada |
| Progresso de conquista sazonal | **Sim** | `guild_achievement_progress` (limpo na virada) |
| Nome, TAG, descrição, emblema | Não | `guild` |
| Membros e cargos | Não | `guild_member` |
| Nível e XP | Não | `guild.level`, `guild.xp` |
| Conquistas permanentes | Não | `guild_achievement` |
| Títulos/medalhas de temporadas anteriores | Não | `season_award` |
| Histórico de eventos | Não | `guild_event` (log imutável) |
| Prestígio das temporadas passadas | Não — fica legível para sempre | `guild_season_prestige` |

Nada é deletado no reset. A temporada nova simplesmente escreve em outra chave.

### 6.4 Premiação

| Posição | Prêmio |
|---|---|
| 🥇 1º | Medalha permanente de campeã + título "Campeã — {nome da temporada}" no perfil |
| 🥈 2º | Medalha permanente de vice |
| 🥉 3º | Medalha permanente de terceiro |

Prêmio é **cosmético e histórico**, nunca vantagem: nada de slot extra de membro,
multiplicador de Prestígio ou XP bônus. Campeã que ganha vantagem vira campeã permanente,
que é exatamente o que a temporada existe para impedir. Arte dos itens: fase 06.

### 6.5 Guilda criada no meio da temporada

Entra na temporada corrente com `prestige = 0` no primeiro evento pontuável (linha criada
sob demanda) e aparece no ranking normalmente. Sem handicap, sem pontos de boas-vindas —
a temporada é curta o bastante para que 45 dias sejam competitivos, e qualquer bônus de
entrada vira exploit de "dissolve e recria".

## 7. Conquistas

Todas detectadas por handler que consome `guild_event`. Nenhuma faz varredura periódica
(exceto o backfill único de retroatividade).

| Nome | Critério computável | Raridade | Escopo | Detectada a partir de | Retroativa? |
|---|---|---|---|---|---|
| **Primeiro Sangue** | Primeira guilda do canal a registrar um `event.win` na temporada. Exatamente 1 por canal por temporada | `epic` | Sazonal (fica no perfil com o selo da temporada) | `event.win` | Não |
| **Exército** | `COUNT(guild_member) >= 20` no momento da entrada | `rare` | Permanente | `member.joined` | **Sim** (contagem atual) |
| **Imortais** | Aparecer em `season_award` (position ≤ 3) em **3 temporadas**, não necessariamente consecutivas | `legendary` | Permanente | `season.ended` | **Sim** (a partir de `season_award`) |
| **Dominadores** | 100 `event.win` acumulados no tempo de vida da guilda (soma entre temporadas) | `legendary` | Permanente | `event.win` | **Sim** (contagem no `guild_event`) |
| **Lendários** | Atingir o nível máximo definido na fase 03 (`MAX_LEVEL`) | `legendary` | Permanente | `guild.level_up` | **Sim** (`guild.level >= MAX_LEVEL`) |

`rarity` (`common | rare | epic | legendary`) é obrigatória: a fase 07 só anuncia
`epic` e `legendary` no chat, e sem a coluna o filtro dela não existe.

**Exército baixou de 30 para 20 membros.** A curva de vagas da fase 03 só chega a 30
lugares por volta do Nv.33 (~8 meses), o que faria "Exército" custar quase o mesmo que
"Lendários" — não era a intenção do brief, onde ela é a conquista de médio prazo.
20 membros cabem no Nv.20 (~3,5 meses).

Notas fechadas:

- **Primeiro Sangue é sazonal** para dar às guildas novas algo alcançável todo trimestre; a
  medalha ganha continua no perfil para sempre, marcada com a temporada em que foi tirada.
- **Imortais conta pódio, não Top 3 corrido**: "3 temporadas em Top 3" já é ~9 meses; exigir
  consecutivas transformaria um tropeço em reset de 9 meses.
- **Exército não é revogável.** Cair para 29 membros não tira a medalha. Conquista registra
  que aconteceu, não o estado atual.
- Conquista permanente é irrevogável e única (`ga_perm_uq`). Reconquistar não gera evento novo.
- **Retroatividade**: uma migração única faz backfill das 4 permanentes com `unlocked_at =
  now()` e `source_event_id = NULL`. Rodada uma vez, nunca reagendada.

## 8. Modelo de dados (delta desta fase)

Requer `CREATE EXTENSION IF NOT EXISTS btree_gist;` (para o EXCLUDE em `season`).

```sql
-- Temporadas -----------------------------------------------------------------
CREATE TABLE season (
  id          bigserial PRIMARY KEY,
  channel_id  bigint      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  number      int         NOT NULL,
  name        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'scheduled',
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  closed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT season_status_ck  CHECK (status IN ('scheduled','active','freezing','closed','archived')),
  CONSTRAINT season_window_ck  CHECK (ends_at > starts_at + interval '7 days'),
  CONSTRAINT season_closed_ck  CHECK ((status IN ('closed','archived')) = (closed_at IS NOT NULL)),
  CONSTRAINT season_number_uq  UNIQUE (channel_id, number),
  CONSTRAINT season_no_overlap EXCLUDE USING gist (
    channel_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
);
-- no máximo uma temporada recebendo pontos por canal
CREATE UNIQUE INDEX season_one_active ON season (channel_id) WHERE status = 'active';

-- Prestígio por temporada ------------------------------------------------------
CREATE TABLE guild_season_prestige (
  season_id     bigint      NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  guild_id      bigint      NOT NULL REFERENCES guild(id)  ON DELETE CASCADE,
  channel_id    bigint      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  prestige      int         NOT NULL DEFAULT 0,
  last_gain_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, guild_id),
  CONSTRAINT gsp_prestige_ck CHECK (prestige >= 0)   -- piso 0, ver R13
);
CREATE INDEX gsp_rank_idx ON guild_season_prestige
  (season_id, prestige DESC, last_gain_at ASC, guild_id ASC);

-- Razão de cada ponto (auditoria + idempotência) --------------------------------
CREATE TABLE prestige_ledger (
  id             bigserial   PRIMARY KEY,
  season_id      bigint      NOT NULL REFERENCES season(id),
  guild_id       bigint      NOT NULL REFERENCES guild(id),
  channel_id     bigint      NOT NULL REFERENCES channel(id),
  guild_event_id bigint      NOT NULL REFERENCES guild_event(id),
  source         text        NOT NULL,   -- 'event.win', 'event.participate', ...
  points         int         NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prestige_ledger_uq     UNIQUE (guild_event_id, source),
  CONSTRAINT prestige_ledger_zero_ck CHECK (points <> 0)
);
CREATE INDEX prestige_ledger_guild_idx ON prestige_ledger (season_id, guild_id, created_at DESC);
```

`prestige_ledger_uq` é a idempotência da fase: `guild_event` já é único por
`(channel_id, type, external_id)`; aqui garantimos que o mesmo evento não vire pontos duas
vezes nem em replay de fila.

```sql
-- Snapshot de ranking ----------------------------------------------------------
CREATE TABLE ranking_snapshot (
  id        bigserial   PRIMARY KEY,
  season_id bigint      NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  taken_at  timestamptz NOT NULL DEFAULT now(),
  is_final  boolean     NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX ranking_snapshot_final_uq ON ranking_snapshot (season_id) WHERE is_final;
CREATE INDEX ranking_snapshot_recent_idx ON ranking_snapshot (season_id, taken_at DESC);

CREATE TABLE ranking_snapshot_row (
  snapshot_id bigint NOT NULL REFERENCES ranking_snapshot(id) ON DELETE CASCADE,
  position    int    NOT NULL,
  guild_id    bigint NOT NULL REFERENCES guild(id),
  prestige    int    NOT NULL,
  PRIMARY KEY (snapshot_id, position),
  CONSTRAINT rsr_guild_uq    UNIQUE (snapshot_id, guild_id),
  CONSTRAINT rsr_position_ck CHECK (position > 0)
);

-- Pódio ------------------------------------------------------------------------
CREATE TABLE season_award (
  season_id      bigint      NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  position       int         NOT NULL,
  guild_id       bigint      NOT NULL REFERENCES guild(id),
  prestige_final int         NOT NULL,
  awarded_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, position),
  CONSTRAINT season_award_guild_uq   UNIQUE (season_id, guild_id),
  CONSTRAINT season_award_position_ck CHECK (position BETWEEN 1 AND 3)
);

-- Conquistas -------------------------------------------------------------------
CREATE TABLE achievement (
  code        text PRIMARY KEY,     -- first_blood | army | immortals | dominators | legendary
  name        text NOT NULL,
  description text NOT NULL,
  scope       text NOT NULL,
  target      int,                  -- meta numérica; NULL = gatilho único
  CONSTRAINT achievement_scope_ck  CHECK (scope IN ('permanent','seasonal')),
  CONSTRAINT achievement_target_ck CHECK (target IS NULL OR target > 0)
);

CREATE TABLE guild_achievement (
  id               bigserial   PRIMARY KEY,
  channel_id       bigint      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  guild_id         bigint      NOT NULL REFERENCES guild(id)   ON DELETE CASCADE,
  achievement_code text        NOT NULL REFERENCES achievement(code),
  season_id        bigint      REFERENCES season(id),  -- NULL nas permanentes
  source_event_id  bigint      REFERENCES guild_event(id),
  unlocked_at      timestamptz NOT NULL DEFAULT now()
);
-- permanente: uma por guilda, para sempre
CREATE UNIQUE INDEX ga_perm_uq   ON guild_achievement (guild_id, achievement_code)
  WHERE season_id IS NULL;
-- sazonal: uma por guilda por temporada
CREATE UNIQUE INDEX ga_season_uq ON guild_achievement (guild_id, achievement_code, season_id)
  WHERE season_id IS NOT NULL;
-- Primeiro Sangue: uma única no canal inteiro por temporada
CREATE UNIQUE INDEX ga_first_blood_uq ON guild_achievement (channel_id, season_id)
  WHERE achievement_code = 'first_blood';

CREATE TABLE guild_achievement_progress (
  guild_id         bigint      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  achievement_code text        NOT NULL REFERENCES achievement(code),
  channel_id       bigint      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  current          int         NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, achievement_code),
  CONSTRAINT gap_current_ck CHECK (current >= 0)
);
```

## 9. API

Base `/api/v1`, JWT da Twitch obrigatório. Rotas `mod/*` exigem `role in (broadcaster, moderator)`;
criar/encerrar temporada e ajustar Prestígio exigem `role = broadcaster`.

| Método | Rota | Quem chama | Request | Response | Erros |
|---|---|---|---|---|---|
| GET | `/seasons/current` | Extensão | — | `{ id, number, name, status, starts_at, ends_at, guild_count }` | `NO_ACTIVE_SEASON` |
| GET | `/seasons` | Extensão | `?cursor=&limit=` | `{ items:[{id,number,name,status,ends_at}], next_cursor }` | `INVALID_CURSOR` |
| GET | `/ranking` | Extensão | `?season_id=&cursor=&limit=` (season_id default = corrente) | `{ snapshot_id, taken_at, items:[{position,guild_id,name,tag,prestige,level,emblem_url}], next_cursor }` | `SEASON_NOT_FOUND`, `INVALID_CURSOR`, `CURSOR_EXPIRED`, `LIMIT_TOO_LARGE` |
| GET | `/guilds/:id/rank` | Extensão | `?season_id=` | `{ season_id, position, prestige, delta_position, live:true }` | `GUILD_NOT_FOUND`, `GUILD_NOT_RANKED`, `SEASON_NOT_FOUND` |
| GET | `/guilds/:id/prestige/ledger` | Extensão (membro) | `?season_id=&cursor=&limit=` | `{ items:[{source,points,created_at}], next_cursor }` | `GUILD_NOT_FOUND`, `FORBIDDEN` |
| GET | `/seasons/:id/podium` | Extensão | — | `{ season, awards:[{position,guild_id,name,tag,prestige_final}] }` | `SEASON_NOT_FOUND`, `SEASON_NOT_CLOSED` |
| GET | `/guilds/:id/achievements` | Extensão | — | `{ unlocked:[{code,name,scope,season_number,unlocked_at}], progress:[{code,current,target}] }` | `GUILD_NOT_FOUND` |
| POST | `/mod/seasons` | Broadcaster | `{ name, starts_at, ends_at }` | `201 { id, number, status }` | `FORBIDDEN`, `SEASON_OVERLAP`, `INVALID_WINDOW`, `SEASON_NAME_REQUIRED` |
| PATCH | `/mod/seasons/:id` | Broadcaster | `{ name?, ends_at? }` | `200 { season }` | `FORBIDDEN`, `SEASON_CLOSED`, `SEASON_OVERLAP`, `INVALID_WINDOW` |
| POST | `/mod/seasons/:id/close` | Broadcaster | `{ reason }` | `202 { status:"freezing" }` | `FORBIDDEN`, `SEASON_NOT_ACTIVE` |
| POST | `/mod/guilds/:id/prestige-adjust` | Broadcaster | `{ points, reason }` | `200 { prestige }` | `FORBIDDEN`, `GUILD_NOT_FOUND`, `NO_ACTIVE_SEASON`, `ADJUST_OUT_OF_RANGE`, `REASON_REQUIRED` |
| POST | `/mod/seasons/:id/recompute` | Broadcaster | — | `202 { job_id }` | `FORBIDDEN`, `SEASON_ARCHIVED` |

- `next_cursor = null` marca fim da lista.
- `GET /ranking` é cacheável (TTL 90 s); `GET /guilds/:id/rank` não é — vem do ZSET.
- `POST /mod/guilds/:id/prestige-adjust` **não** viola "servidor é a autoridade": ele grava
  `guild_event` tipo `prestige.manual_adjust` e passa pelo mesmo handler; o valor não vem do
  viewer, vem do broadcaster autenticado, e cai em `audit_log`.

## 10. Regras de negócio

**Prestígio**

- **R1** — Todo ponto de Prestígio tem exatamente uma linha em `prestige_ledger` referenciando
  um `guild_event`. Ponto sem evento de origem é bug, não recurso.
- **R2** — `guild_season_prestige.prestige` é sempre igual a `SUM(prestige_ledger.points)` da
  mesma `(season_id, guild_id)`. `POST /mod/seasons/:id/recompute` reconstrói do ledger.
- **R3** — Nenhuma fonte monetária gera Prestígio: Bits, subs, gifts e resgates de pontos de
  canal valem **0**. Bits compram criação e cosmético (fase 01/06), nunca posição.
- **R4** — Evento duplicado não vira ponto duplicado: `prestige_ledger_uq (guild_event_id, source)`.
- **R5** — `event.participate` conta no máximo **20 membros distintos por evento**; membros além
  disso são ignorados (não é erro).
- **R6** — Prestígio não é transferível entre guildas em nenhuma hipótese: nem por fusão, nem por
  membro que troca de guilda, nem por recriação.
- **R7** — Evento cujo `created_at` cai fora de `[starts_at, ends_at)` de qualquer temporada
  `active` é registrado em `guild_event` mas não gera ledger (`source_skipped`, sem erro).

**Temporadas**

- **R8** — Um canal não pode ter duas temporadas com janelas sobrepostas
  (`season_no_overlap`) nem duas `active` (`season_one_active`). Tentativa → `SEASON_OVERLAP`.
- **R9** — `ends_at` de uma temporada é `starts_at` da seguinte. Durante a hora de congelamento a
  nova temporada já está `active`: atividade do viewer nunca é descartada, é creditada na nova.
- **R10** — **Fuso horário**: `starts_at` / `ends_at` são `timestamptz` armazenados e comparados
  em **UTC**. O job de encerramento roda em UTC. A extensão renderiza no fuso do navegador; o
  fuso de `channel.settings.timezone` só formata o texto do anúncio (fase 07). Nunca se compara
  data em fuso local.
- **R11** — Empate no pódio é impossível por construção: o desempate de 5.2 gera ordem total
  (`guild.id` como último critério). `season_award` tem `PRIMARY KEY (season_id, position)` e
  sempre recebe 3 linhas — ou menos, se o canal tiver menos de 3 guildas elegíveis.
- **R12** — A apuração é idempotente: rodar de novo sobre a mesma temporada `closed` produz
  exatamente as mesmas linhas de `season_award`.

**Status da guilda**

- **R13** — Guilda **banida** (`status='banned'`) sai do ranking imediatamente: o snapshot só
  inclui `status='active'`. As linhas de `guild_season_prestige` e do ledger são **preservadas**;
  se for desbanida ainda na temporada, volta com o Prestígio intacto e a posição correspondente.
  O mesmo vale para `suspended`.
- **R14** — Guilda **dissolvida** no meio da temporada sai do ranking na hora. O Prestígio dela
  não é redistribuído, não é herdado por guilda sucessora e não é devolvido a membros; fica no
  ledger para auditoria. Dissolver e recriar zera — é a defesa contra lavagem de posição.
- **R15** — Guilda banida ou dissolvida **não** pode receber prêmio de pódio. Se a apuração
  encontrar uma nessa condição, ela é pulada e as posições abaixo sobem.
- **R16** — `prestige-adjust` aceita `points` entre `-5000` e `+5000`, exige `reason` não vazio,
  grava `audit_log` e nunca deixa `prestige` abaixo de 0 (clamp, não erro).

**Conquistas**

- **R17** — Conquista permanente é irrevogável: perder membros, cair de posição ou ser suspensa
  não remove medalha já concedida.
- **R18** — Conquista é concedida no máximo uma vez pelo escopo dela (índices `ga_perm_uq`,
  `ga_season_uq`, `ga_first_blood_uq`). Corrida entre dois handlers resolve no banco, não no app.
- **R19** — "Primeiro Sangue" é atribuída à guilda cujo `event.win` tem o menor `created_at` na
  temporada; empate exato de timestamp resolve pelo menor `guild_event.id`.
- **R20** — Guilda banida não concorre a "Primeiro Sangue" e seu pódio não conta para "Imortais".
- **R21** — Toda concessão emite `guild_event` tipo `achievement.unlocked` com
  `payload.code`, para a fase 07 anunciar no chat sem consultar tabela nova.

## 11. Riscos e decisões em aberto

| # | Assunto | Risco / pergunta | Recomendação |
|---|---|---|---|
| D1 | Origem de `event.win` | Na fase 04 quem declara "evento vencido"? A fonte robusta (guerras) só chega na fase 05. Sem ela, o ranking depende do bot/streamer disparar evento manualmente e pode ficar parado | Entregar a fase 04 com **objetivo semanal automático** (`weekly.objective_completed`) como fonte garantida, e tratar `event.win` como plugável. Sem isso, canal pequeno vê ranking congelado |
| D2 | Decaimento de Prestígio | Sem decay, uma guilda que abre vantagem nas 3 primeiras semanas pode dormir 9 semanas e ganhar | **Não implementar na v1.** Medir a curva da temporada 1 e decidir com dado. Se precisar, `-2%/semana` sobre o total, aplicado por job, é um delta pequeno |
| D3 | Canal com poucas guildas | Pódio de 3 num canal com 4 guildas premia quase todo mundo | Exigir mínimo de **5 guildas ativas** para publicar pódio; abaixo disso, temporada encerra sem `season_award`. Precisa de decisão do cliente |
| D4 | `MAX_LEVEL` | "Lendários" depende do teto de nível da fase 03, que a fase 04 não define | Ler de config compartilhada; nunca hardcodar 50 aqui |
| D5 | Duração configurável por canal | Streamers com público diferente podem querer 60 dias | Manter 90 fixo na v1; a duração já vive em dados, então virar configurável depois é UI, não migração |
| D6 | Bônus de sequência | `+200` por 3 dias distintos em 7 dias é a regra mais complexa da fórmula e a mais fácil de calcular errado | Se atrasar a entrega, cortar. Vale 1,3% do total num ritmo típico |
| D7 | Ranking abaixo do Top 100 | Guilda em 300º paga full scan de snapshot para saber a posição | Snapshot já é materializado com `position`; se virar problema, limitar snapshot a Top 500 e mostrar "500+" abaixo disso |
| D8 | Retroatividade de "Exército" | Backfill concede medalha a guildas que passaram de 30 e caíram antes da fase 04 existir | Aceito: conquista registra que aconteceu (R17). Documentar no changelog do canal |

## 12. Critérios de aceite

**Prestígio**

- [ ] Um `event.win` gera exatamente 1 linha em `prestige_ledger` com `points = 500` e soma em `guild_season_prestige`.
- [ ] Reprocessar o mesmo `guild_event` não altera o total (violação de `prestige_ledger_uq` tratada como no-op).
- [ ] Evento com 35 participantes gera no máximo 200 pontos de `event.participate`.
- [ ] Cheer de Bits e sub gifts não produzem nenhuma linha em `prestige_ledger`.
- [ ] `recompute` sobre uma temporada reproduz o mesmo `prestige` para todas as guildas.
- [ ] `prestige` nunca fica negativo, mesmo com ajuste manual de `-5000` sobre 200 pontos.

**Ranking**

- [ ] Snapshot é gerado a cada 60 s enquanto a temporada está `active`.
- [ ] Duas guildas com o mesmo `prestige` recebem `position` distintas e a ordem é estável entre snapshots.
- [ ] Paginar 3 páginas de 25 não repete nem pula guilda, mesmo com pontos entrando durante a paginação.
- [ ] Cursor de snapshot com mais de 10 minutos retorna `CURSOR_EXPIRED`.
- [ ] `limit=500` retorna `LIMIT_TOO_LARGE`.
- [ ] Banir uma guilda a remove do próximo snapshot sem apagar o Prestígio dela; desbanir a traz de volta com o mesmo valor.
- [ ] `GET /guilds/:id/rank` reflete um ganho de Prestígio em menos de 2 s.

**Temporadas**

- [ ] Criar temporada com janela sobreposta retorna `SEASON_OVERLAP`.
- [ ] Ao atingir `ends_at`, a temporada vai a `freezing`, a seguinte fica `active` e eventos novos pontuam na seguinte.
- [ ] Após a apuração há exatamente 1 `ranking_snapshot` com `is_final = true` e até 3 linhas em `season_award`.
- [ ] Guilda banida durante o congelamento é pulada no pódio e as posições abaixo sobem.
- [ ] Após a virada: `guild.level`, `guild.xp`, `guild_member` e conquistas permanentes intactos; `prestige` da temporada nova em 0.
- [ ] Temporada anterior continua legível em `GET /seasons/:id/podium` e no histórico de Prestígio.
- [ ] Encerramento agendado em UTC dispara no instante correto para um canal em `America/Sao_Paulo`.

**Conquistas**

- [ ] "Primeiro Sangue" é concedida a exatamente uma guilda por canal por temporada; a segunda vitória do canal não gera nada.
- [ ] Entrar o 30º membro concede "Exército"; sair para 29 e voltar a 30 não gera segunda linha.
- [ ] Terceiro pódio concede "Imortais" mesmo com temporadas não consecutivas.
- [ ] Cada conquista concedida emite `guild_event` tipo `achievement.unlocked`.
- [ ] O backfill roda uma vez, é idempotente, e uma segunda execução não cria linhas.
- [ ] `GET /guilds/:id/achievements` retorna desbloqueadas e progresso (`current`/`target`) das pendentes.
