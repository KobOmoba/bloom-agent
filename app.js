// ── Firebase ───────────────────────────────────────────────────────────────
const FB = { apiKey:"AIzaSyCVEdunn3AZndDP5Rm1Z3Kv1e6G6W2mB_o", authDomain:"educationbloom-699ed.firebaseapp.com", projectId:"educationbloom-699ed", storageBucket:"educationbloom-699ed.firebasestorage.app", messagingSenderId:"33750392965", appId:"1:33750392965:web:2b3da887ede996ea8389ec" };
let db = null;
try {
  firebase.initializeApp(FB);
  db = firebase.firestore();
  // ✅ FIX: Enable offline persistence — Firestore caches all data locally.
  // After an agent logs in once, the app works fully without internet.
  db.enablePersistence({ synchronizeTabs: true })
    .then(() => console.log('✅ Offline persistence enabled'))
    .catch(err => {
      // failed-precondition = multiple tabs open (one tab still works offline)
      // unimplemented = very old browser — ignored gracefully
      if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
        console.warn('Persistence error:', err.code);
      }
    });
} catch(e){ console.warn('Firebase:',e); }

// ── State ──────────────────────────────────────────────────────────────────
let agent = null;    // { id, name, phone, commission }
let selTier = null;
const TIERS_LIST = [
  {max:50,  price:10000, name:'Starter (1-50 students)'},
  {max:100, price:20000, name:'Small (51-100 students)'},
  {max:200, price:35000, name:'Medium (101-200 students)'},
  {max:350, price:55000, name:'Large (201-350 students)'},
  {max:9999,price:75000, name:'Enterprise (351+ students)'}
];
  // { price, name, max }
const TIERS = [
  { price:10000, name:'Starter (1–50)',    max:50  },
  { price:20000, name:'Small (51–100)',    max:100 },
  { price:35000, name:'Medium (101–200)',  max:200 },
  { price:55000, name:'Large (201–350)',   max:350 },
  { price:75000, name:'Enterprise (351+)', max:9999 },
];

// ── Sync queue ─────────────────────────────────────────────────────────────
const SQ = {
  q: JSON.parse(localStorage.getItem('ag_sq')||'[]'),
  save(){ localStorage.setItem('ag_sq', JSON.stringify(this.q)); },
  push(op){ this.q.push({ id: Date.now().toString(36)+Math.random().toString(36).slice(2), op, tries:0 }); this.save(); this.run(); },
  ping(){ const ok=navigator.onLine&&!!db; const el=document.getElementById('sync'); if(el){ el.className='dot '+(ok?this.q.length?'dot-sync':'dot-on':'dot-off'); el.textContent=ok?this.q.length?'● Syncing':'● Online':'● Offline'; } if(ok&&this.q.length) this.run(); },
  async run(){
    if(!db||!navigator.onLine||!this.q.length) return;
    const items=[...this.q];
    for(const item of items){
      try{ await this.exec(item.op); this.q=this.q.filter(x=>x.id!==item.id); }
      catch(e){ item.tries++; if(item.tries>3) this.q=this.q.filter(x=>x.id!==item.id); }
    }
    this.save(); this.ping();
  },
  async exec(op){ if(op.t==='deal') await db.collection('admin_deals').add(op.d); }
};
window.addEventListener('online', ()=>{ SQ.ping(); SQ.run(); });
window.addEventListener('offline', ()=>SQ.ping());

// ── Helpers ────────────────────────────────────────────────────────────────
const esc = s => { if(!s)return''; const d=document.createElement('div'); d.textContent=s; return d.innerHTML; };
const $ = id => document.getElementById(id);
const fmt = n => '₦'+Number(n).toLocaleString('en-NG');

// ── Login ──────────────────────────────────────────────────────────────────
function setTab(mode){
  $('phone-form').style.display = mode==='phone' ? 'block' : 'none';
  $('register-form').style.display = mode==='register' ? 'block' : 'none';
  document.querySelectorAll('.ltab').forEach((t,i)=>t.classList.toggle('on',(i===0&&mode==='phone')||(i===1&&mode==='register')));
  $('login-err').style.display='none';
}

// Convert any Nigerian phone format to 234XXXXXXXXXX
function normalizePhone(raw){
  let p = raw.trim().replace(/\D/g,'');
  if(p.startsWith('0') && p.length === 11) return '234' + p.slice(1);
  if(p.startsWith('234') && p.length === 13) return p;
  if(p.length === 10) return '234' + p;
  return p;
}

async function doLogin(){
  const raw = $('l-phone').value.trim();
  const phone = normalizePhone(raw);
  const localFmt = phone.startsWith('234') ? '0' + phone.slice(3) : phone;

  if(phone.length < 10){
    showErr('Enter your WhatsApp number — e.g. 08038740131 or 2348038740131');
    return;
  }
  const btn=$('l-btn'); btn.textContent='Checking...'; btn.disabled=true;
  $('login-err').style.display='none';

  // ✅ Step 1: check localStorage cache first — works offline after first login
  const cached = localStorage.getItem('ag_agent');
  if(cached){
    try{
      const cachedAgent = JSON.parse(cached);
      const cachedPhone = normalizePhone(cachedAgent.phone || '');
      if(cachedPhone === phone || cachedAgent.phone === localFmt || cachedPhone === localFmt){
        agent = cachedAgent;
        // Silently refresh from Firestore in background if online
        if(navigator.onLine && db){
          refreshAgentBackground(cachedAgent.id, phone, localFmt).catch(()=>{});
        }
        startApp();
        btn.textContent='▶ Login'; btn.disabled=false;
        return;
      }
    }catch(e){ localStorage.removeItem('ag_agent'); }
  }

  // ✅ Step 2: first-time login — needs internet to find agent record in Firestore
  if(!navigator.onLine || !db){
    showErr('First login needs internet. Connect once — after that you can work offline anytime.');
    btn.textContent='▶ Login'; btn.disabled=false;
    return;
  }

  try {
    // Search both formats — admin may have saved with or without country code
    const [snap1, snap2] = await Promise.all([
      db.collection('admin_agents').where('phone','==',phone).get(),
      db.collection('admin_agents').where('phone','==',localFmt).get()
    ]);
    // Deduplicate by document ID
    const seen = new Set();
    const allDocs = [...snap1.docs, ...snap2.docs].filter(d=>{
      if(seen.has(d.id)) return false; seen.add(d.id); return true;
    });

    if(!allDocs.length){
      showErr('Number not registered. Ask Bayo (AariNAT) to add you: +234 814 507 3941');
      btn.textContent='▶ Login'; btn.disabled=false; return;
    }
    const doc = allDocs[0];
    agent = { id:doc.id, ...doc.data() };
    localStorage.setItem('ag_agent', JSON.stringify(agent));
    startApp();
  } catch(e){
    const msg = e?.message||'';
    if(msg.toLowerCase().includes('permission') || msg.includes('PERMISSION_DENIED')){
      showErr('Firebase permission error. Ask Bayo to fix the Firestore Rules: +234 814 507 3941');
    } else if(!navigator.onLine){
      showErr('No internet. First login needs a connection — offline works after that.');
    } else {
      showErr('Failed: ' + (msg.slice(0,100)||'unknown error'));
    }
    console.error('Login error:', e);
  }
  btn.textContent='▶ Login'; btn.disabled=false;
}

