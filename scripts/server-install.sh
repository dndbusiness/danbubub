#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# התקנת המערכת על שרת אובונטו 24.04 נקי — מריצים פעם אחת, כ-root, מתוך הריפו.
#
#   DOMAIN=finance.example.com ./scripts/server-install.sh   # HTTPS אוטומטי
#   ./scripts/server-install.sh                              # בלי דומיין: HTTP על ה-IP (מסוכן)
#
# הסקריפט idempotent: ריצה שנייה לא מוחקת סודות, לא דורסת את ה-DB, ולא מכפילה
# שורות cron. מה שכבר קיים — נשאר.
#
# מה הוא מתקין: Postgres 16 · Node 22 · Caddy (HTTPS) · Chromium ל-PDF ·
#               systemd לשירות · cron ל-14 הג'ובים של חלק ג' · גיבוי יומי.
#
# מה הוא **לא** עושה: לא מייבא נתונים (זה `scripts/import-workbook.mjs` עם הקובץ
# האמיתי), ולא מחבר את גוגל (זה OAuth של דן מהדפדפן).
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="${DOMAIN:-}"
APP_USER="${APP_USER:-harel}"
APP_DIR="${APP_DIR:-/opt/harel}"
PORT="${PORT:-3000}"
ENV_FILE="$APP_DIR/.env.local"

say()  { printf '\n\033[1m→ %s\033[0m\n' "$*"; }
ok()   { printf '   ✓ %s\n' "$*"; }
warn() { printf '   ⚠ %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "צריך להריץ כ-root (sudo -i)"
command -v apt-get >/dev/null || die "הסקריפט הזה לאובונטו/דביאן"

# ── 1. חבילות מערכת ──────────────────────────────────────────────────────────
say "חבילות מערכת"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg jq git ufw rsync openssl >/dev/null
apt-get install -y -qq postgresql postgresql-contrib >/dev/null
ok "Postgres $(psql --version | awk '{print $3}')"

if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node -v)"

if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
ok "Caddy $(caddy version | head -1)"

# ── 2. משתמש וקוד ────────────────────────────────────────────────────────────
say "משתמש הרצה וקוד"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
if [[ "$ROOT" != "$APP_DIR" ]]; then
  # rsync אם יש, אחרת cp — שומר על .env.local ועל storage/ שכבר קיימים.
  if command -v rsync >/dev/null; then
    rsync -a --delete --exclude .git --exclude node_modules --exclude .next \
      --exclude .env.local --exclude storage "$ROOT/" "$APP_DIR/"
  else
    cp -r "$ROOT/." "$APP_DIR/"
  fi
fi
mkdir -p "$APP_DIR/storage/reports" "$APP_DIR/storage/intake" "$APP_DIR/storage/backups"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
ok "הקוד ב-$APP_DIR"

# ── 3. בסיס הנתונים ──────────────────────────────────────────────────────────
say "בסיס הנתונים"
DB_NAME="${DB_NAME:-harel}"
DB_USER="${DB_USER:-harel}"
if ! su postgres -c "psql -tAc \"select 1 from pg_roles where rolname='$DB_USER'\"" | grep -q 1; then
  DB_PASS="$(openssl rand -hex 24)"
  su postgres -c "psql -q -c \"create role $DB_USER login password '$DB_PASS'\""
  ok "נוצר משתמש DB"
else
  DB_PASS=""
  ok "משתמש ה-DB כבר קיים"
fi
su postgres -c "psql -tAc \"select 1 from pg_database where datname='$DB_NAME'\"" | grep -q 1 || {
  su postgres -c "createdb -O $DB_USER $DB_NAME"
  ok "נוצר בסיס נתונים $DB_NAME"
}

# ── 4. משתני סביבה — נוצרים פעם אחת ונשמרים ──────────────────────────────────
say "משתני סביבה"
if [[ ! -f "$ENV_FILE" ]]; then
  [[ -n "$DB_PASS" ]] || die "$ENV_FILE לא קיים אבל משתמש ה-DB כן — הגדירו DATABASE_URL ידנית והריצו שוב"
  APP_PASSWORD="$(openssl rand -hex 8)"
  cat > "$ENV_FILE" <<EOF
