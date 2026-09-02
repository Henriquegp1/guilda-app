-- Modelo base de docs/ARQUITETURA.md. Cada fase adiciona o seu delta em 0X0_*.sql.
-- Nenhum módulo altera este arquivo.

CREATE TABLE channel (
  id                 BIGSERIAL PRIMARY KEY,
  twitch_channel_id  TEXT        NOT NULL UNIQUE,
  settings           JSONB       NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE channel_token (
  token       TEXT        PRIMARY KEY,
  channel_id  BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

CREATE TYPE guild_status AS ENUM
  ('awaiting', 'pending', 'active', 'overflow', 'suspended', 'banned', 'purged');

CREATE TYPE guild_role AS ENUM
  ('leader', 'officer', 'veteran', 'member', 'recruit');

CREATE TABLE guild (
  id              BIGSERIAL    PRIMARY KEY,
  channel_id      BIGINT       NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  name            TEXT         NOT NULL,
  tag             TEXT,          -- NULL só em rascunho awaiting (fase 01)
  description     TEXT,
  status          guild_status NOT NULL DEFAULT 'awaiting',
  leader_user_id  TEXT,
  level           INT          NOT NULL DEFAULT 1,
  xp              BIGINT       NOT NULL DEFAULT 0,
  prestige        INT          NOT NULL DEFAULT 0,
  member_limit    INT          NOT NULL DEFAULT 2,    -- derivado do nível (fase 03, R10)
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Unicidade viva de nome e TAG por canal, case-insensitive.
-- 'awaiting' entra: rascunho reserva o nome por 15 min (fase 01, R7).
-- 'purged' fica de fora: quarentena é controlada pela fase 01, não pelo índice.
CREATE UNIQUE INDEX guild_name_uk ON guild (channel_id, lower(name))
  WHERE status <> 'purged';
CREATE UNIQUE INDEX guild_tag_uk  ON guild (channel_id, upper(tag))
  WHERE status <> 'purged';

CREATE TABLE guild_member (
  guild_id    BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL,
  channel_id  BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  role        guild_role  NOT NULL DEFAULT 'recruit',
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);

-- Um viewer, uma guilda por canal (fase 02, R1).
CREATE UNIQUE INDEX guild_member_one_per_channel_uk
  ON guild_member (channel_id, user_id);

-- Nunca 0 nem 2 líderes (fase 02, R21).
CREATE UNIQUE INDEX guild_member_leader_uk
  ON guild_member (guild_id) WHERE role = 'leader';

CREATE TABLE guild_event (
  id             BIGSERIAL   PRIMARY KEY,
  channel_id     BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  guild_id       BIGINT      REFERENCES guild(id) ON DELETE SET NULL,  -- NULL = viewer sem guilda
  type           TEXT        NOT NULL,
  payload        JSONB       NOT NULL DEFAULT '{}',
  actor_user_id  TEXT,
  external_id    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotência de webhook da Twitch. Parcial: eventos internos têm external_id NULL
-- e não competem entre si.
CREATE UNIQUE INDEX guild_event_ext_uk
  ON guild_event (channel_id, type, external_id) WHERE external_id IS NOT NULL;

CREATE INDEX guild_event_guild_ix   ON guild_event (guild_id, created_at DESC);
CREATE INDEX guild_event_channel_ix ON guild_event (channel_id, type, created_at DESC);

CREATE TABLE audit_log (
  id             BIGSERIAL   PRIMARY KEY,
  channel_id     BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  actor_user_id  TEXT        NOT NULL,
  action         TEXT        NOT NULL,
  target         TEXT        NOT NULL,
  before         JSONB,
  after          JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_channel_ix ON audit_log (channel_id, created_at DESC);
