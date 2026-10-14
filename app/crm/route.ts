import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** בשלב השכפול: פס קבוע שאומר מאיזה גיבוי הנתונים, ושמה שמשנים כאן נדרס בעדכון הבא. */
async function mirrorBanner(): Promise<string> {
  const rows = await sql<{ key: string; value: unknown }[]>`select key, value from settings where key in ('crm_mode', 'crm_mirror_last')`.catch(() => [])
  const mode = rows.find((r) => r.key === 'crm_mode')?.value
  if (mode === 'live') return ''
  const last = rows.find((r) => r.key === 'crm_mirror_last')?.value as { exportedAt?: string; at?: string } | undefined
  const when = last?.exportedAt ?? last?.at
  const label = when ? new Date(when).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'עוד לא נקלט גיבוי'
  return '<div id="mirrorBar" role="status" style="position:fixed;inset-inline:0;bottom:0;z-index:9999;background:var(--expected-bg,#FFFBEB);color:var(--text,#111827);' +
    'border-top:1px solid var(--expected,#F59E0B);font:13px/1.4 Heebo,Arial,sans-serif;padding:6px 12px;text-align:center">' +
    '<b>מצב שכפול</b> · הנתונים מהגיבוי של ' + esc(label) + ' · עובדים עדיין בדף ב-Claude — מה שמשנים כאן נדרס בעדכון הבא' +
    ' · <label style="text-decoration:underline;cursor:pointer">עדכן מקובץ גיבוי<input type="file" accept=".json,.gz,application/json,application/gzip" hidden ' +
    'onchange="var f=this.files[0];if(!f)return;this.parentNode.firstChild.textContent=\'מעדכן…\';fetch(\'/api/crm/import\',{method:\'POST\',body:f}).then(function(r){return r.json()}).then(function(j){alert(j.total!=null?(\'עודכן: \'+j.written+\' רשומות השתנו, \'+j.removed+\' נמחקו\'):(j.message||\'השכפול נכשל\'));location.reload()})"></label>' +
    // המעבר: מכאן והלאה השרת הוא המקור — הפס נעלם, השכפול מהדף ב-Claude נעצר
    ' · <a href="#" style="color:inherit;font-weight:600" onclick="event.preventDefault();if(!confirm(\'לעבור לעבוד מכאן?\\nמהרגע הזה המערכת הזו היא המקור: לא מעדכנים יותר מהדף ב-Claude, וגיבוי משם לא ידרוס את מה שנעשה כאן.\\nלפני כן — לייבא את הגיבוי האחרון מהדף ב-Claude.\'))return;' +
    'fetch(\'/api/crm/mode\',{method:\'POST\',headers:{\'content-type\':\'application/json\'},body:\'{&quot;mode&quot;:&quot;live&quot;}\'}).then(function(r){if(!r.ok)throw 0;location.reload()}).catch(function(){alert(\'המעבר נכשל — נסו שוב\')})">עוברים לעבוד מכאן</a></div>'
}

/**
 * ה-CRM — אותו דף שרץ ב-Claude (crm/harel-crm.html), כאן עם crm-shim.js שמספק לו
 * את מה ש-Claude סיפק: מסד נתונים, משתמש, Gmail/Drive והורדות — מול השרת.
 */
/** מסד ריק (פריסה ראשונה): מסך אחד עם כפתור שמקים את הסכימה — /api/setup/db. */
const SETUP_PAGE = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>הר-אל — הקמה</title></head>' +
  '<body style="font:16px/1.6 Heebo,Arial,sans-serif;max-width:520px;margin:12vh auto;padding:0 16px;color:#111827;background:#F6F7F9">' +
  '<h1 style="font-size:22px">מסד הנתונים עוד לא מוקם</h1><p>המערכת מחוברת למסד ריק. לחיצה אחת מקימה את הטבלאות ובודקת שההגנות שלהן עובדות.</p>' +
  '<button id="go" style="font:inherit;padding:10px 18px;border-radius:10px;border:0;background:#111827;color:#fff;cursor:pointer">הקמת מסד הנתונים</button><p id="st" role="status"></p>' +
  '<script>document.getElementById("go").onclick=function(){var b=this,st=document.getElementById("st");b.disabled=true;st.textContent="מקים… (עד דקה)";' +
  'fetch("/api/setup/db",{method:"POST"}).then(function(r){return r.json()}).then(function(j){if(j.ok||j.code==="already_exists"){st.textContent="הוקם ✓ טוען…";location.reload()}else{st.textContent="נכשל: "+(j.message||"");b.disabled=false}})' +
  '.catch(function(){st.textContent="נכשל — בדקו חיבור ונסו שוב";b.disabled=false})}</script></body></html>'

export async function GET() {
  const [ready] = await sql<{ ok: boolean }[]>`select to_regclass('public.crm_docs') is not null as ok`.catch(() => [{ ok: true }])
  if (!ready?.ok) return new Response(SETUP_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
  const [raw, banner] = await Promise.all([readFile(join(process.cwd(), 'crm', 'harel-crm.html'), 'utf8'), mirrorBanner()])
  // מזהי התיקיות בדרייב לא בריפו (ציבורי) — נכנסים כאן מסביבת השרת. ריק = הדף משתמש ב-settings או בשורש הדרייב.
  const id = (v: string | undefined) => (v && /^[A-Za-z0-9_-]{10,80}$/.test(v) ? v : '')
  const page = raw.replace("'__CRM_BACKUP_FOLDER__'", `'${id(process.env.CRM_BACKUP_FOLDER)}'`).replace("'__CRM_SCAN_FOLDER__'", `'${id(process.env.CRM_SCAN_FOLDER)}'`)
  // בלי </head><body>: כמו המעטפת של Claude — ה-title/style/script של הדף נשארים ב-head, והגוף נפתח באלמנט הראשון שלו
  const html = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    '<link rel="manifest" href="/crm-manifest.webmanifest"><meta name="theme-color" content="#111827">' +
    '<link rel="icon" href="/crm-icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/crm-icon-192.png">' +
    '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="הר-אל">' +
    '<script src="/crm-shim.js"></script>' + page + banner
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}
