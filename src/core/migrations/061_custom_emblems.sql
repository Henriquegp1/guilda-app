-- Fase 06.2 — Suporte a Brasões Customizados (PNG/JPG)
-- Snapshot de Identidade: armazenamento autoritativo do EBS.

ALTER TABLE guild_emblem
  ADD COLUMN custom_source_url   TEXT,
  ADD COLUMN custom_asset_hash   TEXT,
  ADD COLUMN custom_local_path   TEXT;

-- Regra de integridade: ou tem camadas (catálogo) ou tem imagem customizada.
-- 'v' é o campo de versão das camadas; se não existe, deve ser custom.
ALTER TABLE guild_emblem
  DROP CONSTRAINT layers_complete,
  ADD CONSTRAINT emblem_content_ck CHECK (
    (layers ? 'v' AND custom_local_path IS NULL) OR
    (NOT (layers ? 'v') AND custom_local_path IS NOT NULL)
  );

-- Histórico de identidade agora suporta 'emblem_custom'
ALTER TABLE guild_identity_history
  DROP CONSTRAINT field_check; -- Assumindo que existia algo similar

ALTER TABLE guild_identity_history
  ADD CONSTRAINT field_check CHECK (field IN ('name', 'tag', 'emblem', 'emblem_custom'));
