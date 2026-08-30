-- Fase 02 — Membros e Cargos. Só o DELTA sobre 000_core.sql.
-- guild_member já existe no core com channel_id, PK (guild_id,user_id),
-- guild_member_one_per_channel_uk (R1) e guild_member_leader_uk (R19).

-- ---------- guild: modo de entrada, lema, contagem ----------
CREATE TYPE join_mode AS ENUM ('open', 'approval', 'closed');

-- `motto` com IF NOT EXISTS: a fase 01 já o adiciona no 010 (formulário de criação).
-- É a mesma coluna, mesmo tipo; a fase 02 só passa a escrever nela pelo /settings.
ALTER TABLE guild
  ADD COLUMN                join_mode    join_mode   NOT NULL DEFAULT 'approval',
  ADD COLUMN IF NOT EXISTS  motto        varchar(80),
  ADD COLUMN                member_count integer     NOT NULL DEFAULT 0,
  -- Sem teto em member_limit de propósito: a fase 03 (R10) pode baixar o limite
  -- abaixo da lotação atual e ninguém é expulso (R24) — a guilda vai para
  -- overflow e recusa entradas. O limite é aplicado na transação de entrada (R3).
  ADD CONSTRAINT guild_member_count_ck CHECK (member_count >= 0),
  -- necessária para as FKs compostas (guild_id, channel_id) abaixo
  ADD CONSTRAINT guild_id_channel_uk UNIQUE (id, channel_id);

-- ---------- guild_member: trilha de cargo e procedência ----------
ALTER TABLE guild_member
  ADD COLUMN invited_by_user_id text,
  ADD COLUMN role_changed_at    timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN role_changed_by    text,
  ADD CONSTRAINT guild_member_guild_fk
      FOREIGN KEY (guild_id, channel_id) REFERENCES guild (id, channel_id) ON DELETE CASCADE;

CREATE INDEX guild_member_by_guild_ix ON guild_member (guild_id, role);

-- ---------- pedidos de entrada ----------
CREATE TYPE join_request_status AS ENUM
  ('pending', 'approved', 'rejected', 'cancelled', 'expired');

CREATE TABLE guild_join_request (
  id                 bigserial PRIMARY KEY,
  channel_id         bigint      NOT NULL REFERENCES channel (id) ON DELETE CASCADE,
  guild_id           bigint      NOT NULL,
  user_id            text        NOT NULL,
  message            varchar(140),
  status             join_request_status NOT NULL DEFAULT 'pending',
  decided_by_user_id text,
  decided_at         timestamptz,
  expires_at         timestamptz NOT NULL,            -- created_at + 7 dias (R11)
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gjr_guild_fk FOREIGN KEY (guild_id, channel_id)
      REFERENCES guild (id, channel_id) ON DELETE CASCADE,
  CONSTRAINT gjr_decided_ck CHECK (
      (status = 'pending' AND decided_at IS NULL)
   OR (status <> 'pending' AND decided_at IS NOT NULL)),
  CONSTRAINT gjr_expires_ck CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX gjr_one_pending_per_guild_uk
  ON guild_join_request (guild_id, user_id) WHERE status = 'pending';
CREATE INDEX gjr_pending_by_user_ix
  ON guild_join_request (channel_id, user_id) WHERE status = 'pending';
CREATE INDEX gjr_queue_ix
  ON guild_join_request (guild_id, created_at) WHERE status = 'pending';
-- R12: pedido recusado trava novo pedido à mesma guilda por 24 h
CREATE INDEX gjr_decided_by_user_ix
  ON guild_join_request (channel_id, user_id, decided_at DESC);

-- ---------- convites ----------
CREATE TYPE invite_status AS ENUM
  ('pending', 'accepted', 'declined', 'revoked', 'expired');

CREATE TABLE guild_invite (
  id                 bigserial PRIMARY KEY,
  channel_id         bigint      NOT NULL REFERENCES channel (id) ON DELETE CASCADE,
  guild_id           bigint      NOT NULL,
  invitee_user_id    text        NOT NULL,            -- nominal, não link público
  code               varchar(24) NOT NULL,
  created_by_user_id text        NOT NULL,
  status             invite_status NOT NULL DEFAULT 'pending',
  expires_at         timestamptz NOT NULL,            -- created_at + 72 h (R14)
  responded_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gi_guild_fk FOREIGN KEY (guild_id, channel_id)
      REFERENCES guild (id, channel_id) ON DELETE CASCADE,
  CONSTRAINT gi_code_uk UNIQUE (channel_id, code),
  CONSTRAINT gi_no_self_invite_ck CHECK (invitee_user_id <> created_by_user_id),
  CONSTRAINT gi_expires_ck CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX gi_one_pending_per_invitee_uk
  ON guild_invite (guild_id, invitee_user_id) WHERE status = 'pending';
CREATE INDEX gi_inbox_ix
  ON guild_invite (channel_id, invitee_user_id) WHERE status = 'pending';

-- ---------- histórico de saída e cooldown ----------
CREATE TYPE exit_reason AS ENUM ('left', 'kicked', 'disbanded', 'purged');

CREATE TABLE guild_membership_history (
  id             bigserial PRIMARY KEY,
  channel_id     bigint      NOT NULL REFERENCES channel (id) ON DELETE CASCADE,
  guild_id       bigint      NOT NULL,               -- sem FK: sobrevive à dissolução
  user_id        text        NOT NULL,
  role_at_exit   text        NOT NULL,
  reason         exit_reason NOT NULL,
  actor_user_id  text,                               -- NULL em saída voluntária
  joined_at      timestamptz NOT NULL,
  left_at        timestamptz NOT NULL DEFAULT now(),
  cooldown_until timestamptz,                        -- NULL = sem cooldown (R12)
  CONSTRAINT gmh_actor_ck CHECK (reason <> 'kicked' OR actor_user_id IS NOT NULL),
  CONSTRAINT gmh_period_ck CHECK (left_at >= joined_at)
);

CREATE INDEX gmh_cooldown_ix
  ON guild_membership_history (channel_id, user_id, left_at DESC);
