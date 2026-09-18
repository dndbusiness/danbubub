/**
 * בדיקת מוכנות לעלייה לאוויר — מה כבר עובד, מה חסם, ומה רק מגביל.
 *   node scripts/preflight.mjs            # מול .env.local וה-DB שבו
 *   BASE_URL=https://… node scripts/preflight.mjs
 *
 * לא משנה כלום. רק בודק ומדווח.
 */
import { readFileSync, existsSync } from 'node:fs'
import postgres from 'postgres'

if (existsSync('.env.local')) for (const line of readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2] }

const R = { block: [], limit: [], ok: [] }
const block = (m, how) => R.block.push({ m, how })
const limit = (m, how) => R.limit.push({ m, how })
const ok = (m) => R.ok.push(m)

// ── סביבה ──────────────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) block('DATABASE_URL לא מוגדר', 'Supabase → Connection string (pooler), או ./scripts/dev-db.sh start')
else ok('DATABASE_URL מוגדר')

if (!process.env.JOBS_SECRET && !process.env.CRON_SECRET) block('אין JOBS_SECRET / CRON_SECRET', 'openssl rand -hex 32 → משתנה סביבה; בלעדיו כל אחד יכול להריץ ג׳ובים')
else ok('הג׳ובים מוגנים בסוד')

if (!process.env.SECRETS_KEY) block('SECRETS_KEY לא מוגדר', 'openssl rand -hex 32 — בלעדיו אי אפשר לשמור refresh token של גוגל (הנחיה 15)')
else ok('SECRETS_KEY מוגדר')

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) limit('גוגל לא מוגדר', 'Google Cloud Console → OAuth client; בלעדיו: אין מייל, יומן, דרייב וסריקת חשבוניות')
else ok('מפתחות OAuth של גוגל מוגדרים')

if (!process.env.GREEN_API_ID_INSTANCE || !process.env.GREEN_API_TOKEN) limit('Green-API לא מוגדר', 'בלעדיו התראות וואטסאפ ותזכורות גביה ממתינות ב-outbox')
else ok('Green-API מוגדר')

if (!process.env.ANTHROPIC_API_KEY) limit('ANTHROPIC_API_KEY לא מוגדר', 'בלעדיו חילוץ חשבונית של ספק לא מוכר נשאר לפי כללים בלבד (ב.3)')
else ok('חילוץ LLM לחשבוניות זמין')

if (!process.env.APP_BASE_URL) limit('APP_BASE_URL לא מוגדר', 'הקישורים במיילים, בוואטסאפ וביומן יצאו יחסיים')
else ok(`APP_BASE_URL = ${process.env.APP_BASE_URL}`)

