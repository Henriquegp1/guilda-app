-- Fase 05 — Guerras e Territórios. Delta sobre 000_core.sql e 040_seasons.sql
-- (§9 do doc da fase). Não altera guild, guild_member nem guild_event: esta fase
-- só LÊ guild_event e escreve nas tabelas abaixo.
--
-- Ordem de criação diferente do doc porque as FKs mandam: territory antes de war
-- (stake), territory_dispute antes de territory_holding (source_dispute_id).

CREATE TYPE war_format AS ENUM ('skirmish','campaign','special');
CREATE TYPE war_status AS ENUM ('pending','accepted','declined','expired',
                                'active','ended','settled','no_contest','cancelled');

-- Territórios ----------------------------------------------------------------
CREATE TABLE territory (
  id               BIGSERIAL   PRIMARY KEY,
  channel_id       BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
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

CREATE TABLE territory_dispute (
  id              BIGSERIAL   PRIMARY KEY,
  channel_id      BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  territory_id    BIGINT      NOT NULL REFERENCES territory(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','closed','void')),
  opened_by       TEXT        NOT NULL,
  opens_at        TIMESTAMPTZ NOT NULL,
  closes_at       TIMESTAMPTZ NOT NULL,
  min_points      INT         NOT NULL DEFAULT 300 CHECK (min_points > 0),
  season_id       BIGINT      REFERENCES season(id) ON DELETE SET NULL,
  winner_guild_id BIGINT      REFERENCES guild(id)  ON DELETE SET NULL,
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dispute_window CHECK (closes_at > opens_at)
);
-- R24: uma disputa aberta por território, garantida pelo índice.
CREATE UNIQUE INDEX dispute_one_open ON territory_dispute (territory_id)
  WHERE status = 'open';

-- Guerra ---------------------------------------------------------------------
CREATE TABLE war (
  id                   BIGSERIAL   PRIMARY KEY,
  channel_id           BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  format               war_format  NOT NULL,
  status               war_status  NOT NULL DEFAULT 'pending',
  challenger_guild_id  BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  defender_guild_id    BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  stake_territory_id   BIGINT      REFERENCES territory(id) ON DELETE SET NULL,
  roster_size          SMALLINT    NOT NULL CHECK (roster_size BETWEEN 3 AND 25),
  min_points           INT         NOT NULL CHECK (min_points > 0),
  declared_by          TEXT        NOT NULL,
  responded_by         TEXT,
  challenge_expires_at TIMESTAMPTZ NOT NULL,
  starts_at            TIMESTAMPTZ,
  ends_at              TIMESTAMPTZ,
  ended_at             TIMESTAMPTZ,
  settled_at           TIMESTAMPTZ,
  -- instante em que a guerra deixou (pending, accepted, active): base do cooldown
  -- de par (R6). O doc derivava de 4 colunas diferentes; uma coluna é mais barato.
  closed_at            TIMESTAMPTZ,
  season_id            BIGINT      REFERENCES season(id) ON DELETE SET NULL,
  score_challenger     INT         NOT NULL DEFAULT 0 CHECK (score_challenger >= 0),
  score_defender       INT         NOT NULL DEFAULT 0 CHECK (score_defender   >= 0),
  -- monotônico por guerra: o cliente descarta mensagem PubSub com seq menor (§7).
  score_seq            INT         NOT NULL DEFAULT 0,
  score_updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  winner_guild_id      BIGINT      REFERENCES guild(id) ON DELETE SET NULL,
  prestige_multiplier  NUMERIC(3,2) NOT NULL DEFAULT 1.00
                         CHECK (prestige_multiplier BETWEEN 0 AND 1),
  prestige_awarded     JSONB,
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
CREATE INDEX war_challenger_idx     ON war (challenger_guild_id, status);
CREATE INDEX war_defender_idx       ON war (defender_guild_id, status);

-- R1: no máximo UMA guerra (ou disputa, R24) aberta por guilda, em qualquer papel.
-- A PK é a trava; nenhuma checagem de aplicação substitui isto.
CREATE TABLE war_slot (
  channel_id BIGINT NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  guild_id   BIGINT NOT NULL REFERENCES guild(id)   ON DELETE CASCADE,
  war_id     BIGINT REFERENCES war(id) ON DELETE CASCADE,
  dispute_id BIGINT REFERENCES territory_dispute(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, guild_id),
  CONSTRAINT war_slot_one_source CHECK (num_nonnulls(war_id, dispute_id) = 1)
);

CREATE TABLE war_roster (
  war_id    BIGINT      NOT NULL REFERENCES war(id) ON DELETE CASCADE,
  guild_id  BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  user_id   TEXT        NOT NULL,
  added_by  TEXT        NOT NULL,
  locked_at TIMESTAMPTZ,
  PRIMARY KEY (war_id, user_id)
);
CREATE INDEX war_roster_side_idx ON war_roster (war_id, guild_id);

CREATE TABLE war_point (
  id         BIGSERIAL   PRIMARY KEY,
  war_id     BIGINT      NOT NULL REFERENCES war(id) ON DELETE CASCADE,
  guild_id   BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL,
  event_id   BIGINT      NOT NULL REFERENCES guild_event(id) ON DELETE CASCADE,
  event_type TEXT        NOT NULL,
  points     SMALLINT    NOT NULL CHECK (points > 0),
  -- = guild_event.created_at, não o instante do processamento: o teto diário do
  -- R9 é do dia do EVENTO, senão um replay atrasado mudaria o resultado.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT war_point_once UNIQUE (war_id, event_id)
);
CREATE INDEX war_point_tally_idx ON war_point (war_id, guild_id);
CREATE INDEX war_point_cap_idx   ON war_point (war_id, user_id, created_at);

-- Posse -----------------------------------------------------------------------
CREATE TABLE territory_holding (
  id                BIGSERIAL   PRIMARY KEY,
  territory_id      BIGINT      NOT NULL REFERENCES territory(id) ON DELETE CASCADE,
  guild_id          BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  channel_id        BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  acquired_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  acquired_via      TEXT        NOT NULL CHECK (acquired_via IN ('war','dispute','admin')),
  source_war_id     BIGINT      REFERENCES war(id) ON DELETE SET NULL,
  source_dispute_id BIGINT      REFERENCES territory_dispute(id) ON DELETE SET NULL,
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

CREATE TABLE territory_dispute_entry (
  dispute_id BIGINT      NOT NULL REFERENCES territory_dispute(id) ON DELETE CASCADE,
  guild_id   BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  points     INT         NOT NULL DEFAULT 0 CHECK (points >= 0),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dispute_id, guild_id)
);
