/*
 * crm-shim.js — מה ש-Claude נותן לדף ה-CRM, כאן מול השרת שלנו.
 * הדף קורא ל-claude.use('db' | 'user' | 'mcp' | 'downloads' | 'sample'); כאן כל אחד ממומש:
 *   db        → /api/crm/sync (משיכת שינויים כל כמה שניות) + /api/crm/write
 *   user      → /api/crm/me
 *   mcp       → /api/crm/mcp (Gmail / Google Drive דרך ה-OAuth של השרת)
 *   downloads → הורדה רגילה בדפדפן
 *   sample    → עדיין לא (ניתוחי Claude יעברו לתור שרץ על המנוי — שלב 3). null = הדף מסתיר את הכפתורים.
 */
(function () {
  'use strict';
  var POLL_MS = 3000, POLL_HIDDEN_MS = 30000;

  function api(path, body) {
    var init = body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
    return fetch(path, init).then(function (r) {
      // שער הכניסה פג — חזרה למסך הכניסה של השרת
      if (r.redirected && /\/gate/.test(r.url)) { location.href = '/gate?next=' + encodeURIComponent(location.pathname); throw Object.assign(new Error('נדרשת כניסה'), { code: 'not_granted' }); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw Object.assign(new Error(j.message || r.statusText), { code: j.code || 'upstream_error' });
        return j;
      });
    });
  }

  /* ── db ─────────────────────────────────────────────────────────────── */
  var docs = new Map();            // 'coll/id' → data
  var collSubs = new Map();        // coll → [{cb, err, primed}]
  var docSubs = new Map();         // 'coll/id' → [{cb, err, primed}]
  var seq = 0, loaded = false, timer = null, inflight = null;

  function mkDoc(id, data) { return { id: id, exists: !!data, data: function () { return data ? JSON.parse(JSON.stringify(data)) : undefined; } }; }
  function collSnap(coll, changes) {
    var all = []; docs.forEach(function (v, k) { if (k.slice(0, k.indexOf('/')) === coll) all.push(mkDoc(k.slice(k.indexOf('/') + 1), v)); });
    return { docs: all, size: all.length, empty: !all.length, docChanges: function () { return changes; } };
  }
  function docSnap(key) { var d = docs.get(key); return mkDoc(key.slice(key.indexOf('/') + 1), d); }

  function prime(sub, kind, key) {
    if (sub.primed || !loaded) return;
    sub.primed = true;
    if (kind === 'coll') {
      var ch = []; docs.forEach(function (v, k) { if (k.slice(0, k.indexOf('/')) === key) ch.push({ type: 'added', doc: mkDoc(k.slice(k.indexOf('/') + 1), v) }); });
      sub.cb(collSnap(key, ch));
    } else sub.cb(docSnap(key));
  }

  function pull() {
    if (inflight) return inflight;
    inflight = api('/api/crm/sync?after=' + seq).then(function (j) {
      var byColl = new Map(), touched = new Set();
      (j.changes || []).forEach(function (c) {
        var key = c.coll + '/' + c.id, had = docs.has(key);
        if (c.seq > seq) seq = c.seq;
        if (c.data) docs.set(key, c.data); else if (had) docs.delete(key); else return;
        if (!loaded) return;
        if (!byColl.has(c.coll)) byColl.set(c.coll, []);
        byColl.get(c.coll).push({ type: c.data ? (had ? 'modified' : 'added') : 'removed', doc: mkDoc(c.id, c.data) });
        touched.add(key);
      });
      if (j.more) { inflight = null; return pull(); }
      if (!loaded) {
        loaded = true;
        collSubs.forEach(function (subs, coll) { subs.forEach(function (s) { prime(s, 'coll', coll); }); });
        docSubs.forEach(function (subs, key) { subs.forEach(function (s) { prime(s, 'doc', key); }); });
      } else {
        byColl.forEach(function (ch, coll) { (collSubs.get(coll) || []).forEach(function (s) { if (s.primed) s.cb(collSnap(coll, ch)); }); });
        touched.forEach(function (key) { (docSubs.get(key) || []).forEach(function (s) { if (s.primed) s.cb(docSnap(key)); }); });
      }
    }).catch(function (e) {
      collSubs.forEach(function (subs) { subs.forEach(function (s) { if (s.err) s.err(e); }); });
      docSubs.forEach(function (subs) { subs.forEach(function (s) { if (s.err) s.err(e); }); });
    }).then(function () { inflight = null; schedule(); });
    return inflight;
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(pull, document.hidden ? POLL_HIDDEN_MS : POLL_MS); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) pull(); });

  function write(path, op, data) { return api('/api/crm/write', { path: path, op: op, data: data }).then(function () { return pull(); }).then(function () {}); }

  var db = {
    doc: function (path) {
      return {
        path: path,
        get: function () { return pull().then(function () { return docSnap(path); }); },
        set: function (data) { return write(path, 'set', data); },
        update: function (data) { return write(path, 'update', data); },
        delete: function () { return write(path, 'delete'); },
        onSnapshot: function (cb, err) {
          var s = { cb: cb, err: err, primed: false };
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
        onSnapshot: function (cb, err) {
          var s = { cb: cb, err: err, primed: false };
          if (!collSubs.has(name)) collSubs.set(name, []);
          collSubs.get(name).push(s); prime(s, 'coll', name); if (!loaded) pull();
          return function () { var a = collSubs.get(name) || []; a.splice(a.indexOf(s), 1); };
        },
      };
    },
  };

  /* ── user ───────────────────────────────────────────────────────────── */
  var meP = null;
  function meInfo() { return meP || (meP = api('/api/crm/me').catch(function () { return { me: { id: 'owner', name: 'דן' } }; })); }
  var user = {
    me: function () { return meInfo().then(function (j) { return j.me; }); },
    id: function () { return meInfo().then(function (j) { return j.me.id; }); },
    isOwner: function () { return true; },
    canEdit: function () { return true; },
    can: function () { return Promise.resolve(true); },
    profiles: function (ids) {
      return meInfo().then(function (j) {
        var out = {};
        (ids || []).forEach(function (id) { var t = docs.get('team/' + id); out[id] = { id: id, name: id === j.me.id ? j.me.name : (t && (t.name || t.label)) || '' }; });
        return out;
      });
    },
    search: function () { return Promise.resolve([]); },
  };

  /* ── mcp (Gmail / Google Drive) ─────────────────────────────────────── */
  var mcp = {
    callTool: function (server, tool, input) { return api('/api/crm/mcp', { server: server, tool: tool, input: input || {} }); },
    server: function (server) { return Promise.resolve(new Proxy({}, { get: function (_, tool) { return function (input) { return mcp.callTool(server, tool, input).then(function (r) { return r.payload; }); }; } })); },
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

  var NS = { db: db, user: user, mcp: mcp, downloads: downloads };
  window.claude = Object.freeze({ use: function (name) { return Promise.resolve(NS[name] || null); } });
})();
