-- Fase 04 - Novos Cargos. Renomeia e simplifica a escada de poder.
-- lider > sub-lider > comandante > vassalo

-- 1. Cria o novo tipo temporário
CREATE TYPE guild_role_new AS ENUM ('lider', 'sub-lider', 'comandante', 'vassalo');

-- 2. Converte as colunas na guild_member
ALTER TABLE guild_member
  ALTER COLUMN role TYPE TEXT;

UPDATE guild_member SET role = 'lider'      WHERE role = 'leader';
UPDATE guild_member SET role = 'sub-lider'  WHERE role = 'officer';
UPDATE guild_member SET role = 'comandante' WHERE role = 'veteran';
UPDATE guild_member SET role = 'vassalo'    WHERE role IN ('member', 'recruit');

ALTER TABLE guild_member
  ALTER COLUMN role TYPE guild_role_new USING role::guild_role_new;

-- 3. Converte a coluna na guild_membership_history (se existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guild_membership_history' AND column_name = 'role_at_exit') THEN
    ALTER TABLE guild_membership_history ALTER COLUMN role_at_exit TYPE TEXT;
    UPDATE guild_membership_history SET role_at_exit = 'lider'      WHERE role_at_exit = 'leader';
    UPDATE guild_membership_history SET role_at_exit = 'sub-lider'  WHERE role_at_exit = 'officer';
    UPDATE guild_membership_history SET role_at_exit = 'comandante' WHERE role_at_exit = 'veteran';
    UPDATE guild_membership_history SET role_at_exit = 'vassalo'    WHERE role_at_exit IN ('member', 'recruit');
  END IF;
END $$;

-- 4. Remove o tipo antigo
DROP TYPE guild_role;
ALTER TYPE guild_role_new RENAME TO guild_role;

-- 5. Atualiza o default na tabela guild_member
ALTER TABLE guild_member ALTER COLUMN role SET DEFAULT 'vassalo';
