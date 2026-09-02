-- Fase 03 — Progressão. Delta sobre 000_core.sql.
--
-- A §7.1 do doc pedia actor_user_id, external_id, guild_id nullable e a UNIQUE
-- parcial em guild_event: o core já entrega os quatro. Nada a alterar lá.

-- Ledger imutável. Uma linha por guild_event processado — inclusive os que valem
-- 0 (sem guilda, em quarentena, guilda inativa): o evento fica auditável.
CREATE TABLE guild_xp_entry (
  id                bigserial   PRIMARY KEY,
  channel_id        bigint      NOT NULL REFERENCES channel (id) ON DELETE CASCADE,
  guild_id          bigint      REFERENCES guild (id) ON DELETE SET NULL,  -- NULL = sem guilda no instante
  user_id           text,                                    -- NULL = crédito da guilda inteira
  event_id          bigint      NOT NULL REFERENCES guild_event (id) ON DELETE CASCADE,
  amount            integer     NOT NULL,                    -- 0 (capado) ou negativo (estorno) são válidos
  reason            text        NOT NULL,                    -- = guild_event.type, ou 'xp_reversal'
  capped            boolean     NOT NULL DEFAULT false,
  -- Qual lançamento este estorna (R12). NULL em lançamento normal. O doc não previa
  -- a coluna; sem ela não dá para saber se um sub já foi estornado.
  reverses_entry_id bigint      REFERENCES guild_xp_entry (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- R1/R3: reprocessar o mesmo evento nunca credita duas vezes.
  CONSTRAINT xp_entry_event_uk UNIQUE (event_id),
  -- O doc §7.2 dizia ±1000, mas R13 permite ajuste de moderação de ±5.000 —
  -- a faixa segue a regra, que é o número que o produto prometeu.
  CONSTRAINT xp_entry_range CHECK (amount BETWEEN -5000 AND 5000)
);

CREATE INDEX xp_entry_guild_ix ON guild_xp_entry (guild_id, created_at DESC);
CREATE INDEX xp_entry_daily_ix ON guild_xp_entry (channel_id, user_id, created_at DESC);
-- Um lançamento é estornado no máximo uma vez.
CREATE UNIQUE INDEX xp_entry_reversal_uk ON guild_xp_entry (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

-- Teto diário por CANAL + USUÁRIO (§4.1). Não por guilda: é o que mata o guild-hop.
CREATE TABLE member_xp_daily (
  channel_id  bigint   NOT NULL REFERENCES channel (id) ON DELETE CASCADE,
  user_id     text     NOT NULL,
  day         date     NOT NULL,                             -- UTC
  xp_granted  integer  NOT NULL DEFAULT 0,
  watch_ticks smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id, day),
  CONSTRAINT daily_cap   CHECK (xp_granted BETWEEN 0 AND 200),
  CONSTRAINT daily_ticks CHECK (watch_ticks BETWEEN 0 AND 18)
);

-- Contribuição histórica dentro da guilda. Vaidade e leitura, não saldo transferível.
CREATE TABLE guild_member_xp (
  guild_id   bigint      NOT NULL REFERENCES guild (id) ON DELETE CASCADE,
  user_id    text        NOT NULL,
  channel_id bigint      NOT NULL REFERENCES channel (id) ON DELETE CASCADE,
  xp_total   bigint      NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id),
  CONSTRAINT member_xp_nonneg CHECK (xp_total >= 0)
);

CREATE INDEX guild_member_xp_rank_ix ON guild_member_xp (guild_id, xp_total DESC);

-- Snapshot diário imutável (R17): auditoria, gráfico e rollback de recálculo errado.
CREATE TABLE guild_level_snapshot (
  channel_id   bigint   NOT NULL REFERENCES channel (id) ON DELETE CASCADE,
  guild_id     bigint   NOT NULL REFERENCES guild (id) ON DELETE CASCADE,
  day          date     NOT NULL,
  xp_total     bigint   NOT NULL,
  level        smallint NOT NULL,
  member_count smallint NOT NULL,
  member_limit smallint NOT NULL,
  PRIMARY KEY (guild_id, day),
  CONSTRAINT snap_level CHECK (level BETWEEN 1 AND 50)
);

-- Quarentena anti-abuso (§4.3). Sem linha = conta limpa. Nada aqui bane ninguém:
-- só zera o XP e deixa o caso para humano.
CREATE TABLE xp_quarantine (
  channel_id bigint      NOT NULL REFERENCES channel (id) ON DELETE CASCADE,
  user_id    text        NOT NULL,
  reason     text        NOT NULL,   -- new_account | no_interaction | ip_cluster | viewer_mismatch
  until      timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- Cosmético desbloqueado, append-only: queda de nível nunca retira (R11).
CREATE TABLE guild_unlock (
  guild_id     bigint      NOT NULL REFERENCES guild (id) ON DELETE CASCADE,
  unlock_key   text        NOT NULL,
  level_earned smallint    NOT NULL,
  unlocked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, unlock_key),
  CONSTRAINT unlock_level CHECK (level_earned BETWEEN 1 AND 50)
);

-- Agregados derivados na tabela base. member_limit sem piso de propósito: a fase 02
-- cria guildas com limite menor que 10 em fixture, e R10 nunca escreve abaixo disso.
ALTER TABLE guild
  ADD CONSTRAINT guild_level_range CHECK (level BETWEEN 1 AND 50),
  ADD CONSTRAINT guild_xp_nonneg   CHECK (xp >= 0),
  ADD CONSTRAINT guild_limit_max   CHECK (member_limit <= 15);
