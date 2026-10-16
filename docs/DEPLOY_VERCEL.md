# העלאה ב-Vercel + Supabase — בלי טרמינל

המסלול הזה לא דורש SSH, מפתחות או שורת פקודה. הכל בדפדפן.

**מה עובד כאן ומה לא:** האפליקציה, בסיס הנתונים, ההתראות, המיילים והג'ובים —
עובדים. **הפקת PDF** דורשת `CHROMIUM_PACK_URL` (שלב 6), ו**הגיבוי היומי לדיסק**
לא רלוונטי — בסיס הנתונים המנוהל מגבה את עצמו. בשרת ייעודי הכל עובד בלי תוספות;
ראו `docs/DEPLOY.md`.

---

## 1. בסיס נתונים

1. [supabase.com](https://supabase.com) → New project. שמרו את סיסמת ה-DB.
2. בפרויקט → **SQL Editor** → New query.
3. פתחו את [`db/bundle.sql`](../db/bundle.sql) → העתיקו הכל → הדביקו → **Run**.
   זו כל הסכימה: טבלאות, אילוצים, טריגרים, views, קטגוריות, וההבטחות
   המבניות של §11. **אם הריצה נגמרה בלי ERROR — הסכימה תקינה.**
4. **Project Settings → Database → Connection string → URI**, ובתוכו להחליף
   `[YOUR-PASSWORD]` בסיסמה מסעיף 1. זה ה-`DATABASE_URL`.
   בפריסה serverless עדיף ה-**Connection pooler** (פורט 6543).

## 2. הפרויקט ב-Vercel

**Add New → Project** → לבחור את המאגר `danbubub` → **Deploy**.
הבנייה תעבור; האתר עדיין לא יעבוד עד שיוגדרו המשתנים.

## 3. משתני הסביבה

**Settings → Environment Variables**, לכל הסביבות:

| משתנה | ערך |
|---|---|
| `DATABASE_URL` | מסעיף 1.4 |
| `APP_PASSWORD` | סיסמת הכניסה למערכת |
| `JOBS_SECRET` | מחרוזת אקראית (32 בייט hex) |
| `SECRETS_KEY` | מחרוזת אקראית (32 בייט hex) — מצפינה את ה-refresh token של גוגל |
| `APP_BASE_URL` | כתובת האתר, למשל `https://danbubub.vercel.app` |
| `STORAGE_DIR` | `/tmp/storage` |
| `HAREL_REPORTS_DIR` | `/tmp/reports` |
| `HAREL_INTAKE_DIR` | `/tmp/intake` |
| `HAREL_BACKUP_DIR` | `/tmp/backups` |

שלושת נתיבי ה-`/tmp` נחוצים כי מערכת הקבצים בפריסה serverless לקריאה בלבד.

**Redeploy** אחרי השמירה — משתנים נכנסים לתוקף רק בבנייה הבאה.

## 4. הג'ובים

19 הג'ובים רצים ב-GitHub Actions, לא ב-Vercel Cron (חשבון Hobby מוגבל
ל-2 ג'ובים יומיים). ב-GitHub: **Settings → Secrets and variables → Actions**:

| Secret | ערך |
|---|---|
| `APP_BASE_URL` | אותה כתובת מסעיף 3 |
| `JOBS_SECRET` | אותו ערך מסעיף 3 |

לבדיקה: **Actions → scheduled-jobs → Run workflow** עם `alerts_eval`.

## 5. הנתונים

`/import` → **"קובץ האקסל של הר-אל"** → לבחור את הקובץ → ייבוא.
הייבוא idempotent: העלאה חוזרת של אותו קובץ לא תיצור כפילויות.

ואז `/settings` → קודי PIN לארבעת האזורים המוגנים.

## 6. מה שדורש מפתח נוסף

| חסר | מה לא עובד | איפה |
|---|---|---|
| `CHROMIUM_PACK_URL` | אין PDF (הדוחות עדיין נשלחים כ-HTML) | `docs/DEPLOY.md` §3 |
| OAuth של גוגל | אין מייל, יומן, דרייב וסריקת חשבוניות | `/settings` |
| `GREEN_API_*` | וואטסאפ ממתין ב-outbox | |
| `ANTHROPIC_API_KEY` | חילוץ מחשבונית של ספק לא מוכר לפי כללים בלבד | |

כל אחד מהם נכנס ב-Environment Variables ואז Redeploy. **שום הודעה לא הולכת
לאיבוד בינתיים** — היא ממתינה ב-`outbox` ונשלחת כשהחיבור נוצר.