// Silently refresh cached agent profile from Firestore in background
async function refreshAgentBackground(agentId, phone, localFmt){
  try{
    let doc = await db.collection('admin_agents').doc(agentId).get();
    if(!doc.exists){
      const [s1,s2] = await Promise.all([
        db.collection('admin_agents').where('phone','==',phone).get(),
        db.collection('admin_agents').where('phone','==',localFmt).get()
      ]);
      const d = [...s1.docs, ...s2.docs][0];
      if(!d) return;
      doc = d;
    }
    const fresh = { id:doc.id, ...doc.data() };
    localStorage.setItem('ag_agent', JSON.stringify(fresh));
    if(agent && agent.id === fresh.id) agent = fresh;
  }catch(e){ /* silent — cached profile is valid */ }
}

async function doRegister(){
  // Self-registration is not allowed — agents must be added by admin
  showErr("You can't self-register. AariNAT must add you. Call +234 814 507 3941");
}

function showErr(msg){ const e=$('login-err'); e.textContent=msg; e.style.display='block'; }

function startApp(){
  $('login').style.display='none';
  // Use 'flex' for the app — it uses flex layout for header/main/nav stacking
  $('app').style.display='flex';
  $('app').style.flexDirection='column';
  $('agent-name-hdr').textContent=agent.name;
  SQ.ping();
  go('submit');
}

function logout(){ if(!confirm('Logout?'))return; localStorage.removeItem('ag_agent'); location.reload(); }

// ── Navigation ─────────────────────────────────────────────────────────────
function go(tab){
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.nlink').forEach(b=>b.classList.remove('on'));
  $(`sec-${tab}`).classList.add('on');
  const btn=document.querySelector(`[data-tab="${tab}"]`);
  if(btn) btn.classList.add('on');
  if(tab==='deals') renderDeals();
  if(tab==='earnings') renderEarnings();
}

// ── Submit Deal ────────────────────────────────────────────────────────────
function selectTier(el, price, name, max){
  document.querySelectorAll('.tier').forEach(t=>t.classList.remove('sel'));
  el.classList.add('sel');
  selTier={price,name,max};
  updateCommission();
}

function autoTier(){
  const n=parseInt($('s-count').value)||0;
  if(!n)return;
  const t=TIERS_LIST.find(x=>n<=x.max)||TIERS_LIST[4];
  document.querySelectorAll('.tier').forEach((el,i)=>{
    el.classList.toggle('sel', TIERS_LIST[i]?.name===t.name);
  });
  selTier=t;
  updateCommission();
}

function updateCommission(){
  if(!selTier)return;
  const terms=parseInt($('s-terms').value)||1;
  const total=selTier.price*terms;
  const comm=Math.round(total*((agent.commission||20)/100));
  $('comm-box').style.display='block';
  $('comm-amt').textContent=fmt(comm);
  $('comm-total').textContent=`Total school pays: ${fmt(total)} for ${terms} term${terms>1?'s':''}`;
}

async function submitDeal(){
  const name=$('s-name').value.trim();
  const phone=$('s-phone').value.trim().replace(/\D/g,'');
  const email=$('s-email').value.trim();
  const count=parseInt($('s-count').value)||0;
  const terms=parseInt($('s-terms').value)||1;
  const notes=$('s-notes').value.trim();
  const fb=$('submit-fb');

  if(!name){ showFB(fb,'bad','Enter the school name.'); return; }
  if(!phone||phone.length<10){ showFB(fb,'bad','Enter principal\'s WhatsApp (e.g. 2348012345678).'); return; }
  if(!count||count<1){ showFB(fb,'bad','Enter approximate number of students.'); return; }
  if(!selTier){ showFB(fb,'bad','Select a pricing tier.'); return; }

  const btn=$('submit-btn'); btn.textContent='Submitting...'; btn.disabled=true;
  const deal={
    timestamp:new Date(), status:'pending',
    agent:{ id:agent.id, name:agent.name, phone:agent.phone, commission:agent.commission||20 },
    school:{ name, phone, email, studentCount:count },
    tier:{ name:selTier.name, price:selTier.price },
    terms, notes,
    // AI-scanned student names — used by onboarding agent to pre-load school
    scannedStudents: csvParsedNames.length ? csvParsedNames : [],
    scannedCount: csvParsedNames.length || 0,
    onboardingStatus: 'awaiting_principal'
  };

  try{
    if(db&&navigator.onLine){ await db.collection('admin_deals').add(deal); }
    else{ SQ.push({t:'deal',d:deal}); }
    showFB(fb,'ok',`✅ "${name}" submitted! ${navigator.onLine?'':'(Saved offline — will reach Bayo when internet returns.) '}Your commission will be ${fmt(Math.round(selTier.price*terms*((agent.commission||20)/100))/1)} on approval.`);
    pipelineReset();
    // ✅ Command center stays in control — no direct principal contact from agent app.
    // Bayo reviews the deal, generates school code, and sends the onboarding link.
    // Agent's job is done at submission.
    // Reset form
	['s-name','s-phone','s-email','s-count','s-notes'].forEach(id=>$(id).value='');
    $('s-terms').value='1';
    document.querySelectorAll('.tier').forEach(t=>t.classList.remove('sel'));
    selTier=null; $('comm-box').style.display='none';
    resetCSVCount();
  }catch(e){
    // Write failed — queue it so the deal is never lost
    SQ.push({t:'deal',d:deal});
    showFB(fb,'ok',`📥 "${name}" saved offline — will reach Bayo when connection returns.`);
    console.warn('submitDeal write failed, queued:', e?.message);
  }
  btn.textContent='📤 Submit to Bayo'; btn.disabled=false;
}

function showFB(el,type,msg){ el.className=`feedback ${type}`; el.textContent=msg; el.style.display='block'; }

