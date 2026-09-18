# העלאה לאוויר

המערכת רצה על Next.js + Postgres. שני מסלולים: **שרת אחד משלנו** (סעיף 0 — פקודה
אחת, וזה המסלול שנבחר) או **Vercel + Supabase** (סעיפים 1–3). בשניהם הסדר זהה:
DB → משתני סביבה → נתונים → cron → גוגל.

בכל שלב אפשר לבדוק איפה אנחנו עומדים:

```bash
node scripts/preflight.mjs        # מה עובד, מה חוסם, מה רק מגביל
curl $APP_BASE_URL/api/health     # 200 = ה-DB עונה והסכימה במקום
```

---

## 0. שרת אחד (Ubuntu 24.04) — פקודה אחת

זה המסלול שנבחר: שרת Hetzner, Ubuntu 24.04 נקייה, הכול עליו — Postgres, האפליקציה,
HTTPS והג'ובים. **כל מה שצריך זה SSH לשרת.**

```bash
ssh root@<IP>
git clone <הריפו> /opt/harel && cd /opt/harel
DOMAIN=finance.example.com ./scripts/server-install.sh      # עם דומיין: HTTPS אוטומטי
./scripts/server-install.sh                                 # בלי דומיין: HTTP על ה-IP
```

הסקריפט מתקין Postgres 16 · Node 22 · Caddy · Chromium ל-PDF, מריץ את הסכימה
וה-views לפי הסדר, מאמת את **26 ההבטחות המבניות** לפני שהוא ממשיך, מייצר סודות
(`JOBS_SECRET`, `SECRETS_KEY`, `APP_PASSWORD`) פעם אחת ושומר אותם ב-`/opt/harel/.env.local`,
מרים שירות `systemd`, פותח חומת אש ל-22/80/443 בלבד, ומייצר את **14 הג'ובים של חלק ג'
ישירות מ-`vercel.json`** — מקור אחד לתזמונים, בלי עותק שלישי שיתיישן.

הוא **idempotent**: ריצה שנייה מעדכנת קוד, בונה מחדש ומרעננת cron, בלי לגעת בסודות
או בנתונים. אחרי עדכון קוד: `cd /opt/harel && git pull && ./scripts/server-install.sh`.

**DNS לפני ההרצה עם דומיין:** רשומת `A` מהדומיין (או תת-דומיין) ל-IP של השרת,
TTL 300. בלי זה Let's Encrypt לא יאשר תעודה והסקריפט יישאר על HTTP.

> **בלי דומיין אין HTTPS.** סיסמת הכניסה, קודי ה-PIN לאזורי ניסים/שותפים/פרייבט
> ונתוני הבנק עוברים אז בגלוי ברשת. להריץ שוב עם `DOMAIN=` ברגע שיש רשומת A.

מה שנשאר אחרי הסקריפט (הוא מדפיס את זה בסוף): ייבוא הקובץ האמיתי · OAuth client
של גוגל · מייל רו"ח · קודי PIN.

בדיקה: `systemctl status harel` · `journalctl -u harel -f` · `node scripts/smoke.mjs` ·
`curl localhost:3000/api/health`. גיבוי יומי: `/opt/harel/storage/backups` (14 יום אחורה).

---

## 1. בסיס הנתונים (Supabase)

