#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# מריץ את סכימת ה-DB, ה-views והבדיקות שלהם על מופע Postgres נקי.
#
#   ./scripts/verify-db.sh                     # מרים Postgres זמני ובודק
#   PGURL=postgres://… ./scripts/verify-db.sh  # מול DB קיים
#
# הבדיקות:
#   1. הסכימה וה-views נוצרים ללא שגיאה
#   2. 12 ההבטחות המבניות מ-SPEC §11 נאכפות (db/tests/000_guarantees.sql)
#   3. ה-views מחזירים את יעדי SPEC §8 (db/tests/001_parity.sql)
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/harel-db-verify-$$"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

if [[ -n "${PGURL:-}" ]]; then
  PSQL=(psql "$PGURL")
else
  PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}"
  [[ -x "$PGBIN/initdb" ]] || { echo "לא נמצא Postgres. התקינו, או הריצו עם PGURL=…" >&2; exit 1; }
  PGDATA="$WORK/pgdata"
  PORT="${PGPORT:-5433}"

  # Postgres מסרב לרוץ כ-root. בסביבות שבהן אנחנו root (קונטיינרים),
  # מריצים את השרת תחת משתמש לא-מורשה ומתחברים אליו כלקוח.
  if [[ "$(id -u)" -eq 0 ]]; then
    SRV_USER="${PGUSER_SERVER:-postgres}"
    id "$SRV_USER" >/dev/null 2>&1 || { echo "נדרש משתמש $SRV_USER להרצת השרת" >&2; exit 1; }
    chmod 777 "$WORK"
    AS_SERVER=(su "$SRV_USER" -c)
  else
    AS_SERVER=(bash -c)
  fi

  echo "→ מרים Postgres זמני ב-$PGDATA"
  "${AS_SERVER[@]}" "$PGBIN/initdb -D $PGDATA -A trust -E UTF8" >/dev/null
  "${AS_SERVER[@]}" "$PGBIN/pg_ctl -D $PGDATA -l $WORK/pg.log \
     -o '-k $WORK -p $PORT -c listen_addresses=' start" >/dev/null
  stop_server() {
    "${AS_SERVER[@]}" "$PGBIN/pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1 || true
    rm -rf "$WORK"
  }
  trap stop_server EXIT

  psql -h "$WORK" -p "$PORT" -U postgres -d postgres -c 'create database harel' >/dev/null
  PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d harel)
fi

run() { "${PSQL[@]}" -v ON_ERROR_STOP=1 -q -f "$1"; }

echo "→ סכימה"
for f in "$ROOT"/db/schema/*.sql; do echo "   $(basename "$f")"; run "$f" >/dev/null; done

echo "→ views"
for f in "$ROOT"/db/views/*.sql; do echo "   $(basename "$f")"; run "$f" >/dev/null; done

echo "→ seed מהפיקסצ'ר של vitest"
node --experimental-strip-types "$ROOT/scripts/fixture-to-sql.mjs" > "$WORK/seed.sql"
run "$WORK/seed.sql" >/dev/null

echo "→ הבטחות מבניות (SPEC §11)"
run "$ROOT/db/tests/000_guarantees.sql" 2>&1 | sed -n 's/^psql.*NOTICE:  /   /p'

echo "→ הבטחות מבניות (ADDENDUM)"
run "$ROOT/db/tests/002_addendum.sql" 2>&1 | sed -n 's/^psql.*NOTICE:  /   /p'

echo "→ זהות views ↔ lib/rules (SPEC §8)"
run "$ROOT/db/tests/001_parity.sql" 2>&1 | sed -n 's/^psql.*NOTICE:  /   /p'

echo
echo "✓ ה-DB עובר."
