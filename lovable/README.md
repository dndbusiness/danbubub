# הר-אל CRM על Lovable Cloud

אותו דף CRM שרץ ב-Claude (`crm/harel-crm.html`), מתארח ב-Lovable עם מסד Postgres משלו (Lovable Cloud / Supabase).

| קובץ | מה |
|---|---|
| `schema.sql` | טבלאות, הרשאות (RLS) ופונקציות — רץ על מסד הפרויקט ב-Lovable |
| `public/crm.html` | טוען את קוד הדף מהענף `claude/new-session-3k3pta` במאגר, ומכניס לפניו את המתאם |
| `public/crm-lovable.js` | מממש את `claude.use('db' / 'user' / 'downloads')` מול המסד, ומסך כניסה (מייל + סיסמה) |
| `test-adapter.mjs` | בדיקה: הדף האמיתי + המתאם + Postgres מקומי עם אותו SQL |

## איך זה עובד
- **מסמכים:** כמו ב-Claude — אוסף + מזהה → אובייקט (`crm_docs`). כתיבה רק דרך `crm_write` (set / update עם מיזוג ברמה העליונה ו-`{"__delete__":true}` / delete רך). קריאה: `crm_changes` אחרי `seq`, כל 3 שניות.
- **מי נכנס:** רק מי שיש לו הזמנה ב-`crm_invites` (לפי מייל). בכניסה הראשונה `crm_whoami` הופך הזמנה לחברות ב-`crm_members`.
- **הרשאות (כמו כללי ה-db בדף):** owner / admin = הכל. team = לא קורא כספים, הוצאות, שכר, פרייבט, קמפיינים ומאגר כוורת, וכותב רק לאוספי הצוות.
- **בלי DELETE פיזי:** מחיקה = `deleted_at`. כל שינוי נרשם ב-`crm_docs_history`.
- **עדכון קוד הדף:** push לענף. אין צורך לגעת ב-Lovable (raw.githubusercontent, מטמון של כמה דקות).
- **עוד לא מחובר כאן:** גוגל (Gmail / Drive / Calendar) וניתוחי Claude — הדף מסתיר את הכפתורים שתלויים בהם.

## הזמנת משתמש
```sql
insert into crm_invites (email, role, name) values ('someone@example.com', 'team', 'שם');
```
