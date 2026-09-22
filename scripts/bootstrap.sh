#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# שורה אחת קצרה להדבקה בקונסולה של השרת (כ-root):
#
#   curl -fsSL https://raw.githubusercontent.com/dndbusiness/danbubub/claude/new-session-3k3pta/scripts/bootstrap.sh | bash
#
# מוריד את הקוד ומריץ את ההתקנה. מה שחסר — נשאל כאן, ולא מודבק בשורת הפקודה:
# בקונסולה של ספק הענן שורת הפקודה נשמרת בהיסטוריה ולעיתים גם בלוג של הספק.
# הסיסמה נקראת בלי הד למסך.
#
# אפשר גם בלי שאלות, למי שמריץ מסקריפט:
#   DOMAIN=… APP_PASSWORD=… NOTIFY_WHATSAPP=… NOTIFY_EMAIL=… bash bootstrap.sh
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO="${REPO:-https://github.com/dndbusiness/danbubub}"
BRANCH="${BRANCH:-claude/new-session-3k3pta}"
APP_DIR="${APP_DIR:-/opt/harel}"

say() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "צריך להריץ כ-root"

# הסקריפט מגיע דרך צינור, ולכן stdin תפוס — שואלים ישירות מהמסוף.
# פתיחת /dev/tty היא גם הבדיקה: הקובץ קיים גם כשאין מסוף, והפתיחה היא זו שנכשלת.
TTY_OK=0
{ exec 3<>/dev/tty; } 2>/dev/null && TTY_OK=1 || true

ask() { # ask <שאלה> <משתנה> [secret]
  local prompt="$1" var="$2" secret="${3:-}" value
  # "הוגדר" כולל ערך ריק במכוון — DOMAIN= פירושו "בלי דומיין", לא "תשאל אותי".
  [[ -n "${!var+x}" ]] && return 0
  [[ "$TTY_OK" == 1 ]] || die "$var לא הוגדר ואין מסוף לשאול בו — העבירו אותו כמשתנה סביבה"
  printf '%s' "$prompt" >&3
  if [[ -n "$secret" ]]; then read -rs value <&3; printf '\n' >&3; else read -r value <&3; fi
  printf -v "$var" '%s' "$value"
  export "${var?}"
}

say "פרטי ההתקנה"
ask "דומיין (Enter = בלי דומיין, האתר יעלה על ה-IP בלי הצפנה): " DOMAIN
ask "סיסמת כניסה למערכת: " APP_PASSWORD secret
ask "נייד לוואטסאפ (05…): " NOTIFY_WHATSAPP
ask "מייל להתראות: " NOTIFY_EMAIL
[[ -n "$APP_PASSWORD" ]] || die "בלי סיסמה כל מי שיש לו את הכתובת רואה את כל הכספים"

say "הורדת הקוד"
command -v git >/dev/null || { apt-get update -qq; apt-get install -y -qq git; }
if [[ -d "$APP_DIR/.git" ]]; then
  # עדכון גרסה. .env.local לא במעקב ולכן נשמר.
  git -C "$APP_DIR" fetch --depth 50 origin "$BRANCH"
  git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  [[ -e "$APP_DIR" ]] && die "$APP_DIR קיים ואינו עותק של הריפו — להעביר אותו הצידה ולהריץ שוב"
  git clone --depth 50 -b "$BRANCH" "$REPO" "$APP_DIR"
fi

say "התקנה"
cd "$APP_DIR"
exec env DOMAIN="$DOMAIN" APP_PASSWORD="$APP_PASSWORD" \
  NOTIFY_WHATSAPP="$NOTIFY_WHATSAPP" NOTIFY_EMAIL="$NOTIFY_EMAIL" \
  ./scripts/server-install.sh
