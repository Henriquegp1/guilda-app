-- Fase 04 - Novos Cargos. Renomeia e simplifica a escada de poder.
-- lider > sub-lider > comandante > vassalo

-- 1. Remove dependências que usam o tipo antigo em comparações (índices parciais)
DROP INDEX IF EXISTS guild_member_leader_uk;

-- 2. Remove o default antigo para evitar conflitos de tipo durante a alteração
ALTER TABLE guild_member ALTER COLUMN role DROP DEFAULT;

-- 3. Converte a coluna para TEXT temporariamente para permitir a mudança de valores
-- Usamos explicitamente a conversão para garantir que não haja ambiguidade
ALTER TABLE guild_member ALTER COLUMN role TYPE TEXT USING role::TEXT;

-- 4. Atualiza os valores (mapeamento antigo -> novo)
-- Usamos casts explícitos ::TEXT no lado direito para evitar o erro "text = guild_role"
UPDATE guild_member SET role = 'lider'      WHERE role = 'leader'::TEXT;
UPDATE guild_member SET role = 'sub-lider'  WHERE role = 'officer'::TEXT;
UPDATE guild_member SET role = 'comandante' WHERE role = 'veteran'::TEXT;
UPDATE guild_member SET role = 'vassalo'    WHERE role IN ('member'::TEXT, 'recruit'::TEXT);

-- 5. Garante que o histórico também use os novos nomes (já é TEXT)
UPDATE guild_membership_history SET role_at_exit = 'lider'      WHERE role_at_exit = 'leader';
UPDATE guild_membership_history SET role_at_exit = 'sub-lider'  WHERE role_at_exit = 'officer';
UPDATE guild_membership_history SET role_at_exit = 'comandante' WHERE role_at_exit = 'veteran';
UPDATE guild_membership_history SET role_at_exit = 'vassalo'    WHERE role_at_exit IN ('member', 'recruit');

-- 6. Cria o novo tipo ENUM (com nome temporário)
CREATE TYPE guild_role_new AS ENUM ('lider', 'sub-lider', 'comandante', 'vassalo');

-- 7. Converte a coluna para o novo ENUM
ALTER TABLE guild_member
  ALTER COLUMN role TYPE guild_role_new USING role::guild_role_new;

-- 8. Substitui o tipo global
DROP TYPE guild_role;
ALTER TYPE guild_role_new RENAME TO guild_role;

-- 9. Restaura o default e o índice de unicidade do líder
ALTER TABLE guild_member ALTER COLUMN role SET DEFAULT 'vassalo';

CREATE UNIQUE INDEX guild_member_leader_uk
  ON guild_member (guild_id) WHERE role = 'lider';
