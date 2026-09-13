-- Fase 06 - Adiciona colunas de cache de brasão na tabela guild
-- Permite que a listagem pública mostre brasões customizados sem joins caros.

ALTER TABLE guild
  ADD COLUMN IF NOT EXISTS custom_emblem_url TEXT;
