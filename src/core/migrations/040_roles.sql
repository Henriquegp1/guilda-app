-- Fase 04 - Novos Cargos. Renomeia e simplifica a escada de poder.
-- lider > sub-lider > comandante > vassalo

-- 1. Remove dependências que usam o tipo antigo em comparações (índices parciais)
DROP INDEX IF EXISTS guild_member_leader_uk;

-- 2. Remove o default antigo
ALTER TABLE guild_member ALTER COLUMN role DROP DEFAULT;

-- 3. Converte a coluna para TEXT temporariamente para permitir a mudança de valores
ALTER TABLE guild_member ALTER COLUMN role TYPE TEXT USING role::TEXT;

-- 4. Atualiza os valores (mapeamento antigo -> novo)
UPDATE guild_member SET role = 'lider'      WHERE role IN ('leader', 'lider');
UPDATE guild_member SET role = 'sub-lider'  WHERE role IN ('officer', 'sub-lider');
UPDATE guild_member SET role = 'comandante' WHERE role IN ('veteran', 'comandante');
UPDATE guild_member SET role = 'vassalo'    WHERE role IN ('member', 'recruit', 'vassalo');

-- 5. Garante que o histórico também use os novos nomes (já é TEXT)
UPDATE guild_membership_history SET role_at_exit = 'lider'      WHERE role_at_exit IN ('leader', 'lider');
UPDATE guild_membership_history SET role_at_exit = 'sub-lider'  WHERE role_at_exit IN ('officer', 'sub-lider');
UPDATE guild_membership_history SET role_at_exit = 'comandante' WHERE role_at_exit IN ('veteran', 'comandante');
UPDATE guild_membership_history SET role_at_exit = 'vassalo'    WHERE role_at_exit IN ('member', 'recruit', 'vassalo');

-- 6. Cria o novo tipo ENUM
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'guild_role_new') THEN
    CREATE TYPE guild_role_new AS ENUM ('lider', 'sub-lider', 'comandante', 'vassalo');
  END IF;
END $$;

-- 7. Converte a coluna para o novo ENUM
ALTER TABLE guild_member
  ALTER COLUMN role TYPE guild_role_new USING role::guild_role_new;

-- 8. Substitui o tipo global com CASCADE para não travar
DROP TYPE IF EXISTS guild_role CASCADE;
ALTER TYPE guild_role_new RENAME TO guild_role;

-- 9. Restaura o default e o índice de unicidade do líder
ALTER TABLE guild_member ALTER COLUMN role SET DEFAULT 'vassalo';

CREATE UNIQUE INDEX guild_member_leader_uk
  ON guild_member (guild_id) WHERE role = 'lider';

-- 10. Re-sincroniza a contagem de membros real para todas as guildas existentes (evita desbalanço de member_count)
UPDATE guild g
  SET member_count = (SELECT count(*)::int FROM guild_member m WHERE m.guild_id = g.id);
