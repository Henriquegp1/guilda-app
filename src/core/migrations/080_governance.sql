-- Fase 08 — Governança e Auditoria.
-- Enriquecimento do log de auditoria com o cargo do ator.

ALTER TABLE audit_log ADD COLUMN actor_role TEXT;
