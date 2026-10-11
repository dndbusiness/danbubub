/**
 * העמודים של החתימה — HTML שלם בלי ה-layout של המערכת (הלקוח לא רואה תפריטים פנימיים).
 *   signPage   — מה שהלקוח פותח בטלפון: הנוסח, שם + ת"ז, חתימת אצבע, אישור.
 *   printPage  — ההסכם החתום + עמוד תיעוד. ממנו נוצר ה-PDF (lib/pdf.ts, Playwright).
 */
import type { SignState } from '@/lib/rules/sign'
import type { SignRow } from './store'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const COMPANY: Record<string, string> = { finance: 'הר-אל פתרונות מימון', realestate: 'הר-אל השקעות' }
const il = (d: string | Date | null) => (d ? new Date(d).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

const BASE_CSS = `
:root{--bg:#F7F8FA;--surface:#FFFFFF;--border:#E6E8EC;--text:#111827;--text-2:#6B7280;--ink:#111827;--ok:#16A34A;--ok-bg:#ECFDF5;--bad:#DC2626;--bad-bg:#FEF2F2}
@media (prefers-color-scheme: dark){:root{--bg:#0B0F17;--surface:#111827;--border:#1F2937;--text:#F3F4F6;--text-2:#9CA3AF;--ink:#F3F4F6;--ok-bg:#052E1B;--bad-bg:#3A0D0D}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 Heebo,Arial,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:14px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:17px;margin:14px 0 6px}.hint{color:var(--text-2);font-size:13px}
.doc p{margin:0 0 10px}.doc ol{margin:0 0 10px;padding-inline-start:22px}.doc li{margin-bottom:4px}
label{display:block;font-size:14px;margin:10px 0 4px}
input[type=text]{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text)}
.pad{position:relative;border:1.5px dashed var(--text-2);border-radius:12px;background:#fff;touch-action:none;height:190px}
.pad canvas{width:100%;height:100%;display:block;border-radius:12px}
.pad .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9CA3AF;pointer-events:none;font-size:14px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.btn{font:inherit;border-radius:10px;padding:12px 18px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer}
.btn.primary{background:var(--ink);color:var(--bg);border-color:var(--ink);width:100%;font-weight:600}
.btn:disabled{opacity:.5}
.check{display:flex;gap:10px;align-items:flex-start;margin:12px 0}.check input{width:22px;height:22px;margin-top:2px}
.err{background:var(--bad-bg);color:var(--bad);border-radius:10px;padding:10px 12px;margin:10px 0;display:none}
.done{background:var(--ok-bg);color:var(--ok);border-radius:12px;padding:16px;text-align:center}
`

function shell(title: string, body: string, extraHead = ''): string {
  return '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">' +
    `<title>${esc(title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&display=swap" rel="stylesheet">` +
    `<style>${BASE_CSS}</style>${extraHead}</head><body>${body}</body></html>`
}

export function messagePage(title: string, text: string, tone: 'ok' | 'bad' | 'muted' = 'muted'): string {
  return shell(title, `<div class="wrap"><div class="card" style="text-align:center"><h1>${esc(title)}</h1><p class="${tone === 'muted' ? 'hint' : ''}" style="${tone === 'bad' ? 'color:var(--bad)' : tone === 'ok' ? 'color:var(--ok)' : ''}">${esc(text)}</p><p class="hint">הר-אל</p></div></div>`)
}

export function signPage(row: SignRow, state: SignState, token: string): string {
  const company = COMPANY[row.division] ?? 'הר-אל'
  if (state === 'signed') return messagePage('ההסכם נחתם', `ההסכם נחתם ב-${il(row.signed_at)}. עותק חתום נשלח אליך${row.send_email ? ' במייל' : ''}. תודה!`, 'ok')
  if (state === 'expired') return messagePage('תוקף הקישור פג', 'נא לפנות אלינו לקבלת קישור חדש.', 'bad')
  if (state === 'cancelled') return messagePage('הקישור בוטל', 'נא לפנות אלינו אם יש שאלה.', 'bad')
  const body = `<div class="wrap">
  <div class="card"><div class="hint">${esc(company)}</div><h1>${esc(row.title)}</h1><div class="hint">עבור ${esc(row.client_name)} · בתוקף עד ${esc(il(row.expires_at))}</div></div>
  <div class="card doc">${row.body_html}</div>
  <form class="card" id="f" novalidate>
    <h2 style="margin-top:0">חתימה</h2>
    <label for="name">שם מלא</label><input type="text" id="name" autocomplete="name" required>
    <label for="idn">מספר תעודת זהות</label><input type="text" id="idn" inputmode="numeric" autocomplete="off" maxlength="10" required dir="ltr" style="text-align:right">
    <label>חתימה <span class="hint">— לחתום באצבע / בעכבר בתוך המסגרת</span></label>
    <div class="pad" id="pad"><canvas id="cv"></canvas><div class="ph" id="ph">כאן חותמים</div></div>
    <div class="row" style="margin-top:6px"><button type="button" class="btn" id="clear">ניקוי</button></div>
    <label class="check"><input type="checkbox" id="agree"><span>קראתי את ההסכם במלואו, אני מסכים/ה לתנאיו, ואני מאשר/ת שהחתימה האלקטרונית שלי מחייבת כמו חתימה בכתב יד.</span></label>
    <div class="err" id="err" role="alert"></div>
    <button type="submit" class="btn primary" id="go">אני מאשר/ת וחותם/ת</button>
    <p class="hint" style="margin-top:10px">עם החתימה נשמרים: השם, ת"ז, החתימה, מועד החתימה, כתובת ה-IP והמכשיר, וטביעה של נוסח ההסכם — לתיעוד.</p>
  </form></div>
<script>
(function(){
  var cv=document.getElementById('cv'),pad=document.getElementById('pad'),ph=document.getElementById('ph'),ctx=cv.getContext('2d'),drawing=false,pts=0,last=null;
  function size(){var r=pad.getBoundingClientRect(),d=window.devicePixelRatio||1,img=pts?cv.toDataURL():null;cv.width=Math.round(r.width*d);cv.height=Math.round(r.height*d);ctx.setTransform(d,0,0,d,0,0);ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#111827';if(img){var i=new Image();i.onload=function(){ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(i,0,0,cv.width,cv.height);ctx.setTransform(d,0,0,d,0,0)};i.src=img}}
  function p(e){var r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
  cv.addEventListener('pointerdown',function(e){drawing=true;last=p(e);cv.setPointerCapture(e.pointerId);ph.style.display='none';e.preventDefault()});
  cv.addEventListener('pointermove',function(e){if(!drawing)return;var q=p(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(q.x,q.y);ctx.stroke();last=q;pts++;e.preventDefault()});
  ['pointerup','pointercancel','pointerleave'].forEach(function(t){cv.addEventListener(t,function(){drawing=false})});
  document.getElementById('clear').onclick=function(){ctx.clearRect(0,0,cv.width,cv.height);pts=0;ph.style.display=''};
  window.addEventListener('resize',size);size();
  var err=document.getElementById('err'),go=document.getElementById('go');
  function show(m){err.innerHTML=m.map(function(x){return'<div>'+x.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})+'</div>'}).join('');err.style.display=m.length?'block':'none'}
  document.getElementById('f').addEventListener('submit',function(e){
    e.preventDefault();var name=document.getElementById('name').value.trim(),idn=document.getElementById('idn').value,agree=document.getElementById('agree').checked,m=[];
    if(name.length<2)m.push('נא למלא שם מלא');if(!/^\\d{5,9}$/.test(idn.replace(/\\D/g,'')))m.push('נא למלא מספר תעודת זהות');if(pts<12)m.push('נא לחתום במסגרת');if(!agree)m.push('נא לאשר שקראת את ההסכם ושאתה מסכים לו');
    show(m);if(m.length)return;go.disabled=true;go.textContent='שומר את החתימה…';
    var w=document.createElement('canvas');w.width=cv.width;w.height=cv.height;var g=w.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,w.width,w.height);g.drawImage(cv,0,0);
    fetch('/api/s/${encodeURIComponent(token)}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name,idNumber:idn,signature:w.toDataURL('image/png'),agree:true})})
      .then(function(r){return r.json()}).then(function(j){if(j.ok){document.querySelector('.wrap').innerHTML='<div class="card done"><h1>ההסכם נחתם — תודה!</h1><p>עותק חתום יישלח אליך.</p></div>';window.scrollTo(0,0)}else{show(j.errors||['השמירה נכשלה — נסו שוב']);go.disabled=false;go.textContent='אני מאשר/ת וחותם/ת'}})
      .catch(function(){show(['אין חיבור — נסו שוב']);go.disabled=false;go.textContent='אני מאשר/ת וחותם/ת'});
  });
})();
</script>`
  return shell(row.title, body)
}

export function printPage(row: SignRow): string {
  const company = COMPANY[row.division] ?? 'הר-אל'
  const css = `<style>@page{size:A4}body{background:#fff;color:#111827;font-size:13.5px}.wrap{max-width:none;padding:0}.card{border:0;padding:0}
  .sig{display:flex;gap:24px;align-items:flex-end;border-top:1px solid #E6E8EC;padding-top:12px;margin-top:18px}.sig img{height:90px;border-bottom:1px solid #111827}
  table{border-collapse:collapse;width:100%;font-size:12px}td{border-bottom:1px solid #E6E8EC;padding:6px 4px;vertical-align:top}td:first-child{color:#6B7280;width:34%}
  .audit{page-break-before:always}.mono{font-family:ui-monospace,Menlo,monospace;direction:ltr;text-align:right;word-break:break-all}</style>`
  const body = `<div class="wrap">
  <div class="hint">${esc(company)}</div><h1>${esc(row.title)}</h1><div class="hint">עבור ${esc(row.client_name)}</div>
  <div class="doc" style="margin-top:14px">${row.body_html}</div>
  <div class="sig"><div><img src="${esc(row.signature_png)}" alt="חתימה"><div>${esc(row.signer_name)}</div><div class="hint">ת"ז ${esc(row.signer_id_number)}</div></div>
    <div class="hint">נחתם אלקטרונית ב-${esc(il(row.signed_at))}</div></div>
  <div class="audit"><h2>עמוד תיעוד חתימה</h2><table>
    <tr><td>מסמך</td><td>${esc(row.title)}</td></tr>
    <tr><td>מזהה בקשה</td><td class="mono">${esc(row.id)}</td></tr>
    <tr><td>טביעת הנוסח (SHA-256)</td><td class="mono">${esc(row.doc_hash)}</td></tr>
    <tr><td>נשלח</td><td>${esc(il(row.created_at))}${row.send_email ? ' · במייל ל-' + esc(row.send_email) : ''}${row.send_phone ? ' · וואטסאפ ' + esc(row.send_phone) : ''}</td></tr>
    <tr><td>נפתח לראשונה</td><td>${esc(il(row.opened_at))}</td></tr>
    <tr><td>נחתם</td><td>${esc(il(row.signed_at))}</td></tr>
    <tr><td>החותם</td><td>${esc(row.signer_name)} · ת"ז ${esc(row.signer_id_number)}</td></tr>
    <tr><td>כתובת IP</td><td class="mono">${esc(row.signer_ip ?? '—')}</td></tr>
    <tr><td>מכשיר / דפדפן</td><td class="mono">${esc(row.signer_ua ?? '—')}</td></tr>
  </table>
  <p class="hint" style="margin-top:12px">החתימה בוצעה דרך קישור אישי וחד-פעמי שנשלח ללקוח. הנוסח שהוצג לחותם נשמר כפי שנשלח וטביעתו מופיעה למעלה; כל שינוי בנוסח משנה את הטביעה. השעות לפי שעון ישראל.</p></div></div>`
  return shell(row.title, body, css)
}
