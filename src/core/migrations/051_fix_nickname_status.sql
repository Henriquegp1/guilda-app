-- Correção: Garante que a coluna status existe na tabela user_profile
-- Necessário porque a 050 foi editada após ser aplicada em alguns ambientes.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profile' AND column_name = 'status') THEN
    ALTER TABLE user_profile ADD COLUMN status TEXT NOT NULL DEFAULT 'pending_review';
  END IF;
END $$;
