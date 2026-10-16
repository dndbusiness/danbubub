/* בדיקת המעבר ל-Lovable: הדף האמיתי + crm-lovable.js + המסד המקומי עם אותו SQL (supabase-js מוחלף בכפיל שמעביר rpc ל-Postgres) */
import { chromium } from '/home/user/danbubub/node_modules/playwright/index.mjs';
import postgres from '/home/user/danbubub/node_modules/postgres/src/index.js';
import fs from 'fs';
const sql = postgres({ host: '/tmp/claude-0/pglov', port: 5499, user: 'postgres', database: 'postgres', max: 4 });
const USERS = { 'dan@x.com': { pw: 'owner-pass-1', id: '11111111-1111-1111-1111-111111111111' }, 'team@x.com': { pw: 'team-pass-1', id: '22222222-2222-2222-2222-222222222222' }, 'stranger@x.com': { pw: 'stranger-1', id: '33333333-3333-3333-3333-333333333333' } };
const CRM = fs.readFileSync('/tmp/claude-0/-home-user-danbubub/426e1ebb-0e1d-5cda-b8a4-ade29be48758/scratchpad/harel-crm.html', 'utf8');
const LOADER = fs.readFileSync('/home/user/danbubub/lovable/public/crm.html', 'utf8');
const SHIM = fs.readFileSync('/home/user/danbubub/lovable/public/crm-lovable.js', 'utf8');
const PL = '/tmp/claude-0/-home-user-danbubub/426e1ebb-0e1d-5cda-b8a4-ade29be48758/scratchpad/pdflibs/node_modules/';
const xlsxJs = fs.readFileSync('/home/user/danbubub/node_modules/xlsx/dist/xlsx.full.min.js', 'utf8');
/* כפיל ל-supabase-js: auth מקומי, rpc → window.__rpc (node → Postgres עם auth.uid של המחובר) */
const FAKE_SB = `window.supabase = { createClient: function (url, key, opts) {
  var KEY = 'sb-test-session', subs = [];
  function sess() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  var auth = {
    getSession: function () { return Promise.resolve({ data: { session: sess() } }); },
    signInWithPassword: function (c) { return window.__login(c.email, c.password).then(function (u) { if (!u) return { error: { message: 'Invalid login credentials' } }; localStorage.setItem(KEY, JSON.stringify({ user: u })); subs.forEach(function (f) { f('SIGNED_IN'); }); return { data: { session: { user: u } } }; }); },
    signUp: function () { return Promise.resolve({ data: { session: null } }); },
    signOut: function () { localStorage.removeItem(KEY); subs.forEach(function (f) { f('SIGNED_OUT'); }); return Promise.resolve({}); },
    resetPasswordForEmail: function () { return Promise.resolve({}); }, updateUser: function () { return Promise.resolve({}); },
    onAuthStateChange: function (f) { subs.push(f); return { data: { subscription: { unsubscribe: function () {} } } }; },
  };
  return { auth: auth, rpc: function (fn, args) { var s = sess(); return window.__rpc(s && s.user, fn, args || {}); } };
} };`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const R = {};
async function open(w) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/fonts|favicon|net::ERR/.test(m.text())) errs.push(m.text()); });
  await p.exposeFunction('__login', (email, pw) => { const u = USERS[email]; return u && u.pw === pw ? { id: u.id, email } : null; });
  await p.exposeFunction('__rpc', async (u, fn, args) => {
    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('t.uid', ${u ? u.id : ''}, true), set_config('t.email', ${u ? u.email : ''}, true)`;
        if (fn === 'crm_whoami') return (await tx`select crm_whoami() as r`)[0].r;
        if (fn === 'crm_changes') return await tx`select coll, doc_id, seq::int as seq, data from crm_changes(${args.p_after}, ${args.p_limit})`;
        if (fn === 'crm_write') return (await tx`select crm_write(${args.p_path}, ${args.p_op}, ${args.p_data === null ? null : tx.json(args.p_data)}) as s`)[0].s;
        throw new Error('no fn ' + fn);
      });
      return { data: rows, error: null };
    } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
  });
  await p.route('https://t.test/**', (r) => { const u = r.request().url(); r.fulfill(u.endsWith('/crm-lovable.js') ? { body: SHIM, contentType: 'text/javascript' } : { body: LOADER, contentType: 'text/html; charset=utf-8' }); });
  await p.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ body: CRM, contentType: 'text/plain; charset=utf-8', headers: { 'access-control-allow-origin': '*' } }));
  await p.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ body: FAKE_SB, contentType: 'text/javascript' }));
  await p.route('https://cdnjs.cloudflare.com/**', (r) => { const u = r.request().url(); r.fulfill({ body: u.includes('pdf.worker') ? fs.readFileSync(PL + 'pdfjs-dist/build/pdf.worker.min.js', 'utf8') : u.includes('pdf.js/') ? fs.readFileSync(PL + 'pdfjs-dist/build/pdf.min.js', 'utf8') : u.includes('html2canvas') ? fs.readFileSync(PL + 'html2canvas/dist/html2canvas.min.js', 'utf8') : u.includes('jspdf') ? fs.readFileSync(PL + 'jspdf/dist/jspdf.umd.min.js', 'utf8') : xlsxJs, contentType: 'text/javascript' }); });
  await p.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await p.goto('https://t.test/crm.html'); await p.waitForTimeout(1500);
  return { p, errs, ev: (f, a) => p.evaluate(f, a), T: async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ') };
}
const login = async (p, email, pw) => { await p.fill('#crmAuthE', email); await p.fill('#crmAuthP', pw); await p.click('#crmAuthF button[type=submit]'); await p.waitForTimeout(2500); };
// 1. מסך כניסה, סיסמה שגויה, ואז בעלים
{ const { p, errs, ev, T } = await open(1280);
  R.loginShown = await ev(() => !!document.getElementById('crmAuthF'));
  await p.screenshot({ path: '/tmp/claude-0/lovtest/login@1280.png' });
  await login(p, 'dan@x.com', 'wrong-pass-1'); R.wrong = await ev(() => (document.getElementById('crmAuthM') || {}).textContent);
  await login(p, 'dan@x.com', 'owner-pass-1');
  R.ownerAfter = (await T()).slice(0, 300); R.authGone = await ev(() => !document.getElementById('crmAuth'));
  R.level = await ev(() => S.level + ' / claudeOwner=' + S.claudeOwner + ' / db=' + !!S.db + ' / me=' + JSON.stringify(S.me));
  await p.screenshot({ path: '/tmp/claude-0/lovtest/owner-first@1280.png' });
  // כתיבה דרך הפונקציות של הדף
  R.writes = await ev(async () => { const t = new Date().toISOString();
    await write('leads/LV1', { id: 'LV1', name: 'ליד ענן', phone: '0501234567', division: 'finance', stage: 'new', createdAt: t, updatedAt: t });
    await write('transactions/TV1', { id: 'TV1', kind: 'income', amount: 1000, date: t.slice(0, 10), division: 'finance', createdAt: t });
    await write('settings/main', { users: [], ownerName: 'דן' }, 'update');
    await write('leads/LV1', { stage: 'followup', note: 'נבדק' }, 'update');
    return [S.leads.get('LV1') && S.leads.get('LV1').stage, S.transactions.size, !!S.settings.ownerName].join(' | '); });
  // 2. רענון באותו דפדפן — הכניסה נשמרת והנתונים חוזרים מהמסד
  await p.reload(); await p.waitForTimeout(3000);
  R.reloadNoLogin = await ev(() => !document.getElementById('crmAuthF'));
  R.persisted = await ev(() => [S.leads.get('LV1') && S.leads.get('LV1').stage + ':' + S.leads.get('LV1').note, S.transactions.size, S.settings.ownerName].join(' | '));
  await ev(() => window.__crmSignOut()); await p.waitForTimeout(2500);
  R.afterSignOut = await ev(() => !!document.getElementById('crmAuthF'));
  R.errsOwner = errs; await p.close(); }
// 3. צוות — רואה ליד, לא רואה כספים, כותב משימה, לא כותב לקוח
{ const { p, errs, ev } = await open(390);
  await login(p, 'team@x.com', 'team-pass-1'); await p.waitForTimeout(1000);
  R.team = await ev(() => [S.level, S.claudeOwner, S.leads.size, S.transactions.size].join(' | '));
  R.teamWrites = await ev(async () => { const out = [];
    try { await S.db.doc('tasks/TK1').set({ title: 'משימת צוות', status: 'open' }); out.push('task ok'); } catch (e) { out.push('task ERR ' + e.code); }
    try { await S.db.doc('clients/C1').set({ name: 'x' }); out.push('client ok?!'); } catch (e) { out.push('client blocked: ' + e.code); }
    try { await S.db.doc('transactions/T9').set({ amount: 1 }); out.push('tx ok?!'); } catch (e) { out.push('tx blocked: ' + e.code); }
    return out.join(' | '); });
  await p.screenshot({ path: '/tmp/claude-0/lovtest/team@390.png' });
  R.ov390 = await ev(() => document.documentElement.scrollWidth - innerWidth);
  R.errsTeam = errs; await p.close(); }
// 4. מי שלא הוזמן
{ const { p, errs, ev, T } = await open(390);
  await p.screenshot({ path: '/tmp/claude-0/lovtest/login@390.png' });
  await login(p, 'stranger@x.com', 'stranger-1');
  R.stranger = (await ev(() => (document.getElementById('crmAuth') || {}).innerText || 'NO OVERLAY')).replace(/\s+/g, ' ');
  R.strangerDb = await ev(() => typeof S === 'undefined' ? 'no S' : String(!!S.db));
  R.errsStranger = errs; await p.close(); }
R.dbRows = (await sql`select coll, doc_id, data->>'stage' st, deleted_at is not null del from crm_docs order by seq`).map((r) => r.coll + '/' + r.doc_id + (r.st ? ':' + r.st : '')).join(' ');
R.history = (await sql`select count(*)::int n from crm_docs_history`)[0].n;
console.log(JSON.stringify(R, null, 1)); await b.close(); await sql.end();