// ── My Deals ───────────────────────────────────────────────────────────────
async function renderDeals(){
  const c=$('deals-list'); c.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">Loading...</p>';

  // Always show offline-queued deals first (they exist even without internet)
  const queued = SQ.q
    .filter(x => x.op?.t === 'deal' && x.op?.d?.agent?.id === agent.id)
    .map(x => ({ _queuedId: x.id, _offline: true, ...x.op.d }));

  let deals = [];
  try{
    // Try by agent.id first (most reliable), fall back to agent.phone
    const snap = await db.collection('admin_deals').where('agent.id','==',agent.id).get();
    deals = snap.docs.map(d=>({id:d.id,...d.data()}));
    if(!deals.length){
      // Fallback for deals submitted before agent had an ID cached
      const snap2 = await db.collection('admin_deals').where('agent.phone','==',agent.phone).get();
      deals = snap2.docs.map(d=>({id:d.id,...d.data()}));
    }
    deals.sort((a,b)=>{ const ta=a.timestamp?.toDate?a.timestamp.toDate():new Date(a.timestamp||0); const tb=b.timestamp?.toDate?b.timestamp.toDate():new Date(b.timestamp||0); return tb-ta; });
  }catch(e){ /* offline — queued deals still show */ }

  const allDeals = [...queued, ...deals];
  if(!allDeals.length){ c.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">No deals yet. Submit your first school!</p>'; return; }

  c.innerHTML=allDeals.map(d=>{
    const isOffline = !!d._offline;
    const status = isOffline ? 'queued' : (d.status||'pending');
    const chipCls = status==='approved'?'chip-a':status==='rejected'?'chip-r':'chip-p';
    const comm=Math.round((d.tier?.price||0)*((d.agent?.commission||20)/100)*(d.terms||1));
    const ts = isOffline ? 'Saved offline — syncing when online' :
      (d.timestamp?.toDate ? d.timestamp.toDate().toLocaleDateString('en-NG') : 'just now');
    return `<div class="deal ${status==='approved'?'appr':status==='rejected'?'rejt':'pend'}" style="${isOffline?'opacity:0.85;':''}">
      <span class="chip ${chipCls}">${status.toUpperCase()}</span>
      <div class="deal-name">${esc(d.school?.name)}</div>
      <div class="deal-meta">📊 ${d.school?.studentCount||0} students · ${esc(d.tier?.name||'—')}</div>
      <div class="deal-meta">📱 ${esc(d.school?.phone||'—')}</div>
      <div class="deal-meta" style="color:var(--money);font-weight:600;">Your commission: ${fmt(comm)}</div>
      <div class="deal-meta" style="font-size:0.72rem;color:var(--sub);">${ts}</div>
      ${d.schoolId?`<div class="deal-meta" style="color:#60a5fa;">School ID: ${d.schoolId}</div>`:''}
      ${isOffline?`<div class="deal-meta" style="color:#fbbf24;font-size:0.72rem;">⏳ Will reach Bayo when internet returns</div>`:''}
      ${status==='approved'?`<div style="margin-top:0.5rem;"><button class="btn-money btn-sm" onclick="resendOnboarding('${esc(d.school?.phone)}','${esc(d.school?.name)}','${d.schoolId||''}')">📲 Send Onboarding WhatsApp</button></div>`:''}
    </div>`;
  }).join('');
}

function resendOnboarding(phone, schoolName, schoolId){
  const msg=`Hi! I'm your Educational Bloom agent.\n\nYour school "${schoolName}" has been activated! 🎉\n\n*School ID:* ${schoolId}\n\nLog in at: https://kobomoba.github.io/bloom-portal/\n\nI'll guide you through the setup. Call me anytime! 📞\n– ${agent.name}`;
  window.open(`https://wa.me/${phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`,'_blank');
}

// ── Earnings ───────────────────────────────────────────────────────────────
async function renderEarnings(){
  try{
    const snap=await db.collection('admin_ledger').where('agentPhone','==',agent.phone).get();
    const entries=snap.docs.map(d=>({id:d.id,...d.data()}));
    const total=entries.reduce((s,e)=>s+(e.amount||0),0);
    const paid=entries.filter(e=>e.paid).reduce((s,e)=>s+(e.amount||0),0);
    $('earn-total').textContent=fmt(total);
    $('earn-paid').textContent=fmt(paid);
    $('earn-pending').textContent=fmt(total-paid);
    const tbody=$('earn-body');
    tbody.innerHTML=entries.length===0?'<tr><td colspan="4" style="text-align:center;color:var(--sub);padding:2rem;">No earnings yet.</td></tr>':entries.map(e=>{
      const dt=e.date?.toDate?e.date.toDate():new Date();
      const paidCls=e.paid?'chip-a':'chip-p';
      return `<tr><td>${dt.toLocaleDateString('en-NG',{day:'numeric',month:'short'})}</td><td style="font-size:0.75rem;">${e.schoolId||'—'}</td><td style="color:var(--money);font-weight:700;">${fmt(e.amount||0)}</td><td><span class="chip ${paidCls}" style="position:static;">${e.paid?'Paid':'Pending'}</span></td></tr>`;
    }).join('');
  }catch(e){ console.warn('Earnings:',e); }
}


// ── Smart Register Counter ─────────────────────────────────────────────────
// Accepts: CSV, TXT (WhatsApp lists), JPG/PNG photos of paper registers
// Photos: OCR via Tesseract.js loaded on demand — free, no API key needed

let csvStudentCount = 0;
let csvParsedNames  = [];



// Strip prefix titles and list markers, return cleaned name or false
function cleanName(raw) {
  // Strip leading numbering: "1.", "22.", "10.", "•", "-", "(1)"
  let s = raw.replace(/^[\s]*\d+[\.\)\s]+/, '').trim();
  s = s.replace(/^[\s\u2022\-\*]+/, '').trim();

  // Strip Nigerian title prefixes — keep everything after the last "." in prefix
  // Handles: Hon/Snr/Evang. | Sp/Ven/Evang. | MC. | C/E/B. | L/S/S/E/S. | M/C | C/P | S/P/S
  s = s.replace(/^((?:[A-Z][a-zA-Z]*\/)*[A-Z][a-zA-Z]*\.\s*)+/g, '').trim();
  // Also strip standalone abbreviation prefixes before the real name
  s = s.replace(/^(M\/C|MC|C\/P|S\/P\/S|C\/E\/B|L\/S\/[A-Z\/]+)\s+/i, '').trim();

  if (!s || s.length < 3) return null;

  const letters = s.replace(/[^a-zA-Z\s]/g, '').trim();
  if (letters.length < 3) return null;

  // Reject if too many special/garbage chars (OCR noise)
  const specialRatio = s.replace(/[a-zA-Z\s]/g, '').length / s.length;
  if (specialRatio > 0.35) return null;

  // Reject obvious non-names
  if (/^(general|members|list|students|class|section|total|name|s\/n|serial|no\.|page|date|school|am|pm|\d{1,2}:\d{2})/i.test(letters.trim())) return null;

  // Must be mostly letters
  const letterRatio = letters.length / Math.max(s.length, 1);
  if (letterRatio < 0.55) return null;

  // Must look like a name: at least one word with 2+ letters
  const words = s.split(/\s+/).filter(w => /[a-zA-Z]{2,}/.test(w));
  if (words.length < 1) return null;

  return s;
}

// Check if a line STARTS a new numbered entry (has leading number)
function isNumberedLine(line) {
  return /^\s*\d+[\.\)\s]/.test(line);
}

// Check if a line is a bullet/dash entry
function isBulletLine(line) {
  return /^\s*[\u2022\-\*]\s/.test(line);
}

function showLoading(msg) {
  // Drive pipeline to processing state
  const scan = document.getElementById('pipe-state-scan');
  const proc = document.getElementById('pipe-state-processing');
  const result = document.getElementById('pipe-state-result');
  const label = document.getElementById('pipe-step-label');
  if (scan)   scan.style.display   = 'none';
  if (proc)   proc.style.display   = 'block';
  if (result) result.style.display = 'none';
  if (label)  label.textContent    = 'AI Reading Register...';

  const ld = document.getElementById('csv-loading');
  if (ld) { ld.style.display = 'block'; ld.textContent = msg || 'AI reading...'; }

  // Animate progress bar
  let pct = 20;
  const bar = document.getElementById('pipe-progress-bar');
  if (bar) {
    bar.style.width = pct + '%';
    const interval = setInterval(() => {
      pct = Math.min(pct + 8, 85);
      bar.style.width = pct + '%';
      if (pct >= 85) clearInterval(interval);
    }, 600);
    bar._interval = interval;
  }
}

