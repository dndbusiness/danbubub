# ההעלאה לאוויר — מה להדביק

שתי דרכים. בשתיהן **אתה לא מקליד פקודות בעצמך** — או שאני מריץ מהמחשב שלך,
או ש-Claude Code מריץ.

---

## 0. הדרך הקצרה — קונסולה בדפדפן, בלי SSH ובלי מפתחות

בקונסולת השרת של ספק הענן (`>_` בעמוד השרת), אחרי `login: root`:

```bash
curl -fsSL https://raw.githubusercontent.com/dndbusiness/danbubub/claude/new-session-3k3pta/scripts/bootstrap.sh | bash
```

הסקריפט שואל דומיין (Enter = בלי), סיסמת כניסה (נקראת בלי הד למסך), נייד ומייל,
ואז מוריד את הקוד ומריץ את ההתקנה. **הערכים לא מודבקים בשורת הפקודה** — בקונסולה
של ספק ענן היא נשמרת בהיסטוריה ולעיתים גם בלוג שלו.

ריצה חוזרת של אותה שורה = עדכון גרסה: מושך את הקוד החדש ומריץ שוב. `.env.local`
לא במעקב גיט ולכן הסודות נשמרים.

---

## א. Claude Code על המחשב שלך

פותחים טרמינל בתיקיית הפרויקט (או בכל תיקייה — הוא יעשה `git clone`), מריצים
`claude`, ומדביקים את הבלוק הזה:

```
תעלה את מערכת הכספים של הר-אל לשרת שלי.

השרת: 5.75.153.167 · Ubuntu 24.04 נקייה · root · מפתח SSH harel-dan-laptop
הריפו: https://github.com/dndbusiness/danbubub · הענף claude/new-session-3k3pta
דומיין: <הדומיין שלי, או "אין">

מה לעשות, לפי הסדר:
1. ssh root@5.75.153.167 ולוודא שהשרת עונה ושיש בו לפחות 10GB פנויים.
2. git clone -b claude/new-session-3k3pta https://github.com/dndbusiness/danbubub /opt/harel
3. אם יש דומיין: לוודא שרשומת A מצביעה ל-5.75.153.167 (dig +short <דומיין>), ואז:
   DOMAIN=<דומיין> APP_PASSWORD='<הסיסמה שלי>' \
   NOTIFY_WHATSAPP=<הנייד שלי> NOTIFY_EMAIL=<המייל שלי> \
   /opt/harel/scripts/server-install.sh
   אם אין דומיין: להריץ בלי DOMAIN, אבל להגיד לי במפורש שהתעבורה בגלוי
   ושצריך להריץ שוב עם DOMAIN= ברגע שתהיה רשומת A.
4. אחרי ההתקנה: curl -fsS localhost:3000/api/health ו-node /opt/harel/scripts/preflight.mjs
   ולהראות לי את הפלט.
5. להעתיק לשרת את קובץ האקסל שאני אתן (scp) ולהריץ:
   cd /opt/harel && node --experimental-strip-types scripts/import-workbook.mjs <הקובץ> --as-of <היום>
6. להגדיר קודי PIN: node scripts/set-pin.mjs nissim ****, וכנ"ל partners ו-private.
   (יעדי המסירה והסיסמה כבר הוגדרו בשלב 3 — לא צריך להזין אותם במסך.)
7. להדפיס לי: הכתובת, סיסמת הכניסה הזמנית (APP_PASSWORD מתוך /opt/harel/.env.local),
   ומה עוד חסר לפי preflight.

חשוב: הסקריפט server-install.sh הוא idempotent — מותר להריץ אותו שוב.
אל תמציא ערכים; מה שחסר — תשאל אותי.
```

---

## ב. מהשיחה הזו, אם תחבר את המחשב

באפליקציית Claude לדסקטופ → "Link to this computer". מאותו רגע יש לי טרמינל
אצלך ואני מריץ את אותם שלבים בעצמי, ומדווח תוך כדי.

---

## מה הסקריפט עושה (כדי שתדע מה רץ אצלך)

`scripts/server-install.sh`, כ-root, על השרת:

| | |
|---|---|
| מתקין | Postgres 16 · Node 22 · Caddy · Chromium ל-PDF |
| DB | יוצר משתמש ובסיס נתונים, מריץ סכימה לפי סדר מספרי (**כל קובץ פעם אחת**, נרשם ב-`schema_migrations`), מרענן views ו-seed, ו**עוצר אם ההבטחות המבניות של §11 לא עוברות** |
| סודות | `JOBS_SECRET`, `SECRETS_KEY`, `APP_PASSWORD` — נוצרים פעם אחת ונשמרים ב-`/opt/harel/.env.local` (600). ריצה חוזרת לא דורסת אותם, **אלא אם** מוסרים `APP_PASSWORD=` במפורש — ואז הסיסמה מוחלפת וכל מי שמחובר מנותק |
| יעדי מסירה | `NOTIFY_WHATSAPP` (05… מומר ל-972…) ו-`NOTIFY_EMAIL` נכתבים ל-`settings`. בלעדיהם שום התראה לא יוצאת (ב.11) |
| שירות | `systemd` יחידה `harel`, רסטרט אוטומטי |
| HTTPS | Caddy עם תעודה אוטומטית כשיש `DOMAIN`; בלעדיו HTTP על ה-IP **עם אזהרה מפורשת** |
| ג'ובים | 19 הג'ובים של חלק ג' ל-`/etc/cron.d/harel`, **נוצרים מ-`vercel.json`** — מקור אחד לתזמונים |
| אבטחה | `ufw`: 22, 80, 443 בלבד. Postgres מקומי, לא חשוף |
| גיבוי | `pg_dump` יומי ל-`/opt/harel/storage/backups`, 14 יום אחורה |

**עדכון גרסה אחרי זה:** `cd /opt/harel && git pull && ./scripts/server-install.sh`.

## מה לא יעבוד עד שתיתן אותו

| חסר | מה לא עובד |
|---|---|
| **דומיין + רשומת A** | אין HTTPS — סיסמה, קודי PIN ונתוני בנק עוברים בגלוי |
| **OAuth client של גוגל** | אין מייל יוצא, אין יומן, אין דרייב, אין סריקת חשבוניות. הכול ממתין ב-`outbox` ונשלח ברגע שמתחברים |
| **`GREEN_API_ID_INSTANCE` + `GREEN_API_TOKEN`** | התראות ותזכורות גביה בוואטסאפ ממתינות ב-outbox |
| **מייל הרו"ח** | דוחות מופקים ונרשמים אבל לא יוצאים אליו |
| **`ANTHROPIC_API_KEY`** | חילוץ מחשבונית של ספק לא מוכר נשאר לפי כללים בלבד (ב.3) |

כל אחד מהם נכנס ב-`/opt/harel/.env.local` ואז `systemctl restart harel` — או במסך
ההגדרות, למה שנשמר ב-DB.