// ── DB ─────────────────────────────────────────────────────────────────────
if (process.env.DATABASE_URL) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5 })
  try {
    const [{ tables, views }] = await sql`
      select (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as tables,
             (select count(*)::int from information_schema.views where table_schema='public') as views`
    if (tables < 40) block(`בסכימה יש ${tables} טבלאות בלבד`, 'להריץ את db/schema/*.sql ו-db/views/*.sql לפי הסדר')
    else ok(`סכימה: ${tables} טבלאות, ${views} views`)

    const [{ n: txs }] = await sql`select count(*)::int as n from transactions where deleted_at is null`
    if (txs === 0) block('אין תנועות ב-DB', 'node --experimental-strip-types scripts/import-workbook.mjs <הקובץ.xlsx> --as-of YYYY-MM-DD')
    else ok(`${txs} תנועות`)

    const [{ n: accounts }] = await sql`select count(*)::int as n from accounts where type='bank' and active and deleted_at is null`
    if (accounts === 0) block('אין חשבון בנק פעיל', 'בלעדיו אין עוגן, אין תזרים ואין סגירת יום')
    else ok('חשבון בנק פעיל קיים')

    const [{ n: pins }] = await sql`select count(*)::int as n from settings where key like 'pin_hash_%'`
    if (pins === 0) block('לא הוגדר PIN לאזורים המוגנים', 'node scripts/set-pin.mjs nissim <קוד>  (וגם partners / private)')
    else ok(`${pins} אזורים מוגנים ב-PIN`)

    const [{ n: anchors }] = await sql`select count(*)::int as n from balances where deleted_at is null`
    if (anchors === 0) limit('לא הוזן אף עוגן', 'מסך /anchor — בלי עוגן אין תזרים ואין סגירת יום')
    else {
      const [{ last }] = await sql`select to_char(max(date),'YYYY-MM-DD') as last from balances where deleted_at is null`
      const days = Math.round((Date.now() - Date.parse(last)) / 86_400_000)
      if (days > 2) limit(`העוגן האחרון מלפני ${days} ימים (${last})`, 'להזין יתרה ב-/anchor')
      else ok(`עוגן עדכני (${last})`)
    }

    const [{ dan, nissim }] = await sql`
      select (select count(*)::int from settings where key in ('notify_email_dan','notify_whatsapp_dan')) as dan,
             (select count(*)::int from settings where key = 'notify_email_nissim') as nissim`
    if (dan === 0) block('אין יעדי מסירה לדן', 'מסך /alerts — מייל ו/או וואטסאפ; בלעדיהם שום התראה לא יוצאת')
    else ok('יעדי מסירה לדן מוגדרים')
    if (nissim === 0) limit('אין מייל לניסים', 'מסך /settings — נדרש לאירועי היומן של ב.2')

    const [{ n: google }] = await sql`select count(*)::int as n from integrations where provider='google' and status='connected' and deleted_at is null`
    if (google === 0) limit('גוגל לא מחובר', '/settings → "חבר את גוגל"')
    else ok('גוגל מחובר')

    const [{ n: openPeriods }] = await sql`select count(*)::int as n from periods where status='closed' and deleted_at is null`
    ok(`${openPeriods} תקופות סגורות`)

    const jobs = await sql`select job_name, max(started_at)::text as last from scheduled_jobs_log where started_at > now() - interval '48 hours' group by job_name`
    if (jobs.length === 0) limit('אף ג׳וב לא רץ ב-48 השעות האחרונות', 'cron: vercel.json או .github/workflows/cron.yml')
    else ok(`${jobs.length} ג׳ובים רצו ב-48 שעות`)
  } catch (e) {
    block(`חיבור ל-DB נכשל: ${e.message}`, 'לבדוק DATABASE_URL ורשת')
  } finally { await sql.end({ timeout: 5 }) }
}

// ── שרת חי ─────────────────────────────────────────────────────────────────
if (process.env.BASE_URL) {
  try {
    const res = await fetch(`${process.env.BASE_URL}/api/health`)
    const body = await res.json()
    if (res.ok) ok(`/api/health עונה: ${body.status}`)
    else limit(`/api/health מחזיר ${res.status}`, JSON.stringify(body).slice(0, 120))
  } catch (e) { limit('השרת לא עונה', e.message) }
}

// ── פלט ────────────────────────────────────────────────────────────────────
const line = (s) => console.log(s)
line('')
line(`✓ עובד (${R.ok.length})`)
for (const m of R.ok) line(`   ✓ ${m}`)
if (R.block.length) { line(''); line(`✗ חוסם עלייה לאוויר (${R.block.length})`); for (const b of R.block) line(`   ✗ ${b.m}\n     → ${b.how}`) }
if (R.limit.length) { line(''); line(`⚠ עובד אבל מוגבל (${R.limit.length})`); for (const b of R.limit) line(`   ⚠ ${b.m}\n     → ${b.how}`) }
line('')
line(R.block.length ? `✗ ${R.block.length} חסמים — המערכת לא מוכנה לעלות.` : '✓ אין חסמים. המערכת יכולה לעלות לאוויר.')
process.exit(R.block.length ? 1 : 0)