function renderCountResult(names) {
  const unique = [...new Set(names.map(n=>n.trim()).filter(n=>n.length>1))];

  // Hide processing state
  const proc = document.getElementById('pipe-state-processing');
  if (proc) proc.style.display = 'none';

  if (!unique.length) {
    pipelineReset();
    alert('No student names found.\n\nTip: Hold phone directly above the register. Flatten the page. Good lighting.');
    return;
  }

  csvStudentCount = unique.length;
  csvParsedNames  = unique.map(name => ({ name, class: null }));
  const tier = TIERS_LIST.find(t => csvStudentCount <= t.max) || TIERS_LIST[4];
  const comm = Math.round(tier.price * 0.20);

  // Update all count display elements (pipeline + legacy)
  ['csv-student-count'].forEach(id => { const e=document.getElementById(id); if(e) e.textContent=csvStudentCount; });
  ['csv-tier-name'].forEach(id => { const e=document.getElementById(id); if(e) e.textContent=tier.name; });
  ['csv-school-pays'].forEach(id => { const e=document.getElementById(id); if(e) e.textContent='\u20a6'+tier.price.toLocaleString('en-NG')+'/term'; });
  ['csv-your-comm'].forEach(id => { const e=document.getElementById(id); if(e) e.textContent='\u20a6'+comm.toLocaleString('en-NG'); });

  const preview = unique.slice(0, 12);
  const extra   = unique.length - preview.length;
  const previewHTML =
    '<strong style="display:block;margin-bottom:4px;color:white;font-size:0.73rem;">✅ ' + unique.length + ' names found — sample:</strong>' +
    preview.map(n => '<span style="display:inline-block;background:rgba(255,255,255,0.08);border-radius:5px;padding:2px 6px;margin:2px;font-size:0.7rem;color:#e2e8f0;">' + esc(n) + '</span>').join('') +
    (extra > 0 ? '<div style="font-size:0.7rem;color:var(--sub);margin-top:3px;">...and ' + extra + ' more</div>' : '');

  ['csv-name-preview'].forEach(id => { const e=document.getElementById(id); if(e) e.innerHTML=previewHTML; });

  // Show pipeline result state
  const scan   = document.getElementById('pipe-state-scan');
  const result = document.getElementById('pipe-state-result');
  const label  = document.getElementById('pipe-step-label');
  const dot    = document.getElementById('pipe-step-dot');
  if (scan)   scan.style.display   = 'none';
  if (result) result.style.display = 'block';
  if (label)  label.textContent    = 'STEP 2 — Confirm Student Count';
  if (dot)    dot.style.background = '#34d399';

  // Also auto-fill the student count field
  const scount = document.getElementById('s-count');
  if (scount) { scount.value = csvStudentCount; autoTier(); }
}

function pipelineReset() {
  const scan   = document.getElementById('pipe-state-scan');
  const proc   = document.getElementById('pipe-state-processing');
  const result = document.getElementById('pipe-state-result');
  const label  = document.getElementById('pipe-step-label');
  const dot    = document.getElementById('pipe-step-dot');
  if (scan)   scan.style.display   = 'block';
  if (proc)   proc.style.display   = 'none';
  if (result) result.style.display = 'none';
  if (label)  label.textContent    = 'STEP 1 — Scan the School Register';
  if (dot)    dot.style.background = '#7c3aed';
  csvStudentCount = 0; csvParsedNames = [];
  const scount = document.getElementById('s-count'); if(scount) scount.value='';
}

function pipelineRescan() { pipelineReset(); }

function pipelineConfirmCount() {
  // Move to step 3: fill school info
  const label = document.getElementById('pipe-step-label');
  const dot   = document.getElementById('pipe-step-dot');
  if (label) label.textContent = 'STEP 3 — Fill School Details & Submit';
  if (dot)   dot.style.background = '#fbbf24';

  // Auto-fill count and auto-select tier
  const scount = document.getElementById('s-count');
  if (scount) { scount.value = csvStudentCount; autoTier(); }

  // Scroll smoothly to school name field
  const nameField = document.getElementById('s-name');
  if (nameField) {
    nameField.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nameField.focus();
  }
  // Show a quick toast
  pipelineToast('✅ Count locked! Now fill in school name + principal contact.');
}

function pipelineToast(msg) {
  let t = document.getElementById('pipe-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'pipe-toast';
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#059669;color:#fff;padding:0.6rem 1.2rem;border-radius:20px;font-size:0.82rem;font-weight:700;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);pointer-events:none;transition:opacity 0.4s;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

function handleRegisterCSV(e) {
  const files = Array.from(e.target.files || []); if (!files.length) return;
  e.target.value = '';
  pipelineReset();

  const ocrFiles = files.filter(f => {
    const n = (f.name||'').toLowerCase(), t = (f.type||'').toLowerCase();
    return t.startsWith('image/') || t === 'application/pdf'
        || /\.(jpg|jpeg|png|webp|bmp|heic|heif|pdf)$/.test(n);
  });
  const textFiles = files.filter(f => !ocrFiles.includes(f));
  textFiles.forEach(f => { showLoading('📄 Reading file...'); readTextOrCSV(f); });

  if (ocrFiles.length) {
    const apiKey = window.GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || GEMINI_KEY;
    if (!apiKey) {
      showGeminiKeyPrompt(() => processImagesSequentially(ocrFiles));
    } else {
      processImagesSequentially(ocrFiles);
    }
  }
}


// ═══════════════════════════════════════════════════════
// OCR ENGINE — identical to school.edubloom.com.ng
// Gemini Vision (primary) → OCR.space (fallback)
// ═══════════════════════════════════════════════════════

// ── Gemini Flash OCR (Structured Outputs) — PRIMARY OCR ──────────────────
// Key stored encoded; managed via AariNAT Command Center Settings
const GEMINI_KEY  = window.GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || '';  // Set via settings or key prompt
const GEMINI_MODELS = ['gemini-2.0-flash','gemini-2.0-flash-exp','gemini-1.5-flash','gemini-1.5-flash-latest'];

const GEMINI_PROMPT = `You are reading a Nigerian primary/secondary school fee register.
The register has columns: SERIAL NO | SURNAME | FIRST NAME | (fee columns).
The image may be rotated — read it in any orientation.

Your job: extract EVERY student's name as SURNAME + FIRSTNAME pairs.

Nigerian name examples from this type of school:
- Surnames: OGUNLADE, KASALI, ALAWODE, OYESANWO, OGUNDEYI, ALAO, AKINWANDE, OLAWALE, ODEREYE, AKINDELE, ADEBAYO, AYANRINDE, SHONPE, OLATUNDE, GBELEKALE, FAFIOLU, OLIYIDE, KOLANOLE, ADEGUNLE, ADEOYE, SABIU, JOHN, LAWAL, OLOOТУ, AYOMIDE, OGUNSOLA, OLOWU, AFOLAБИ, IYELABOYE, OKEIOLUНMI, OBASA
- Firstnames: GABRIEL, RASAQ, GODWIN, ENOCH, ABIGEAL, KOREDE, MICHEAL, ADEMIDE, AMIDAT, WIQUYAT, ISREAL, DORCAS, MARYAM, MUSTEQEEM, AMINAT, CYNTHIA, ELIZABETH, TIRESIMI, WASILAT, DEBORAH, SHINDARA

Rules:
1. Each row in the register = one student. Read ALL rows.
2. Ignore: CLASS, SERIAL NO, NAMES (header), BALANCE, FROM LAST TERM, numbers, dates
3. Do NOT split a single student into two entries
4. If handwriting is unclear, make your BEST guess at the Nigerian name
5. Return surname and firstname SEPARATELY

Return ONLY valid JSON.`;

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    students: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          surname:   { type: 'STRING' },
          firstname: { type: 'STRING' },
          fullName:  { type: 'STRING' }
        },
        required: ['surname','firstname','fullName']
      }
    }
  },
  required: ['students']
};

