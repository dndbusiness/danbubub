/**
 * מעתיק את דף ה-CRM מ-Claude לריפו (crm/harel-crm.html), בלי מזהי התיקיות של דן בדרייב:
 * הריפו ציבורי, ובתיקיית הגיבויים יש עותק מלא של הנתונים. המזהים נכנסים בזמן ההגשה
 * מ-CRM_BACKUP_FOLDER / CRM_SCAN_FOLDER בסביבת השרת (app/crm/route.ts).
 *
 *   node scripts/crm-page-import.mjs <harel-crm.html מה-artifact>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2]
if (!src) { console.error('שימוש: crm-page-import.mjs <harel-crm.html>'); process.exit(1) }
let html = readFileSync(src, 'utf8')
const subs = [
  [/const DRIVE_FOLDER = '[^']*'/, "const DRIVE_FOLDER = '__CRM_BACKUP_FOLDER__'"],
  [/const SCAN_ROOT = '[^']*'/, "const SCAN_ROOT = '__CRM_SCAN_FOLDER__'"],
]
for (const [re, to] of subs) {
  if (!re.test(html)) { console.error('לא נמצא בדף: ' + re); process.exit(1) }
  html = html.replace(re, to)
}
const leak = html.match(/'1[A-Za-z0-9_-]{30,}'/g)
if (leak) { console.error('נשארו מזהי דרייב בדף: ' + leak.join(', ')); process.exit(1) }
writeFileSync('crm/harel-crm.html', html)
console.log('✓ crm/harel-crm.html עודכן (' + html.length + ' תווים)')
