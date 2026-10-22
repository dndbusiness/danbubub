/**
 * בדיקת קצה-לקצה — ציר תיק משכנתא לפי דן (18/10):
 *   מכירה (ניסים) → איסוף מסמכים (הדס) + תיאום שמאי (ניסים) → בדיקת מסמכים (דן; "החזר להדס עם הערה") → תוכנית ותמהיל → הכנה להגשה (דן)
 *   → הגשה טכנית (הדס) → אישור ההגשה בלי שליחה (דן) → שליחה (הדס) → מעקב אישור (הדס) → השלמות (הדס) + שליחת השמאי (ניסים)
 *   → שמאות (ניסים) → ביטוחים (דן) … · "צריך את דן" · אחראי לשלב מההגדרות · תיק ישן בשלב "אישור עקרוני" ממשיך ב"מעקב אישור".
 *   "אישרתי לאחרונה" (דן 19/10): ביטול אישור הגשה · החזרה לתיקון אחרי שליחה · שחזור מחיקה · החזרת שלב אחורה.
 * נתונים סינתטיים בלבד. מנקה אחריו.
 *
 *   BASE_URL=http://localhost:3000 CHROMIUM=/opt/pw-browsers/chromium node scripts/e2e-pipeline.mjs
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import postgres from 'postgres'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}
const url = process.env.DATABASE_URL || env.DATABASE_URL
if (!url) { console.error('DATABASE_URL לא מוגדר'); process.exit(1) }
const sql = postgres(url, { max: 1, onnotice: () => {} })
const step = (s) => console.log(`→ ${s}`)
const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); throw new Error(m) } console.log(`✓ ${m}`) }
const CID = 'e2e-pipe-client', OLD = 'e2e-pipe-old', APR = 'e2e-pipe-approval', LID = 'e2e-pipe-lead', DEL = 'e2e-pipe-del'

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p0 = Buffer.from(JSON.stringify({ k: 'dan', r: 'owner', d: ['finance', 'realestate'], l: 'דן', e: Date.now() + 36e5 })).toString('base64url')
await ctx.addCookies([{ name: 'harel_crm_user', value: encodeURIComponent(p0 + '.' + createHmac('sha256', 'harel-crm-user-v1:' + (env.SECRETS_KEY || env.APP_PASSWORD || '')).update(p0).digest('base64url')), url: BASE }])
const page = await ctx.newPage()
await page.addInitScript(() => { sessionStorage.setItem('harel-unlock', String(Date.now() + 36e5)); sessionStorage.setItem('harel-user', JSON.stringify({ resp: 'dan', label: 'דן' })) })
const pageErrs = []; page.on('pageerror', (e) => pageErrs.push(e.message))
let prompts = []; page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? prompts.shift() ?? '' : undefined))
let ownersBefore = null
const client = (extra = {}) => ({ id: CID, name: 'לקוח צנרת בדיקה', phone: '0500000000', division: 'finance', product: 'mortgage', status: 'open', stage: 'signed_collecting_docs',
  checklist: [{ label: 'תלושי שכר', status: 'pending' }, { label: 'עו״ש 3 חודשים', status: 'done' }], submissions: [], log: [], ...extra })
const tasksOf = (cid) => page.evaluate((id) => live(S.tasks).filter((t) => t.clientId === id).map((t) => ({ key: String(t.procKey || '').split(':').slice(1).join(':'), resp: t.resp, status: t.status, priority: t.priority, notes: t.notes || '', title: t.title })), cid)
const open = async (cid, key) => (await tasksOf(cid)).filter((t) => t.status !== 'done' && t.key === key)
const cur = (cid) => page.evaluate((id) => procCur(S.clients.get(id)), cid)
const waitStep = (cid, key) => page.waitForFunction(([id, k]) => S.clients.get(id) && procCur(S.clients.get(id)) === k, [cid, key], { timeout: 10000 })
const next = async () => { await page.click('[data-procnext]'); }
/* הצעד מתעדכן לפני שהמשימות נכתבות — מחכים למשימה הפתוחה של השלב ולסגירת הקודמת */
const settle = (cid, key, closed = []) => page.waitForFunction(([id, k, cl]) => { const T = live(S.tasks).filter((t) => t.clientId === id && t.status !== 'done'), has = (x) => T.some((t) => t.procKey === id + ':' + x);
  return (!k || has(k)) && cl.every((x) => !has(x)) }, [cid, key, closed], { timeout: 10000 }).catch(() => {})
