#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# Postgres מקומי לפיתוח — מתמיד (בניגוד ל-verify-db.sh שמרים ומפרק).
#
#   ./scripts/dev-db.sh start    # מרים (initdb בפעם הראשונה), מחיל סכימה+views, טוען seed
#   ./scripts/dev-db.sh stop
#   ./scripts/dev-db.sh reset    # מוחק ומתחיל מחדש
#   ./scripts/dev-db.sh psql     # מעטפת psql
#
# ה-seed הוא הפיקסצ'ר המשוחזר (tests/fixtures) — לא נתונים אמיתיים (SPEC §11.11).
# מדפיס את DATABASE_URL לשימוש ב-.env.local.
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${HAREL_DEV_DB_DIR:-${TMPDIR:-/tmp}/harel-dev-db}"
PGDATA="$DIR/pgdata"; SOCK="$DIR"; PORT="${HAREL_DEV_DB_PORT:-5433}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}"
URL="postgres://postgres@localhost:$PORT/harel"

if [[ "$(id -u)" -eq 0 ]]; then AS=(su postgres -c); mkdir -p "$DIR"; chmod 777 "$DIR"; else AS=(bash -c); mkdir -p "$DIR"; fi
psqlc() { psql -h "$SOCK" -p "$PORT" -U postgres "$@"; }

case "${1:-start}" in
  stop)  "${AS[@]}" "$PGBIN/pg_ctl -D $PGDATA stop -m fast" >/dev/null 2>&1 || true; echo "נעצר"; exit 0 ;;
  reset) "${AS[@]}" "$PGBIN/pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$PGDATA"; exec "$0" start ;;
  psql)  shift; exec psql "$URL" "$@" ;;
  start) ;;
  *) echo "שימוש: $0 start|stop|reset|psql" >&2; exit 1 ;;
esac

if [[ ! -d "$PGDATA" ]]; then
  echo "→ initdb"
  "${AS[@]}" "$PGBIN/initdb -D $PGDATA -A trust -E UTF8" >/dev/null
fi
if ! "${AS[@]}" "$PGBIN/pg_ctl -D $PGDATA status" >/dev/null 2>&1; then
  echo "→ מרים Postgres על $SOCK:$PORT"
  "${AS[@]}" "$PGBIN/pg_ctl -D $PGDATA -l $DIR/pg.log -o '-k $SOCK -p $PORT -c listen_addresses=localhost' start" >/dev/null
fi

if ! psqlc -d harel -tAc 'select 1' >/dev/null 2>&1; then
  psqlc -d postgres -c 'create database harel' >/dev/null
fi

# מחיל רק קבצים שטרם הוחלו — לפי טבלת מעקב פשוטה
psqlc -d harel -q -c 'create table if not exists _applied (name text primary key, at timestamptz default now())'
apply() {
  local f="$1" n; n="$(basename "$(dirname "$f")")/$(basename "$f")"
  if [[ -z "$(psqlc -d harel -tAc "select 1 from _applied where name='$n'")" ]]; then
    echo "   $n"; psqlc -d harel -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null
    psqlc -d harel -q -c "insert into _applied(name) values ('$n')"
  fi
}
echo "→ סכימה ו-views"
for f in "$ROOT"/db/schema/*.sql "$ROOT"/db/views/*.sql "$ROOT"/db/seed/*.sql; do apply "$f"; done

if [[ -z "$(psqlc -d harel -tAc 'select 1 from deals limit 1')" ]]; then
  echo "→ seed (פיקסצ'ר משוחזר)"
  node --experimental-strip-types "$ROOT/scripts/fixture-to-sql.mjs" > "$DIR/seed.sql"
  psqlc -d harel -v ON_ERROR_STOP=1 -q -f "$DIR/seed.sql" >/dev/null
fi

echo
echo "DATABASE_URL=$URL"
