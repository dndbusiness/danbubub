# וואטסאפ ב-CRM — חיבור ל-API הרשמי של Meta

**מה זה נותן:**
- כל הודעה שלקוח שולח למספר של המשרד נכנסת ל-CRM:
  - לכרטיס הליד או הלקוח.
  - לתיבת הוואטסאפ (לידים ← 💬 וואטסאפ).
  - מספר שלא מוכר פותח ליד חדש "וואטסאפ נכנס".
- עונים מהכרטיס או מהתיבה. רואים ✓ נשלח, ✓✓ נמסר ו-✓✓ נקרא.
- תמונות ומסמכים שהלקוח שלח נפתחים מהשיחה.

**איך זה עובד מול WISE:**
- זה אותו מספר שחובר ב-WISE. WISE ממשיכה לעבוד כרגיל.
- ה-CRM נרשם כ"אפליקציה נוספת" על אותו חשבון WhatsApp Business. Meta שולחת כל הודעה נכנסת גם לו.

**כללי Meta:**
- הודעה חופשית אפשר לשלוח רק עד 24 שעות מההודעה האחרונה של הלקוח.
- אחרי 24 שעות, או ללקוח שעוד לא כתב, שולחים רק תבנית שאושרה ב-Meta. תבנית עולה כסף לפי המחירון של Meta. מוסיפים אמצעי תשלום ב-WhatsApp Manager ← Payment settings.
- ה-CRM מציג את החלון בכל שיחה, ומציע תבנית כשהוא נסגר.

---

## מה דן עושה, פעם אחת (בערך 20 דקות, ממחשב)

### 1. אפליקציה ב-Meta
1. נכנסים ל-[developers.facebook.com](https://developers.facebook.com) ← My Apps ← **Create App**.
2. סוג **Business**. שם: "הר-אל CRM".
3. בוחרים את ה-**Business portfolio** שאליו חובר הוואטסאפ ב-WISE (שלב 4 במדריך של WISE).
4. באפליקציה: **Add product** ← **WhatsApp** ← Set up. בוחרים את חשבון ה-WhatsApp Business **הקיים** — זה ש-WISE חיברה.

> אם החשבון לא מופיע ברשימה, WISE פתחה אותו תחת העסק שלה ולא תחת העסק שלך. צריך לבקש מ-WISE לשתף את החשבון (WABA) עם העסק שלך, או להעביר אותו אליו.

### 2. טוקן קבוע (משתמש מערכת)
1. [business.facebook.com](https://business.facebook.com) ← **Settings** ← Users ← **System users** ← Add.
   - שם: "crm".
   - תפקיד: Admin.
2. **Assign assets**:
   - האפליקציה "הר-אל CRM": Full control.
   - חשבון ה-WhatsApp: Full control.
3. **Generate new token**:
   - האפליקציה: הר-אל CRM.
   - Expiration: **Never**.
   - הרשאות: `whatsapp_business_messaging` ו-`whatsapp_business_management`.
4. מעתיקים את הטוקן. הוא מוצג פעם אחת בלבד.

### 3. המספרים
WhatsApp Manager ← **Phone numbers** ← המספר של המשרד:
- **Phone number ID**: מספר ארוך, לא מספר הטלפון.
- **WhatsApp Business Account ID** (WABA ID): בראש העמוד, או ב-Settings של החשבון.

### 4. הסוד של האפליקציה
באפליקציה ← **App settings** ← Basic ← **App secret** ← Show.

### 5. חמישה משתנים ב-Vercel
Vercel ← danbubub ← Settings ← **Environment Variables**. כל אחד ב-Production, מוצפן:

| שם | ערך |
|---|---|
| `WA_CLOUD_TOKEN` | הטוקן משלב 2 |
| `WA_PHONE_NUMBER_ID` | Phone number ID משלב 3 |
| `WA_WABA_ID` | WABA ID משלב 3 |
| `WA_APP_SECRET` | App secret משלב 4 |
| `WA_VERIFY_TOKEN` | מחרוזת אקראית, אותה מחרוזת גם בשלב 6. Claude ייצר לך אחת. |

אחר כך: Deployments ← Redeploy.

### 6. ה-webhook
באפליקציה ← WhatsApp ← **Configuration** ← Webhook ← Edit:
- **Callback URL**: `https://danbubub.vercel.app/api/whatsapp/webhook`
- **Verify token**: הערך של `WA_VERIFY_TOKEN`.
- ← **Verify and save**.
- ב-Webhook fields: **Subscribe** ל-`messages`.

### 7. מצב Live
- באפליקציה ← App settings ← Basic ← **Privacy policy URL**: `https://danbubub.vercel.app/privacy`
- למעלה: **App mode** ← **Live**.
- בלי זה Meta שולחת רק הודעות בדיקה.

### 8. רישום ה-CRM לחשבון
ב-CRM: לידים ← 💬 וואטסאפ ← **"רשום את ה-CRM לקבלת הודעות"** (רק דן רואה את הכפתור).

### 9. בדיקה
- שולחים הודעה מטלפון אחר למספר של המשרד.
- תוך כמה שניות היא מופיעה ב-CRM, בתיבה ובכרטיס.
- עונים משם, והתשובה מגיעה לטלפון.

---

## בעיות נפוצות
| מה רואים | למה |
|---|---|
| "וואטסאפ עוד לא מחובר בשרת" | חסר `WA_CLOUD_TOKEN` או `WA_PHONE_NUMBER_ID`, או שלא עשו Redeploy |
| הודעות יוצאות עובדות, נכנסות לא מגיעות | אחד מאלה: ה-webhook לא נשמר (שלב 6), האפליקציה לא ב-Live (שלב 7), לא נרשמה לחשבון (שלב 8), או חסר `WA_APP_SECRET` |
| "עברו 24 שעות…" | שולחים תבנית. יוצרים אותה ב-WhatsApp Manager ← Message templates, ומחכים לאישור של Meta |
| "הטוקן של וואטסאפ לא תקף" | הטוקן נוצר עם תוקף, או שהוחלף. יוצרים חדש בשלב 2 עם Expiration: Never |

## בקוד
- הכללים: `lib/rules/wa-cloud.ts`. ה-CRM: `lib/crm/whatsapp.ts`. התחבורה: `lib/outbox/wa-cloud.ts`.
- כל שליחה עוברת דרך תיבת היוצא (הנחיה 16).
- הנתיבים:
  - `app/api/whatsapp/webhook`: ציבורי, חתום ב-`X-Hub-Signature-256`.
  - `app/api/crm/whatsapp`: שליחה, תבניות ורישום.
  - `app/api/crm/whatsapp/media`.
- בדיקה מקצה לקצה עם Meta מדומה: `node scripts/e2e-whatsapp.mjs`.
