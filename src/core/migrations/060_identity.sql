-- Fase 06 — Identidade Visual e Economia. Só o delta desta fase.
-- channel, guild, guild_member, guild_event e audit_log vêm do 000_core.
--
-- Divergência consciente do doc §9: o catálogo (emblem_catalog_version,
-- emblem_asset) NÃO vira tabela. Ele é dado imutável do módulo
-- (src/modules/identity/catalog.js) e duplicá-lo no banco criaria uma segunda
-- fonte de verdade para a validação. `catalog_version` fica como int simples.
-- Ids do core são BIGSERIAL, não uuid — as FKs abaixo seguem o core.

-- ---------- compras em Bits ----------
CREATE TABLE bits_purchase (
  id              BIGSERIAL   PRIMARY KEY,
  channel_id      BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  guild_id        BIGINT      REFERENCES guild(id) ON DELETE SET NULL,
  user_id         TEXT        NOT NULL,
  sku             TEXT        NOT NULL,            -- 'guild.rename', 'emblem.slot', 'asset.symbol.dragon'
  bits_amount     INT         NOT NULL CHECK (bits_amount >= 0),
  credit_amount   INT         NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  transaction_id  TEXT,                            -- id da Twitch; NULL se 100% crédito
  state           TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending', 'settled', 'failed', 'voided')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at      TIMESTAMPTZ,
  CONSTRAINT paid_something CHECK (bits_amount + credit_amount > 0),
  CONSTRAINT bits_need_tx   CHECK ((bits_amount = 0) OR (transaction_id IS NOT NULL))
);

-- R18: recibo reenviado não cobra de novo.
CREATE UNIQUE INDEX bits_purchase_tx_uq
  ON bits_purchase (channel_id, transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX bits_purchase_guild_ix ON bits_purchase (guild_id, sku, created_at DESC);

-- ---------- entitlements (da guilda, não do usuário — R2) ----------
CREATE TABLE guild_entitlement (
  channel_id  BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  guild_id    BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL CHECK (kind IN ('asset', 'slot')),
  ref         TEXT        NOT NULL,                -- asset_id, ou 'slot:2'..'slot:5'
  source      TEXT        NOT NULL CHECK (source IN ('bits', 'credit', 'grant', 'bundle')),
  purchase_id BIGINT      REFERENCES bits_purchase(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, kind, ref)
);

-- ---------- brasão da guilda ----------
CREATE TABLE guild_emblem (
  id               BIGSERIAL   PRIMARY KEY,
  channel_id       BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  guild_id         BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  slot_index       SMALLINT    NOT NULL CHECK (slot_index BETWEEN 1 AND 5),
  layers           JSONB       NOT NULL,
  -- chave de dedup de render: mesmo brasão, mesmo arquivo PNG (§4).
  layers_hash      TEXT        GENERATED ALWAYS AS (encode(sha256(layers::text::bytea), 'hex')) STORED,
  catalog_version  INT         NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'published'
                     CHECK (status IN ('draft', 'pending_review', 'published', 'reverted')),
  render_url       TEXT,                           -- NULL até o job de render terminar
  is_active        BOOLEAN     NOT NULL DEFAULT false,
  created_by       TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT layers_complete CHECK (
    layers ? 'v' AND layers ? 'shape' AND layers ? 'background' AND layers ? 'palette'
    AND layers ? 'border' AND layers ? 'symbol' AND layers ? 'effect'
  )
);

-- um brasão publicado por slot; exatamente um ativo por guilda (R5, R6).
CREATE UNIQUE INDEX guild_emblem_slot_uq  ON guild_emblem (guild_id, slot_index) WHERE status = 'published';
CREATE UNIQUE INDEX guild_emblem_one_active ON guild_emblem (guild_id) WHERE is_active;
CREATE INDEX guild_emblem_hash_ix ON guild_emblem (layers_hash);
CREATE INDEX guild_emblem_review_ix ON guild_emblem (channel_id, created_at DESC) WHERE status = 'pending_review';

-- ---------- denylist de combinação (§8) ----------
CREATE TABLE emblem_denied_combo (
  id         BIGSERIAL   PRIMARY KEY,
  asset_ids  TEXT[]      NOT NULL,                 -- 2 ou 3 ids, ordenados
  action     TEXT        NOT NULL CHECK (action IN ('review', 'block')),
  reason     TEXT        NOT NULL,
  created_by TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT combo_size CHECK (array_length(asset_ids, 1) BETWEEN 2 AND 3),
  UNIQUE (asset_ids)
);

-- ---------- denúncia de brasão (R9) ----------
CREATE TABLE emblem_report (
  id               BIGSERIAL   PRIMARY KEY,
  channel_id       BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  guild_id         BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  layers_hash      TEXT        NOT NULL,
  reporter_user_id TEXT        NOT NULL,
  reason           TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- um viewer denuncia o mesmo brasão uma vez só.
CREATE UNIQUE INDEX emblem_report_once_uq ON emblem_report (channel_id, layers_hash, reporter_user_id);

-- ---------- crédito de identidade (§8, R14, R20) ----------
CREATE TABLE guild_identity_credit (
  id           BIGSERIAL   PRIMARY KEY,
  channel_id   BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  guild_id     BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  delta_bits   INT         NOT NULL CHECK (delta_bits <> 0),   -- + emissão, − consumo
  reason       TEXT        NOT NULL,                           -- 'rejected:name', 'asset_revoked', 'spend'
  purchase_id  BIGINT      REFERENCES bits_purchase(id),
  expires_at   TIMESTAMPTZ,                                    -- só em emissão: now() + 180d
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credit_expiry CHECK ((delta_bits > 0) = (expires_at IS NOT NULL))
);
CREATE INDEX credit_guild_ix ON guild_identity_credit (guild_id, created_at);

-- ---------- histórico e fila de nome / TAG ----------
CREATE TABLE guild_identity_history (
  id             BIGSERIAL   PRIMARY KEY,
  channel_id     BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  guild_id       BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  field          TEXT        NOT NULL CHECK (field IN ('name', 'tag')),
  old_value      TEXT        NOT NULL,
  new_value      TEXT        NOT NULL,
  purchase_id    BIGINT      REFERENCES bits_purchase(id),
  state          TEXT        NOT NULL DEFAULT 'pending_review'
                   CHECK (state IN ('pending_review', 'approved', 'rejected', 'reverted')),
  requested_by   TEXT        NOT NULL,
  reviewed_by    TEXT,
  reviewed_at    TIMESTAMPTZ,
  reject_reason  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT value_changed CHECK (old_value IS DISTINCT FROM new_value),
  CONSTRAINT reviewed_pair CHECK (state = 'pending_review' OR reviewed_at IS NOT NULL)
);

-- R13: uma troca em análise por campo por guilda.
CREATE UNIQUE INDEX identity_one_pending
  ON guild_identity_history (guild_id, field) WHERE state = 'pending_review';
CREATE INDEX identity_history_guild_ix ON guild_identity_history (guild_id, created_at DESC);
CREATE INDEX identity_queue_ix ON guild_identity_history (channel_id, created_at) WHERE state = 'pending_review';

-- ---------- quarentena do nome antigo (R12) ----------
CREATE TABLE guild_name_reservation (
  channel_id  BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  field       TEXT        NOT NULL CHECK (field IN ('name', 'tag')),
  value_norm  TEXT        NOT NULL,                -- lower(trim(value)); TAG normaliza em lower também
  guild_id    BIGINT      NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (channel_id, field, value_norm)
);
CREATE INDEX reservation_expiry_ix ON guild_name_reservation (expires_at);
