# CLAUDE.md — מערכת הכספים הפנימית של הר-אל

אתה בונה מערכת כספים פנימית לפי שלושה מסמכים מחייבים:

| מסמך | מה מגדיר |
|---|---|
| `HAREL_FINANCE_SPEC.md` | מודל הנתונים, הכללים העסקיים, המסכים, שלבי הביצוע |
| `HAREL_FINANCE_SPEC_ADDENDUM.md` | אינטגרציות Google, קליטת מסמכים, צ'קליסט ביצוע, גביה, מנוע התראות, כל האוטומציות |
| `HAREL_FINANCE_UIUX.md` | design tokens, ספריית רכיבים, wireframes, מה אסור |

## כללים (SPEC §11)

1. **הספק מחייב.** סעיפים 1, 2, 3 אינם ניתנים לפרשנות — כל סטייה דורשת אישור מפורש מדן.
2. **עבודה בשלבים לפי §9.** אין להתחיל שלב N+1 לפני שקריטריון הסיום של N עובר.
3. **כל נוסחה ב-§3 = פונקציה טהורה ב-`lib/rules` עם בדיקת יחידה.** ה-fixtures ב-§8 חייבים לעבור לשקל.
4. **כל טבלה:** `created_at`, `updated_at`, `created_by`, טריגר `audit_log`. אין `DELETE` פיזי — soft delete דרך `deleted_at`.
5. **סכומים:** `NUMERIC(14,2)`. לעולם לא float. מע"מ מחושב פעם אחת בכתיבה ונשמר.
6. **UI:** עברית RTL מלאה, מובייל-first למסכים 1, 15, 16. אין אנגלית במסך.
7. **אין מסך שמציג מספר בלי drill-down** לשורות המרכיבות אותו.
8. **תקופה נעולה:** כל `UPDATE`/`INSERT` עם `period closed` נדחה ברמת DB (trigger), לא רק ב-UI.
9. **ייבוא idempotent.** ריצה חוזרת על אותו קובץ = 0 שורות חדשות.
10. לפני כל migration הרסני — גיבוי + הודעה לדן.
11. **אין להמציא נתוני דמו כמספרים אמיתיים.** seed = הנתונים מהקובץ הקיים בלבד.
12. **בכל PR:** מה נבנה, איזה קריטריון מ-§9 הוא מקדם, מה נשאר פתוח.
13. **עיצוב לפי §5.1** (רפרנס WISE). WISE נשארת מקור האמת ללידים/לקוחות/הגשות — לא לבנות מסכי הזנה מקבילים.

## כללים (ADDENDUM חלק ד')

14. **ה-ADDENDUM מחייב כמו ה-SPEC.** חלק ג' הוא המקור היחיד לאוטומציות — אין ג'וב שלא רשום שם.
15. **גוגל:** OAuth משתמש, scopes מינימליים (ב.1), refresh token ב-Vault. **אסור לשמור סיסמאות.**
16. **כל יציאה החוצה** (מייל / וואטסאפ / אירוע יומן) עוברת דרך `outbox` עם retry ולוג — אין קריאות ישירות מהקוד העסקי.
17. **חילוץ שדות ממסמך לעולם לא הופך ל-`verified` בלי אישור אנושי.** LLM = הצעה בלבד.
18. **כל התראה ומשימה אוטומטית עם `rule_key` ייחודי** — מניעת כפילויות היא חובה, לא שיפור.
19. **סדר בניית הנספח:** ב.1 → ב.4 → ב.3 → ב.2 → ב.5+ב.6 → ב.7 → ב.8 → ב.11. משתלב **אחרי שלב 5** באפיון ולפני שלב 6.
20. **כל דוח אוטומטי = אותה פונקציה שמפיקה אותו לפי דרישה מהמסך.** אין שני מנועי דוחות.

## כללים (UIUX §10)

21. **Tailwind + shadcn/ui**, tokens מ-§2 כ-CSS variables ב-`:root` ו-`.dark`. **אין צבעים מקודדים בקומפוננטות.**
22. **קומפוננטות חובה לפני כל מסך:** `<Money>`, `<KpiCard>`, `<StatusPill>`, `<DrillDrawer>`, `<DataTable>`, `<PeriodPicker>`, `<DivisionSwitch>`, `<PinGate>`, `<StaleBadge>`, `<RiskBanner>`. כל מסך מורכב מהן בלבד.
23. **`/ui-kit`** עם כל הרכיבים בכל המצבים — נבנה בשלב 2, **לפני** המסכים.
24. **בדיקות ויזואליות:** כל מסך ב-390px, 768px, 1280px לפני PR.
25. **RTL נבדק** עם טקסט מעורב (שם ספק באנגלית בתוך משפט עברי) ועם מספרים שליליים.

## מבנה

