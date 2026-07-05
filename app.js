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
const openM = id => { const e = document.getElementById(id); if (e) e.classList.add('on'); };
const closeM = id => { const e = document.getElementById(id); if (e) e.classList.remove('on'); };
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
  // Pull Groq key from admin_settings — survives browsing-data clears
  _fetchGroqKeyFromFirestore();
}

async function _fetchGroqKeyFromFirestore() {
  try {
    const phone = (agent && agent.phone) || '';
    if (!phone) return;
    const res = await fetch('https://superagent-626f0107.base44.app/functions/getEduBloomKeys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'agent', id: phone })
    });
    if (!res.ok) return; // fall back to whatever's cached in localStorage
    const d = await res.json();
    if (d.groqApiKey) {
      window.GROQ_API_KEY = d.groqApiKey;
      localStorage.setItem(GROQ_KEY_STORAGE, d.groqApiKey);
      console.log('✅ Groq key loaded via secure proxy');
    }
    if (d.hfApiKey) {
      window.HF_API_KEY = d.hfApiKey;
      localStorage.setItem(HF_KEY_STORAGE, d.hfApiKey);
      console.log('✅ HF key loaded via secure proxy');
    }
  } catch(e) { /* offline — use whatever is in localStorage */ }
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
  if(tab==='settings') renderSettingsProfile();
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


// Real connectivity test — navigator.onLine lies on Android (WiFi with no internet)
async function realOnline() {
  if (!navigator.onLine) return false;
  try {
    await fetch('https://firestore.googleapis.com/', { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(3000) });
    return true;
  } catch { return false; }
}

async function submitDeal(){
  if(window._dealSubmitting){ return; }  // prevent double-tap
  window._dealSubmitting = true;
  const name=$('s-name').value.trim();
  const phone=$('s-phone').value.trim().replace(/\D/g,'');
  const email=$('s-email').value.trim();
  const count=parseInt($('s-count').value)||0;
  const terms=parseInt($('s-terms').value)||1;
  const notes=$('s-notes').value.trim();
  const fb=$('submit-fb');

  if(!name){ showFB(fb,'bad','Enter the school name.'); window._dealSubmitting=false; return; }
  if(!phone||phone.length<10){ showFB(fb,'bad','Enter principal\'s WhatsApp (e.g. 2348012345678).'); window._dealSubmitting=false; return; }
  if(!count||count<1){ showFB(fb,'bad','Enter approximate number of students.'); window._dealSubmitting=false; return; }
  if(!selTier){ showFB(fb,'bad','Select a pricing tier.'); window._dealSubmitting=false; return; }

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
    const online = await realOnline();
    if(db && online){
      // Dedup check: block identical pending deal within 30 seconds
      const recent = await db.collection('admin_deals')
        .where('school.name','==',name)
        .where('school.phone','==',phone)
        .where('status','==','pending')
        .orderBy('timestamp','desc').limit(1).get();
      const thirtySecsAgo = new Date(Date.now() - 30000);
      const isDup = !recent.empty && recent.docs[0].data().timestamp?.toDate?.() > thirtySecsAgo;
      if(isDup){ showFB(fb,'bad','⚠️ This school was just submitted. Please wait before re-submitting.'); btn.textContent='🚀 Submit Deal'; btn.disabled=false; window._dealSubmitting=false; return; }
      await db.collection('admin_deals').add(deal);
    }
    else{ SQ.push({t:'deal',d:deal}); }
    window._dealSubmitting=false; showFB(fb,'ok',`✅ "${name}" submitted! ${online?'Bayo will see it shortly.':'Saved offline — will reach Bayo when internet returns.'} Your commission will be ${fmt(Math.round(selTier.price*terms*((agent.commission||20)/100))/1)} on approval.`);
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
    const errMsg = e?.message || '';
    const isPermission = errMsg.toLowerCase().includes('permission') || errMsg.includes('PERMISSION_DENIED');
    if (isPermission) {
      showFB(fb,'bad',`⚠️ Submission blocked by server (permission error). Contact Bayo — your deal is saved locally and will retry.`);
    } else {
      showFB(fb,'ok',`📥 "${name}" saved offline — will reach Bayo when connection returns.`);
    }
    console.warn('submitDeal write failed:', e?.message, e?.code);
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
  const msg=`Hi! I'm your Educational Bloom agent.\n\nYour school "${schoolName}" has been activated! 🎉\n\n*School ID:* ${schoolId}\n\nLog in at: https://school.edubloom.com.ng\n\nI'll guide you through the setup. Call me anytime! 📞\n– ${agent.name}`;
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
// Photos: AI OCR — AariNAT OCR (primary) → Groq Vision (fallback)

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
  if (label)  label.textContent    = 'STEP 2 — Review & Edit Names';
  if (dot)    dot.style.background = '#34d399';

  // Also auto-fill the student count field
  const scount = document.getElementById('s-count');
  if (scount) { scount.value = csvStudentCount; autoTier(); }

  // Immediately show the FULL editable name list — no extra tap required.
  // Small delay lets the "done scanning" state render first for a smooth transition.
  setTimeout(() => { openOcrReviewModal(csvParsedNames, _lastDetectedClass); }, 250);
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
  // If we have parsed names — show Review Names modal so agent can verify
  if (csvParsedNames && csvParsedNames.length > 0) {
    openOcrReviewModal(csvParsedNames, _lastDetectedClass);
    return;
  }
  _proceedToStep3(); // no names to review — go straight to step 3
}

function _proceedToStep3() {
  const label = document.getElementById('pipe-step-label');
  const dot   = document.getElementById('pipe-step-dot');
  if (label) label.textContent = 'STEP 3 — Fill School Details & Submit';
  if (dot)   dot.style.background = '#fbbf24';
  const scount = document.getElementById('s-count');
  if (scount) { scount.value = csvStudentCount; autoTier(); }
  const nameField = document.getElementById('s-name');
  if (nameField) { nameField.scrollIntoView({ behavior: 'smooth', block: 'center' }); nameField.focus(); }
  pipelineToast('✅ ' + csvStudentCount + ' students confirmed! Fill in school details below.');
}

// ── OCR Review Modal ────────────────────────────────────────────────────────
let _ocrReviewData = [];




// ── OCR character-level correction (matches School Bloom Fix & Clean) ─────
const NIGERIAN_NAME_FRAGMENTS = [
  'ADE', 'OLA', 'OYE', 'OGUN', 'AKIN', 'AYO', 'OLU', 'SAN', 'KASALI', 'OGUNLADE',
  'ALAWODE', 'OYESANWO', 'OGUNDEYI', 'ALAO', 'AKINWANDE', 'OLAWALE', 'OBASA',
  'OLATUNDE', 'ADENIYI', 'ADEOYE', 'LAWAL', 'AYOMIDE', 'RASAQ', 'GABRIEL',
  'GODWIN', 'ENOCH', 'EMMANUEL', 'KOREDE', 'SUCCESS', 'EZEKIEL', 'ZAINAB',
  'SALAM', 'WAJUD', 'MUEEZ', 'QUARDRI', 'BIGGOLD', 'ADEMIDE', 'ABIGEAL',
  'MICHEAL', 'MICHAEL', 'CHRISTIANA', 'CHRISTIAN', 'MOHAMMED', 'MUHAMMED',
  'IBRAHIM', 'ABDUL', 'ABDULLAH', 'YUSUF', 'YUSUFF', 'NUHU', 'MUSA', 'ISA',
  'HASSAN', 'HUSSEIN', 'ALIYU', 'ALIU', 'USMAN', 'SULE', 'SULEIMAN', 'YAKUBU',
  'GIDEON', 'DANIEL', 'SAMUEL', 'DAVID', 'JOHN', 'PAUL', 'PETER', 'JAMES',
  'MARY', 'GRACE', 'FAITH', 'HOPE', 'CHARITY', 'JOY', 'PEACE', 'MERCY',
  'PATIENCE', 'BLESSED', 'GIFT', 'PRECIOUS', 'VICTORY', 'GLORY', 'DIVINE',
  'CHIDINMA', 'CHIAMAKA', 'NWAFOR', 'OKEKE', 'EZE', 'NWOSU', 'IGWE',
  'OBI', 'OKORO', 'NNAMDI', 'CHUKWU', 'ANIEFIOK', 'EFFIONG', 'AKPAN',
  'EDIDIONG', 'UDO', 'IME', 'NSIKAN', 'TIEMI', 'INIABASI',
  'GBOLAHAN', 'GBADEBO', 'GBELEKALE', 'SHONPE', 'OLIYIDE', 'KOLANOLE'
];

