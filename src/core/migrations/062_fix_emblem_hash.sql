-- Fase 06 - Correção da função de hash para o brasão
-- Algumas versões de Postgres não possuem sha256() built-in.
-- Mudamos para md5() que é universal e suficiente para cache de render.

ALTER TABLE guild_emblem
  DROP COLUMN IF EXISTS layers_hash;

ALTER TABLE guild_emblem
  ADD COLUMN layers_hash TEXT GENERATED ALWAYS AS (md5(layers::text)) STORED;

CREATE INDEX IF NOT EXISTS guild_emblem_hash_ix ON guild_emblem (layers_hash);
