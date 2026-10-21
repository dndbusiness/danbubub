/**
 * העמודים של החתימה — HTML שלם בלי ה-layout של המערכת (הלקוח לא רואה תפריטים פנימיים).
 *   signPage   — מה שהלקוח פותח בטלפון: הנוסח, שם + ת"ז, חתימת אצבע, אישור.
 *   printPage  — ההסכם החתום + עמוד תיעוד. ממנו נוצר ה-PDF (lib/pdf.ts, Playwright).
 *                בטופס PDF — רק עמוד התיעוד (auditOnly); החתימות נכתבות על המקור (lib/sign/pdf.ts).
 * טופס PDF בדף החותם: העמודים מוצגים עם pdf.js, השדות של החותם מסומנים וממולאים בזמן אמת
 * (חתימה, שם, ת"ז, תאריך), ושדות הטקסט / הסימון שלו מופיעים בטופס.
 */
import { deviceLabel, groupByDocument, identityCheck, maskEmail, maskPhone, otpState, SIGN_CATEGORIES, SIGN_EVENT_LABELS, SIGN_HERE_HTML, type SignState } from '@/lib/rules/sign'
import { FIELD_KINDS, fieldsOf, signerInputs, type PdfField } from '@/lib/rules/sign-pdf'
import type { EnvelopeRow, SignRow } from './store'

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
.sighere{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:flex-end;margin:10px 0 14px}.sighere .slot{border:1.5px dashed var(--text-2);border-radius:10px;padding:18px 22px;color:var(--text-2);font-size:13px}.sighere .co img{height:84px;display:block}.pagebreak{border-top:2px dashed var(--border,#E6E8EC);margin:26px 0 8px}
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
.otp input{font-size:24px;letter-spacing:8px;text-align:center;direction:ltr}
.pages{display:flex;flex-direction:column;gap:12px}.pg{position:relative;direction:ltr;background:#fff;border:1px solid var(--border);border-radius:6px;overflow:hidden}
.pg canvas{display:block;width:100%;height:100%}
.fld{position:absolute;border:1.5px solid #F59E0B;background:rgba(245,158,11,.14);border-radius:3px;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#111827;font:600 11px/1 Arial,sans-serif}
.fld.other{border:1px dashed #9CA3AF;background:rgba(156,163,175,.10);color:#6B7280;font-weight:400}
.fld.filled{background:rgba(22,163,74,.08);border-color:#16A34A}.fld img{max-width:100%;max-height:100%}
.fld .t{white-space:nowrap;direction:rtl;padding:0 2px}
.pre{font-size:12px;color:var(--text-2);margin-top:-2px}.notes{white-space:pre-wrap}
.who{display:inline-block;background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:2px 10px;font-size:13px;margin-top:6px}
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

export function signPage(row: SignRow, state: SignState, token: string, opts: { total?: number; now?: Date; stamp?: string | null; pdf?: { fields: PdfField[]; pages: { w: number; h: number }[] } | null } = {}): string {
  const company = COMPANY[row.division] ?? 'הר-אל'
  const total = opts.total ?? 1
  // קוד אימות: עד שאומת — הטופס מוסתר, והשרת דוחה חתימה בלי אימות בכל מקרה
  const needOtp = row.require_otp && otpState(row, opts.now ?? new Date()) !== 'verified'
  if (state === 'signed') return messagePage('המסמך נחתם', `חתמת ב-${il(row.signed_at)}. ${total > 1 ? 'כשכל החותמים יחתמו יישלח' : 'נשלח'} אליך עותק חתום${row.send_email ? ' במייל' : ''}. תודה!`, 'ok')
  if (state === 'expired') return messagePage('תוקף הקישור פג', 'נא לפנות אלינו לקבלת קישור חדש.', 'bad')
  if (state === 'cancelled') return messagePage('הקישור בוטל', 'נא לפנות אלינו אם יש שאלה.', 'bad')
  const pdf = opts.pdf ?? null
  const mine = pdf ? fieldsOf(pdf.fields, row.signer_order) : []
  const inputs = pdf ? signerInputs(pdf.fields, row.signer_order) : []
  // מה שמולא מראש מהתיק (דן, 17/10) — החותם רואה, בודק ומתקן אם צריך; ההערות של השולח — לקריאה בלבד
  const pre = row.fields?.['@prefill'] ?? {}, notes = String(row.fields?.['@notes'] ?? '')
  const preHint = '<div class="pre">מולא מראש מהתיק — נא לבדוק, ולתקן אם צריך</div>'
  const pdfHtml = pdf ? `<div class="card"><div class="row" style="justify-content:space-between"><b>המסמך</b><span class="hint">${pdf.pages.length} עמודים · ${mine.length} שדות שלך מסומנים בכתום</span></div>
    <div class="pages" id="pages" style="margin-top:10px">${pdf.pages.map((p, i) => `<div class="pg" data-pg="${i}" style="aspect-ratio:${p.w}/${p.h}"><canvas></canvas>${pdf.fields.filter((f) => f.page === i).map((f) =>
      `<div class="fld${f.signer === row.signer_order ? '' : ' other'}" data-f="${esc(f.id)}" data-k="${f.kind}" style="left:${(f.x * 100).toFixed(3)}%;top:${(f.y * 100).toFixed(3)}%;width:${(f.w * 100).toFixed(3)}%;height:${(f.h * 100).toFixed(3)}%"><span class="t">${esc(f.signer === row.signer_order ? f.label || FIELD_KINDS[f.kind] : 'לווה ' + f.signer)}</span></div>`).join('')}</div>`).join('')}</div>
    <p class="hint" id="pdfFallback" style="display:none">התצוגה לא נטענה. <a href="/api/s/${encodeURIComponent(token)}/file" target="_blank" rel="noopener">פתיחת המסמך</a></p></div>` : ''
  const inputsHtml = inputs.map((f) => f.kind === 'checkbox'
    ? `<label class="check"><input type="checkbox" data-fid="${esc(f.id)}"><span>${esc(f.label || 'אישור')}${f.required ? ' *' : ''}</span></label>`
    : f.src === 'notes'
      ? `<label for="v_${esc(f.id)}">${esc(f.label || 'הערות')}</label><input type="text" id="v_${esc(f.id)}" data-fid="${esc(f.id)}" value="${esc(notes.replace(/\n+/g, ' · ').slice(0, 200))}" readonly>`
      : `<label for="v_${esc(f.id)}">${esc(f.label || 'טקסט')}${f.required ? ' *' : ''}</label><input type="text" id="v_${esc(f.id)}" data-fid="${esc(f.id)}" maxlength="200" value="${esc(pre.values?.[f.id] ?? '')}">${pre.values?.[f.id] ? preHint : ''}`).join('')
  const notesHtml = pdf && notes ? `<div class="card"><h2 style="margin-top:0">הערות למסמך</h2><div class="notes">${esc(notes)}</div><p class="hint" style="margin-bottom:0">ההערות הן חלק מהמסמך שעליו חותמים, ונשמרות איתו.</p></div>` : ''
  const body = `<div class="wrap">
  <div class="card"><div class="hint">${esc(company)}</div><h1>${esc(row.title)}</h1><div class="hint">בתוקף עד ${esc(il(row.expires_at))}</div>
    <div class="who">חותם/ת: ${esc(row.client_name)}${row.signer_label && row.signer_label !== 'הלקוח' ? ' · ' + esc(row.signer_label) : ''}${total > 1 ? ` · אחד/ת מ-${total} חותמים` : ''}</div></div>
  ${pdf ? pdfHtml : `<div class="card doc">${String(row.body_html).split(SIGN_HERE_HTML).join(`<div class="sighere"><div class="slot">כאן תופיע החתימה שלך</div>${opts.stamp ? `<div class="co"><img src="${esc(opts.stamp)}" alt="חותמת החברה"><div class="hint">חותמת החברה</div></div>` : ''}</div>`)}</div>`}
  ${notesHtml}
  ${needOtp ? `<div class="card otp" id="otp"><h2 style="margin-top:0">אימות לפני חתימה</h2>
    <p class="hint">נשלח קוד חד-פעמי ${row.send_email ? 'למייל ' + esc(maskEmail(row.send_email)) : 'בוואטסאפ ל-' + esc(maskPhone(row.send_phone))}.</p>
    <div class="row"><button type="button" class="btn" id="otpSend">שלחו לי קוד</button></div>
    <label for="otpCode">הקוד שקיבלת</label><input type="text" id="otpCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
    <div class="err" id="otpErr" role="alert"></div>
    <button type="button" class="btn primary" id="otpGo" style="margin-top:10px">אימות</button></div>` : ''}
  <form class="card" id="f" novalidate${needOtp ? ' hidden' : ''}>
    <h2 style="margin-top:0">חתימה</h2>
    <label for="name">שם מלא</label><input type="text" id="name" autocomplete="name" required value="${esc(pre.name ?? '')}">${pre.name ? preHint : ''}
    <label for="idn">מספר תעודת זהות</label><input type="text" id="idn" inputmode="numeric" autocomplete="off" maxlength="10" required dir="ltr" style="text-align:right" value="${esc(pre.idNumber ?? '')}">${pre.idNumber ? preHint : ''}
    ${inputsHtml}
    <label>חתימה <span class="hint">— לחתום באצבע / בעכבר בתוך המסגרת</span></label>
    <div class="pad" id="pad"><canvas id="cv"></canvas><div class="ph" id="ph">כאן חותמים</div></div>
    <div class="row" style="margin-top:6px"><button type="button" class="btn" id="clear">ניקוי</button></div>
    <label class="check"><input type="checkbox" id="agree"><span>קראתי את המסמך במלואו, אני מסכים/ה לתנאיו, ואני מאשר/ת שהחתימה האלקטרונית שלי מחייבת כמו חתימה בכתב יד.</span></label>
    <div class="err" id="err" role="alert"></div>
    <button type="submit" class="btn primary" id="go">אני מאשר/ת וחותם/ת</button>
    <p class="hint" style="margin-top:10px">עם החתימה נשמרים לתיעוד: השם, ת"ז, החתימה, מועדי הפתיחה והחתימה, כתובת ה-IP והמכשיר${row.require_otp ? ', אימות הקוד החד-פעמי' : ''}, וטביעה של המסמך.</p>
  </form></div>
<script>
(function(){
  var API='/api/s/${encodeURIComponent(token)}', PDF=${pdf ? 'true' : 'false'}, TODAY=${JSON.stringify(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).format(opts.now ?? new Date()))};
  function post(b){return fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()})}
  // "נפתח" — רק כשהדף באמת נפתח בדפדפן (לא תצוגה מקדימה של הקישור בוואטסאפ/מייל)
  post({action:'open'}).catch(function(){});
  var oe=document.getElementById('otpErr');
  function otpMsg(m,ok){if(!oe)return;oe.textContent=m;oe.style.display=m?'block':'none';oe.style.background=ok?'var(--ok-bg)':'';oe.style.color=ok?'var(--ok)':''}
  var os=document.getElementById('otpSend');if(os)os.onclick=function(){os.disabled=true;post({action:'otp_send'}).then(function(j){otpMsg(j.ok?'הקוד נשלח ל-'+j.to+(j.to.indexOf('@')>0?' (גם בספאם)':''):(j.error||'השליחה נכשלה'),j.ok);setTimeout(function(){os.disabled=false},j.ok?60000:2000)}).catch(function(){otpMsg('אין חיבור');os.disabled=false})};
  var og=document.getElementById('otpGo');if(og)og.onclick=function(){var c=document.getElementById('otpCode').value.replace(/\D/g,'');if(c.length!==6)return otpMsg('6 ספרות');og.disabled=true;post({action:'otp_verify',code:c}).then(function(j){og.disabled=false;if(j.ok){document.getElementById('otp').style.display='none';document.getElementById('f').hidden=false;setTimeout(size,0)}else otpMsg(j.error||'קוד שגוי')}).catch(function(){og.disabled=false;otpMsg('אין חיבור')})};
  var cv=document.getElementById('cv'),pad=document.getElementById('pad'),ph=document.getElementById('ph'),ctx=cv.getContext('2d'),drawing=false,pts=0,last=null;
  function size(){var r=pad.getBoundingClientRect(),d=window.devicePixelRatio||1,img=pts?cv.toDataURL():null;cv.width=Math.round(r.width*d);cv.height=Math.round(r.height*d);ctx.setTransform(d,0,0,d,0,0);ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#111827';if(img){var i=new Image();i.onload=function(){ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(i,0,0,cv.width,cv.height);ctx.setTransform(d,0,0,d,0,0)};i.src=img}}
  function p(e){var r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
  cv.addEventListener('pointerdown',function(e){drawing=true;last=p(e);cv.setPointerCapture(e.pointerId);ph.style.display='none';e.preventDefault()});
  cv.addEventListener('pointermove',function(e){if(!drawing)return;var q=p(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(q.x,q.y);ctx.stroke();last=q;pts++;e.preventDefault()});
  ['pointerup','pointercancel','pointerleave'].forEach(function(t){cv.addEventListener(t,function(){drawing=false})});
  document.getElementById('clear').onclick=function(){ctx.clearRect(0,0,cv.width,cv.height);pts=0;ph.style.display=''};
  window.addEventListener('resize',size);size();
  // טופס PDF: העמודים (pdf.js) + מילוי חי של השדות שלי
  function trimmed(){var w=cv.width,h=cv.height,d=ctx.getImageData(0,0,w,h).data,x0=w,y0=h,x1=-1,y1=-1;for(var y=0;y<h;y++)for(var x=0;x<w;x++){if(d[(y*w+x)*4+3]>10){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}}if(x1<0)return cv.toDataURL('image/png');var m=6;x0=Math.max(0,x0-m);y0=Math.max(0,y0-m);x1=Math.min(w-1,x1+m);y1=Math.min(h-1,y1+m);var o=document.createElement('canvas');o.width=x1-x0+1;o.height=y1-y0+1;o.getContext('2d').drawImage(cv,x0,y0,o.width,o.height,0,0,o.width,o.height);return o.toDataURL('image/png')}
  function initials(n){return n.trim().split(/\s+/).filter(Boolean).slice(0,3).map(function(w){return w[0]+'.'}).join('')}
  function preview(){if(!PDF)return;var name=document.getElementById('name').value.trim(),idn=document.getElementById('idn').value.replace(/\D/g,''),sig=pts>=12?trimmed():null;
    document.querySelectorAll('.fld:not(.other)').forEach(function(el){var k=el.getAttribute('data-k'),id=el.getAttribute('data-f'),v='';
      if(k==='signature'){if(sig){el.innerHTML='<img alt="" src="'+sig+'">';el.classList.add('filled')}return}
      if(k==='name')v=name;else if(k==='id_number')v=idn;else if(k==='date')v=TODAY;else if(k==='initials')v=initials(name);
      else{var inp=document.querySelector('[data-fid="'+id+'"]');if(inp)v=inp.type==='checkbox'?(inp.checked?'X':''):inp.value}
      if(v){el.innerHTML='<span class="t"></span>';el.firstChild.textContent=v;el.classList.add('filled')}})}
  if(PDF){['name','idn'].forEach(function(i){document.getElementById(i).addEventListener('input',preview)});document.querySelectorAll('[data-fid]').forEach(function(i){i.addEventListener('input',preview);i.addEventListener('change',preview)});cv.addEventListener('pointerup',preview);
    preview();
    var s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';s.onerror=function(){document.getElementById('pdfFallback').style.display='block'};
    s.onload=function(){var lib=window.pdfjsLib;lib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      lib.getDocument({url:API+'/file'}).promise.then(function(doc){document.querySelectorAll('.pg').forEach(function(box){var i=+box.getAttribute('data-pg');doc.getPage(i+1).then(function(pg){var c=box.querySelector('canvas'),vw=pg.getViewport({scale:1}),sc=box.clientWidth*(window.devicePixelRatio||1)/vw.width,v=pg.getViewport({scale:sc});c.width=Math.round(v.width);c.height=Math.round(v.height);pg.render({canvasContext:c.getContext('2d'),viewport:v})})})})
        .catch(function(){document.getElementById('pdfFallback').style.display='block'})};document.head.appendChild(s)}
  var err=document.getElementById('err'),go=document.getElementById('go');
  function show(m){err.innerHTML=m.map(function(x){return'<div>'+x.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})+'</div>'}).join('');err.style.display=m.length?'block':'none'}
  document.getElementById('f').addEventListener('submit',function(e){
    e.preventDefault();var name=document.getElementById('name').value.trim(),idn=document.getElementById('idn').value,agree=document.getElementById('agree').checked,m=[];
    var values={};document.querySelectorAll('[data-fid]').forEach(function(i){values[i.getAttribute('data-fid')]=i.type==='checkbox'?i.checked:i.value.trim()});
    if(name.length<2)m.push('נא למלא שם מלא');if(!/^\\d{5,9}$/.test(idn.replace(/\\D/g,'')))m.push('נא למלא מספר תעודת זהות');if(pts<12)m.push('נא לחתום במסגרת');if(!agree)m.push('נא לאשר שקראת את ההסכם ושאתה מסכים לו');
    show(m);if(m.length)return;go.disabled=true;go.textContent='שומר את החתימה…';
    var w=document.createElement('canvas');w.width=cv.width;w.height=cv.height;var g=w.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,w.width,w.height);g.drawImage(cv,0,0);
    // טופס PDF: חתימה שקופה וחתוכה — נכתבת על הטופס בלי מלבן לבן
    post({name:name,idNumber:idn,signature:PDF?trimmed():w.toDataURL('image/png'),agree:true,values:values})
      .then(function(j){if(j.ok){document.querySelector('.wrap').innerHTML='<div class="card done"><h1>נחתם — תודה!</h1><p>${total > 1 ? 'כשכל החותמים יחתמו יישלח אליך עותק חתום.' : 'עותק חתום יישלח אליך.'}</p></div>';window.scrollTo(0,0)}else{show(j.errors||['השמירה נכשלה — נסו שוב']);go.disabled=false;go.textContent='אני מאשר/ת וחותם/ת'}})
      .catch(function(){show(['אין חיבור — נסו שוב']);go.disabled=false;go.textContent='אני מאשר/ת וחותם/ת'});
  });
})();
</script>`
  return shell(row.title, body)
}

/** פרטים מהתיק מול מה שהחותם הזין (ת"ז ושם) — לתיעוד הזיהוי */
function identityRow(r: SignRow): string {
  const pre = r.fields?.['@prefill']
  if (!pre?.name && !pre?.idNumber) return ''
  const chk = identityCheck(pre, String(r.signer_name ?? ''), String(r.signer_id_number ?? ''))
  const mark = (v: boolean | null) => (v === null ? '' : v ? ' ✓ תואם' : ' ✗ שונה ממה שהוזן')
  return `<tr><td>פרטים בתיק לפני החתימה</td><td>${pre.name ? esc(pre.name) + mark(chk.name) : ''}${pre.name && pre.idNumber ? ' · ' : ''}${pre.idNumber ? 'ת"ז ' + esc(pre.idNumber) + mark(chk.id) : ''}</td></tr>`
}

/** ציר הזמן של החותם: שליחה, כל פתיחה, קוד, חתימה — עם IP ומכשיר */
function eventsTable(r: SignRow): string {
  const ev = Array.isArray(r.fields?.['@events']) ? r.fields['@events'] : []
  if (!ev.length) return ''
  return `<div class="hint" style="margin:8px 0 2px">ציר הזמן</div><table>${ev.map((e) => `<tr><td>${esc(il(e.at))}</td><td>${esc(SIGN_EVENT_LABELS[e.kind] ?? e.kind)}${e.detail ? ' · ' + esc(e.detail) : ''}${e.ip ? ' · <span class="mono">' + esc(e.ip) + '</span>' : ''}${e.ua ? ' · ' + esc(deviceLabel(e.ua)) : ''}</td></tr>`).join('')}</table>`
}

export function printPage(env: EnvelopeRow, rows: SignRow[], opts: { auditOnly?: boolean; stamp?: string | null } = {}): string {
  const company = COMPANY[env.division] ?? 'הר-אל'
  const signed = rows.filter((r) => r.status === 'signed')
  const css = `<style>@page{size:A4}body{background:#fff;color:#111827;font-size:13.5px}.wrap{max-width:none;padding:0}.card{border:0;padding:0}
  .sigs{display:flex;flex-wrap:wrap;gap:24px 36px;border-top:1px solid #E6E8EC;padding-top:12px;margin-top:18px}.sig img{height:84px;border-bottom:1px solid #111827;display:block}
  table{border-collapse:collapse;width:100%;font-size:12px}td{border-bottom:1px solid #E6E8EC;padding:6px 4px;vertical-align:top}td:first-child{color:#6B7280;width:30%}
  .audit{page-break-before:always}.doc2{page-break-before:always}.pagebreak{page-break-before:always;break-before:page}
  .signhere-row{display:flex;flex-wrap:wrap;gap:16px 32px;align-items:flex-end;margin:10px 0 16px}.sig img.stamp{height:96px;border:0;opacity:.95}.mono{font-family:ui-monospace,Menlo,monospace;direction:ltr;text-align:right;word-break:break-all}h3{font-size:14px;margin:16px 0 4px}</style>`
  const stampSig = opts.stamp ? `<div class="sig"><img class="stamp" src="${esc(opts.stamp)}" alt="חותמת החברה"><div>${esc(company)}</div><div class="hint">חותמת וחתימת החברה</div></div>` : ''
  const sig = (r: SignRow) => `<div class="sig"><img src="${esc(r.signature_png)}" alt="חתימה"><div>${esc(r.signer_name)}${r.signer_label && r.signer_label !== 'הלקוח' ? ' · ' + esc(r.signer_label) : ''}</div><div class="hint">ת"ז ${esc(r.signer_id_number)} · ${esc(il(r.signed_at))}</div></div>`
  // חותמים עם אותו נוסח — חתימות זו לצד זו; נוסח נפרד לחותם — עמוד משלו
  const docs = groupByDocument(signed).map((g, i) => `<div class="${i ? 'doc2' : ''}">${i ? `<h2>${esc(env.title)} — ${esc(g.rows.map((r) => r.signer_label ?? r.signer_name).join(', '))}</h2>` : ''}<div class="doc" style="margin-top:14px">${String(g.rows[0]!.body_html).split(SIGN_HERE_HTML).join(`<div class="signhere-row">${g.rows.map(sig).join('')}${stampSig}</div>`)}</div>${String(g.rows[0]!.body_html).includes(SIGN_HERE_HTML) ? '' : `<div class="sigs">${g.rows.map(sig).join('')}${stampSig}</div>`}</div>`).join('')
  const auditRows = (r: SignRow) => `<h3>${esc(r.signer_name)}${r.signer_label ? ' · ' + esc(r.signer_label) : ''}</h3><table>
    <tr><td>מזהה חותם</td><td class="mono">${esc(r.id)}</td></tr>
    <tr><td>טביעת הנוסח (SHA-256)</td><td class="mono">${esc(r.doc_hash)}</td></tr>
    <tr><td>נשלח</td><td>${esc(il(r.created_at))}${r.send_email ? ' · במייל ל-' + esc(r.send_email) : ''}${r.send_phone ? ' · וואטסאפ ' + esc(r.send_phone) : ''}${r.reminders_sent ? ' · תזכורות: ' + r.reminders_sent : ''}</td></tr>
    <tr><td>נפתח לראשונה</td><td>${esc(il(r.opened_at))}</td></tr>
    ${r.require_otp ? `<tr><td>אימות קוד ${r.send_email ? 'במייל' : 'בוואטסאפ'}</td><td>${esc(il(r.otp_verified_at))}</td></tr>` : ''}
    <tr><td>נחתם</td><td>${esc(il(r.signed_at))}</td></tr>
    <tr><td>החותם</td><td>${esc(r.signer_name)} · ת"ז ${esc(r.signer_id_number)}</td></tr>
    <tr><td>כתובת IP</td><td class="mono">${esc(r.signer_ip ?? '—')}</td></tr>
    <tr><td>מכשיר / דפדפן</td><td>${esc(deviceLabel(r.signer_ua))}<div class="mono hint">${esc(r.signer_ua ?? '—')}</div></td></tr>
    ${identityRow(r)}
    ${env.pdf_fields ? `<tr><td>שדות שמולאו</td><td>${esc(fieldsOf(env.pdf_fields, r.signer_order).filter((f) => f.kind === 'text' || f.kind === 'checkbox')
      .map((f) => (f.label || FIELD_KINDS[f.kind]) + ': ' + (f.kind === 'checkbox' ? (r.field_values?.[f.id] ? 'סומן' : 'לא סומן') : r.field_values?.[f.id] || '—')).join(' · ') || '—')}</td></tr>` : ''}
    ${r.fields?.['@notes'] ? `<tr><td>הערות השולח</td><td style="white-space:pre-wrap">${esc(r.fields['@notes'])}</td></tr>` : ''}</table>${eventsTable(r)}`
  if (opts.auditOnly) return shell(env.title, `<div class="wrap"><div class="hint">${esc(company)} · ${esc(SIGN_CATEGORIES[env.category] ?? '')}</div>
  <h2 style="margin-top:0">עמוד תיעוד חתימה</h2><table><tr><td>מסמך</td><td>${esc(env.title)}${env.page_sizes ? ' · ' + env.page_sizes.length + ' עמודים (המסמך המקורי, לפני עמוד זה)' : ''}</td></tr>
  <tr><td>עבור</td><td>${esc(env.client_name)}${env.recipient_kind === 'lead' ? ' (מתעניין)' : ''}${env.lender ? ' · ' + esc(env.lender) : ''}</td></tr>
  <tr><td>מזהה מסמך</td><td class="mono">${esc(env.id)}</td></tr><tr><td>הושלם</td><td>${esc(il(env.completed_at))} · ${signed.length} חותמים</td></tr></table>
  ${signed.map(auditRows).join('')}
  <p class="hint" style="margin-top:12px">כל חותם חתם דרך קישור אישי שנשלח אליו בלבד (הקישור הוא סוד חד-פעמי; במערכת נשמרת רק טביעה שלו). החתימות, השמות, מספרי הזהות והתאריכים נכתבו על המסמך המקורי במקומות שסומנו לפני השליחה; טביעת המסמך, השדות וההערות של כל חותם מופיעה למעלה, וטביעת הקובץ החתום כולו נשלחה במייל לחותמים ולמשרד. השעות לפי שעון ישראל.</p></div>`, css)
  const body = `<div class="wrap">
  <div class="hint">${esc(company)} · ${esc(SIGN_CATEGORIES[env.category] ?? '')}</div><h1>${esc(env.title)}</h1><div class="hint">עבור ${esc(env.client_name)}${env.lender ? ' · ' + esc(env.lender) : ''}</div>
  ${docs}
  <div class="audit"><h2>עמוד תיעוד חתימה</h2><table><tr><td>מסמך</td><td>${esc(env.title)}</td></tr><tr><td>מזהה מסמך</td><td class="mono">${esc(env.id)}</td></tr><tr><td>הושלם</td><td>${esc(il(env.completed_at))} · ${signed.length} חותמים</td></tr></table>
  ${signed.map(auditRows).join('')}
  <p class="hint" style="margin-top:12px">כל חותם חתם דרך קישור אישי שנשלח אליו בלבד. הנוסח שהוצג לכל חותם נשמר כפי שנשלח וטביעתו מופיעה למעלה; כל שינוי בנוסח משנה את הטביעה. השעות לפי שעון ישראל.</p></div></div>`
  return shell(env.title, body, css)
}