function _fixOcrChars(name) {
  let fixed = name.toUpperCase().trim();
  fixed = fixed.replace(/^\d+([A-Z])/, '$1');
  fixed = fixed.replace(/([A-Z])\d+$/, '$1');
  fixed = fixed.replace(/([A-Z])0([A-Z])/g, '$1O$2');
  fixed = fixed.replace(/([A-Z])1([A-Z])/g, '$1I$2');
  fixed = fixed.replace(/([A-Z])5([A-Z])/g, '$1S$2');
  fixed = fixed.replace(/([A-Z])8([A-Z])/g, '$1B$2');
  const rnFixed = fixed.replace(/RN/g, 'M');
  if (_nameScore(rnFixed) > _nameScore(fixed)) fixed = rnFixed;
  fixed = fixed.replace(/[^A-Z\s\-\']/g, '');
  fixed = fixed.replace(/\s+/g, ' ').trim();
  return fixed;
}

function _nameScore(name) {
  let score = 0;
  const upper = name.toUpperCase();
  for (const frag of NIGERIAN_NAME_FRAGMENTS) {
    if (upper.includes(frag)) score += frag.length;
  }
  const consonantRuns = (upper.match(/[^AEIOU\s]{7,}/g) || []);
  score -= consonantRuns.length * 3;
  return score;
}

// Fix names in the OCR review modal (before confirming import)
function fixNamesInReview() {
  let fixedCount = 0;
  _ocrReviewData.forEach(r => {
    if (!r.sel || !r.name) return;
    const original = r.name;
    const corrected = _fixOcrChars(original);
    if (corrected !== original && corrected.length >= 3) {
      if (_nameScore(corrected) >= _nameScore(original)) {
        r.name = corrected;
        fixedCount++;
      }
    }
  });
  _renderOcrReviewList();
  toast('🔧 Fixed ' + fixedCount + ' name' + (fixedCount !== 1 ? 's' : '') + ' — review and confirm.');
}

// Fix names in already-imported students (deal submission form)
function fixNamesInForm() {
  if (!csvParsedNames || !csvParsedNames.length) { toast('No scanned names to fix.'); return; }
  let fixedCount = 0;
  csvParsedNames.forEach(s => {
    if (!s.name) return;
    const original = s.name;
    const corrected = _fixOcrChars(original);
    if (corrected !== original && corrected.length >= 3) {
      if (_nameScore(corrected) >= _nameScore(original)) {
        s.name = corrected;
        fixedCount++;
      }
    }
  });
  renderCountResult(csvParsedNames.map(s => s.name));
  toast('🔧 Fixed ' + fixedCount + ' name' + (fixedCount !== 1 ? 's' : '') + ' — check the preview above.');
}

// ── Class dropdown helpers (shared between bulk + per-row) ────────────────
let _lastDetectedClass = '';
const STANDARD_NIGERIAN_CLASSES = [
  'Creche','Playgroup','Nursery 1','Nursery 2','Kindergarten',
  'Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6',
  'JSS 1','JSS 2','JSS 3',
  'SSS 1','SSS 2','SSS 3',
  'SSS 1 Science','SSS 1 Arts','SSS 1 Commercial',
  'SSS 2 Science','SSS 2 Arts','SSS 2 Commercial',
  'SSS 3 Science','SSS 3 Arts','SSS 3 Commercial'
];

function _getExistingClasses() {
  // Agent app may not have SD.students — safely look for any class data
  try {
    if (typeof csvParsedNames !== 'undefined' && csvParsedNames.length) {
      const fromParsed = [...new Set(csvParsedNames.map(s => s.class).filter(Boolean))].sort();
      if (fromParsed.length) return fromParsed;
    }
  } catch(_) {}
  return [];
}

function populateClassSelect(sel, currentVal) {
  if (!sel) return;
  const existing = _getExistingClasses();
  const all = [...new Set([...existing, ...STANDARD_NIGERIAN_CLASSES])].sort();
  sel.innerHTML = '<option value="">— Class —</option>' +
    all.map(c => `<option value="${esc(c)}" ${c===currentVal?'selected':''}>${esc(c)}</option>`).join('') +
    '<option value="__new__">➕ New class…</option>';
}

function handleClassSelectChange(sel) {
  if (sel.value === '__new__') {
    sel.value = '';
    const v = prompt('Enter class name:');
    if (v && v.trim()) {
      const cv = v.trim();
      // Add the new class as an <option> right before the "__new__" row
      const newOpt = document.createElement('option');
      newOpt.value = cv; newOpt.textContent = cv;
      sel.insertBefore(newOpt, sel.lastElementChild);
      sel.value = cv;
    }
  }
}

function openOcrReviewModal(parsedNames, detectedClass) {
  const dc = (detectedClass || _lastDetectedClass || '').trim();
  _ocrReviewData = (parsedNames || []).map(p => {
    const nm = typeof p === 'string' ? p : (p.name || '');
    return { name: nm.trim().toUpperCase(), cls: dc, sel: true };
  }).filter(r => r.name.length > 1);
  _renderOcrReviewList();
  // Pre-fill the bulk class dropdown too
  const bulkSel = document.getElementById('ocr-class-all');
  if (bulkSel && dc) {
    setTimeout(() => {
      // If the detected class isn't in the list yet, add it
      let found = false;
      for (const opt of bulkSel.options) { if (opt.value === dc) { found = true; break; } }
      if (!found) {
        const newOpt = document.createElement('option');
        newOpt.value = dc; newOpt.textContent = dc;
        bulkSel.insertBefore(newOpt, bulkSel.lastElementChild);
      }
      bulkSel.value = dc;
    }, 50);
  }
  // Show a small "auto-detected" note if we got a class from the scan
  const note = document.getElementById('ocr-detected-class-note');
  if (note) {
    note.textContent = dc ? '🤖 Class auto-detected from register: ' + dc + ' — confirm or change below.' : '';
    note.style.display = dc ? 'block' : 'none';
  }
  openM('ocr-review-modal');
}

function _renderOcrReviewList() {
  const c = document.getElementById('ocr-review-list');
  if (!c) { console.error('[OCR Review] #ocr-review-list not found in DOM'); return; }
  while (c.firstChild) c.removeChild(c.firstChild);
  for (let i = 0; i < _ocrReviewData.length; i++) {
    const r = _ocrReviewData[i];
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:center;padding:4px 2px;border-bottom:1px solid var(--border);';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!r.sel;
    cb.style.cssText = 'width:18px;height:18px;flex-shrink:0;cursor:pointer;';
    (function(idx){ cb.onchange = function(){ _ocrReviewData[idx].sel = this.checked; _ocrUpdateCount(); }; })(i);
    const ni = document.createElement('input');
    ni.type = 'text'; ni.value = r.name || ''; ni.autocomplete = 'off'; ni.setAttribute('autocapitalize','off');
    ni.style.cssText = 'flex:1;margin:0;padding:3px 6px;font-size:0.78rem;min-width:0;text-transform:uppercase;border:1px solid #2d4562;border-radius:6px;background:#0f1d2e !important;color:#f0f6ff !important;-webkit-text-fill-color:#f0f6ff;caret-color:#f0f6ff;';
    (function(idx){ ni.onchange = function(){ _ocrReviewData[idx].name = this.value.trim().toUpperCase(); }; })(i);
    const ci = document.createElement('select');
    ci.style.cssText = 'width:88px;flex-shrink:0;margin:0;padding:3px 2px;font-size:0.7rem;border:1px solid #2d4562;border-radius:6px;background:#0f1d2e !important;color:#f0f6ff !important;';
    populateClassSelect(ci, r.cls);
    (function(idx){ ci.onchange = function(){ handleClassSelectChange(this); _ocrReviewData[idx].cls = this.value === '__new__' ? '' : this.value; }; })(i);
    const db = document.createElement('button');
    db.textContent = '\u2715';
    db.style.cssText = 'width:auto;display:inline-block;flex:0 0 auto;background:#fef2f2;border:1px solid #fecaca;border-radius:5px;padding:2px 7px;cursor:pointer;font-size:0.72rem;color:#dc2626;flex-shrink:0;';
    (function(idx){ db.onclick = function(){ _ocrDelRow(idx); }; })(i);
    row.appendChild(cb); row.appendChild(ni); row.appendChild(ci); row.appendChild(db);
    c.appendChild(row);
  }
  _ocrUpdateCount();
}

function _ocrUpdateCount() {
  const n = _ocrReviewData.filter(r => r.sel).length;
  const tot = _ocrReviewData.length;
  const btn  = document.getElementById('ocr-confirm-btn');
  const info = document.getElementById('ocr-review-info');
  if (btn)  btn.textContent  = '\u2705 Add ' + n + ' Student' + (n !== 1 ? 's' : '') + ' \u2192';
  if (info) info.textContent = n + ' of ' + tot + ' selected \u2014 edit names, set class, then tap Add.';
}

function _ocrDelRow(i) {
  _ocrReviewData.splice(i, 1);
  _renderOcrReviewList();
}

function ocrSelectAll(checked) {
  _ocrReviewData.forEach(r => r.sel = checked);
  _renderOcrReviewList();
}

function ocrSetClassAll() {
  const cls = (document.getElementById('ocr-class-all')?.value || '').trim();
  if (!cls || cls === '__new__') return;
  _ocrReviewData.forEach(r => { if (r.sel) r.cls = cls; });
  _renderOcrReviewList();
}

function ocrConfirmImport() {
  const sel = _ocrReviewData.filter(r => r.sel && r.name && r.name.length > 1);
  if (!sel.length) { alert('Select at least one name.'); return; }
  csvParsedNames = sel.map(r => ({ name: r.name, class: r.cls || null }));
  csvStudentCount = csvParsedNames.length;
  const tier = TIERS_LIST.find(t => csvStudentCount <= t.max) || TIERS_LIST[4];
  const comm = Math.round(tier.price * 0.20);
  const qe = id => document.getElementById(id);
  if (qe('csv-student-count')) qe('csv-student-count').textContent = csvStudentCount;
  if (qe('csv-tier-name'))     qe('csv-tier-name').textContent     = tier.name;
  if (qe('csv-school-pays'))   qe('csv-school-pays').textContent   = '\u20a6' + tier.price.toLocaleString('en-NG') + '/term';
  if (qe('csv-your-comm'))     qe('csv-your-comm').textContent     = '\u20a6' + comm.toLocaleString('en-NG');
  closeM('ocr-review-modal');
  _proceedToStep3();
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

  // Treat ALL files as potential register images — camera photos from Android/iOS
  // frequently arrive with type="" or application/octet-stream (no MIME type)
  // so we NEVER route them to readTextOrCSV (which reads as text and gets binary garbage)
  const csvOnly = files.filter(f => {
    const n = (f.name||'').toLowerCase(), t = (f.type||'').toLowerCase();
    return t === 'text/csv' || t === 'text/plain' || /\.csv$/.test(n) || /\.txt$/.test(n);
  });
  const ocrFiles = files.filter(f => !csvOnly.includes(f));
  csvOnly.forEach(f => { showLoading('📄 Reading file...'); readTextOrCSV(f); });

  if (ocrFiles.length) {
    // Always scan immediately — AariNAT OCR (primary), Groq Vision (fallback).
    // No blocking modal — agent should never hit a dead end.
    processImagesSequentially(ocrFiles);
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// OCR ENGINE — AariNAT OCR (primary) → Groq Vision (fallback)
// ═══════════════════════════════════════════════════════════════════════════

// ── AariNAT OCR — Cloudflare Workers endpoint owned by AariNAT ────────────
const AARINAT_OCR_URL = 'https://aarinat-ocr.aarinat-company-limited.workers.dev';

// ── Groq Vision OCR — Llama 4 Scout vision model (fallback) ───────────────
// Free tier: https://console.groq.com — agents get key from Settings
const GROQ_KEY_STORAGE = 'groq_api_key';
let _lastOcrError = '';
function getGroqKey() { return window.GROQ_API_KEY || localStorage.getItem(GROQ_KEY_STORAGE) || ''; }

// Retries the secure proxy once if the key never loaded (e.g. proxy was down at login)
async function ensureGroqKey() {
  if (getGroqKey()) return getGroqKey();
  if (typeof _fetchGroqKeyFromFirestore === 'function') await _fetchGroqKeyFromFirestore().catch(() => {});
  return getGroqKey();
}

// ── Shared Groq text caller — for the 4 sales/onboarding AI assistants below ──
async function groqChatText(prompt, maxTokens) {
  const apiKey = await ensureGroqKey();
  if (!apiKey) throw new Error('AI features are temporarily unavailable — check your connection and try again shortly.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let resp;
  try {
    resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.65,
        max_tokens: maxTokens || 350
      })
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e.name === 'AbortError' ? 'Groq timed out — try again' : 'Network error — check connection');
  }
  clearTimeout(timer);
  if (!resp.ok) throw new Error('Groq API error ' + resp.status);
  const data = await resp.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

// ── Agent 1: School Scout AI — real GPS map of schools nearby, with fallback ──
let _scoutLeafletMap = null;

async function runScoutAI() {
  const el = document.getElementById('scout-result');
  const mapEl = document.getElementById('scout-map');
  if (!(await ensureGroqKey())) { if (el) el.textContent = '⚠️ AI features temporarily unavailable — check your connection and try again.'; return; }
  if (mapEl) mapEl.style.display = 'none';
  if (!navigator.geolocation) { if (el) el.textContent = '📍 Location not supported on this device — using manual mode.'; return runScoutAIFallback(); }

  if (el) el.textContent = '📍 Getting your location...';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      if (el) el.textContent = '🔍 Searching the map for schools nearby...';
      try {
        const schools = await findNearbySchools(lat, lon, 3000);
        if (!schools.length) {
          if (el) el.textContent = '📍 No schools tagged on the map within 10km of you yet — this area may not be well mapped. Switching to AI tips...';
          return runScoutAIFallback();
        }
        renderScoutMap(lat, lon, schools);
        const names = schools.slice(0, 8).map(s => s.name).join(', ');
        if (el) el.textContent = '📍 Found ' + schools.length + (schools.length > 1 ? ' schools' : ' school') + ' nearby — tap a pin for the name.\n\nGenerating a visit plan...';
        try {
          const tips = await groqChatText(
            'You are a field sales coach for EduBloom, a Nigerian school management app. An agent is standing near these schools right now: ' + names + '. Give a short prioritized visit plan (under 100 words): which 2-3 to try first and why, plus a one-line opener for the gatekeeper. No markdown or asterisks.',
            300
          );
          if (el) el.textContent = '📍 Found ' + schools.length + (schools.length > 1 ? ' schools' : ' school') + ' nearby — tap a pin for the name.\n\n' + tips;
        } catch (e2) {
          if (el) el.textContent = '📍 Found ' + schools.length + (schools.length > 1 ? ' schools' : ' school') + ' nearby — tap a pin for the name.';
        }
      } catch (e) {
        if (el) el.textContent = '⚠️ Map lookup failed — switching to AI tips...';
        return runScoutAIFallback();
      }
    },
    () => { if (el) el.textContent = '📍 Location access denied — using manual mode.'; runScoutAIFallback(); },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

// Queries free OpenStreetMap data — no Google billing/API key needed. Widens radius if nothing found.
async function findNearbySchools(lat, lon, radius) {
  const query = '[out:json][timeout:20];(node["amenity"="school"](around:' + radius + ',' + lat + ',' + lon + ');way["amenity"="school"](around:' + radius + ',' + lat + ',' + lon + ');node["amenity"="college"](around:' + radius + ',' + lat + ',' + lon + '););out center 30;';
  const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(query) });
  if (!resp.ok) throw new Error('Map service unavailable');
  const data = await resp.json();
  const items = (data.elements || []).map(elm => {
    const eLat = elm.lat || (elm.center && elm.center.lat);
    const eLon = elm.lon || (elm.center && elm.center.lon);
    const name = (elm.tags && elm.tags.name) || 'Unnamed school';
    return (eLat && eLon) ? { name, lat: eLat, lon: eLon } : null;
  }).filter(Boolean);
  if (!items.length && radius < 10000) return findNearbySchools(lat, lon, radius * 2.5);
  return items;
}

function renderScoutMap(lat, lon, schools) {
  const mapEl = document.getElementById('scout-map');
  if (!mapEl || typeof L === 'undefined') return;
  mapEl.style.display = 'block';
  if (_scoutLeafletMap) { _scoutLeafletMap.remove(); _scoutLeafletMap = null; }
  _scoutLeafletMap = L.map('scout-map').setView([lat, lon], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(_scoutLeafletMap);
  L.marker([lat, lon]).addTo(_scoutLeafletMap).bindPopup('📍 You').openPopup();
  schools.forEach(s => { L.marker([s.lat, s.lon]).addTo(_scoutLeafletMap).bindPopup('🏫 ' + s.name); });
  setTimeout(() => { if (_scoutLeafletMap) _scoutLeafletMap.invalidateSize(); }, 200);
}

// Fallback when GPS is denied/unsupported or no map data exists for the area
async function runScoutAIFallback() {
  const el = document.getElementById('scout-result');
  const area = prompt('Which area, town or LGA are you scouting today?');
  if (!area) { if (el) el.textContent = ''; return; }
  if (el) el.textContent = '🔍 Thinking...';
  try {
    const text = await groqChatText(
      'You are a field sales coach for EduBloom, a Nigerian school management app. An agent is scouting for private/Islamic/nursery schools in "' + area + '" today. Give: 1) 3 concrete places/times to find school proprietors there today (specific to Nigerian context — market days, morning drop-off, notice boards, etc), 2) a one-line opener to say to a school gatekeeper, 3) 2 quick qualifying questions to check the school is a good fit (uses paper registers, 50+ students). Under 120 words total, short plain lines, no markdown headers or asterisks.',
      350
    );
    if (el) el.textContent = text;
  } catch (e) { if (el) el.textContent = '❌ ' + e.message; }
}

// ── Agent 2: Pitch Coach AI — tailored spoken pitch per school type ──
async function runPitchCoachAI() {
  const el = document.getElementById('pitch-result');
  const type = document.getElementById('pitch-school-type')?.value;
  if (!(await ensureGroqKey())) { if (el) el.textContent = '⚠️ AI features temporarily unavailable — check your connection and try again.'; return; }
  if (!type) { if (el) el.textContent = '⚠️ Select a school type first.'; return; }
  if (el) el.textContent = '🎯 Thinking...';
  try {
    const text = await groqChatText(
      'You are a sales coach for EduBloom, a Nigerian school management app (attendance, fee collection via BloomCollect, report cards, automated parent WhatsApp safety alerts). Write a short natural spoken sales pitch (under 90 words) an agent can say to the proprietor of a "' + type + '" in Nigeria to get them interested in a free demo. Conversational tone, no markdown or asterisks, mention 1-2 benefits most relevant to this school type.',
      300
    );
    if (el) el.textContent = text;
  } catch (e) { if (el) el.textContent = '❌ ' + e.message; }
}

// ── Agent 3: Objection Handler AI — confident replies to pushback ──
async function runObjectionAI() {
  const el = document.getElementById('objection-result');
  const obj = document.getElementById('objection-type')?.value;
  if (!(await ensureGroqKey())) { if (el) el.textContent = '⚠️ AI features temporarily unavailable — check your connection and try again.'; return; }
  if (!obj) { if (el) el.textContent = '⚠️ Select an objection first.'; return; }
  if (el) el.textContent = '🛡️ Thinking...';
  try {
    const text = await groqChatText(
      'You are a sales coach for EduBloom, a Nigerian school management app. A school proprietor just said: "' + obj + '". Give the agent a short, confident, respectful reply (under 80 words) to overcome this objection, natural spoken Nigerian English, no markdown or asterisks.',
      250
    );
    if (el) el.textContent = text;
  } catch (e) { if (el) el.textContent = '❌ ' + e.message; }
}

// ── Agent 4: Follow-up Writer AI — WhatsApp messages that get replies ──
async function runFollowupAI() {
  const el = document.getElementById('followup-result');
  const scenario = document.getElementById('followup-scenario')?.value;
  if (!(await ensureGroqKey())) { if (el) el.textContent = '⚠️ AI features temporarily unavailable — check your connection and try again.'; return; }
  if (!scenario) { if (el) el.textContent = '⚠️ Select a scenario first.'; return; }
  if (el) el.textContent = '📲 Thinking...';
  try {
    const text = await groqChatText(
      'Write a short WhatsApp follow-up message (under 60 words) from an EduBloom sales agent to a school principal. Scenario: "' + scenario + '". Warm professional Nigerian tone, include a clear next step or call-to-action, no markdown or asterisks, no bracket placeholders.',
      200
    );
    if (el) el.textContent = text;
  } catch (e) { if (el) el.textContent = '❌ ' + e.message; }
}
const GROQ_OCR_MODEL = 'qwen/qwen3.6-27b'; // llama-4-scout deprecated June 17 2026
let _groqRateLimitedThisSession = false; // once Groq hits an org-wide rate limit, skip it for remaining pages this scan

const GROQ_OCR_PROMPT = `You are reading a Nigerian school attendance/fee register photo.
Columns: SERIAL NO | SURNAME | FIRST NAME | (other columns — ignore them).
The image may be at any angle — read it correctly.

TASK: Extract every student name visible. Combine as "SURNAME FIRSTNAME" (all caps).
ALSO: If you can see a class name on the page (e.g. "JSS 2A REGISTER", "PRIMARY 6", "SSS 3 SCIENCE" at the top or as a heading), include it as "detected_class".

Nigerian name examples — surnames: OGUNLADE, KASALI, ALAWODE, OYESANWO, OGUNDEYI, ALAO, AKINWANDE, OLAWALE, SHONPE, GBELEKALE, OLIYIDE, KOLANOLE, ADEGUNLE, ADEOYE, LAWAL, AYOMIDE, OBASA, OLATUNDE, ADENIYI, OLOOETU
Firstnames: GABRIEL, RASAQ, GODWIN, ENOCH, ABIGEAL, KOREDE, MICHEAL, ADEMIDE, SUCCESS, EZEKIEL, AWAL, EMMANUEL, BIGGOLD, QUARDRI, MUEEZ, ZAINAB, SALAM, WAJUD

Rules:
1. Every row = one student — read ALL rows, do not skip any
2. Ignore serial numbers, headers (NAMES, S/N), fee columns, dates, totals
3. Unclear handwriting — make your BEST guess at the Nigerian name
4. If no class name is visible, set detected_class to null
5. Output ONLY the JSON below — no explanation, no markdown, no extra text

{"detected_class":"JSS 2A","names":["OGUNLADE GABRIEL","KASALI RASAQ","ALAWODE SUCCESS"]}`;


// ── Tesseract.js fallback for when Groq fails (no API, no rate limits) ───
// ── HF Vision fallback (Qwen2.5-VL-7B) ─────────────────────────────────────
const HF_OCR_MODEL = 'Qwen/Qwen2.5-VL-7B-Instruct';
const HF_KEY_STORAGE = 'hf_api_key';
function getHFKey() { return window.HF_API_KEY || localStorage.getItem(HF_KEY_STORAGE) || ''; }

async function hfVisionOCR(base64, mime) {
  const hfKey = getHFKey();
  if (!hfKey) throw new Error('No HF API key — enter it in portal Settings');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let resp;
  try {
    resp = await fetch(
      'https://api-inference.huggingface.co/models/' + HF_OCR_MODEL + '/v1/chat/completions',
      {
        method: 'POST', signal: controller.signal,
        headers: { 'Authorization': 'Bearer ' + hfKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: HF_OCR_MODEL,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + base64 } },
            { type: 'text', text: GROQ_OCR_PROMPT }
          ]}],
          max_tokens: 600
        })
      }
    );
    clearTimeout(timer);
  } catch(fe) { clearTimeout(timer); throw new Error('HF network error: ' + fe.message); }
  // Cold start: HF returns 503 with estimated_time — wait then retry once
  if (resp.status === 503) {
    const ed = await resp.json().catch(() => ({}));
    const wait = Math.min(Math.ceil(ed.estimated_time || 25), 45);
    const ld = document.getElementById('csv-loading');
    for (let s = wait; s > 0; s--) {
      if (ld) ld.textContent = '\ud83e\udd17 HF model loading \u2014 ready in ' + s + 's...';
      await new Promise(r => setTimeout(r, 1000));
    }
    const ctrl2 = new AbortController();
    const t2 = setTimeout(() => ctrl2.abort(), 45000);
    try {
      resp = await fetch(
        'https://api-inference.huggingface.co/models/' + HF_OCR_MODEL + '/v1/chat/completions',
        { method:'POST', signal:ctrl2.signal,
          headers:{'Authorization':'Bearer '+hfKey,'Content-Type':'application/json'},
          body: JSON.stringify({model:HF_OCR_MODEL,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:'+mime+';base64,'+base64}},{type:'text',text:GROQ_OCR_PROMPT}]}],temperature:0.2,max_tokens:600})
        }
      );
      clearTimeout(t2);
    } catch(fe2){ clearTimeout(t2); throw new Error('HF retry failed: '+fe2.message); }
  }
  if (!resp.ok) {
    const ed = await resp.json().catch(() => ({}));
    throw new Error('HF ' + resp.status + ': ' + (ed.error?.message || resp.statusText));
  }
  const data = await resp.json();
  let text = data.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error('HF returned empty response');
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  let jsonStr = text.trim();
  const cb = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/); if (cb) jsonStr = cb[1].trim();
  // Try to capture detected_class before array-only regexes strip it
  try {
    const rawParsed = JSON.parse(jsonStr);
    if (rawParsed && !Array.isArray(rawParsed) && rawParsed.detected_class) {
      const dc = String(rawParsed.detected_class).trim().toUpperCase();
      if (dc && dc !== 'NULL') _lastDetectedClass = dc;
    }
  } catch(_) {}
  const ow = jsonStr.match(/\{[\s\S]*"students"\s*:\s*(\[[\s\S]*\])\s*\}/); if (ow) jsonStr = ow[1].trim();
  const am = jsonStr.match(/(\[[\s\S]*\])/); if (am) jsonStr = am[1].trim();
  let students;
  try { students = JSON.parse(jsonStr); }
  catch(_) {
    const fb = extractNamesFromText(text);
    return fb.map(n => { const p=n.trim().toUpperCase().split(/\s+/); return {surname:p[0]||'',firstname:p.slice(1).join(' ')||'',fullName:n.trim().toUpperCase()}; }).filter(s=>s.fullName.length>=3);
  }
  if (!Array.isArray(students) || !students.length) throw new Error('HF returned 0 students');
  return students.map(s => {
    if (typeof s === 'string') {
      const parts = s.trim().toUpperCase().split(/\s+/);
      return { surname: parts[0]||'', firstname: parts.slice(1).join(' ')||'', fullName: s.trim().toUpperCase() };
    }
    const sur=(s.surname||'').trim().toUpperCase(), fst=(s.firstname||s.first_name||s.firstName||'').trim().toUpperCase();
    const full=(s.fullName||s.full_name||'').trim().toUpperCase()||(sur+' '+fst).trim();
    return {surname:sur, firstname:fst, fullName:full};
  }).filter(s=>s.fullName.length>=2);
}