async function geminiOCR(base64, mime) {
  // Re-read key at call time (may have been set via the key prompt after page load)
  const apiKey = window.GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || GEMINI_KEY;
  if (!apiKey) throw new Error('No Gemini key set — skipping to fallback');
  let lastError = null;
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mime, data: base64 } },
            { text: GEMINI_PROMPT }
          ]}],
          generationConfig: {
            response_mime_type: 'application/json',
            response_schema: GEMINI_SCHEMA
          }
        })
      });
      const d = await r.json();
      if (d.error) {
        lastError = d.error.message || 'Gemini error';
        if (d.error.code === 404 || d.error.status === 'NOT_FOUND') continue;
        throw new Error(lastError);
      }
      const raw = d.candidates?.[0]?.content?.parts?.[0]?.text || '{"students":[]}';
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      const students = parsed.students || [];
      console.log(`✅ Gemini OCR (${model}): ${students.length} names`);
      return students;
    } catch (e) {
      lastError = e.message;
      console.warn(`Gemini ${model} failed:`, e.message);
    }
  }
  throw new Error('All Gemini models failed: ' + lastError);
}


// ── OCR Upload Overlay ──────────────────────────────────────────────────
function ocrOverlayShow(filename) {
  const el = document.getElementById('ocr-overlay');
  if (!el) return;
  el.style.display = 'flex';
  // Reset all steps
  ['load','upload','read','done'].forEach(s => {
    const icon = document.getElementById(`ocr-step-${s}-icon`);
    const text = document.getElementById(`ocr-step-${s}-text`);
    const row  = document.getElementById(`ocr-step-${s}`);
    if (icon) icon.textContent = { load:'⏳', upload:'☁️', read:'🔍', done:'✅' }[s];
    if (row)  row.style.color = '#94a3b8';
  });
  const bar = document.getElementById('ocr-bar');
  if (bar) bar.style.width = '0%';
  const fn = document.getElementById('ocr-filename');
  if (fn) fn.textContent = filename || 'image';
  const st = document.getElementById('ocr-status');
  if (st) st.textContent = 'Preparing...';
  const pg = document.getElementById('ocr-pages');
  if (pg) { pg.style.display = 'none'; pg.textContent = ''; }
  // Hide thumb until we have data
  const tw = document.getElementById('ocr-thumb-wrap');
  if (tw) tw.style.display = 'none';
}

function ocrOverlayThumb(dataUrl) {
  const img = document.getElementById('ocr-thumb');
  const wrap = document.getElementById('ocr-thumb-wrap');
  if (!img || !wrap) return;
  // Only show thumb for image types
  if (dataUrl && dataUrl.startsWith('data:image')) {
    img.src = dataUrl;
    wrap.style.display = 'block';
  }
}

function ocrOverlayStep(step, status, progress) {
  // step: 'load' | 'upload' | 'read' | 'done' | 'error'
  const bar = document.getElementById('ocr-bar');
  const st  = document.getElementById('ocr-status');
  if (bar && progress !== undefined) bar.style.width = progress + '%';
  if (st  && status)  st.textContent = status;

  const stepMap = { load: 0, upload: 1, read: 2, done: 3 };
  const stepIdx = stepMap[step] ?? -1;
  ['load','upload','read','done'].forEach((s, i) => {
    const icon = document.getElementById(`ocr-step-${s}-icon`);
    const row  = document.getElementById(`ocr-step-${s}`);
    if (!icon || !row) return;
    if (i < stepIdx)      { icon.textContent = '✅'; row.style.color = '#4ade80'; }
    else if (i === stepIdx) {
      if (step === 'error') { icon.textContent = '❌'; row.style.color = '#f87171'; }
      else { icon.textContent = '🔄'; row.style.color = '#818cf8'; }
    }
    else { row.style.color = '#94a3b8'; }
  });
  if (step === 'done')  { if (bar) bar.style.width = '100%'; if (bar) bar.style.background = 'linear-gradient(90deg,#22c55e,#4ade80)'; }
  if (step === 'error') { if (bar) bar.style.background = '#ef4444'; }
}

function ocrOverlayPages(cur, total) {
  const pg = document.getElementById('ocr-pages');
  if (!pg) return;
  if (total > 1) { pg.style.display = 'block'; pg.textContent = `Page ${cur} of ${total}`; }
}

function ocrOverlayHide(delayMs) {
  setTimeout(() => {
    const el = document.getElementById('ocr-overlay');
    if (el) el.style.display = 'none';
    // Reset bar colour for next use
    const bar = document.getElementById('ocr-bar');
    if (bar) bar.style.background = 'linear-gradient(90deg,#6366f1,#818cf8)';
  }, delayMs || 0);
}

