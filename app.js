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
function getGroqKey() { return window.GROQ_API_KEY || localStorage.getItem(GROQ_KEY_STORAGE) || ''; }
const GROQ_OCR_MODEL = 'qwen/qwen3.6-27b'; // llama-4-scout deprecated June 17 2026

const GROQ_OCR_PROMPT = `You are reading a Nigerian primary/secondary school fee register.
The register has columns: SERIAL NO | SURNAME | FIRST NAME | (fee columns).
The image may be rotated — read it in any orientation.

Your job: extract EVERY student's name as SURNAME + FIRSTNAME pairs.

Nigerian name examples from this type of school:
- Surnames: OGUNLADE, KASALI, ALAWODE, OYESANWO, OGUNDEYI, ALAO, AKINWANDE, OLAWALE, ODEREYE, AKINDELE, ADEBAYO, AYANRINDE, SHONPE, OLATUNDE, GBELEKALE, FAFIOLU, OLIYIDE, KOLANOLE, ADEGUNLE, ADEOYE, SABIU, JOHN, LAWAL, OLOYODE, AYOMIDE, OGUNSOLA, OLOWU, AFOLABI, IYELABOYE, OKEIOLUWAMI, OBASA
- Firstnames: GABRIEL, RASAQ, GODWIN, ENOCH, ABIGEAL, KOREDE, MICHEAL, ADEMIDE, AMIDAT, WIQOYAT, ISREAL, DORCAS, MARYAM, MUSTAQEEM, AMINAT, CYNTHIA, ELIZABETH, TIRESIMI, WASILAT, DEBORAH, SHINDARA

Rules:
1. Each row in the register = one student. Read ALL rows.
2. Ignore: CLASS, SERIAL NO, NAMES (header), BALANCE, FROM LAST TERM, numbers, dates
3. Do NOT split a single student into two entries
4. If handwriting is unclear, make your BEST guess at the Nigerian name
5. Return surname and firstname SEPARATELY

Return ONLY a valid JSON array. No markdown, no explanation. Example:
[{"surname":"OGUNLADE","firstname":"GABRIEL","fullName":"OGUNLADE GABRIEL"}]`;

async function groqVisionOCR(base64, mime) {
  const apiKey = getGroqKey();
  if (!apiKey) throw new Error('No Groq API key');
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
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
        temperature:      0.7,    // Qwen3.6 non-thinking mode
        top_p:            0.8,
        top_k:            20,
        presence_penalty: 1.5,
        max_tokens:       8192,
        reasoning_format: 'hidden' // suppresses <think> tokens — REQUIRED for Qwen3.6
      })
    });
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
    // Strip Qwen3.6 thinking tokens in case reasoning_format:hidden is ignored
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    let jsonStr = text.trim();
    const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) jsonStr = codeBlock[1].trim();
    const objWrap = jsonStr.match(/\{[\s\S]*"students"\s*:\s*(\[[\s\S]*\])\s*\}/);
    if (objWrap) jsonStr = objWrap[1].trim();
    const arrMatch = jsonStr.match(/(\[[\s\S]*\])/);
    if (arrMatch) jsonStr = arrMatch[1].trim();
    const students = JSON.parse(jsonStr);
    if (!Array.isArray(students) || !students.length) throw new Error('Groq returned 0 students');
    const normalized = students.map(s => {
      const sur = (s.surname || '').trim().toUpperCase();
      const fst = (s.firstname || s.first_name || s.firstName || '').trim().toUpperCase();
      const full = (s.fullName || s.full_name || '').trim().toUpperCase() || (sur + ' ' + fst).trim();
      return { surname: sur, firstname: fst, fullName: full || (sur + ' ' + fst).trim() };
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

// ── OCR engine: AariNAT OCR (primary) → Groq Vision (fallback) ─────────────
// Returns array of {surname, firstname, fullName}
// ── Image resize helper — compresses phone photos before OCR ────────────
// Groq Vision has a hard 4MB base64 limit; full-res camera shots easily exceed it.
// This resizes to ≤1600px wide at 85% JPEG quality — typically 200-500KB result.
function resizeImageForOCR(dataURL) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const MAX_W = 1600;
      const scale = img.width > MAX_W ? MAX_W / img.width : 1;
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataURL); // fallback: use original if resize fails
    img.src = dataURL;
  });
}

