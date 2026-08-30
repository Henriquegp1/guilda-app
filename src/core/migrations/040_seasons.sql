-- Fase 04 — Competição. Delta sobre 000_core.sql (§8 do doc da fase).
--
-- Nada aqui altera tabela de outra fase: guild.prestige já existe no core e
-- continua sendo só o espelho de leitura da temporada corrente (fase 07 lê ele).
-- A verdade competitiva mora em guild_season_prestige + prestige_ledger.

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- o EXCLUDE de season precisa de `=` em bigint

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
-- R8: no máximo uma temporada recebendo pontos por canal.
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
  CONSTRAINT gsp_prestige_ck CHECK (prestige >= 0)   -- piso 0, ver R13/R16
);
CREATE INDEX gsp_rank_idx ON guild_season_prestige
  (season_id, prestige DESC, last_gain_at ASC, guild_id ASC);

-- Razão de cada ponto (auditoria + idempotência) --------------------------------
CREATE TABLE prestige_ledger (
  id             bigserial   PRIMARY KEY,
  -- CASCADE em tudo: o §8 escreveu as FKs sem ON DELETE, o que travaria a remoção
  -- de um canal inteiro. O ledger é auditoria do tenant, não sobrevive a ele.
  season_id      bigint      NOT NULL REFERENCES season(id)      ON DELETE CASCADE,
  guild_id       bigint      NOT NULL REFERENCES guild(id)       ON DELETE CASCADE,
  channel_id     bigint      NOT NULL REFERENCES channel(id)     ON DELETE CASCADE,
  guild_event_id bigint      NOT NULL REFERENCES guild_event(id) ON DELETE CASCADE,
  source         text        NOT NULL,   -- = guild_event.type, ou 'streak'
  points         int         NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- R4: o mesmo evento não vira ponto duas vezes nem em replay de fila.
  CONSTRAINT prestige_ledger_uq      UNIQUE (guild_event_id, source),
  CONSTRAINT prestige_ledger_zero_ck CHECK (points <> 0)
);
CREATE INDEX prestige_ledger_guild_idx ON prestige_ledger (season_id, guild_id, created_at DESC);

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
  guild_id    bigint NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  prestige    int    NOT NULL,
  PRIMARY KEY (snapshot_id, position),
  CONSTRAINT rsr_guild_uq    UNIQUE (snapshot_id, guild_id),
  CONSTRAINT rsr_position_ck CHECK (position > 0)
);

-- Pódio ------------------------------------------------------------------------
CREATE TABLE season_award (
  season_id      bigint      NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  position       int         NOT NULL,
  guild_id       bigint      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  prestige_final int         NOT NULL,
  awarded_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, position),
  CONSTRAINT season_award_guild_uq    UNIQUE (season_id, guild_id),
  CONSTRAINT season_award_position_ck CHECK (position BETWEEN 1 AND 3)
);

-- Conquistas -------------------------------------------------------------------
-- `rarity` não está na DDL do §8 mas é obrigatória pelo §7 (a fase 07 só anuncia
-- epic e legendary). Sem a coluna o filtro dela não existe.
CREATE TABLE achievement (
  code        text PRIMARY KEY,     -- first_blood | army | immortals | dominators | legendary
  name        text NOT NULL,
  description text NOT NULL,
  rarity      text NOT NULL,
  scope       text NOT NULL,
  target      int,                  -- meta numérica; NULL = gatilho único
  CONSTRAINT achievement_rarity_ck CHECK (rarity IN ('common','rare','epic','legendary')),
  CONSTRAINT achievement_scope_ck  CHECK (scope IN ('permanent','seasonal')),
  CONSTRAINT achievement_target_ck CHECK (target IS NULL OR target > 0)
);

-- Espelho do catálogo de src/modules/seasons/achievements.js (o teste compara os dois).
-- O 50 de `legendary` é MAX_LEVEL da fase 03 congelado em dado; mudar o teto lá
-- quebra o teste de paridade, que é exatamente o aviso que se quer (D4).
INSERT INTO achievement (code, name, description, rarity, scope, target) VALUES
  ('first_blood', 'Primeiro Sangue', 'Primeira guilda do canal a vencer um evento na temporada', 'epic', 'seasonal', NULL),
  ('army', 'Exercito', 'Chegar a 20 membros', 'rare', 'permanent', 20),
  ('immortals', 'Imortais', 'Subir ao podio em 3 temporadas, nao necessariamente consecutivas', 'legendary', 'permanent', 3),
  ('dominators', 'Dominadores', 'Somar 100 vitorias de evento no tempo de vida da guilda', 'legendary', 'permanent', 100),
  ('legendary', 'Lendarios', 'Atingir o nivel maximo da progressao', 'legendary', 'permanent', 50)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE guild_achievement (
  id               bigserial   PRIMARY KEY,
  channel_id       bigint      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  guild_id         bigint      NOT NULL REFERENCES guild(id)   ON DELETE CASCADE,
  achievement_code text        NOT NULL REFERENCES achievement(code),
  season_id        bigint      REFERENCES season(id),  -- NULL nas permanentes
  source_event_id  bigint      REFERENCES guild_event(id) ON DELETE SET NULL,
  unlocked_at      timestamptz NOT NULL DEFAULT now()
);
-- R18 — a corrida entre dois handlers resolve aqui, não no app.
CREATE UNIQUE INDEX ga_perm_uq   ON guild_achievement (guild_id, achievement_code)
  WHERE season_id IS NULL;
CREATE UNIQUE INDEX ga_season_uq ON guild_achievement (guild_id, achievement_code, season_id)
  WHERE season_id IS NOT NULL;
-- Primeiro Sangue: uma única no canal inteiro por temporada.
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
