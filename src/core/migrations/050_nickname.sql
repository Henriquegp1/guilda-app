-- Fase 05 - Perfil e Apelido de Personagem do Viewer com Moderação

CREATE TABLE IF NOT EXISTS user_profile (
  channel_id  BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL,
  nickname    VARCHAR(24) NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending_review',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- Adiciona a coluna status caso a tabela já tenha sido criada antes
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_review';

-- Regra de formato (2 a 20 caracteres)
ALTER TABLE user_profile
  DROP CONSTRAINT IF EXISTS nickname_fmt_chk;

ALTER TABLE user_profile
  ADD CONSTRAINT nickname_fmt_chk CHECK (nickname ~ '^[A-Za-z0-9_ ]{2,20}$');
