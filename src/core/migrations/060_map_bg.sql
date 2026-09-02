-- Fase 06 - Imagem de Fundo do Mapa Mundi Personalizada pelo Streamer

CREATE TABLE IF NOT EXISTS map_config (
  channel_id     BIGINT      PRIMARY KEY REFERENCES channel(id) ON DELETE CASCADE,
  background_url TEXT        NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
