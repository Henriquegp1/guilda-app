-- Fase 07 — Integração com o Chat (docs/fase-07-integracao.md §8).
-- Delta da 07. Ids são BIGINT porque é o que o 000_core usa (o DDL da spec
-- escreve uuid; o core manda).

CREATE TYPE announce_status AS ENUM
  ('queued','sending','sent','failed','expired','suppressed','aggregated','superseded');

CREATE TABLE announce_config (
  channel_id  BIGINT      PRIMARY KEY REFERENCES channel(id) ON DELETE CASCADE,
  enabled     BOOLEAN     NOT NULL DEFAULT false,
  webhook_url TEXT,
  hourly_cap  SMALLINT    NOT NULL DEFAULT 12,
  quiet_from  TIME,
  quiet_to    TIME,
  timezone    TEXT        NOT NULL DEFAULT 'America/Sao_Paulo',
  muted_until TIMESTAMPTZ,
  offline     BOOLEAN     NOT NULL DEFAULT false,  -- §6: sinal vem do bot (D3)
  fail_streak SMALLINT    NOT NULL DEFAULT 0,
  -- R2: corte do backlog. updated_at muda a cada edição de config e serviria de
  -- corte errado, então a ativação tem carimbo próprio.
  enabled_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cap_range  CHECK (hourly_cap BETWEEN 4 AND 20),
  CONSTRAINT quiet_pair CHECK ((quiet_from IS NULL) = (quiet_to IS NULL)),
  CONSTRAINT https_only CHECK (webhook_url IS NULL OR webhook_url ~ '^https://'),
  CONSTRAINT need_url   CHECK (NOT enabled OR webhook_url IS NOT NULL)
);

CREATE TABLE announce_event_config (
  channel_id   BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  event_type   TEXT        NOT NULL,
  enabled      BOOLEAN     NOT NULL DEFAULT false,
  template     TEXT,
  template_agg TEXT,
  cooldown_s   INTEGER     NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, event_type),
  CONSTRAINT tpl_len     CHECK (template     IS NULL OR char_length(template)     <= 300),
  CONSTRAINT tpl_agg_len CHECK (template_agg IS NULL OR char_length(template_agg) <= 300),
  CONSTRAINT cd_range    CHECK (cooldown_s BETWEEN 30 AND 86400)
);

CREATE TABLE announce_secret (
  id         BIGSERIAL   PRIMARY KEY,
  channel_id BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  secret_enc BYTEA       NOT NULL,        -- AES-256-GCM com ANNOUNCE_ENC_KEY
  status     TEXT        NOT NULL CHECK (status IN ('active','retiring','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retires_at TIMESTAMPTZ                  -- fim da janela de dupla assinatura (24 h)
);

CREATE UNIQUE INDEX announce_secret_one_active
  ON announce_secret (channel_id) WHERE status = 'active';
CREATE INDEX announce_secret_live_ix
  ON announce_secret (channel_id, created_at DESC);

CREATE TABLE announce_outbox (
  id              TEXT            PRIMARY KEY,       -- ULID; chave de dedup do bot (R7)
  channel_id      BIGINT          NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  guild_event_id  BIGINT          REFERENCES guild_event(id) ON DELETE SET NULL,
  guild_id        BIGINT          REFERENCES guild(id) ON DELETE SET NULL,
  event_type      TEXT            NOT NULL,
  priority        TEXT            NOT NULL CHECK (priority IN ('alta','media','baixa')),
  dedup_key       TEXT            NOT NULL,
  status          announce_status NOT NULL DEFAULT 'queued',
  suppress_reason TEXT,
  aggregate_count SMALLINT        NOT NULL DEFAULT 1,
  -- Membro de janela de agregação em aberto. NULL = item comum, pronto para
  -- despacho individual. Agrupa os membros da mesma janela sem coluna extra de
  -- chave: (channel_id, event_type, agg_window) já é a janela.
  agg_window      TIMESTAMPTZ,
  message         TEXT,
  payload         JSONB           NOT NULL,
  attempts        SMALLINT        NOT NULL DEFAULT 0,
  not_before      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ     NOT NULL,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  CONSTRAINT msg_len   CHECK (message IS NULL OR char_length(message) <= 400),
  CONSTRAINT sent_time CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT why_supp  CHECK (status <> 'suppressed' OR suppress_reason IS NOT NULL)
);

-- R5/R14: o mesmo guild_event nunca gera dois anúncios, nem após replay da fila.
CREATE UNIQUE INDEX announce_outbox_dedup
  ON announce_outbox (channel_id, dedup_key);
CREATE INDEX announce_outbox_due
  ON announce_outbox (channel_id, not_before) WHERE status = 'queued';
CREATE INDEX announce_outbox_rate
  ON announce_outbox (channel_id, sent_at DESC) WHERE status = 'sent';
CREATE INDEX announce_outbox_agg
  ON announce_outbox (channel_id, event_type, agg_window) WHERE agg_window IS NOT NULL;
CREATE INDEX announce_outbox_log
  ON announce_outbox (channel_id, created_at DESC);

CREATE TABLE announce_delivery_log (
  id          BIGSERIAL   PRIMARY KEY,
  outbox_id   TEXT        NOT NULL REFERENCES announce_outbox(id) ON DELETE CASCADE,
  attempt     SMALLINT    NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  http_status SMALLINT,
  latency_ms  INTEGER,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, attempt)
);

-- R6: estado terminal nunca volta. Constraint em vez de disciplina no handler.
CREATE FUNCTION announce_outbox_no_regress () RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('sent','failed','expired','suppressed','aggregated','superseded')
     AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'announce_outbox %: % é terminal, não vira %',
      OLD.id, OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER announce_outbox_no_regress_t
  BEFORE UPDATE ON announce_outbox
  FOR EACH ROW EXECUTE FUNCTION announce_outbox_no_regress();