# נוצר ע"י scripts/server-install.sh — $(date -u +%F)
DATABASE_URL=postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
JOBS_SECRET=$(openssl rand -hex 32)
SECRETS_KEY=$(openssl rand -hex 32)
APP_PASSWORD=$APP_PASSWORD
APP_BASE_URL=${DOMAIN:+https://$DOMAIN}
NODE_ENV=production
PORT=$PORT
# גוגל (ב.1) — למלא אחרי יצירת OAuth client, ואז: systemctl restart harel
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# ב.3 — חילוץ שדות כהצעה בלבד (הנחיה 17)
ANTHROPIC_API_KEY=
# ב.8 — וואטסאפ
GREEN_API_INSTANCE=
GREEN_API_TOKEN=
EOF
  [[ -z "$DOMAIN" ]] && sed -i "s|^APP_BASE_URL=.*|APP_BASE_URL=http://$(hostname -I | awk '{print $1}')|" "$ENV_FILE"
  ok "נוצר $ENV_FILE עם סודות חדשים"
else
  [[ -n "$DOMAIN" ]] && sed -i "s|^APP_BASE_URL=.*|APP_BASE_URL=https://$DOMAIN|" "$ENV_FILE"
  ok "$ENV_FILE קיים — הסודות נשמרו"
fi
chmod 600 "$ENV_FILE"; chown "$APP_USER:$APP_USER" "$ENV_FILE"
set -a; . "$ENV_FILE"; set +a

# ── 5. סכימה, views, seed ────────────────────────────────────────────────────
# קובצי הסכימה נכתבו ל-DB טרי (alter table add column בלי if not exists), ולכן
# הם רצים **פעם אחת** ונרשמים ב-schema_migrations. views ו-seed נכתבו כ-
# create or replace / on conflict ולכן רצים בכל התקנה ומתעדכנים.
say "סכימה ו-views"
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "
  create table if not exists schema_migrations (
    filename   text primary key,
    hash       text not null,
    applied_at timestamptz not null default now())" >/dev/null

for f in "$APP_DIR"/db/schema/*.sql; do
  base="$(basename "$f")"
  hash="$(sha256sum "$f" | cut -d' ' -f1)"
  applied="$(psql "$DATABASE_URL" -tAc "select hash from schema_migrations where filename = '$base'")"
  if [[ -n "$applied" ]]; then
    [[ "$applied" != "$hash" ]] && warn "$base שונה אחרי שכבר הוחל — לא מורץ מחדש. שינוי סכימה = קובץ חדש עם מספר הבא."
    continue
  fi
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || die "נכשל: $base"
  psql "$DATABASE_URL" -q -c "insert into schema_migrations (filename, hash) values ('$base', '$hash')" >/dev/null
  ok "$base"
done

for f in "$APP_DIR"/db/views/*.sql "$APP_DIR"/db/seed/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || die "נכשל: $(basename "$f")"
done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$APP_DIR/db/tests/000_guarantees.sql" >/dev/null \
  || die "ההבטחות המבניות של §11 לא עוברות — לא ממשיכים"
ok "views ו-seed עודכנו וההבטחות המבניות עוברות"

# ── 6. בנייה ─────────────────────────────────────────────────────────────────
say "התקנה ובנייה"
cd "$APP_DIR"
su "$APP_USER" -s /bin/bash -c "cd $APP_DIR && npm ci --no-audit --no-fund" >/dev/null
# Chromium ל-PDF (דוח שבועי, P&L, פערים). בלעדיו הכול עובד חוץ מקובצי ה-PDF.
# ספריות המערכת כ-root (apt), הדפדפן עצמו כמשתמש שמריץ את השירות (שם הוא יחפש אותו).
npx --yes playwright install-deps chromium >/dev/null 2>&1 || warn "ספריות Chromium לא הותקנו"
su "$APP_USER" -s /bin/bash -c "cd $APP_DIR && npx playwright install chromium" >/dev/null 2>&1 \
  && ok "Chromium מותקן" || warn "Chromium לא הותקן — PDF לא יופק (npx playwright install --with-deps chromium)"
su "$APP_USER" -s /bin/bash -c "cd $APP_DIR && npm run build" >/dev/null
ok "נבנה"

# ── 7. שירות ─────────────────────────────────────────────────────────────────
say "שירות systemd"
cat > /etc/systemd/system/harel.service <<EOF
[Unit]
Description=Har-El finance
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now harel >/dev/null
sleep 3
systemctl is-active --quiet harel && ok "השירות רץ" || die "השירות לא עלה: journalctl -u harel -n 50"

# ── 8. Caddy — HTTPS אוטומטי אם יש דומיין ────────────────────────────────────
say "שרת הקצה"
if [[ -n "$DOMAIN" ]]; then
  cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
  ok "HTTPS אוטומטי ל-$DOMAIN (Let's Encrypt)"
else
  cat > /etc/caddy/Caddyfile <<EOF
:80 {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
  warn "בלי דומיין — התעבורה בגלוי. סיסמאות, קודי PIN ונתוני בנק עוברים ברשת ללא הצפנה."
fi
systemctl reload caddy 2>/dev/null || systemctl restart caddy
ok "Caddy פעיל"

# ── 9. הג'ובים של חלק ג' — מקור אחד: vercel.json ─────────────────────────────
say "ג'ובים מתוזמנים"
timedatectl set-timezone UTC 2>/dev/null || true
{
  echo "# נוצר ע\"י scripts/server-install.sh מתוך vercel.json — חלק ג' של ה-ADDENDUM."
  echo "# שעון UTC. לשינוי: לערוך את vercel.json ולהריץ שוב את הסקריפט."
  echo "SHELL=/bin/bash"
  jq -r --arg secret "$JOBS_SECRET" --arg port "$PORT" '
    .crons[] | "\(.schedule) root curl -fsS -m 600 -X POST -H \"x-jobs-secret: \($secret)\" http://127.0.0.1:\($port)\(.path) > /dev/null 2>&1"
  ' "$APP_DIR/vercel.json"
  echo "17 2 * * * root $APP_DIR/scripts/backup.sh >> /var/log/harel-backup.log 2>&1"
} > /etc/cron.d/harel
chmod 644 /etc/cron.d/harel
ok "$(jq '.crons | length' "$APP_DIR/vercel.json") ג'ובים + גיבוי יומי ב-/etc/cron.d/harel"

cat > "$APP_DIR/scripts/backup.sh" <<EOF
#!/usr/bin/env bash
# גיבוי יומי מקומי (SPEC §11.10). לא תחליף לגיבוי מחוץ לשרת.
set -euo pipefail
. $ENV_FILE
OUT=$APP_DIR/storage/backups/harel-\$(date -u +%F).sql.gz
pg_dump "\$DATABASE_URL" | gzip > "\$OUT"
find $APP_DIR/storage/backups -name 'harel-*.sql.gz' -mtime +14 -delete
echo "\$(date -u +%FT%TZ) \$OUT \$(du -h "\$OUT" | cut -f1)"
EOF
chmod +x "$APP_DIR/scripts/backup.sh"
chown "$APP_USER:$APP_USER" "$APP_DIR/scripts/backup.sh"

# ── 10. חומת אש ──────────────────────────────────────────────────────────────
say "חומת אש"
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ok "22, 80, 443 בלבד (Postgres מקומי, לא חשוף)"

# ── 11. בדיקה ────────────────────────────────────────────────────────────────
say "בדיקת בריאות"
sleep 2
HEALTH="$(curl -fsS "http://127.0.0.1:$PORT/api/health" || true)"
[[ -n "$HEALTH" ]] || die "/api/health לא עונה: journalctl -u harel -n 50"
echo "   $HEALTH"
su "$APP_USER" -s /bin/bash -c "cd $APP_DIR && node scripts/preflight.mjs" || true

URL="${DOMAIN:+https://$DOMAIN}"; URL="${URL:-http://$(hostname -I | awk '{print $1}')}"
cat <<EOF

════════════════════════════════════════════════════════════════════════════
המערכת באוויר: $URL
סיסמת הכניסה הזמנית (APP_PASSWORD): $(grep '^APP_PASSWORD=' "$ENV_FILE" | cut -d= -f2)

מה שנשאר, לפי הסדר:
  1. נתונים:   node --experimental-strip-types scripts/import-workbook.mjs <הקובץ.xlsx> --as-of $(date -u +%F)
  2. גוגל:     OAuth client עם redirect $URL/api/google/callback → GOOGLE_CLIENT_ID/SECRET ב-$ENV_FILE
               → systemctl restart harel → $URL/settings → "חבר את גוגל"
  3. מייל רו"ח: $URL/settings ← "מייל רו״ח" (בלעדיו דוח הפערים מופק אבל לא נשלח)
  4. PIN:      node scripts/set-pin.mjs (אזורי 🔒 — כרטיס ניסים, שותפים, פרייבט)

יומן:    journalctl -u harel -f
ג'ובים:  node scripts/smoke.mjs
גיבוי:   $APP_DIR/storage/backups
════════════════════════════════════════════════════════════════════════════
EOF
[[ -z "$DOMAIN" ]] && warn "אין דומיין → אין HTTPS. להריץ שוב עם DOMAIN=... אחרי שרשומת A מצביעה לכאן."
exit 0