// ── OCR engine: OCR.space (cloud) with Gemini upgrade path ───────────────
// Tesseract removed — unreliable on school registers, wastes 30s
// Returns array of {surname, firstname, fullName}
async function _readOnePage(file, pageNum, total, fbEl) {
  return new Promise(resolve => {
    const reader = new FileReader();

    reader.onload = async ev => {
      const imgData = ev.target.result;   // full data URI
      const b64    = imgData.split(',')[1];
      const mime   = file.type || 'image/jpeg';

      // Show thumbnail in overlay
      ocrOverlayThumb(imgData);
      ocrOverlayStep('load', 'Image loaded — sending to cloud...', 20);
      ocrOverlayPages(pageNum, total);

      // ── 1. Gemini (only when key is configured) ────────────────────────
      if (GEMINI_KEY) {
        try {
          ocrOverlayStep('upload', 'Sending to Gemini AI...', 35);
          const names = await geminiOCR(b64, mime);
          if (names && names.length) {
            ocrOverlayStep('done', `✅ ${names.length} names found via Gemini AI`, 100);
            resolve(names); return;
          }
        } catch (e) { console.warn(`Page ${pageNum} Gemini failed:`, e.message); }
      }

      // ── 2. OCR.space — single clean API call ──────────────────────────
      // Only valid free-key params: base64image, language, apikey, OCREngine,
      // scale, detectOrientation, filetype.  isHandwritten/isTable cause HTTP 400.
      try {
        ocrOverlayStep('upload', 'Uploading to cloud OCR...', 40);

        const mimeToFt = {
          'image/jpeg':'JPG','image/jpg':'JPG','image/png':'PNG',
          'image/webp':'JPG','image/heic':'JPG','image/heif':'JPG',
          'application/pdf':'PDF'
        };
        const ft = mimeToFt[mime] || 'JPG';

        const ocrParams = new URLSearchParams({
          base64image:       imgData,   // full data URI
          language:          'eng',
          apikey:            'helloworld',
          OCREngine:         '2',       // best engine for mixed print/handwriting
          scale:             'true',
          detectOrientation: 'true',
          filetype:          ft
        });

        ocrOverlayStep('read', 'Cloud OCR reading text...', 60);

        const controller = new AbortController();
        const ocrTimeout = setTimeout(() => controller.abort(), 30000);

        let result;
        try {
          const resp = await fetch('https://api.ocr.space/parse/image', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    ocrParams.toString(),
            signal:  controller.signal
          });
          clearTimeout(ocrTimeout);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          result = await resp.json();
        } catch (fetchErr) {
          clearTimeout(ocrTimeout);
          const why = fetchErr.name === 'AbortError' ? 'timed out — check connection' : fetchErr.message;
          ocrOverlayStep('error', '⚠️ Network error: ' + why, 60);
          throw fetchErr;
        }

        // Check API-level errors
        if (result.error) throw new Error(result.error);
        if (result.IsErroredOnProcessing) throw new Error((result.ErrorMessage||[]).join('; '));

        ocrOverlayStep('read', 'Extracting student names...', 80);
        const text = (result.ParsedResults || []).map(r => r.ParsedText || '').join('\n');
        console.log('✅ OCR.space text:', text.substring(0, 400));

        if (text.trim().length > 2) {
          // Nigerian register format (most accurate)
          const ng = extractNigerianNames(text);
          if (ng.length) {
            ocrOverlayStep('done', `✅ ${ng.length} names found`, 100);
            resolve(ng.map(n => { const p = n.trim().split(/\s+/); return { surname: p[0]||'', firstname: p.slice(1).join(' ')||'', fullName: n }; }));
            return;
          }
          // Generic name parser
          const gn = extractStudentNames(text);
          if (gn.length) {
            ocrOverlayStep('done', `✅ ${gn.length} names found`, 100);
            resolve(gn.map(n => ({ surname: '', firstname: '', fullName: n })));
            return;
          }
          // Last resort — pair adjacent single-word lines (two-column register support)
          const rawLn = text.split(/\r?\n/)
            .map(l => l.replace(/^[-\d.)\s*•✓✗]+/, '').replace(/[\d,]+\s*$/, '').trim().toUpperCase())
            .filter(l => l.length >= 2 && /[A-Z]{2,}/.test(l));
          const sngl = rawLn.filter(l => l.split(/\s+/).length === 1).length;
          const paired = [];
          if (rawLn.length >= 4 && sngl / rawLn.length > 0.55) {
            for (let ri = 0; ri < rawLn.length; ri += 2) {
              const sur = rawLn[ri] || ''; const fst = rawLn[ri+1] || '';
              if (sur.length >= 2) paired.push({ surname: sur, firstname: fst.length >= 2 ? fst : '', fullName: sur + (fst.length >= 2 ? ' ' + fst : '') });
            }
          } else {
            rawLn.slice(0, 80).forEach(l => {
              const w = l.split(/\s+/);
              paired.push({ surname: w[0]||'', firstname: w.slice(1).join(' ')||'', fullName: l });
            });
          }
          if (paired.length) {
            ocrOverlayStep('done', `📋 ${paired.length} names — please review`, 100);
            resolve(paired); return;
          }
        }

        // OCR returned blank — image may be too blurry
        ocrOverlayStep('error', '⚠️ No text found — try a clearer photo', 100);
        resolve([]);
        return;

      } catch (e) {
        console.warn(`Page ${pageNum} OCR.space failed:`, e.message);
        ocrOverlayStep('error', '⚠️ OCR failed: ' + e.message.substring(0, 60), 100);
        resolve([]);
        return;
      }
    };

    reader.onerror = () => {
      ocrOverlayStep('error', '❌ Could not read file — use an image or PDF', 100);
      resolve([]);
    };

    // Step 1: read file
    ocrOverlayStep('load', 'Reading file...', 10);
    reader.readAsDataURL(file);
  });
}

// ── Name validation / cleanup helpers (for text/OCR import) ──────────────
const UI_BLACKLIST = [
  'educational bloom','school portal','kobomoba','github','send whatsapp',
  'reminders to all','revenue','students','expenses','analytics','settings',
  'support','finance','comms','alumni','health','music','arts','sports',
  'staff','security','opportunities','outstanding','collection rate',
  'collection progress','overdue','unpaid','paid','partial','basic','premium',
  'online','offline','syncing','principal','term ','session','exit','login',
  'add student','import','fix names','upload','download','export','search',
  'all classes','owes','owes:','fee','fees','phone','class','name',
  'send ai','view students','bulk payment','bank statement',
  'no students','loading','saving','please wait','tap to','click to',
  'details','share','wallpaper','use as'
];
const VALID_PREFIXES = /^(mc\.?|cp\.?|ceb\.?|lsses?\.?|lses?\.?|sps\.?|spvenevang\.?|spsupevang\.?|snrldr\.?|honsnrevang\.?|evang\.?|hon\.?|snr\.?|ldr\.?|ven\.?|sup\.?|rev\.?|pastor|deacon|deaconess|bro\.?|sis\.?|mr\.?|mrs\.?|miss|dr\.?|prof\.?)\s/i;