```
lib/rules/        כל נוסחה מ-§3 ומה-ADDENDUM, כפונקציה טהורה.
                  אין I/O, אין new Date() בלי ארגומנט.
lib/import/       parsers לכל מקור: isracard, max, cal, bank_*, greeninvoice, wise
lib/match/        מנוע ההתאמה (§4.2)
db/schema/        טבלאות, אילוצים, טריגרים — לפי סדר מספרי
db/views/         כל דוח הוא view. אין נוסחאות בקוד ה-UI.
db/tests/         בדיקות שההבטחות המבניות נאכפות + זהות views ↔ lib/rules
tests/            vitest — בדיקת יחידה לכל נוסחה
scripts/          verify-db.sh, fixture-to-sql.mjs
docs/             OPEN_QUESTIONS.md, STATUS.md
```

## הרצה

```bash
npm install
npm test               # בדיקות היחידה של כל נוסחה ב-§3
npm run typecheck
./scripts/verify-db.sh # סכימה + views + 26 הבטחות מבניות + זהות מול lib/rules
```

`verify-db.sh` מרים Postgres זמני. מול DB קיים: `PGURL=postgres://… ./scripts/verify-db.sh`.

## שתי אמיתות שקל להחליף ביניהן

| | קובע מה | נמצא ב |
|---|---|---|
| **חודש התקבול** | באיזה חודש הכסף נספר כהכנסה | `transactions.date_cash` |
| **חודש התיק** (`month_attributed`) | לאילו הוצאות ישירות התיק מתקזז | `deals.month_attributed`, ברירת מחדל = חודש התקבול הראשון |

תקבול שני של תיק נספר בחודש שבו **הוא** נכנס, לא בחודש התיק (§3.4). זה התיקון לליקוי #3.

## ודאות היא צבע, לא טקסט (UIUX §1.2)

ירוק = בפועל · כחול = ודאי צפוי · כתום = פוטנציאל · אדום = פתוח/חסר/באיחור · אפור = נעול.
**קבועים בכל המערכת ולעולם לא משמשים למשהו אחר.**

## נדל"ן = כסף, לא תפעול (החלטה 3, הובהרה ע"י דן)

עסקת נדל"ן במערכת: לקוח, סכום עסקה, 2%+מע"מ שכ"ט, ~1% כולל מע"מ עמלת יזם ב-שוטף+30,
הוצאות ישירות, פוטנציאל/סגור. **אין** שלבים, צ'קליסט או הגשות לנדל"ן. ההתחשבנות
33/33/33, המשיכות וההוצאות הקבועות של נדל"ן — כן.

## הרצת ה-UI

```bash
./scripts/dev-db.sh start        # Postgres מקומי + סכימה + views + קטגוריות (בלי נתונים)
node --experimental-strip-types scripts/import-workbook.mjs <הקובץ.xlsx> --as-of YYYY-MM-DD   # הנתונים האמיתיים
cp .env.example .env.local        # DATABASE_URL
npm run dev                       # http://localhost:3000/ui-kit
npm run build && npm start && node scripts/ui-screenshots.mjs   # UIUX הנחיה 24
node scripts/e2e-import.mjs      # מסך 11 מקצה לקצה על הקבצים הסינתטיים ב-tests/fixtures/cards
node scripts/e2e-anchor.mjs      # שלב 5: עוגן מהנייד → סגירת יום → התראות → תזרים → דף הבית
node scripts/e2e-intake.mjs      # ב.3: PDF → הצעה → אישור אנושי → חשבונית + שידוך + תבנית ספק
node scripts/jobs.mjs alerts_eval   # ג'וב מחלק ג' דרך POST /api/jobs/<name> (JOBS_SECRET ב-.env.local); גם day_close, daily_summary, anchor_reminder, gmail_scan, drive_intake_scan, calendar_sync
# גוגל (ב.1): GOOGLE_CLIENT_ID/SECRET + SECRETS_KEY ב-.env.local → /settings → "חבר את גוגל"
```

## jsonb: אובייקט, לא מחרוזת

`${obj}` או `sql.json(obj)` — לעולם לא `${JSON.stringify(obj)}::jsonb` (נשמר כמחרוזת JSON,
ו-`-> 'key'` מחזיר NULL בשקט). `007_jsonb_shape.sql` דוחה את זה ב-DB.

## שתי הגדרות רווח — לא לאחד ביניהן

- **תפעולי** — מה נשאר בקופה. כל ההוצאות, כולל לא-מוכרות ולא-מאושרות.
- **לחלוקה** — הסכם השותפות. רק `deductible`, ובמימון רק `approved_by_nissim`.

כל מסך שמציג רווח חייב להכריז איזו הגדרה מוצגת (§3.2).

## העלאה לאוויר

`docs/DEPLOY.md` — Supabase, Vercel, cron, חיבור גוגל. לבדוק מוכנות:
`node scripts/preflight.mjs` (מה חוסם, מה מגביל) · `curl $APP/api/health`.

## מצב נוכחי

ראו `docs/STATUS.md`. שאלות פתוחות שחוסמות: `docs/OPEN_QUESTIONS.md`.
