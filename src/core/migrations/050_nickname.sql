-- Fase 05 - Perfil e Apelido de Personagem do Viewer
-- Permite que os membros definam um nome de RPG para ser exibido nas listas do clã.

CREATE TABLE IF NOT EXISTS user_profile (
  channel_id  BIGINT      NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL,
  nickname    VARCHAR(24) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- Regra de formato (2 a 20 caracteres)
ALTER TABLE user_profile
  DROP CONSTRAINT IF EXISTS nickname_fmt_chk;

ALTER TABLE user_profile
  ADD CONSTRAINT nickname_fmt_chk CHECK (nickname ~ '^[A-Za-z0-9_ ]{2,20}$');
