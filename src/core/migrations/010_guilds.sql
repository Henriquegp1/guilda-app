-- Fase 01 — Fundação. Delta sobre 000_core.sql: campos do formulário de criação,
-- ciclo de pagamento em Bits e ciclo de revisão da moderação.
--
-- Não repete o que o core já tem: guild_name_uk / guild_tag_uk (unicidade por canal),
-- a FK de guild_member, member_limit DEFAULT 10 e audit_log_channel_ix.

ALTER TABLE guild
  ADD COLUMN creator_user_id     TEXT        NOT NULL,
  ADD COLUMN motto               VARCHAR(80),
  ADD COLUMN color_primary       CHAR(7)     NOT NULL DEFAULT '#9146FF',
  ADD COLUMN color_secondary     CHAR(7)     NOT NULL DEFAULT '#EFEFF1',
  ADD COLUMN emblem_preset       VARCHAR(32),         -- catálogo fixo; fase 06 substitui
  ADD COLUMN payment_status      TEXT        NOT NULL DEFAULT 'awaiting',
  ADD COLUMN bits_amount         INTEGER,
  ADD COLUMN bits_transaction_id TEXT,
  ADD COLUMN reserved_until      TIMESTAMPTZ,         -- só enquanto awaiting
  ADD COLUMN reviewed_by_user_id TEXT,
  ADD COLUMN reviewed_at         TIMESTAMPTZ,
  ADD COLUMN reject_reason       VARCHAR(280);

-- `!criarguilda <Nome>` cria rascunho só com nome; a TAG chega no painel (fase 01, §3.1).
-- Por isso a TAG é opcional enquanto o rascunho não foi pago, e obrigatória depois.
-- (tag já nasce opcional no 000_core)

ALTER TABLE guild
  ADD CONSTRAINT guild_payment_status_chk
    CHECK (payment_status IN ('awaiting', 'paid', 'refunded')),
  ADD CONSTRAINT guild_name_fmt_chk
    CHECK (name ~ '^[A-Za-z0-9]([A-Za-z0-9 ]{1,22}[A-Za-z0-9])$'),
  ADD CONSTRAINT guild_tag_fmt_chk
    CHECK (tag ~ '^[A-Z0-9]{2,5}$'),
  ADD CONSTRAINT guild_tag_required_chk
    CHECK (tag IS NOT NULL OR status = 'awaiting'),
  ADD CONSTRAINT guild_desc_len_chk
    CHECK (description IS NULL OR char_length(description) <= 280),
  ADD CONSTRAINT guild_color_fmt_chk
    CHECK (color_primary ~ '^#[0-9A-F]{6}$' AND color_secondary ~ '^#[0-9A-F]{6}$'),
  -- pago obriga transação; não-pago proíbe. Estornada (R11) mantém a transação.
  ADD CONSTRAINT guild_paid_has_tx_chk
    CHECK ((payment_status = 'awaiting') = (bits_transaction_id IS NULL)),
  ADD CONSTRAINT guild_reservation_chk
    CHECK ((payment_status = 'awaiting') = (reserved_until IS NOT NULL));

-- Uma transação de Bits nunca cria duas guildas (R9).
CREATE UNIQUE INDEX guild_bits_tx_uk ON guild (bits_transaction_id)
  WHERE bits_transaction_id IS NOT NULL;

-- Um viewer lidera no máximo uma guilda viva por canal (R5). Banida sai do índice
-- para não travar o viewer para sempre; o nome dela continua bloqueado pelo core.
CREATE UNIQUE INDEX guild_one_per_leader_uk ON guild (channel_id, leader_user_id)
  WHERE status <> 'banned';

CREATE INDEX guild_mod_queue_ix ON guild (channel_id, created_at)
  WHERE status = 'pending' AND payment_status = 'paid';
CREATE INDEX guild_reaper_ix ON guild (reserved_until)
  WHERE payment_status = 'awaiting';

-- Histórico de uma guilda no painel de moderação.
CREATE INDEX audit_log_target_ix ON audit_log (target, created_at DESC);