try {
  await sql`update crm_docs set deleted_at = now() where coll = 'tasks' and data->>'clientId' in (${CID}, ${OLD}) and deleted_at is null`
  for (const [id, d] of [[CID, client()], [OLD, { ...client(), id: OLD, name: 'תיק ישן', stage: 'approved_in_principle', proc: { type: 'mortgage', step: 'principle' } }]])
    await sql`insert into crm_docs (coll, doc_id, data) values ('clients', ${id}, ${sql.json(d)}) on conflict (coll, doc_id) do update set data = excluded.data, deleted_at = null`
  await page.goto(BASE + '/crm?key=' + encodeURIComponent(env.APP_PASSWORD || ''))
  await page.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 60000 })
  ownersBefore = await page.evaluate(() => S.settings.procOwners || null)
  await page.evaluate(() => write('settings/main', { procOwners: {} }, 'update'))

  step('תיק ישן בשלב "אישור עקרוני" — ממשיך ב"מעקב אישור"')
  assert(await cur(OLD) === 'tracking', 'principle → tracking')

  step('ניסים מסיים מכירה → הדס: איסוף מסמכים · ניסים: תיאום שמאי')
  await page.evaluate((id) => procFromSale(id), CID); await waitStep(CID, 'docs')
  const d1 = await open(CID, 'docs'), a1 = await open(CID, 'apprPre')
  assert(d1.length === 1 && d1[0].resp === 'hadas' && d1[0].notes.includes('תלושי שכר'), 'משימת איסוף מסמכים להדס, עם החסרים')
  assert(a1.length === 1 && a1[0].resp === 'nissim', 'משימת תיאום שמאי לניסים מהיום הראשון')
  await page.evaluate((id) => go('client', id), CID); await page.waitForSelector('[data-procnext]')
  if (process.env.E2E_OUT) await page.screenshot({ path: path.join(process.env.E2E_OUT, 'pipeline-docs@1280.png'), fullPage: false })

  step('הדס מסיימת → דן: בדיקת המסמכים · "החזר להדס עם הערה"')
  await next(); await waitStep(CID, 'docsReview'); await settle(CID, 'docsReview', ['docs'])
  assert((await open(CID, 'docs')).length === 0 && (await open(CID, 'docsReview'))[0]?.resp === 'dan', 'משימת הדס נסגרה, משימה לדן נפתחה')
  prompts.push('תלוש אוגוסט לא קריא'); await page.click('[data-act="procDocsBack"]'); await waitStep(CID, 'docs'); await settle(CID, 'docs', ['docsReview'])
  const d2 = await open(CID, 'docs')
  assert(d2.length === 1 && d2[0].notes.startsWith('↩ תלוש אוגוסט לא קריא'), 'חזר להדס, וההערה בראש המשימה')

  step('"צריך את דן" — משימה לדן, התיק נשאר בשלב')
  prompts.push('הלקוח שואל על גרייס'); await page.click('[data-act="procAskDan"]')
  await page.waitForFunction((id) => live(S.tasks).some((t) => t.clientId === id && String(t.procKey).includes(':ask:')), CID)
  const ask = (await tasksOf(CID)).find((t) => t.key.startsWith('ask:'))
  assert(ask.resp === 'dan' && ask.priority === 'high' && ask.notes === 'הלקוח שואל על גרייס' && await cur(CID) === 'docs', 'שאלה לדן, השלב לא זז')

  step('docs → docsReview → analysis → prep → submitTech (הדס)')
  for (const k of ['docsReview', 'analysis', 'prep', 'submitTech']) {
    /* דן 20/10: בלי "הנחיות להגשה" לא עוברים מהכנה להגשה */
    if (k === 'submitTech') await page.evaluate(async (id) => { const c = S.clients.get(id); await write('clients/' + id, { proc: { ...c.proc, prep: { ...((c.proc || {}).prep || {}), note: 'בנק בדיקה — 400 אלף, פריים + קבועה' } } }, 'update') }, CID)
    if (k === 'submitTech') await page.waitForFunction((id) => procNote(S.clients.get(id), 'prep'), CID)
    await next(); await waitStep(CID, k); await settle(CID, k) }
  const t5 = await open(CID, 'submitTech')
  assert(t5[0]?.resp === 'hadas', 'הגשה טכנית אצל הדס')

  step('הגשה פנימית → דן מאשר מסמכים (עוברים ל"מאושר לשליחה") → הדס שולחת רק משם → מעקב אישור')
  /* דרייב ו-Gmail מדומים בדף: נרשמת כל קריאה, כדי לבדוק מה זז לאן ומה יצא במייל */
  await page.evaluate((cid) => { window.__calls = []; S.mcp = { callTool: async (srv, tool, input) => { window.__calls.push({ srv, tool, input })
    if (tool === 'search_files') { const q = String(input.query || ''); return { files: q.includes("'appr-root'") ? [] : q.includes("'fold-1'") ? [{ id: 'f1', title: 'תלוש.pdf', mimeType: 'application/pdf' }] : [] } }
    if (tool === 'create_file') return { id: 'appr-root' }
    if (tool === 'download_file_content') return { content: btoa('%PDF-1.4 test'), mimeType: 'application/pdf' }
    return {} } }
    return write('clients/' + cid, { driveFolder: 'client-root' }, 'update') }, CID)
  await page.evaluate(async ([cid, aid]) => { await write('approvals/' + aid, { id: aid, kind: 'submission', clientId: cid, division: 'finance', label: 'הגשה לבנק בדיקה — לקוח', bank: 'בנק בדיקה', to: ['bank@example.com'], files: [{ id: 'f1', title: 'תלוש.pdf' }], folderId: 'fold-1', by: S.me.id, byResp: 'hadas', at: stamp(), status: 'pending' }); await procReach(cid, 'submitApprove') }, [CID, APR])
  await waitStep(CID, 'submitApprove'); await settle(CID, 'submitApprove', ['submitTech'])
  assert((await open(CID, 'submitApprove'))[0]?.resp === 'dan', 'אישור ההגשה — משימה לדן')
  await page.evaluate(() => go('home')); await page.waitForSelector(`[data-approkonly="${APR}"]`, { timeout: 10000 })
  await page.click(`[data-approkonly="${APR}"]`); await waitStep(CID, 'submit'); await settle(CID, 'submit', ['submitApprove'])
  const ap = await page.evaluate((id) => S.approvals.get(id), APR)
  assert(ap.status === 'approved' && ap.noSend && !ap.sentAt, 'אושר בלי שליחה')
  const mv = await page.evaluate(() => window.__calls.filter((x) => x.tool === 'update_file' || x.tool === 'create_file').map((x) => x.input))
  assert(mv.some((x) => x.title === 'מאושר לשליחה' && x.parentId === 'client-root') && mv.some((x) => x.fileId === 'fold-1' && x.parentId === 'appr-root' && /מאושר לשליחה/.test(x.title)) && ap.approvedFolderId === 'fold-1',
    'תיקיית ההגשה עברה לתוך "מאושר לשליחה" בתיקיית הלקוח')

  step('"אישרתי לאחרונה" בלוח: ביטול האישור → חוזר ל"ממתין לאישורך", והתיק לאישור ההגשה')
  // דן 21/10: "אישרתי לאחרונה" סגור בריבוע — נפתח בלחיצה
  await page.evaluate(() => { S.f.myDoneOpen = false; go('home') }); await page.waitForSelector('details[data-mydone]', { timeout: 10000 })
  assert(!(await page.locator(`[data-myundo="sub:${APR}"]`).isVisible()), '"אישרתי לאחרונה" סגור — השורות לא מוצגות עד שלוחצים')
  await page.click('details[data-mydone] > summary'); await page.waitForSelector(`[data-myundo="sub:${APR}"]`, { timeout: 10000 })
  await page.click(`[data-myundo="sub:${APR}"]`); await waitStep(CID, 'submitApprove'); await settle(CID, 'submitApprove', ['submit'])
  assert((await page.evaluate((id) => S.approvals.get(id).status, APR)) === 'pending', 'ההגשה חזרה להמתנה')
  assert(await page.evaluate(() => window.__calls.some((x) => x.tool === 'update_file' && x.input.fileId === 'fold-1' && x.input.parentId === 'client-root')) && !(await page.evaluate((id) => S.approvals.get(id).approvedFolderId, APR)), 'התיקייה יצאה מ"מאושר לשליחה"')
  await page.evaluate(() => { window.__calls = [] })
  await page.waitForSelector(`[data-approkonly="${APR}"]`, { timeout: 10000 })
  assert(await page.waitForSelector(`[data-myundo="sub:${APR}"]`, { state: 'detached', timeout: 10000 }).then(() => true, () => false), 'יצאה מ"אישרתי לאחרונה"')
  await page.click(`[data-approkonly="${APR}"]`); await waitStep(CID, 'submit'); await settle(CID, 'submit', ['submitApprove'])
  assert((await page.evaluate((id) => S.approvals.get(id), APR)).noSend, 'אושר שוב')
  assert((await open(CID, 'submit'))[0]?.resp === 'hadas', 'שליחה — משימה להדס')
  await page.evaluate((id) => go('client', id), CID); await page.waitForSelector(`[data-subsend="${APR}"]`)
  assert(true, 'בכרטיס: "שלח עכשיו" להגשה שאושרה')
  if (process.env.E2E_OUT) await page.screenshot({ path: path.join(process.env.E2E_OUT, 'pipeline-submit@1280.png') })
  /* קובץ שהוצא מהתיקייה — לא שולחים */
  await page.evaluate(() => { const t = S.mcp.callTool; S.mcp._t = t; S.mcp.callTool = async (srv, tool, input) => tool === 'search_files' ? (window.__calls.push({ srv, tool, input }), { files: [] }) : t(srv, tool, input) })
  await page.click(`[data-subsend="${APR}"]`); await page.waitForTimeout(800)
  assert(!(await page.evaluate(() => window.__calls.some((x) => x.tool === 'send_message'))) && !(await page.evaluate((id) => S.approvals.get(id).sentAt, APR)), 'קובץ שלא בתיקיית "מאושר לשליחה" — לא נשלח כלום')
  await page.evaluate(() => { S.mcp.callTool = S.mcp._t })
  await page.click(`[data-subsend="${APR}"]`)
  await page.waitForFunction((id) => S.approvals.get(id).sentAt, APR, { timeout: 10000 })
  const sent = await page.evaluate(() => window.__calls.filter((x) => x.tool === 'send_message').map((x) => x.input))
  assert(sent.length === 1 && sent[0].to.includes('bank@example.com') && (sent[0].cc || []).some((x) => /^finance@/.test(x)) && sent[0].attachments.length === 1 && sent[0].attachments[0].filename === 'תלוש.pdf' && atob(sent[0].attachments[0].content).startsWith('%PDF'),
    'המייל לגוף: הנמען, finance@ בעותק, והקובץ מתיקיית "מאושר לשליחה"')
  await waitStep(CID, 'tracking'); await settle(CID, 'tracking', ['submit'])
  const tr = await open(CID, 'tracking')
  assert(tr[0]?.resp === 'hadas' && (await open(CID, 'submit')).length === 0, 'מעקב אישור — משימה להדס, השליחה נסגרה')

  step('הגשה שנשלחה — "החזר לתיקון" מהלוח: משימה להדס, התיק לא זז')
  await page.evaluate(() => go('home')); await page.waitForSelector(`[data-myundo="fix:${APR}"]`, { timeout: 10000 })
  prompts.push('חסר עמוד 2 בתלוש'); await page.click(`[data-myundo="fix:${APR}"]`)
  await page.waitForFunction(([id, aid]) => live(S.tasks).some((t) => t.procKey === id + ':subfix:' + aid && t.status !== 'done'), [CID, APR], { timeout: 10000 })
  const fx = (await tasksOf(CID)).find((t) => t.key === 'subfix:' + APR)
  assert(fx.resp === 'hadas' && fx.priority === 'high' && fx.notes.includes('חסר עמוד 2 בתלוש') && await cur(CID) === 'tracking', 'משימת תיקון להדס, התיק נשאר במעקב')
  assert(await page.waitForSelector(`[data-myundo="fix:${APR}"]`, { state: 'detached', timeout: 10000 }).then(() => true, () => false), 'יצאה מ"אישרתי לאחרונה"')

  step('מחיקה שאישרתי — "שחזר"')
  await page.evaluate(async ([lid, did]) => { await write('leads/' + lid, { id: lid, name: 'ליד מחיקה בדיקה', phone: '0500000001', division: 'finance', stage: 'new', createdAt: stamp(), log: [] })
    await write('approvals/' + did, { id: did, kind: 'delete', coll: 'leads', docId: lid, label: 'ליד: ליד מחיקה בדיקה', division: 'finance', by: S.me.id, byResp: 'hadas', at: stamp(), status: 'pending' }); await decideApproval(did, true) }, [LID, DEL])
  await page.waitForFunction((lid) => S.leads.get(lid) && S.leads.get(lid).deletedAt, LID); await page.evaluate(() => render())
  await page.waitForSelector(`[data-myundo="del:${DEL}"]`, { timeout: 10000 }); await page.click(`[data-myundo="del:${DEL}"]`)
  await page.waitForFunction((lid) => S.leads.get(lid) && !S.leads.get(lid).deletedAt, LID, { timeout: 10000 })
  assert(await page.waitForFunction((id) => S.approvals.get(id).status === 'restored', DEL, { timeout: 10000 }).then(() => true, () => false), 'הליד שוחזר, הבקשה מסומנת "שוחזר"')
  await page.evaluate((id) => go('client', id), CID); await page.waitForSelector('[data-procnext]')

  step('אישור עקרוני → השלמות (הדס) + שליחת השמאי (ניסים)')
  /* השמאי שנבחר בסקר השמאים נשמר ב-appr.appraiser — המשימה של ניסים צריכה להזכיר אותו */
  await page.evaluate(async (id) => { const c = S.clients.get(id); await write('clients/' + id, { proc: { ...c.proc, appr: { ...((c.proc || {}).appr || {}), appraiser: 'שמאי בדיקה' } } }, 'update') }, CID)
  await page.waitForFunction((id) => ((S.clients.get(id).proc || {}).appr || {}).appraiser === 'שמאי בדיקה', CID)
  await next(); await waitStep(CID, 'conds'); await settle(CID, 'apprGo', ['tracking']); await settle(CID, 'conds')
  const go = await open(CID, 'apprGo')
  assert((await open(CID, 'conds'))[0]?.resp === 'hadas' && go[0]?.resp === 'nissim', 'השלמות להדס, שליחת השמאי לניסים')
  assert(go[0]?.notes === 'השמאי שתואם: שמאי בדיקה', 'שליחת השמאי — עם שם השמאי שתואם')

  step('אחראי מההגדרות: ביטוחים → הדס (במקום דן)')
  await page.evaluate(() => go('settings')); await page.waitForSelector('[data-procowner="mortgage:insurance"]')
  await page.selectOption('[data-procowner="mortgage:insurance"]', 'hadas')
  await page.waitForFunction(() => ((S.settings.procOwners || {}).mortgage || {}).insurance === 'hadas')
  await page.evaluate((id) => go('client', id), CID); await page.waitForSelector('[data-procnext]')
  await next(); await waitStep(CID, 'appraisal'); await settle(CID, 'appraisal', ['conds'])
  assert((await open(CID, 'appraisal'))[0]?.resp === 'nissim', 'שמאות אצל ניסים')
  await next(); await waitStep(CID, 'insurance'); await settle(CID, 'insurance', ['appraisal', 'apprPre', 'apprGo'])
  assert((await open(CID, 'apprPre')).length === 0 && (await open(CID, 'apprGo')).length === 0, 'משימות השמאי נסגרו עם סיום השמאות')
  assert((await open(CID, 'insurance'))[0]?.resp === 'hadas', 'ביטוחים — לפי ההגדרה, להדס')

  step('שלב שסיימתי — "החזר אחורה" מהלוח לשלב שבוחרים, עם הערה')
  await page.evaluate(() => go('home')); await page.waitForSelector(`[data-myundo="step:${CID}"]`, { timeout: 10000 })
  await page.click(`[data-myundo="step:${CID}"]`); await page.waitForSelector('#d_step')
  assert(await page.inputValue('#d_step') === 'appraisal', 'ברירת המחדל — השלב האחרון שסיימתי')
  await page.selectOption('#d_step', 'conds'); await page.fill('#d_note', 'חסר אישור עקרוני חתום'); await page.click('#dsave')
  await waitStep(CID, 'conds'); await settle(CID, 'conds', ['insurance'])
  assert((await open(CID, 'conds'))[0]?.notes.startsWith('↩ הוחזר ע״י דן: חסר אישור עקרוני חתום') && (await open(CID, 'insurance')).length === 0, 'חזר להשלמות — משימה עם ההערה, משימת הביטוחים נסגרה')

  step('390px: הכרטיס בלי גלילה לרוחב')
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400)
  assert(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, 'אין גלילה לרוחב')
  assert(!pageErrs.length, 'אין שגיאות בדף' + (pageErrs.length ? ': ' + pageErrs.join(' | ') : ''))
  console.log('\nציר התיק — עבר.')
} finally {
  await sql`update crm_docs set deleted_at = now() where coll = 'tasks' and data->>'clientId' in (${CID}, ${OLD})`.catch(() => {})
  await sql`update crm_docs set deleted_at = now() where (coll = 'clients' and doc_id in (${CID}, ${OLD})) or (coll = 'approvals' and doc_id in (${APR}, ${DEL})) or (coll = 'leads' and doc_id = ${LID})`.catch(() => {})
  await page.evaluate((v) => write('settings/main', { procOwners: v || {} }, 'update'), ownersBefore).catch(() => {})
  await b.close(); await sql.end()
}
