/**
 * קובץ SQL אחד להדבקה ב-SQL editor של ספק בסיס נתונים מנוהל (Supabase וכו').
 * זו הדרך להקים את הסכימה **בלי טרמינל** — בדפדפן בלבד.
 *
 *   node scripts/build-sql-bundle.mjs > db/bundle.sql
 *
 * הסדר זהה ל-server-install.sh: סכימה לפי מספר → views → seed. בסוף מורצות
 * ההבטחות המבניות של §11, כך שהדבקה שמסתיימת בלי שגיאה = סכימה תקינה.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const files = [
  ...readdirSync('db/schema').sort().map((f) => join('db/schema', f)),
  ...readdirSync('db/views').sort().map((f) => join('db/views', f)),
  ...readdirSync('db/seed').sort().map((f) => join('db/seed', f)),
  'db/tests/000_guarantees.sql',
].filter((f) => f.endsWith('.sql'))

const out = [
  '-- ══════════════════════════════════════════════════════════════════════════',
  '-- מערכת הכספים של הר-אל — סכימה מלאה בקובץ אחד.',
  `-- נוצר אוטומטית מ-${files.length} קבצים ע"י scripts/build-sql-bundle.mjs. אין לערוך כאן.`,
  '-- להדביק ב-SQL editor של בסיס הנתונים ולהריץ פעם אחת. ריצה חוזרת בטוחה:',
  '-- הטבלאות נוצרות פעם אחת, ה-views וה-seed מתעדכנים.',
  '-- ══════════════════════════════════════════════════════════════════════════',
  '',
]
for (const f of files) {
  out.push(`-- ─── ${f} ${'─'.repeat(Math.max(0, 66 - f.length))}`, readFileSync(f, 'utf8').trimEnd(), '')
}
process.stdout.write(out.join('\n'))
