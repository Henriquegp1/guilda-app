-- O brasao em camadas e armazenado como JSON completo, nao como preset curto.
ALTER TABLE guild
  ALTER COLUMN emblem_preset TYPE TEXT;
