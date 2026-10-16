/*
 * crm-lovable.js — מה ש-Claude נותן לדף ה-CRM, כאן מול Lovable Cloud (Supabase).
 * הדף קורא ל-claude.use('db' | 'user' | 'downloads' | …) — מימוש:
 *   db        → טבלת crm_docs: משיכת שינויים (crm_changes אחרי seq) כל כמה שניות, כתיבה דרך crm_write
 *   user      → crm_whoami (מי נכנס, ותפקיד: owner / admin / team)
 *   downloads → הורדה רגילה בדפדפן
 *   mcp / sample / artifact → null: הדף מסתיר את מה שתלוי בהם (גוגל, ניתוחי Claude) עד שיחוברו כאן
 * כניסה: מייל + סיסמה (Supabase Auth). רק מי שהוזמן (crm_invites) נכנס — השאר רואים "אין הרשאה".
 */
(function () {
  'use strict';
  var CFG = window.__CRM_CLOUD || {};
  var URL_ = CFG.url, KEY = CFG.key, POLL_MS = 3000, POLL_HIDDEN_MS = 30000, PAGE = 2000;

  /* מפתחות publishable החדשים אינם JWT — לא שולחים אותם כ-Bearer (כמו הלקוח ש-Lovable מייצר) */
  function sbFetch(input, init) {
    var h = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
    if (/^sb_(publishable|secret)_/.test(KEY) && h.get('Authorization') === 'Bearer ' + KEY) h.delete('Authorization');
    h.set('apikey', KEY);
    return fetch(input, Object.assign({}, init, { headers: h }));
  }
  var sb = window.supabase.createClient(URL_, KEY, { global: { fetch: sbFetch }, auth: { persistSession: true, autoRefreshToken: true, storageKey: 'harel-crm-auth' } });
  window.__crmSupabase = sb;

  function err(e, fallback) {
    var m = (e && (e.message || e.error_description)) || fallback || 'תקלה';
    var code = /not_granted|42501|permission denied|JWT|not authenticated/i.test(m + ' ' + (e && e.code)) ? 'not_granted' : 'upstream_error';
    return Object.assign(new Error(m), { code: code });
  }

  /* ── כניסה ─────────────────────────────────────────────────────────── */
  var who = null, readyResolve, ready = new Promise(function (r) { readyResolve = r; });
  var css = 'position:fixed;inset:0;z-index:2147483000;background:#F6F7F9;display:flex;align-items:center;justify-content:center;font-family:Heebo,system-ui,sans-serif;direction:rtl';
  function overlay(html) {
    var o = document.getElementById('crmAuth');
    if (!o) { o = document.createElement('div'); o.id = 'crmAuth'; o.setAttribute('style', css); (document.body || document.documentElement).appendChild(o); }
    o.innerHTML = '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:28px 26px;width:min(380px,92vw);box-shadow:0 10px 30px rgba(15,23,42,.08);color:#111827">' +
      '<div style="font-size:22px;font-weight:700;margin:0 0 4px">הר-אל CRM</div>' + html + '</div>';
    return o;
  }
  function closeOverlay() { var o = document.getElementById('crmAuth'); if (o) o.remove(); }
  var inp = 'display:block;width:100%;box-sizing:border-box;margin:6px 0 12px;padding:10px 12px;border:1px solid #D1D5DB;border-radius:10px;font:inherit;font-size:15px';
  var btn = 'width:100%;padding:11px;border:0;border-radius:10px;background:#111827;color:#fff;font:inherit;font-size:15px;font-weight:600;cursor:pointer';
  var lnk = 'background:none;border:0;color:#2563EB;font:inherit;font-size:13px;cursor:pointer;padding:4px 0';

  function loginForm(msg, mode) {
    mode = mode || 'in';
    var o = overlay('<div style="font-size:13px;color:#6B7280;margin:0 0 16px">' + (mode === 'up' ? 'יצירת חשבון — רק למי שהוזמן' : mode === 'reset' ? 'איפוס סיסמה' : 'כניסה למערכת') + '</div>' +
      '<form id="crmAuthF" novalidate><label style="font-size:13px">מייל<input id="crmAuthE" type="email" autocomplete="username" dir="ltr" style="' + inp + '" required></label>' +
      (mode === 'reset' ? '' : '<label style="font-size:13px">סיסמה<input id="crmAuthP" type="password" autocomplete="' + (mode === 'up' ? 'new-password' : 'current-password') + '" dir="ltr" style="' + inp + '" required minlength="8"></label>') +
      '<button type="submit" style="' + btn + '">' + (mode === 'up' ? 'צור חשבון' : mode === 'reset' ? 'שלח קישור לאיפוס' : 'כניסה') + '</button></form>' +
      '<p id="crmAuthM" role="alert" style="min-height:18px;font-size:13px;color:#B91C1C;margin:10px 0 4px">' + (msg || '') + '</p>' +
      '<div style="display:flex;justify-content:space-between;gap:8px">' +
        (mode === 'in' ? '<button type="button" data-m="up" style="' + lnk + '">כניסה ראשונה? צור חשבון</button><button type="button" data-m="reset" style="' + lnk + '">שכחתי סיסמה</button>' : '<button type="button" data-m="in" style="' + lnk + '">חזרה לכניסה</button>') + '</div>');
    o.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { loginForm('', b.getAttribute('data-m')); }; });
    var f = document.getElementById('crmAuthF'), m = document.getElementById('crmAuthM'), e = document.getElementById('crmAuthE'), p = document.getElementById('crmAuthP');
    e.focus();
    f.onsubmit = function (ev) {
      ev.preventDefault(); m.style.color = '#B91C1C';
      var email = String(e.value || '').trim().toLowerCase(), pw = p ? p.value : '';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { m.textContent = 'מייל לא תקין'; return; }
      if (mode !== 'reset' && pw.length < 8) { m.textContent = 'סיסמה של 8 תווים לפחות'; return; }
      m.style.color = '#6B7280'; m.textContent = 'רגע…';
      var go = mode === 'up' ? sb.auth.signUp({ email: email, password: pw, options: { emailRedirectTo: location.origin + '/crm.html' } })
        : mode === 'reset' ? sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/crm.html' })
        : sb.auth.signInWithPassword({ email: email, password: pw });
      go.then(function (r) {
        if (r.error) { m.style.color = '#B91C1C'; m.textContent = /invalid login/i.test(r.error.message) ? 'מייל או סיסמה שגויים' : /already registered/i.test(r.error.message) ? 'החשבון כבר קיים — היכנס' : r.error.message; return; }
        if (mode === 'reset') { m.style.color = '#047857'; m.textContent = 'נשלח מייל עם קישור לאיפוס'; return; }
        if (mode === 'up' && !(r.data && r.data.session)) { m.style.color = '#047857'; m.textContent = 'נשלח מייל לאימות — אחרי האימות חזור לכאן והיכנס'; return; }
        start();
      });
    };
  }
  function newPasswordForm() {
    overlay('<div style="font-size:13px;color:#6B7280;margin:0 0 16px">סיסמה חדשה</div><form id="crmAuthF" novalidate><input id="crmAuthP" type="password" autocomplete="new-password" dir="ltr" style="' + inp + '" minlength="8"><button type="submit" style="' + btn + '">שמור</button></form><p id="crmAuthM" role="alert" style="min-height:18px;font-size:13px;color:#B91C1C"></p>');
    document.getElementById('crmAuthF').onsubmit = function (ev) {
      ev.preventDefault(); var pw = document.getElementById('crmAuthP').value, m = document.getElementById('crmAuthM');
      if (pw.length < 8) { m.textContent = 'סיסמה של 8 תווים לפחות'; return; }
      sb.auth.updateUser({ password: pw }).then(function (r) { if (r.error) { m.textContent = r.error.message; return; } start(); });
    };
  }
  function start() {
    return sb.auth.getSession().then(function (s) {
      if (!s.data || !s.data.session) return loginForm();
      return sb.rpc('crm_whoami').then(function (r) {
        if (r.error) return loginForm('תקלה בחיבור: ' + r.error.message);
        if (!r.data || !r.data.member) {
          overlay('<p style="font-size:14px;margin:12px 0">החשבון <b dir="ltr">' + String((r.data && r.data.email) || '').replace(/[<>&"]/g, '') + '</b> עוד לא מורשה במערכת.</p><p style="font-size:13px;color:#6B7280">בקש מדן להוסיף אותך, ואז היכנס שוב.</p><button type="button" id="crmOut" style="' + btn + '">התנתק</button>');
          document.getElementById('crmOut').onclick = function () { sb.auth.signOut().then(function () { loginForm(); }); };
          return;
        }
        who = r.data; closeOverlay(); readyResolve();
      });
    });
  }
  window.__crmSignOut = function () { return sb.auth.signOut().then(function () { location.reload(); }); };
  sb.auth.onAuthStateChange(function (ev) { if (ev === 'PASSWORD_RECOVERY') newPasswordForm(); else if (ev === 'SIGNED_OUT' && who) location.reload(); });
  function boot() { if (/type=recovery/.test(location.hash)) return; start(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  /* ── db ─────────────────────────────────────────────────────────────── */
  var docs = new Map(), collSubs = new Map(), docSubs = new Map();
  var seq = 0, loaded = false, timer = null, inflight = null;

  function clone(d) { return d ? JSON.parse(JSON.stringify(d)) : undefined; }
  function mkDoc(id, data) { return { id: id, exists: !!data, data: function () { return clone(data); } }; }
  function split(k) { var i = k.indexOf('/'); return [k.slice(0, i), k.slice(i + 1)]; }
  function collSnap(coll, changes) {
    var all = []; docs.forEach(function (v, k) { var p = split(k); if (p[0] === coll) all.push(mkDoc(p[1], v)); });
    return { docs: all, size: all.length, empty: !all.length, docChanges: function () { return changes; } };
  }
  function docSnap(key) { return mkDoc(split(key)[1], docs.get(key)); }
  function prime(sub, kind, key) {
    if (sub.primed || !loaded) return;
    sub.primed = true;
    if (kind === 'coll') { var ch = []; docs.forEach(function (v, k) { var p = split(k); if (p[0] === key) ch.push({ type: 'added', doc: mkDoc(p[1], v) }); }); sub.cb(collSnap(key, ch)); }
    else sub.cb(docSnap(key));
  }
  function pullPage() {
    return sb.rpc('crm_changes', { p_after: seq, p_limit: PAGE }).then(function (r) {
      if (r.error) throw err(r.error);
      return r.data || [];
    });
  }
  function pull() {
    if (inflight) return inflight;
    inflight = ready.then(function () {
      var byColl = new Map(), touched = new Set();
      function step() {
        return pullPage().then(function (rows) {
          rows.forEach(function (c) {
            var key = c.coll + '/' + c.doc_id, had = docs.has(key);
            if (Number(c.seq) > seq) seq = Number(c.seq);
            if (c.data) docs.set(key, c.data); else if (had) docs.delete(key); else return;
            if (!loaded) return;
            if (!byColl.has(c.coll)) byColl.set(c.coll, []);
            byColl.get(c.coll).push({ type: c.data ? (had ? 'modified' : 'added') : 'removed', doc: mkDoc(c.doc_id, c.data) });
            touched.add(key);
          });
          if (rows.length >= PAGE) return step();
        });
      }
      return step().then(function () {
        if (!loaded) {
          loaded = true;
          collSubs.forEach(function (subs, coll) { subs.forEach(function (s) { prime(s, 'coll', coll); }); });
          docSubs.forEach(function (subs, key) { subs.forEach(function (s) { prime(s, 'doc', key); }); });
        } else {
          byColl.forEach(function (ch, coll) { (collSubs.get(coll) || []).forEach(function (s) { if (s.primed) s.cb(collSnap(coll, ch)); }); });
          touched.forEach(function (key) { (docSubs.get(key) || []).forEach(function (s) { if (s.primed) s.cb(docSnap(key)); }); });
        }
      });
    }).catch(function (e) {
      collSubs.forEach(function (subs) { subs.forEach(function (s) { if (s.err) s.err(e); }); });
      docSubs.forEach(function (subs) { subs.forEach(function (s) { if (s.err) s.err(e); }); });
    }).then(function () { inflight = null; schedule(); });
    return inflight;
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(pull, document.hidden ? POLL_HIDDEN_MS : POLL_MS); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && loaded) pull(); });

  function write(path, op, data) {
    return ready.then(function () { return sb.rpc('crm_write', { p_path: path, p_op: op, p_data: data === undefined ? null : data }); })
      .then(function (r) { if (r.error) throw err(r.error); return pull(); }).then(function () {});
  }
  var db = {
    doc: function (path) {
      return {
        path: path,
        get: function () { return pull().then(function () { return docSnap(path); }); },
        set: function (data) { return write(path, 'set', data); },
        update: function (data) { return write(path, 'update', data); },
        delete: function () { return write(path, 'delete'); },
        onSnapshot: function (cb, e) {
          var s = { cb: cb, err: e, primed: false };
          if (!docSubs.has(path)) docSubs.set(path, []);
          docSubs.get(path).push(s); prime(s, 'doc', path); if (!loaded) pull();
          return function () { var a = docSubs.get(path) || []; a.splice(a.indexOf(s), 1); };
        },
      };
    },
    collection: function (name) {
      return {
        doc: function (id) { return db.doc(name + '/' + id); },
        get: function () { return pull().then(function () { return collSnap(name, []); }); },
        onSnapshot: function (cb, e) {
          var s = { cb: cb, err: e, primed: false };
          if (!collSubs.has(name)) collSubs.set(name, []);
          collSubs.get(name).push(s); prime(s, 'coll', name); if (!loaded) pull();
          return function () { var a = collSubs.get(name) || []; a.splice(a.indexOf(s), 1); };
        },
      };
    },
  };

  /* ── user ───────────────────────────────────────────────────────────── */
  var user = {
    me: function () { return ready.then(function () { return { id: who.id, name: who.name }; }); },
    id: function () { return ready.then(function () { return who.id; }); },
    isOwner: function () { return ready.then(function () { return who.role === 'owner'; }); },
    canEdit: function () { return ready.then(function () { return who.role === 'owner' || who.role === 'admin'; }); },
    can: function () { return ready.then(function () { return true; }); },
    profiles: function (ids) {
      return ready.then(function () {
        var out = {};
        (ids || []).forEach(function (id) { var t = docs.get('team/' + id); out[id] = { id: id, name: id === who.id ? who.name : (t && (t.name || t.label)) || '' }; });
        return out;
      });
    },
    search: function () { return Promise.resolve([]); },
  };

  /* ── downloads ──────────────────────────────────────────────────────── */
  var downloads = {
    save: function (o) {
      var blob = o.data instanceof Blob ? o.data : new Blob([o.data], { type: o.mimeType || 'application/octet-stream' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = o.filename || 'file';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return Promise.resolve({ saved: true });
    },
  };

  var NS = { db: db, user: user, downloads: downloads };
  window.claude = Object.freeze({
    use: function (name) {
      if (name === 'db' || name === 'user') return ready.then(function () { return NS[name]; });
      return Promise.resolve(NS[name] || null);
    },
  });
})();