// ── OCR.space Engine 3 last resort (no key required, engine=3 is open source) ──
async function ocrSpaceOCR(base64, mime) {
  // Try Engine 3 first (open-source, fast). If it errors, retry with Engine 2 (cloud, more accurate).
  const tryEngine = async (engine) => {
    const fd = new FormData();
    fd.append('base64Image', 'data:' + mime + ';base64,' + base64);
    fd.append('language', 'eng');
    fd.append('OCREngine', String(engine));
    fd.append('isTable', 'true');
    fd.append('apikey', 'helloworld');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const resp = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: fd, signal: ctrl.signal });
    clearTimeout(t);
    const data = await resp.json();
    if (data.IsErroredOnProcessing) throw new Error('OCR.space E' + engine + ': ' + (data.ErrorMessage?.[0] || 'error'));
    const text = (data.ParsedResults || []).map(r => r.ParsedText || '').join('\n');
    if (!text.trim()) throw new Error('OCR.space E' + engine + ' returned empty text');
    return extractNamesFromText(text);
  };
  try { return await tryEngine(3); }
  catch(e3) {
    console.warn('OCR.space E3 failed:', e3.message, '— trying E2');
    return await tryEngine(2);  // Engine 2 fallback
  }
}

async function groqVisionOCR(base64, mime, _retry) {
  if (_retry === undefined) _retry = 0;
  const apiKey = getGroqKey();
  if (!apiKey) throw new Error('No Groq API key');

  // ── 20-second fetch timeout — prevents infinite hang when Groq server doesn't respond ──
  const controller = new AbortController();
  const fetchTimer = setTimeout(() => controller.abort(), 45000); // 45s: covers slow 4G upload + Groq processing

  let resp;
  try {
    resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: GROQ_OCR_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + base64 } },
            { type: 'text', text: GROQ_OCR_PROMPT }
          ]
        }],
        temperature: 0.2,
        max_tokens:  600,
        reasoning_effort: "none",
        response_format: { type: "json_object" }
      })
    });
    clearTimeout(fetchTimer);
  } catch (fetchErr) {
    clearTimeout(fetchTimer);
    // AbortError = our 20s timeout fired (server not responding)
    if (fetchErr.name === 'AbortError') {
      if (_retry >= 2) throw new Error('Groq timed out — page skipped (slow connection or server busy)');
      const ld = document.getElementById('csv-loading');
      for (let s = 25; s > 0; s--) {
        if (ld) ld.textContent = '⏳ Groq slow — retrying in ' + s + 's... (' + (_retry + 1) + '/2)';
        await new Promise(r => setTimeout(r, 1000));
      }
      return groqVisionOCR(base64, mime, _retry + 1);
    }
    // Network error (e.g. "Failed to fetch") — retry after brief wait
    if (_retry < 2) {
      const ld = document.getElementById('csv-loading');
      for (let s = 15; s > 0; s--) {
        if (ld) ld.textContent = '⏳ Network error — retrying in ' + s + 's... (' + (_retry + 1) + '/2)';
        await new Promise(r => setTimeout(r, 1000));
      }
      return groqVisionOCR(base64, mime, _retry + 1);
    }
    throw fetchErr;
  }

  try {
    // ── Auto-retry on rate limit (429) or over-capacity (503/529) ────────────
    if (resp.status === 429 || resp.status === 503 || resp.status === 529) {
      if (_retry >= 2) {
        const errData = await resp.json().catch(() => ({}));
        if (resp.status === 429) _groqRateLimitedThisSession = true; // stop hammering Groq for the rest of this scan
        throw new Error((errData.error && errData.error.message) || 'Groq unavailable — page skipped, try rescanning.');
      }
      const is429 = resp.status === 429;
      const resetRaw = is429 ? (resp.headers.get('x-ratelimit-reset-tokens') || '65') : '25';
      const waitSecs = Math.ceil(parseFloat(resetRaw)) + 5;
      const reason = is429 ? 'rate limit' : 'over capacity';
      const ld = document.getElementById('csv-loading');
      for (let s = waitSecs; s > 0; s--) {
        if (ld) ld.textContent = '⏳ Groq ' + reason + ' — retrying in ' + s + 's... (' + (_retry + 1) + '/2)';
        await new Promise(r => setTimeout(r, 1000));
      }
      return groqVisionOCR(base64, mime, _retry + 1);
    }

    const data = await resp.json();
    if (data.error) {
      const msg = data.error.message || ('Groq error ' + (data.error.code || ''));
      if (data.error.code === 401 || msg.toLowerCase().includes('auth') || msg.toLowerCase().includes('invalid api key')) {
        throw new Error('Groq API key invalid — check in Settings');
      }
      throw new Error(msg);
    }
    let text = data.choices?.[0]?.message?.content || '';
    if (!text.trim()) throw new Error('Empty response from Groq');
    // Strip any stray thinking tokens (defensive)
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    let jsonStr = text.trim();
    const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) jsonStr = codeBlock[1].trim();
    // Handle {"names":[...]} (new compact format) or {"students":[...]} (legacy)
    const namesWrap = jsonStr.match(/\{[\s\S]*"names"\s*:\s*(\[[\s\S]*\])\s*\}/);
    if (namesWrap) jsonStr = namesWrap[1].trim();
    else {
      const objWrap = jsonStr.match(/\{[\s\S]*"students"\s*:\s*(\[[\s\S]*\])\s*\}/);
      if (objWrap) jsonStr = objWrap[1].trim();
      else { const arrMatch = jsonStr.match(/(\[[\s\S]*\])/); if (arrMatch) jsonStr = arrMatch[1].trim(); }
    }
    let parsedObj;
    try {
      parsedObj = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.warn('JSON parse failed — prose fallback:', text.slice(0, 100));
      const fallbackNames = (typeof extractNamesFromText === 'function') ? extractNamesFromText(text) : [];
      const fb = fallbackNames.map(name => {
        const parts = name.trim().toUpperCase().split(/\s+/);
        return { surname: parts[0]||'', firstname: parts.slice(1).join(' ')||'', fullName: name.trim().toUpperCase() };
      }).filter(s => s.fullName.length >= 3);
      if (fb.length > 0) { console.log('✅ Prose fallback: ' + fb.length + ' names'); return fb; }
      throw new Error('Model returned text — try a clearer photo');
    }
    // Capture detected_class from the parsed object
    if (parsedObj && !Array.isArray(parsedObj) && parsedObj.detected_class) {
      const dc = String(parsedObj.detected_class).trim().toUpperCase();
      if (dc && dc !== 'NULL') _lastDetectedClass = dc;
    }
    const students = Array.isArray(parsedObj) ? parsedObj : (parsedObj.names || parsedObj.students || []);
    const normalized = students.map(s => {
      // New format: string element e.g. "KASALI RASAQ"
      if (typeof s === 'string') {
        const parts = s.trim().toUpperCase().split(/\s+/);
        return { surname: parts[0]||'', firstname: parts.slice(1).join(' ')||'', fullName: s.trim().toUpperCase() };
      }
      // Legacy format: object with surname/firstname
      const sur = (s.surname||'').trim().toUpperCase();
      const fst = (s.firstname||s.first_name||s.firstName||'').trim().toUpperCase();
      const full = (s.fullName||s.full_name||'').trim().toUpperCase() || (sur+' '+fst).trim();
      return { surname: sur, firstname: fst, fullName: full };
    }).filter(s => s.fullName.length >= 2);
    console.log('✅ Groq Vision OCR (' + GROQ_OCR_MODEL + '): ' + normalized.length + ' names');
    return normalized;
  } catch (e) {
    console.warn('Groq Vision OCR failed:', e.message);
    throw e;
  }
}