function looksLikeValidName(str) {
  const t = (str || '').trim();
  if (!t || t.length < 2) return false;
  if (!/[a-zA-Z]/.test(t)) return false;
  // Allow digits only if looks like a balance annotation — strip those first
  const noDigits = t.replace(/\d+/g, '').trim();
  if (noDigits.length < 2) return false;
  const low = t.toLowerCase();
  if (UI_BLACKLIST.some(b => low.includes(b))) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  const alpha = t.replace(/[^a-zA-Z]/g, '');
  if (alpha.length < 3) return false;
  // Nigerian names are ALL-CAPS from handwritten registers — normalise before checking
  const isAllCaps = alpha === alpha.toUpperCase();
  // Allow up to 8 consonants in a row for Yoruba/Hausa/Igbo names (e.g. AKINWANDE, GBELEGKALE)
  const consonantRun = (t.match(/[^aeiouAEIOU\s.,'\'\-]{9,}/g) || []);
  if (consonantRun.length > 0) return false;
  const hasRealWord = words.some(w => {
    const a = w.replace(/[^a-zA-Z]/g, '');
    return a.length >= 3;
  });
  if (!hasRealWord) return false;
  if (VALID_PREFIXES.test(t)) return true;
  // Accept all-caps words of 3+ letters (Nigerian register format)
  if (isAllCaps && alpha.length >= 3) return true;
  const hasProperNoun = words.some(w => w.length >= 3 && /^[A-Z]/.test(w) && /[a-z]/.test(w));
  return hasProperNoun;
}


// ── Nigerian Name Extractor — handles ALL-CAPS handwritten registers ──────
// Understands: numbered rows, two-column (surname + firstname), balance notes
function extractNigerianNames(raw) {
  // ── Step 1: clean all lines ───────────────────────────────────────────
  const allLines = (raw || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const cleanLine = (line) => {
    const low = line.toLowerCase();
    if (UI_BLACKLIST.some(b => low.includes(b))) return null;
    if (/^(class|serial|no\b|names?|balance|term|from|date|\bsn\b|s\/n)/i.test(line)) return null;
    // Strip leading serial numbers: "1.", "- 2", "* 3", etc.
    let c = line.replace(/^[-–•*x✓✗✔]?\s*\d+[.):\s]+/, '').trim();
    // Strip trailing balance/fee noise
    c = c.replace(/\bBALANCE[\s\d,]*$/i, '')
         .replace(/[\d,]+\s*$/, '')
         .replace(/\b(BALANCE|PAID|OWING|FEE|TERM|CLASS|FROM|BASIC|NURSERY|JSS|SS\d?)\b/gi, '')
         .replace(/[^a-zA-Z\s'\-]/g, ' ')
         .replace(/\s+/g, ' ')
         .trim();
    if (!c || c.length < 2) return null;
    return c.toUpperCase();
  };

  // ── Step 2: classify each cleaned line ───────────────────────────────
  // isNameWord: a word that looks like a Nigerian name token (3+ alpha chars)
  const isNameWord = w => w && /^[A-Z][A-Z'\-]{2,}$/.test(w);

  const cleaned = allLines.map(cleanLine).filter(Boolean);

  // ── Step 3: detect two-column register format ─────────────────────────
  // Signature: many consecutive single-word lines (OCR reads surname col then
  // firstname col as interleaved or back-to-back single tokens).
  // Strategy: scan for runs where >60% of lines are single words → pair them.
  const wordCounts = cleaned.map(l => l.split(/\s+/).filter(isNameWord).length);
  const singleWordLines = wordCounts.filter(n => n === 1).length;
  const isTwoColumnRegister = cleaned.length >= 4 && (singleWordLines / cleaned.length) > 0.55;

  const seen = new Set();
  const results = [];

  const addName = (sur, fst) => {
    sur = (sur || '').trim();
    fst = (fst || '').trim();
    if (!sur || sur.length < 2) return;
    const fullName = fst && fst.length >= 2 ? sur + ' ' + fst : sur;
    if (!looksLikeValidName(fullName)) return;
    const key = fullName.toLowerCase().replace(/[^a-z]/g, '');
    if (seen.has(key)) return;
    seen.add(key);
    results.push(fullName);
  };

  if (isTwoColumnRegister) {
    // ── Two-column mode: pair consecutive single-word lines ──────────────
    // Pattern: line[i]=SURNAME, line[i+1]=FIRSTNAME (both single words)
    // OR the OCR may output all surnames first then all firstnames (less common)
    // We use the simpler approach: walk line by line, pair adjacent singles
    let i = 0;
    while (i < cleaned.length) {
      const line = cleaned[i];
      const words = line.split(/\s+/).filter(isNameWord);

      if (words.length === 0) { i++; continue; }

      if (words.length >= 2) {
        // Already a full "SURNAME FIRSTNAME" on one line — use as-is
        addName(words[0], words[1]);
        i++;
      } else {
        // Single word — look ahead for the next single-word line to pair with
        const next = cleaned[i + 1];
        if (next) {
          const nextWords = next.split(/\s+/).filter(isNameWord);
          if (nextWords.length === 1) {
            // Perfect pair: surname + firstname
            addName(words[0], nextWords[0]);
            i += 2;  // consume both lines
            continue;
          } else if (nextWords.length >= 2) {
            // Next line has a full name — this single might be a stray header
            addName(words[0], '');
            i++;
          } else {
            addName(words[0], '');
            i++;
          }
        } else {
          addName(words[0], '');
          i++;
        }
      }
    }
  } else {
    // ── Normal mode: each line is one student ─────────────────────────────
    cleaned.forEach(line => {
      const words = line.split(/\s+/).filter(isNameWord);
      if (!words.length) return;
      addName(words[0], words[1] || '');
    });
  }

  return results;
}

function extractStudentNames(raw) {
  const lines = (raw || '').split(/\r?\n/);
  const candidates = [];
  lines.forEach(line => {
    const t = line.trim();
    if (!t) return;
    if (t.includes(',') && !/^\d+[.)\s]/.test(t)) {
      const col = t.split(',')[0].replace(/"/g, '').trim();
      if (col) candidates.push(col);
      return;
    }
    const stripped = t.replace(/^\d+[.):\s]+/, '').replace(/^[-*•]\s*/, '').trim();
    if (stripped) candidates.push(stripped);
  });
  const seen = new Set();
  const result = [];
  candidates.forEach(rawName => {
    const n = rawName.replace(/\s+/g, ' ').trim();
    const key = n.toLowerCase().replace(/[^a-z]/g, '');
    if (!key || seen.has(key)) return;
    if (looksLikeValidName(n)) { seen.add(key); result.push(n); }
  });
  return result;
}

// ── Gemini API key prompt — shown when OCR is attempted without a key ─────
function showGeminiKeyPrompt(onProceed) {
  const existing = document.getElementById('gemini-key-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'gemini-key-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg);border-radius:20px 20px 0 0;padding:1.5rem 1.2rem 2rem;width:100%;max-width:520px;animation:slideup 0.25s ease;">
      <div style="font-size:1.05rem;font-weight:800;margin-bottom:0.4rem;">🤖 Better OCR Available</div>
      <p style="font-size:0.82rem;color:var(--sub);margin:0 0 1rem;line-height:1.6;">
        Without a <strong>Gemini API key</strong>, OCR.space will be used — it struggles with <em>rotated handwritten Nigerian registers</em> and may produce 40–60% spelling errors.<br><br>
        With Gemini, accuracy jumps to ~85–95% and it understands Nigerian names.
      </p>
      <div style="background:var(--s2);border-radius:12px;padding:0.9rem;margin-bottom:1rem;">
        <div style="font-size:0.78rem;font-weight:700;color:var(--text);margin-bottom:0.5rem;">🔑 Enter Gemini API Key (free)</div>
        <input id="gemini-key-input" type="password" placeholder="AIzaSy..."
          style="width:100%;padding:0.6rem 0.75rem;border:1.5px solid var(--border);border-radius:9px;font-size:0.82rem;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box;">
        <div style="font-size:0.72rem;color:var(--sub);margin-top:0.4rem;">
          Get a free key at <strong>aistudio.google.com</strong> → Create API Key
        </div>
      </div>
      <div style="display:flex;gap:0.6rem;">
        <button onclick="saveGeminiKeyAndProceed()" 
          class="btn-brand" style="flex:1;padding:0.75rem;font-size:0.88rem;">
          ✅ Save Key & Scan
        </button>
        <button onclick="skipGeminiKey()" 
          style="flex:1;padding:0.75rem;font-size:0.82rem;border:1.5px solid var(--border);border-radius:12px;background:var(--bg);color:var(--sub);cursor:pointer;">
          ⚠️ Continue Without Key
        </button>
      </div>
      <button onclick="document.getElementById('gemini-key-modal').remove()"
        style="display:block;width:100%;text-align:center;margin-top:0.75rem;background:none;border:none;color:var(--sub);font-size:0.78rem;cursor:pointer;">Cancel</button>
    </div>`;
  document.body.appendChild(modal);

  // Store callback for after key save
  window._geminiKeyCallback = onProceed;
}

function saveGeminiKeyAndProceed() {
  const inp = document.getElementById('gemini-key-input');
  const key = (inp?.value || '').trim();
  if (!key || !key.startsWith('AIza')) {
    inp.style.borderColor = '#ef4444';
    inp.placeholder = 'Must start with AIza... — check your key';
    return;
  }
  // Save to localStorage for this session
  localStorage.setItem('gemini_api_key', key);
  // Inject into runtime — update the GEMINI_KEY variable equivalent
  window.GEMINI_API_KEY = key;
  // Also patch: reload won't be needed since geminiOCR reads GEMINI_KEY at call time
  // We need to update the const — but since it's const we use a workaround via window
  document.getElementById('gemini-key-modal').remove();
  toast('✅ Gemini key saved — scanning with AI...');
  // Small delay then run
  setTimeout(() => {
    if (window._geminiKeyCallback) { window._geminiKeyCallback(); window._geminiKeyCallback = null; }
  }, 300);
}

function skipGeminiKey() {
  document.getElementById('gemini-key-modal').remove();
  toast('⚠️ Using OCR.space — results may need heavy editing');
  if (window._geminiKeyCallback) { window._geminiKeyCallback(); window._geminiKeyCallback = null; }
}



let _ocrPending = [];

async function processImagesSequentially(files) {
  const fbEl = $('csv-fb'); _ocrPending = [];

  // Show the upload overlay for the first file
  if (files.length > 0) {
    const firstName = files[0].name || 'image';
    ocrOverlayShow(firstName);
  }

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    // Update overlay filename for multi-file uploads
    if (i > 0) {
      const fn = document.getElementById('ocr-filename');
      if (fn) fn.textContent = f.name || `Image ${i+1}`;
    }
    if (fbEl) fbEl.textContent = `📸 Reading page ${i+1} of ${files.length}...`;
    const names = await _readOnePage(f, i + 1, files.length, fbEl);
    _ocrPending.push(...names);
  }

  if (!_ocrPending.length) {
    ocrOverlayHide(2000);
    if (fbEl) fbEl.textContent = '❌ Could not read any names. Try a clearer, well-lit photo.';
    return;
  }
  const existingKeys = new Set(SD.students.map(s => s.name.toLowerCase().replace(/[^a-z]/g, '')));
  _ocrPending = _ocrPending.filter(n => {
    const key = (n.fullName || '').toLowerCase().replace(/[^a-z]/g, '');
    return key.length > 1 && !existingKeys.has(key);
  });
  const totalFound = _ocrPending.length;
  if (fbEl) fbEl.textContent = `✅ Found ${totalFound} name${totalFound!==1?'s':''} — review below.`;
  ocrOverlayStep('done', `✅ ${totalFound} name${totalFound!==1?'s':''} ready to review`, 100);
  // Hide overlay after brief success pause, then open review
  setTimeout(() => {
    ocrOverlayHide(0);
    // Agent app: feed names into renderCountResult (the pipeline count display)
    // Convert structured {surname, firstname, fullName} objects to plain name strings
    const nameStrings = _ocrPending.map(function(n) {
      const sur = (n.surname   || '').trim().toUpperCase();
      const fst = (n.firstname || '').trim().toUpperCase();
      return fst ? (sur + ' ' + fst) : (n.fullName || sur);
    }).filter(function(n) { return n.trim().length > 1; });
    if (nameStrings.length) {
      renderCountResult(nameStrings);
    } else {
      const fbEl = document.getElementById('csv-loading') || document.getElementById('pipe-step-label');
      if (fbEl) fbEl.textContent = '❌ No names found. Try a clearer, well-lit photo.';
    }
  }, 900);
}

function ocrShowReview(names) {
  const modal = $('ocr-review-modal');
  const list  = $('ocr-review-list');
  const info  = $('ocr-review-info');
  if (!modal || !list) { console.error('OCR review modal not found in HTML'); return; }

  // Populate the "Set class for ALL" dropdown from existing class arms
  const classDropdown = $('ocr-class-all');
  if (classDropdown) {
    const arms = [...new Set((SD.students||[]).map(s=>s.class||'').filter(Boolean))].sort();
    // Also include common Nigerian class names as defaults
    const defaults = ['JSS1A','JSS1B','JSS2A','JSS2B','JSS3A','JSS3B','SS1A','SS1B','SS2A','SS2B','SS3A','SS3B'];
    const allArms  = [...new Set([...arms, ...defaults])];
    classDropdown.innerHTML = '<option value="">Set class for ALL ▾</option>' +
      allArms.map(a => `<option value="${a}">${a}</option>`).join('');
  }

  if (info) info.textContent = `${names.length} name${names.length!==1?'s':''} found. ✏️ Edit any wrong names, 🗑️ delete bad ones, then tap Add Students.`;

  // Pre-filter: remove entries that have no usable name content
  const validNames = names.filter(n => {
    const full = (n.fullName || n.surname || '').trim();
    return full.length >= 2 && /[a-zA-Z]{2,}/.test(full);
  });
  // Update info text with actual count after filtering
  if (info) info.textContent = `${validNames.length} name${validNames.length!==1?'s':''} found. ✏️ Edit wrong names, ✕ delete bad ones, then tap Add Students.`;

  list.innerHTML = validNames.map((n, i) => {
    // FIX: define sur/fst properly from the name object
    const sur = (n.surname  || '').trim().toUpperCase();
    const fst = (n.firstname|| '').trim().toUpperCase();
    const fullName = n.fullName || ((sur + ' ' + fst).trim());
    // If surname/firstname not split, put everything in surname field
    const surVal = sur || fullName.split(/\s+/)[0] || '';
    const fstVal = fst || fullName.split(/\s+/).slice(1).join(' ') || '';

    return `<div class="ocr-row" id="ocr-row-${i}" style="display:flex;align-items:center;gap:4px;padding:7px 4px;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <input type="checkbox" id="ocr-chk-${i}" checked onchange="ocrUpdateCount()"
        style="width:20px;height:20px;cursor:pointer;accent-color:var(--brand);flex-shrink:0;">
      <input type="text" id="ocr-sur-${i}" value="${surVal.replace(/"/g,'&quot;')}" placeholder="Surname"
        style="width:110px;border:1.5px solid var(--border);border-radius:7px;padding:5px 7px;font-size:0.82rem;background:var(--bg);color:var(--text);font-family:inherit;font-weight:700;text-transform:uppercase;">
      <input type="text" id="ocr-fst-${i}" value="${fstVal.replace(/"/g,'&quot;')}" placeholder="First name"
        style="width:100px;border:1.5px solid var(--border);border-radius:7px;padding:5px 7px;font-size:0.82rem;background:var(--bg);color:var(--text);font-family:inherit;text-transform:uppercase;">
      <input type="text" id="ocr-cls-${i}" placeholder="Class"
        style="width:68px;border:1.5px solid var(--border);border-radius:7px;padding:5px 6px;font-size:0.78rem;background:var(--bg);color:var(--text);font-family:inherit;flex-shrink:0;">
      <button onclick="document.getElementById('ocr-row-${i}').remove();ocrUpdateCount()"
        style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:7px;padding:5px 10px;cursor:pointer;color:#dc2626;font-size:0.82rem;font-weight:700;flex-shrink:0;">✕</button>
    </div>`;
  }).join('');

  ocrUpdateCount();
  openM('ocr-review-modal');
}

function ocrUpdateCount() {
  const checked = document.querySelectorAll('#ocr-review-list input[type=checkbox]:checked').length;
  const btn = $('ocr-confirm-btn');
  if (btn) btn.textContent = `✅ Add ${checked} Student${checked!==1?'s':''}`;
}


function readTextOrCSV(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const names = extractNamesFromText(ev.target.result);
    renderCountResult(names);
  };
  reader.onerror = () => alert('Could not read file.');
  reader.readAsText(file);
}