1. פרויקט חדש ב-[supabase.com](https://supabase.com) — אזור **Frankfurt** (הכי קרוב).
2. Settings → Database → **Connection string → Transaction pooler** (פורט 6543). זה `DATABASE_URL`.
3. להריץ את הסכימה לפי הסדר — **מספרית, בלי לדלג**:

```bash
export PGURL='postgresql://postgres.xxx:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
for f in db/schema/*.sql db/views/*.sql db/seed/*.sql; do
  echo "→ $f"; psql "$PGURL" -v ON_ERROR_STOP=1 -f "$f" >/dev/null || break
done
psql "$PGURL" -f db/tests/000_guarantees.sql   # 26 ההבטחות המבניות
```

> **גיבוי לפני כל שינוי סכימה** (SPEC §11.10): Supabase → Database → Backups, או
> `pg_dump "$PGURL" > backup-$(date +%F).sql`.

## 2. משתני סביבה

| משתנה | חובה | מה קורה בלעדיו |
|---|---|---|
| `DATABASE_URL` | ✔ | שום דבר לא עובד |
| `JOBS_SECRET` | ✔ | כל אחד ברשת יכול להריץ ג׳ובים. `openssl rand -hex 32` |
| `SECRETS_KEY` | ✔ | אי אפשר לשמור refresh token של גוגל (הנחיה 15). `openssl rand -hex 32` |
| `APP_BASE_URL` | ✔ | הקישורים במיילים, בוואטסאפ וביומן יוצאים שבורים |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | אין מייל, יומן, דרייב וסריקת חשבוניות (ב.1–ב.4) |
| `GREEN_API_ID_INSTANCE` / `GREEN_API_TOKEN` | — | התראות ותזכורות וואטסאפ ממתינות ב-`outbox` |
| `ANTHROPIC_API_KEY` | — | חילוץ חשבונית של ספק לא מוכר נשאר לפי כללים (ב.3) |
| `CRON_SECRET` | — | רק אם משתמשים ב-Vercel Cron (Vercel מגדיר אותו לבד) |
| `CHROMIUM_PACK_URL` | — | הפקת PDF ב-Vercel נכשלת (ראו §3) |
| `APP_PASSWORD` | — | **האתר פתוח לכל מי שיש לו הכתובת** (ראו §7) |

> `SECRETS_KEY` מצפין את ה-refresh token של גוגל. **אם הוא מתחלף — החיבור לגוגל
> נשבר וצריך לחבר מחדש.** לשמור אותו במקום שלא הולך לאיבוד.

## 3. פריסה (Vercel)

```bash
npx vercel link && npx vercel env add DATABASE_URL production   # וכן הלאה
npx vercel --prod
```

`vercel.json` כבר מגדיר את שבעת הג׳ובים של חלק ג' ואת תקרות הזמן.
**Vercel Hobby מאפשר cron יומי בלבד** — לסריקה כל 15 דקות צריך Pro, או להשתמש
ב-GitHub Actions (סעיף 5).

**PDF ב-Vercel:** אין שם דפדפן מותקן, ולכן `lib/pdf.ts` נופל אוטומטית ל-`@sparticuz/chromium-min`
(כבר מותקן) — צריך רק להצביע על חבילת הבינארי:

```
CHROMIUM_PACK_URL=https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar
```

בלי המשתנה הזה הפקת PDF תחזיר שגיאה מפורשת (המסכים `/…/print` עובדים תמיד — הדפסה
מהדפדפן). חלופה: להריץ את הג'ובים שמפיקים PDF מ-GitHub Actions, שם Playwright עובד כרגיל.

## 4. נתונים ראשונים

```bash
node --experimental-strip-types scripts/import-workbook.mjs <הקובץ.xlsx> --as-of YYYY-MM-DD
node scripts/set-pin.mjs nissim <קוד>     # וגם partners / private
```

הייבוא idempotent — ריצה חוזרת על אותו קובץ מוסיפה 0 שורות (§11.9).

ואז, במסכים:
- `/alerts` → יעדי מסירה (מייל + וואטסאפ של דן). **בלעדיהם שום התראה לא יוצאת.**
- `/settings` → יומנים, מיילים של ניסים והדס, ימי שכר/רו"ח/מע"מ, כתובת חשבונית ירוקה.
- `/anchor` → יתרת הבנק. **בלי עוגן אין תזרים ואין סגירת יום.**

## 5. Cron

**Vercel:** אוטומטי מ-`vercel.json`. אימות דרך `Authorization: Bearer $CRON_SECRET`.

**GitHub Actions** (עובד גם בתוכנית החינמית): `.github/workflows/cron.yml`.
להגדיר secrets: `APP_BASE_URL`, `JOBS_SECRET`.

**שרת משלנו:** `scripts/server-install.sh` מייצר את `/etc/cron.d/harel` **מתוך `vercel.json`** —
כל 14 הג'ובים, אותם תזמונים, בלי עותק ידני שיתיישן. לשינוי תזמון: לערוך את `vercel.json`
ולהריץ את הסקריפט שוב.

> השעות בחלק ג' הן **Asia/Jerusalem**. Vercel ו-GitHub רצים ב-UTC, ולכן הקבצים
> מכוונים ל-UTC+3 (קיץ). במעבר לשעון חורף הג׳ובים ירוצו שעה מוקדם יותר — לא מהותי,
> ואפשר להזיז.

בריאות הג׳ובים: `/settings` → "בריאות המערכת — 7 ימים".

## 6. חיבור גוגל (ב.1)

1. [Google Cloud Console](https://console.cloud.google.com) → פרויקט חדש.
2. APIs & Services → **Enable**: Gmail API, Google Calendar API, Google Drive API, Google Sheets API.
3. OAuth consent screen → **Internal** (אם יש Workspace) → scopes: המערכת מבקשת רק
   `gmail.readonly`, `gmail.send`, `gmail.modify`, `calendar.events`, `drive.file`,
   `spreadsheets`, `userinfo.email`.
4. Credentials → OAuth client ID → **Web application** → Authorized redirect URI:
   `https://<APP_BASE_URL>/api/google/callback`.
5. להעתיק את ה-Client ID וה-Secret למשתני הסביבה, ואז `/settings` → **"חבר את גוגל"**.

מרגע החיבור מתחילים לרוץ: סיכום יומי במייל (ב.4), אירועי יומן (ב.2), סריקת חשבוניות
מ-Gmail ומתיקיית "להזנה" (ב.3), והעלאת דוחות לדרייב.

## 7. אבטחה — מה עוד לא נעשה

- **שער גישה זמני:** הגדרת `APP_PASSWORD` מפעילה שער סיסמה אחד לכל האתר (`middleware.ts`).
  זה **לא** מנגנון ההרשאות של §6 — אין משתמשים, אין תפקידים, אין audit של מי נכנס.
  זו מנעולת דלת עד שלב 10. אזורי ה-PIN (ניסים, שותפים, פרייבט) ממשיכים לעבוד מעליו.
- **בלי `APP_PASSWORD` האתר פתוח לחלוטין** לכל מי שיש לו את הכתובת. חלופות ברמת
  הפלטפורמה: Vercel Password Protection (בתשלום) או Cloudflare Access.
- **RLS לא מופעל** (שלב 10). ה-`DATABASE_URL` הוא מפתח לכל הנתונים.
- `/api/jobs/*` מוגן בסוד; `/api/health` פתוח ולא חושף נתונים עסקיים.

## 8. גיבוי

**שרת משלנו:** `scripts/backup.sh` רץ מדי לילה מ-`/etc/cron.d/harel` ושומר `pg_dump`
דחוס ב-`/opt/harel/storage/backups`, 14 יום אחורה. **זה גיבוי על אותה מכונה** — אם
השרת נמחק הוא נמחק איתו. שתי שכבות חסרות (§6, שלב 9): עותק מחוץ לשרת (דרייב —
הג'וב `db_backup` כבר עושה זאת כשגוגל מחובר) ו-snapshot של הספק.

**Supabase:** גיבוי יומי אוטומטי בתוכנית Pro; בחינמית — `pg_dump` שבועי לדרייב.