// ── OCR Upload Overlay ──────────────────────────────────────────────────
function ocrOverlayShow(filename) {
  const el = document.getElementById('ocr-overlay');
  if (!el) return;
  el.style.display = 'flex';
  // Reset all steps
  const defaultText = { load: 'Loading image...', upload: 'Uploading to cloud OCR', read: 'Reading names from image', done: 'Done' };
  ['load','upload','read','done'].forEach(s => {
    const icon = document.getElementById(`ocr-step-${s}-icon`);
    const text = document.getElementById(`ocr-step-${s}-text`);
    const row  = document.getElementById(`ocr-step-${s}`);
    if (icon) icon.textContent = { load:'⏳', upload:'☁️', read:'🔍', done:'✅' }[s];
    if (row)  row.style.color = '#94a3b8';
    if (text) text.textContent = defaultText[s]; // clear stale text from a previous scan
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
  // step: 'load' | 'upload'/'scan' | 'read' | 'done' | 'error'
  const map = { load: 'load', upload: 'upload', scan: 'upload', read: 'read', done: 'done', error: 'done' };
  const key = map[step] || step;
  const row  = document.getElementById('ocr-step-' + key);
  const icon = document.getElementById('ocr-step-' + key + '-icon');
  const text = document.getElementById('ocr-step-' + key + '-text');
  if (row)  row.style.color = step === 'error' ? '#f87171' : '#6366f1';
  if (icon) icon.textContent = step === 'error' ? '⚠️' : (step === 'done' ? '✅' : '🔍');
  if (text && status) text.textContent = status;
  const bar = document.getElementById('ocr-bar');
  if (bar) {
    bar.style.width = Math.min(progress || 0, 100) + '%';
    if (step === 'error') bar.style.background = 'linear-gradient(90deg,#f87171,#dc2626)';
    if (step === 'done')  bar.style.background = 'linear-gradient(90deg,#34d399,#10b981)';
  }
  ['load','upload','read','done'].forEach(s => {
    if (s === key) return;
    const r = document.getElementById('ocr-step-' + s);
    if (r && (progress || 0) >= 100 && step !== 'error') r.style.color = '#34d399';
  });
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

// ── OCR engine: AariNAT OCR (primary) → Groq Vision (fallback) ─────────────
// Returns array of {surname, firstname, fullName}
// ── Image resize helper — compresses phone photos before OCR ────────────
// Groq Vision has a hard 4MB base64 limit; full-res camera shots easily exceed it.
// This resizes to ≤1600px wide at 85% JPEG quality — typically 200-500KB result.
// ── OpenCV.js loader (lazy-loaded on first OCR scan) ──────────────────────
let _cvReady = false, _cvLoading = false;
function loadOpenCV() {
  return new Promise(resolve => {
    if (_cvReady) return resolve(true);
    if (_cvLoading) { const wait = setInterval(() => { if (_cvReady) { clearInterval(wait); resolve(true); } }, 200); return; }
    _cvLoading = true;
    if (document.getElementById('opencv-js')) {
      const wait = setInterval(() => {
        if (window.cv && cv.Mat) { _cvReady = true; _cvLoading = false; clearInterval(wait); resolve(true); }
      }, 200);
      return;
    }
    const s = document.createElement('script');
    s.id = 'opencv-js';
    s.src = 'https://docs.opencv.org/4.x/opencv.js';
    s.async = true;
    s.onload = () => {
      if (window.cv && cv.Mat) { _cvReady = true; _cvLoading = false; resolve(true); }
      else if (window.cv) {
        cv['onRuntimeInitialized'] = () => { _cvReady = true; _cvLoading = false; resolve(true); };
      } else {
        const wait = setInterval(() => {
          if (window.cv && cv.Mat) { _cvReady = true; _cvLoading = false; clearInterval(wait); resolve(true); }
        }, 300);
        setTimeout(() => { if (!_cvReady) { clearInterval(wait); _cvLoading = false; resolve(false); } }, 15000);
      }
    };
    s.onerror = () => { _cvLoading = false; resolve(false); };
    document.head.appendChild(s);
  });
}

// ── OpenCV preprocessing: grayscale → denoise → adaptive threshold → deskew ──
async function preprocessWithOpenCV(canvas) {
  if (!_cvReady) return canvas;
  try {
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    const denoised = new cv.Mat();
    cv.fastNlMeansDenoising(gray, denoised, 10, 7, 21);

    const binary = new cv.Mat();
    cv.adaptiveThreshold(denoised, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 10);

    const deskewed = _deskew(binary);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = deskewed.cols; outCanvas.height = deskewed.rows;
    cv.imshow(outCanvas, deskewed);

    src.delete(); gray.delete(); denoised.delete(); binary.delete(); deskewed.delete();
    return outCanvas;
  } catch (e) {
    console.warn('[OpenCV] preprocessing failed, using raw image:', e.message);
    return canvas;
  }
}

function _deskew(binaryMat) {
  try {
    const edges = new cv.Mat();
    cv.Canny(binaryMat, edges, 50, 150);
    const lines = new cv.Mat();
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 80, 30, 10);

    let angles = [];
    for (let i = 0; i < Math.min(lines.rows, 30); i++) {
      const x1 = lines.data32F[i * 4], y1 = lines.data32F[i * 4 + 1];
      const x2 = lines.data32F[i * 4 + 2], y2 = lines.data32F[i * 4 + 3];
      const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      if (Math.abs(angle) < 20) angles.push(angle);
    }
    edges.delete(); lines.delete();

    if (angles.length < 3) return binaryMat.clone();

    angles.sort((a, b) => a - b);
    const median = angles[Math.floor(angles.length / 2)];
    if (Math.abs(median) < 0.5) return binaryMat.clone();

    const rows = binaryMat.rows, cols = binaryMat.cols;
    const M = cv.getRotationMatrix2D(new cv.Point(cols / 2, rows / 2), median, 1);
    const rotated = new cv.Mat();
    cv.warpAffine(binaryMat, rotated, M, new cv.Size(cols, rows), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255));
    M.delete();
    return rotated;
  } catch (e) {
    console.warn('[OpenCV] deskew failed:', e.message);
    return binaryMat.clone();
  }
}

function resizeImageForOCR(dataURL) {
  return new Promise(async resolve => {
    const img = new Image();
    img.onload = async () => {
      const MAX_W = 400;
      const scale = img.width > MAX_W ? MAX_W / img.width : 1;
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      // OpenCV preprocessing (if available) — improves handwriting clarity
      let finalCanvas = canvas;
      try {
        const cvReady = await loadOpenCV();
        if (cvReady) {
          finalCanvas = await preprocessWithOpenCV(canvas);
        }
      } catch (e) {
        console.warn('[OCR] OpenCV preprocess skipped:', e.message);
        finalCanvas = canvas;
      }

      resolve(finalCanvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataURL);
    img.src = dataURL;
  });
}

async function _readOnePage(file, pageNum, total, fbEl, skipGroq) {
  return new Promise(resolve => {
    const reader = new FileReader();

    reader.onload = async ev => {
      try {
      // Resize to ≤400px — reduces image tokens to stay under 6K TPM free-tier limit
      const imgData = await resizeImageForOCR(ev.target.result);
      const b64    = imgData.split(',')[1];
      let mime = file.type || '';
      if (!mime || mime === 'application/octet-stream' || mime === 'application/unknown') {
        mime = 'image/jpeg';
      }

      ocrOverlayThumb(imgData);
      ocrOverlayPages(pageNum, total);

      // ── Groq Vision (direct — no Cloudflare Worker) ───────────────────
      const groqKey = getGroqKey();
      const canTryGroq = !!groqKey && !skipGroq;

      ocrOverlayStep('load', canTryGroq
        ? 'Image loaded — sending to Groq Vision...'
        : '🤗 Groq unavailable — preparing HuggingFace (page ' + pageNum + ')...', 20);

      // Retry loading keys once if the proxy hadn't finished/succeeded yet
      if (!groqKey && !getHFKey() && typeof _fetchGroqKeyFromFirestore === 'function') {
        await _fetchGroqKeyFromFirestore().catch(() => {});
      }

      // No hard-stop when Groq key is missing — always cascade to HF, then OCR.space.
      if (canTryGroq) {
        try {
          ocrOverlayStep('upload', 'Groq Vision scanning (page ' + pageNum + '/' + total + ')...', 50);
          const names = await groqVisionOCR(b64, mime);
          if (names && names.length) {
            ocrOverlayStep('done', '✅ ' + names.length + ' names found (page ' + pageNum + ')', 100);
            resolve(names); return;
          }
          _lastOcrError = 'Groq returned 0 names'; // fall through to HF
        } catch (e) {
          _lastOcrError = e.message || 'Groq Vision failed';
          console.error('Groq Vision error (page ' + pageNum + '):', _lastOcrError);
          // fall through to HF even on invalid/auth errors
        }
      } else if (!groqKey) {
        _lastOcrError = 'Groq key not loaded (proxy unavailable) — trying HuggingFace';
      }
      // HF Vision (pages 4+ primary, or Groq fallback)
      try {
        const hfLabel = canTryGroq ? 'Trying HuggingFace' : 'HuggingFace scanning';
        ocrOverlayStep('scan', '🤗 ' + hfLabel + ' (page ' + pageNum + '/' + total + ')...', canTryGroq ? 70 : 40);
        const hfResult = await hfVisionOCR(b64, mime);
        if (hfResult && hfResult.length > 0) {
          ocrOverlayStep('read', '🤗 HF: ' + hfResult.length + ' names (page ' + pageNum + ')', 100);
          resolve(hfResult); return;
        }
      } catch (hfErr) {
        const hfMsg = hfErr.message.includes('No HF API key')
          ? '⚠️ HF not loaded (proxy unavailable) — trying OCR.space'
          : ('🤗 HF failed (' + hfErr.message.slice(0,40) + ') — trying OCR.space');
        console.warn('HF fallback:', hfErr.message);
        ocrOverlayStep('scan', hfMsg, 80);
      }
      // OCR.space Engine 3 last resort
      try {
        const ocrNames = await ocrSpaceOCR(b64, mime);
        if (ocrNames && ocrNames.length > 0) {
          const mapped = ocrNames.map(name => {
            const parts = name.trim().toUpperCase().split(/\s+/);
            return { surname: parts[0]||'', firstname: parts.slice(1).join(' ')||'', fullName: name.trim().toUpperCase() };
          }).filter(s => s.fullName.length >= 3);
          if (mapped.length > 0) {
            ocrOverlayStep('read', '📄 OCR.space: ' + mapped.length + ' names (page ' + pageNum + ')', 100);
            resolve(mapped); return;
          }
        }
      } catch (ocrErr) {
        console.warn('OCR.space fallback failed:', ocrErr.message);
      }
      ocrOverlayStep('error', '⚠️ All OCR failed: ' + _lastOcrError.slice(0, 60), 100);
      resolve([]);
      } catch(fatal) { console.error('_readOnePage fatal:', fatal.message||String(fatal)); resolve([]); }
    };

    reader.onerror = () => {
      _lastOcrError = 'Could not read file';
      ocrOverlayStep('error', '❌ Could not read file — use an image or PDF', 100);
      resolve([]);
    };

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
  // Allow up to 8 consonants in a row for Yoruba/Hausa/Igbo names (e.g. AKINWANDE, GBELEKALE)
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

    // ── Reject lines that are entirely class/grade names ──────────────────
    if (/^\s*(BASIC\s+(ONE|TWO|THREE|FOUR|FIVE|SIX|\d+)|NURSERY(\s*\d|\s*1\s*[&AND]+\s*2)?|PRE.?NURSERY|JSS\s*[1-3]|SS[S]?\s*[1-3]|PRIMARY\s*[1-6]|KG\s*[12]?|UNKNOWN|RECEPTION)\s*$/i.test(line)) return null;

    // Strip ALL leading non-letter chars — handles X14, V17, ✓14, •3, "- 2" etc.
    let c = line.replace(/^[^a-zA-Z]+/, '').trim();

    // Strip trailing balance/fee noise
    c = c.replace(/\bBALANCE[\s\d,]*$/i, '')
         .replace(/[\d,]+\s*$/, '')
         .replace(/\b(BALANCE|PAID|OWING|FEE|TERM|CLASS|FROM|BASIC|NURSERY|JSS|SS\d?)\b/gi, '')
         .replace(/[^a-zA-Z\s'\-]/g, ' ')
         .replace(/\s+/g, ' ')
         .trim();

    // ── Merge OCR column-split artifacts: "RASA Q" → "RASAQ", "OGUND EI" → "OGUNDEI"
    // When a word of 3+ letters is followed by 1-2 isolated letters, merge them
    c = c.replace(/\b([A-Z]{3,})\s+([A-Z]{1,2})\b(?!\s+[A-Z]{3,})/g, '$1$2');

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
    const stripped = t.replace(/^\d+[.)\s]+/, '').replace(/^[-\u2022*]\s*/, '').trim();
    if (!stripped || stripped.length < 2) return;
    if (/^\d+$/.test(stripped.replace(/[,.\-]/g, ''))) return;
    if (looksLikeValidName(stripped)) candidates.push(stripped);
  });
  // Deduplicate
  const seen = new Set();
  return candidates.filter(n => {
    const key = n.toLowerCase().replace(/[^a-z]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── CSV / TXT file reader (for text-based name lists) ─────────────────────
function readTextOrCSV(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const lines = text.split(/\r?\n/);
    const names = [];
    lines.forEach(line => {
      const t = line.trim();
      if (!t) return;
      if (/^(s\/n|serial|no\.?|name|class|total|students?|#)/i.test(t)) return;
      if (/^\d+$/.test(t.replace(/[,.\-]/g, ''))) return;
      // Try cleanName first (handles prefixed Nigerian names)
      const cleaned = cleanName(t);
      if (cleaned) { names.push(cleaned); return; }
      // Fallback: if line has comma, take first field as name
      if (t.includes(',')) {
        const first = t.split(',')[0].replace(/"/g, '').trim();
        if (first.length >= 3 && /[a-zA-Z]{2,}/.test(first)) { names.push(first); }
      }
    });
    if (names.length) {
      renderCountResult(names);
    } else {
      alert('No student names found in this file.\n\nFor photos, use the camera option — text files should have one name per line.');
      pipelineReset();
    }
  };
  reader.onerror = () => { alert('Could not read file.'); pipelineReset(); };
  reader.readAsText(file);
}

// ── Sequential multi-image processor ───────────────────────────────────────
async function processImagesSequentially(files) {
  const allNames = [];
  const _seen = new Set(); // cross-page dedup — same name on two pages only counted once
  // Inter-page delay to stay under Groq free-tier 6K TPM/min limit.
  // 15s gap means max ~3 pages touch any 60s window → ~4500 tokens, safely under 6K.
  // Pages 1-3: Groq (15s cooldown between them — stays under 6K TPM/min)
  // Pages 4+:  HuggingFace direct (separate quota, only 5s cooldown needed)
  // This eliminates the 30-second retry penalty Groq imposes on every 4th/7th page.
  const GROQ_DELAY_S = 15;
  _groqRateLimitedThisSession = false; // fresh scan — give Groq another chance
  _lastDetectedClass = ''; // fresh scan — clear previous detection
  for (let i = 0; i < files.length; i++) {
    if (i > 0 && files.length > 1) {
      const ld = document.getElementById('csv-loading');
      for (let s = GROQ_DELAY_S; s > 0; s--) {
        if (ld) ld.textContent = '⏳ Cooling down (' + s + 's) before page ' + (i + 1) + ' of ' + files.length + '...';
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    const skipGroq = _groqRateLimitedThisSession;
    ocrOverlayShow(files[i].name);
    const pageNames = await _readOnePage(files[i], i + 1, files.length, null, skipGroq);
    // Each entry is {surname, firstname, fullName} — deduplicate across pages
    pageNames.forEach(n => {
      const full = (n.fullName || (n.surname + ' ' + n.firstname)).trim().toUpperCase();
      const key  = full.replace(/[^A-Z]/g, ''); // letters-only key for fuzzy dedup
      if (full.length >= 2 && !_seen.has(key)) { _seen.add(key); allNames.push(full); }
    });
  }
  ocrOverlayHide(800);
  if (allNames.length) {
    renderCountResult(allNames);
  } else {
    pipelineReset();
    const _ed = _lastOcrError ? ('\n\nError: ' + _lastOcrError.slice(0,150)) : '';
    alert('No student names found in any image.' + _ed + '\n\nTips:\n• Hold phone directly above the register\n• Flatten the page fully\n• Use good lighting (avoid shadows)\n• Make sure all columns are visible');
  }
}

// ── Reset CSV counter displays ─────────────────────────────────────────────
function resetCSVCount() {
  csvStudentCount = 0;
  csvParsedNames = [];
  ['csv-student-count','csv-tier-name','csv-school-pays','csv-your-comm'].forEach(id => {
    const e = document.getElementById(id); if(e) e.textContent = '';
  });
  ['csv-name-preview'].forEach(id => {
    const e = document.getElementById(id); if(e) e.innerHTML = '';
  });
}

// ── Settings Profile ───────────────────────────────────────────────────────
function renderSettingsProfile() {
  const c = document.getElementById('settings-content');
  if (!c) return;
  const groqKey = getGroqKey();
  const maskedKey = groqKey ? groqKey.slice(0, 6) + '••••••' + groqKey.slice(-4) : '';

  c.innerHTML = `
    <div style="padding:1.2rem;">
      <div style="background:var(--card);border-radius:16px;padding:1.2rem;margin-bottom:1rem;">
        <div style="font-size:0.75rem;color:var(--sub);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.6rem;">Agent Profile</div>
        <div style="font-size:1.1rem;font-weight:700;color:white;">${esc(agent.name)}</div>
        <div style="font-size:0.85rem;color:var(--sub);margin-top:0.3rem;">📱 ${esc(agent.phone)}</div>
        <div style="font-size:0.85rem;color:var(--money);margin-top:0.3rem;">Commission: ${agent.commission || 20}%</div>
      </div>

      <div style="background:var(--card);border-radius:16px;padding:1.2rem;margin-bottom:1rem;">
        <div style="font-size:0.75rem;color:var(--sub);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.6rem;">Register Scanner</div>
        <div style="font-size:0.78rem;color:var(--sub);margin-bottom:0.6rem;">
          OCR keys are managed centrally and load automatically when you log in — nothing to set up here.
        </div>
        <div style="font-size:0.82rem;color:${groqKey ? '#4ade80' : '#f87171'};">
          ${groqKey ? '✅ Scanner ready' : '⚠️ Not loaded yet — reopen the app or check your connection'}
        </div>
      </div>

      <div style="background:var(--card);border-radius:16px;padding:1.2rem;margin-bottom:1rem;">
        <div style="font-size:0.75rem;color:var(--sub);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.6rem;">Account</div>
        <button onclick="logout()" style="width:100%;padding:0.7rem;border-radius:10px;border:1px solid #ef4444;background:transparent;color:#f87171;font-weight:700;font-size:0.85rem;cursor:pointer;">
          🚪 Logout
        </button>
      </div>

      <div style="text-align:center;font-size:0.7rem;color:var(--sub);padding:1rem 0;">
        Educational Bloom Agent App · Built by AariNAT<br>
        v2.3 · OCR: AariNAT AI + Groq Vision (auto-configured)
      </div>
    </div>
  `;
}

// saveGroqKey() removed — keys now auto-load via secure proxy on login, no manual entry needed.

// build-retrigger 1783047742
