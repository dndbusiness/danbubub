/*
 * crm-shim.js — מה ש-Claude נותן לדף ה-CRM, כאן מול השרת שלנו.
 * הדף קורא ל-claude.use('db' | 'user' | 'mcp' | 'downloads' | 'sample'); כאן כל אחד ממומש:
 *   db        → /api/crm/sync (משיכת שינויים כל כמה שניות) + /api/crm/write
 *   user      → /api/crm/me
 *   mcp       → /api/crm/mcp (Gmail / Google Drive דרך ה-OAuth של השרת)
 *   downloads → הורדה רגילה בדפדפן
 *   sample    → /api/crm/sample — תור ל-Claude על המנוי (תשובה תוך דקות, חוזרת לתיק), או מיידי עם ANTHROPIC_API_KEY.
 *               אף אחד מהם לא פעיל → null = הדף מסתיר את כפתורי הניתוח.
 */
(function () {
  'use strict';
  window.__harelServer = true; /* הדף רץ בשרת — פיצ'רים שצריכים כתובת ציבורית (חתימה דיגיטלית) נדלקים */
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
      /* אין כניסה בשרת (עוגייה פגה / חדש) אבל הדפדפן זוכר "פתוח" — מוחקים, כדי שמסך הכניסה יעלה ולא דף ריק */
      if (!j.session) { try { if (sessionStorage.getItem('harel-unlock')) { sessionStorage.removeItem('harel-unlock'); if (loaded) location.reload(); } } catch (e) {} }
      window.__crmSession = j.session || null;
      var byColl = new Map(), touched = new Set();
      (j.changes || []).forEach(function (c) {
        var key = c.coll + '/' + c.id, had = docs.has(key);
        if (c.seq > seq) seq = c.seq;
        // השרת שולח שוב כתיבות מהדקות האחרונות (ראו changesSince) — מה שלא השתנה לא מודיע לדף
        if (had && c.data && JSON.stringify(docs.get(key)) === JSON.stringify(c.data)) return;
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

  // אחרי כתיבה — משיכה חדשה. משיכה שכבר רצה התחילה לפני הכתיבה ולא תכיל אותה: מחכים לה ומושכים שוב.
  function pullFresh() { return (inflight || Promise.resolve()).then(function () { return pull(); }); }
  function write(path, op, data) { return api('/api/crm/write', { path: path, op: op, data: data }).then(function () { return pullFresh(); }).then(function () {}); }

  var db = {
    doc: function (path) {
      return {
        path: path,
        get: function () { return pullFresh().then(function () { return docSnap(path); }); },
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
        get: function () { return pullFresh().then(function () { return collSnap(name, []); }); },
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

  /* ── כניסה אישית בשרת (lib/crm/auth.ts): הסיסמה נבדקת בשרת, לא בדפדפן. הדף קורא לזה ממסך הנעילה ── */
  window.__crmLogin = function (username, password) {
    return fetch('/api/crm/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: username || '', password: password || '' }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw Object.assign(new Error(j.message || 'השרת לא ענה (' + r.status + ') — נסו שוב בעוד רגע'), { code: j.code || 'unavailable' }); return j; }); });
  };
  /* כניסה בקוד לוואטסאפ / למייל (app/api/crm/login/code) */
  window.__crmCode = function (action, username, code) {
    return fetch('/api/crm/login/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: action, username: username || '', code: code || '' }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw Object.assign(new Error(j.message || 'השרת לא ענה — נסו שוב'), { code: j.code }); return j; }); });
  };
  window.__crmLogout = function () { return fetch('/api/crm/login', { method: 'DELETE' }).catch(function () {}); };

  /* ── downloads ──────────────────────────────────────────────────────── */
  var downloads = {
    save: function (o) {
      var blob = o.data instanceof Blob ? o.data : new Blob([o.data], { type: o.mimeType || 'application/octet-stream' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = o.filename || 'file';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return Promise.resolve({ saved: true });
    },
  };

  /* ── sample (ניתוחי Claude) — התשובה זורמת כשורות JSON מ-/api/crm/sample ── */
  function b64(blob) {
    return new Promise(function (ok, bad) {
      var fr = new FileReader();
      fr.onload = function () { var u = String(fr.result); ok({ media_type: blob.type || 'image/jpeg', data: u.slice(u.indexOf(',') + 1) }); };
      fr.onerror = function () { bad(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function fail(code, message, text) { return Object.assign(new Error(message || code), { code: code, text: text }); }
  function runSample(input, opts) {
    opts = opts || {};
    if (opts.tools && opts.tools.length) return Promise.reject(fail('unsupported', 'כלים לא נתמכים בשרת'));
    return Promise.all((opts.images || []).map(function (im) { return im instanceof Blob ? b64(im) : im; })).then(function (images) {
      return fetch('/api/crm/sample', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: opts.signal,
        body: JSON.stringify({ input: input, images: images, modelTier: opts.modelTier, system: opts.system, json: !!opts.__json, apply: opts.saveTo || null, label: opts.label || '' }) });
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw fail(j.code || 'upstream_error', j.message || r.statusText); });
      if (/json/.test(r.headers.get('content-type') || '') && !/ndjson/.test(r.headers.get('content-type') || '')) return r.json().then(function (j) { return waitJob(j.job, opts); });
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '', text = '', end = null;
      function line(l) {
        if (!l.trim()) return;
        var m = JSON.parse(l);
        if (m.d) { text += m.d; if (opts.onText) try { opts.onText({ text: text, delta: m.d }); } catch (e) { /* בעיה בדף לא עוצרת את הזרם */ } }
        else if (m.done) end = { text: m.text != null ? m.text : text, truncated: !!m.truncated };
        else if (m.error) throw fail(m.error.code, m.error.message, m.error.text || text);
      }
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) { line(buf); if (!end) throw fail('upstream_error', 'התשובה נקטעה', text); return end; }
          buf += dec.decode(x.value, { stream: true });
          var parts = buf.split('\n'); buf = parts.pop(); parts.forEach(line);
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      if (e && e.name === 'AbortError') throw fail('cancelled', 'בוטל');
      throw e;
    });
  }
  /* תור: Claude על המנוי עונה תוך דקות. בודקים כל כמה שניות; "עצור" מבטל את הבקשה בשרת */
  var QUEUE_MSG = 'נשלח ל-Claude — התשובה מגיעה תוך כמה דקות.';
  function waitJob(id, opts) {
    if (!id) return Promise.reject(fail('upstream_error', 'הבקשה לא נכנסה לתור'));
    if (opts.onText) try { opts.onText({ text: QUEUE_MSG + (opts.saveTo ? ' אפשר לסגור את הדף — התשובה תישמר בתיק.' : ''), delta: '' }); } catch (e) { /* הדף */ }
    return new Promise(function (ok, bad) {
      var t = null, stop = false;
      function onAbort() { stop = true; clearTimeout(t); fetch('/api/crm/sample?job=' + encodeURIComponent(id), { method: 'DELETE' }).catch(function () {}); bad(fail('cancelled', 'בוטל')); }
      if (opts.signal) { if (opts.signal.aborted) return onAbort(); opts.signal.addEventListener('abort', onAbort, { once: true }); }
      (function tick() {
        if (stop) return;
        fetch('/api/crm/sample?job=' + encodeURIComponent(id), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
          if (stop) return;
          if (j.status === 'done') { stop = true; return ok({ text: j.text || '', truncated: false }); }
          if (j.status === 'error' || j.status === 'cancelled' || j.code) { stop = true; return bad(fail(j.status === 'cancelled' ? 'cancelled' : 'upstream_error', j.error || j.message || 'הניתוח נכשל')); }
          t = setTimeout(tick, 4000);
        }).catch(function () { if (!stop) t = setTimeout(tick, 8000); });
      })();
    });
  }
  function parseJson(t) {
    var s = String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(s); } catch (e) { /* מחפשים את הגוש הראשון */ }
    var a = s.search(/[\[{]/), z = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (a >= 0 && z > a) try { return JSON.parse(s.slice(a, z + 1)); } catch (e) { /* נופל למטה */ }
    throw fail('invalid_json', 'Claude לא החזיר JSON תקין', t);
  }
  var sampleNs = null, sampleP = null;
  function getSample() {
    if (sampleP) return sampleP;
    sampleP = fetch('/api/crm/sample', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (j) {
      /* לא מחובר עכשיו — לא זוכרים את זה: הקריאה הבאה בודקת שוב (מפתח שנוסף / תור שהתעורר אחרי שהדף נפתח) */
      if (!j.enabled) { sampleP = null; return null; }
      window.__crmAiQueue = j.mode === 'queue'; /* הדף מתאים את הטקסטים: "תוך כמה דקות" במקום "עד דקה" */
      var f = function (input, opts) { return runSample(input, opts); };
      f.json = function (input, opts) {
        var tail = '\n\nהחזר JSON תקין בלבד, בלי טקסט לפניו או אחריו ובלי ```.';
        var inp = typeof input === 'string' ? input + tail : input.map(function (t, i) { return i === input.length - 1 ? { role: t.role, content: String(t.content) + tail } : t; });
        return runSample(inp, Object.assign({}, opts, { __json: true })).then(function (r) { return parseJson(r.text); });
      };
      f.limits = function () { return Promise.resolve(j.limits || { images: { maxCount: 5 } }); };
      sampleNs = Object.freeze(f);
      return sampleNs;
    });
    return sampleP;
  }

  var NS = { db: db, user: user, mcp: mcp, downloads: downloads };
  window.claude = Object.freeze({ use: function (name) { return name === 'sample' ? getSample() : Promise.resolve(NS[name] || null); } });
})();
