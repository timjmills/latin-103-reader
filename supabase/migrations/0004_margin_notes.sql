-- Ørberg-style marginal glosses per unit (see CONTRACT.md "Margin notes").
alter table public.units add column if not exists margin jsonb not null default '[]'::jsonb;
