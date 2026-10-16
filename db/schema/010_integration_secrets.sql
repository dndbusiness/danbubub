-- ════════════════════════════════════════════════════════════════════════════
-- 010 — סודות אינטגרציה (ADDENDUM ב.1 / הנחיה 15)
--
-- integrations לא מחזיקה סוד (הבטחה מבנית "אין עמודת סוד ב-integrations").
-- הסוד (refresh token) יושב כאן *מוצפן* — AES-256-GCM עם SECRETS_KEY שנמצא רק
-- בסביבת השרת (lib/secrets.ts). ב-Supabase הטבלה הזו מוחלפת ב-Vault; המפתח
-- vault_secret_id ב-integrations נשאר אותו דבר.
-- ════════════════════════════════════════════════════════════════════════════

create table integration_secrets (
  id           uuid primary key default gen_random_uuid(),
  -- {iv, tag, ciphertext, alg} — אף שדה כאן אינו קריא בלי המפתח.
  sealed       jsonb not null check (jsonb_typeof(sealed) = 'object' and sealed ? 'ciphertext' and sealed ? 'iv' and sealed ? 'tag'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id),
  deleted_at   timestamptz
);

select install_standard_triggers('integration_secrets');

-- audit_log (§11.4) מקליט את השורה — כלומר ciphertext בלבד; בלי SECRETS_KEY אין בו כלום.

comment on table integration_secrets is
  'הנחיה 15 — refresh tokens מוצפנים; המפתח מחוץ ל-DB. ב-Supabase: Vault.';

-- לאיזה שירותים חוברנו בפועל (Google עשוי לאשר פחות ממה שביקשנו).
alter table integrations add column if not exists connected_email text;