async function _readOnePage(file, pageNum, total, fbEl) {
  return new Promise(resolve => {
    const reader = new FileReader();

    reader.onload = async ev => {
      // Resize to ≤1600px before sending — Groq has a 4MB base64 limit
      const imgData = await resizeImageForOCR(ev.target.result);
      const b64    = imgData.split(',')[1];
      // Force valid MIME — Android camera photos often arrive with type=""
      let mime = file.type || '';
      if (!mime || mime === 'application/octet-stream' || mime === 'application/unknown') {
        mime = 'image/jpeg'; // safe default for camera photos
      }

      // Show thumbnail in overlay
      ocrOverlayThumb(imgData);
      ocrOverlayStep('load', 'Image loaded — sending to AI...', 20);
      ocrOverlayPages(pageNum, total);

      // ── 1. AariNAT OCR (primary) ──────────────────────────────────────
      //    Cloudflare Workers endpoint owned by AariNAT
      try {
        ocrOverlayStep('upload', 'AariNAT AI scanning...', 30);
        const aarinatCtrl = new AbortController();
        const aarinatTimer = setTimeout(() => aarinatCtrl.abort(), 25000);

        const aarinatResp = await fetch(AARINAT_OCR_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: b64, mime: mime }),
          signal: aarinatCtrl.signal
        });
        clearTimeout(aarinatTimer);

        if (aarinatResp.ok) {
          const aarinatData = await aarinatResp.json();
          if (aarinatData.students && Array.isArray(aarinatData.students) && aarinatData.students.length > 0) {
            ocrOverlayStep('done', '✅ ' + aarinatData.students.length + ' names found — AariNAT AI', 100);
            console.log('✅ AariNAT OCR:', aarinatData.students.length, 'names');
            resolve(aarinatData.students); return;
          } else {
            const errMsg = aarinatData.error || 'no students in response';
            console.warn('AariNAT OCR: ok response but no students:', errMsg, aarinatData);
            ocrOverlayStep('upload', '⚠️ AariNAT AI: ' + errMsg.slice(0,80) + ' — trying backup...', 35);
          }
        } else {
          console.warn('AariNAT OCR HTTP error:', aarinatResp.status, aarinatResp.statusText);
        }
      } catch (e) {
        const reason = e.name === 'AbortError' ? 'timed out (25s)' : e.message;
        console.warn('AariNAT OCR failed (' + reason + '), falling back to Groq Vision...');
      }

      // ── 2. Groq Vision OCR — Llama 4 Scout (fallback) ────────────────
      //    Requires API key from console.groq.com — set in Settings
      const groqKey = getGroqKey();
      if (!groqKey) {
        ocrOverlayStep('error', '⚠️ Primary scanner unavailable. Go to Settings → add your free Groq API key to enable backup scanner. Get one free at console.groq.com', 100);
        resolve([]); return;
      }
      try {
        ocrOverlayStep('upload', 'Groq Vision scanning...', 50);
        const names = await groqVisionOCR(b64, mime);
        if (names && names.length) {
          ocrOverlayStep('done', '✅ ' + names.length + ' names found — Groq Vision', 100);
          resolve(names); return;
        }
      } catch (e) {
        console.warn('Page ' + pageNum + ' Groq Vision failed:', e.message);
        if (e.message.includes('Groq API key invalid')) {
          ocrOverlayStep('error', '⚠️ Groq API key is invalid — open Settings and re-enter your key from console.groq.com', 100);
          resolve([]); return;
        }
      }

      // ── All engines failed ────────────────────────────────────────────
      ocrOverlayStep('error', '⚠️ Could not read names — try a clearer photo with better lighting', 100);
      resolve([]);
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
  for (let i = 0; i < files.length; i++) {
    ocrOverlayShow(files[i].name);
    const pageNames = await _readOnePage(files[i], i + 1, files.length, null);
    // Each entry is {surname, firstname, fullName} — collect fullNames
    pageNames.forEach(n => {
      const full = (n.fullName || (n.surname + ' ' + n.firstname)).trim();
      if (full.length >= 2) allNames.push(full);
    });
  }
  ocrOverlayHide(800);
  if (allNames.length) {
    renderCountResult(allNames);
  } else {
    pipelineReset();
    alert('No student names found in any image.\n\nTips:\n• Hold phone directly above the register\n• Flatten the page fully\n• Use good lighting (avoid shadows)\n• Make sure all columns are visible');
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
        <div style="font-size:0.75rem;color:var(--sub);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.6rem;">Groq API Key (Backup Scanner)</div>
        <div style="font-size:0.78rem;color:var(--sub);margin-bottom:0.8rem;">
          AariNAT AI is the primary scanner. If it's unavailable, Groq Vision takes over automatically.<br><br>
          Get a free key at <a href="https://console.groq.com" target="_blank" style="color:#818cf8;">console.groq.com</a> → API Keys → Create API Key
        </div>
        <div style="font-size:0.82rem;color:#94a3b8;margin-bottom:0.5rem;">Current: ${maskedKey || '<span style="color:#f87171;">Not set — backup scanner disabled</span>'}</div>
        <input id="groq-key-input" type="text" placeholder="Paste your Groq API key here..."
          style="width:100%;padding:0.7rem;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:white;font-size:0.85rem;box-sizing:border-box;"
          value="">
        <button onclick="saveGroqKey()" style="margin-top:0.6rem;width:100%;padding:0.7rem;border-radius:10px;border:none;background:linear-gradient(135deg,#6366f1,#818cf8);color:white;font-weight:700;font-size:0.85rem;cursor:pointer;">
          💾 Save Groq Key
        </button>
      </div>

      <div style="background:var(--card);border-radius:16px;padding:1.2rem;margin-bottom:1rem;">
        <div style="font-size:0.75rem;color:var(--sub);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.6rem;">Account</div>
        <button onclick="logout()" style="width:100%;padding:0.7rem;border-radius:10px;border:1px solid #ef4444;background:transparent;color:#f87171;font-weight:700;font-size:0.85rem;cursor:pointer;">
          🚪 Logout
        </button>
      </div>

      <div style="text-align:center;font-size:0.7rem;color:var(--sub);padding:1rem 0;">
        Educational Bloom Agent App · Built by AariNAT<br>
        v2.2 · OCR: AariNAT AI + Groq Vision (Llama 4 Scout)
      </div>
    </div>
  `;
}

function saveGroqKey() {
  const input = document.getElementById('groq-key-input');
  if (!input) return;
  const key = input.value.trim();
  if (!key) {
    localStorage.removeItem(GROQ_KEY_STORAGE);
    delete window.GROQ_API_KEY;
    alert('Groq key removed. AariNAT AI will still work as your primary scanner.');
    renderSettingsProfile();
    return;
  }
  localStorage.setItem(GROQ_KEY_STORAGE, key);
  window.GROQ_API_KEY = key;
  alert('✅ Groq key saved! It will activate automatically if AariNAT AI is unavailable.');
  renderSettingsProfile();
}
