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
    terms, notes
  };

  try{
    if(db&&navigator.onLine){ await db.collection('admin_deals').add(deal); }
    else{ SQ.push({t:'deal',d:deal}); }
    showFB(fb,'ok',`✅ "${name}" submitted! ${navigator.onLine?'':'(Saved offline — will reach Bayo when internet returns.) '}Your commission will be ${fmt(Math.round(selTier.price*terms*((agent.commission||20)/100))/1)} on approval.`);
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
  const box = document.getElementById('csv-count-result');
  const ld  = document.getElementById('csv-loading');
  box.style.display = 'block';
  ld.style.display  = 'block';
  ld.textContent    = msg || 'Reading...';
  document.getElementById('csv-name-preview').innerHTML = '';
  document.getElementById('csv-class-breakdown').innerHTML = '';
}

function renderCountResult(names) {
  const unique = [...new Set(names.map(n=>n.trim()).filter(n=>n.length>1))];
  document.getElementById('csv-loading').style.display = 'none';
  if (!unique.length) {
    document.getElementById('csv-count-result').style.display = 'none';
    alert('No student names found.\n\nFor photos: ensure the image is clear and well-lit.\nFor CSV/text: one name per line.');
    return;
  }
  csvStudentCount = unique.length;
  csvParsedNames  = unique.map(name => ({ name, class: null }));
  const tier = TIERS_LIST.find(t => csvStudentCount <= t.max) || TIERS_LIST[4];
  const comm = Math.round(tier.price * 0.20);
  document.getElementById('csv-student-count').textContent = csvStudentCount;
  document.getElementById('csv-tier-name').textContent     = tier.name;
  document.getElementById('csv-school-pays').textContent   = '\u20a6' + tier.price.toLocaleString('en-NG') + '/term';
  document.getElementById('csv-your-comm').textContent     = '\u20a6' + comm.toLocaleString('en-NG');
  const preview = unique.slice(0, 15);
  const extra   = unique.length - preview.length;
  document.getElementById('csv-name-preview').innerHTML =
    '<strong style="display:block;margin-bottom:5px;color:white;">Names found (' + unique.length + ') — verify a few are correct:</strong>' +
    preview.map(n => '<span style="display:inline-block;background:rgba(255,255,255,0.08);border-radius:5px;padding:2px 7px;margin:2px;font-size:0.72rem;color:#e2e8f0;">' + esc(n) + '</span>').join('') +
    (extra > 0 ? '<div style="font-size:0.71rem;color:var(--sub);margin-top:4px;">...and ' + extra + ' more</div>' : '');
  document.getElementById('csv-class-breakdown').innerHTML = '';
  document.getElementById('csv-count-result').style.display = 'block';
}

function handleRegisterCSV(e) {
  const file = e.target.files[0]; if (!file) return;
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  const isImage = type.startsWith('image/') || /\.(jpg|jpeg|png|webp|bmp)$/.test(name);
  if (isImage) {
    readImageWithOCR(file);
  } else {
    showLoading('Counting students...');
    readTextOrCSV(file);
  }
  e.target.value = '';
}

// Core extraction: joins continuation lines, handles CSV and plain text
// A "continuation line" is a line that does NOT start with a number or bullet
// — meaning it is the second line of a wrapped name like "Abiodun\nKogbodoku"
function extractNamesFromText(raw) {
  const rawLines = raw.split(/\r?\n/);
  const names = [];

  // Step 1: join continuation lines with the previous numbered/bulleted line
  const joined = [];
  let current = null;

  rawLines.forEach(line => {
    const t = line.trim();
    if (!t) {
      // blank line ends current entry
      if (current !== null) { joined.push(current); current = null; }
      return;
    }
    // Is this a CSV line? (contains comma — treat each col0 independently)
    if (t.includes(',') && !isNumberedLine(t) && !isBulletLine(t)) {
      if (current !== null) { joined.push(current); current = null; }
      joined.push(t.split(',')[0].replace(/"/g,'').trim());
      return;
    }
    if (isNumberedLine(t) || isBulletLine(t)) {
      // New numbered entry — save previous
      if (current !== null) joined.push(current);
      current = t;
    } else {
      if (current !== null) {
        // Continuation of previous — append if it looks like more of a name
        // Only join if continuation line has no numbers and looks like word(s)
        const words = t.replace(/[^a-zA-Z\s]/g,'').trim();
        if (words.length > 1 && t.length < 40) {
          current = current + ' ' + t;
        } else {
          // Not a continuation — save current and start fresh
          joined.push(current);
          current = t;
        }
      } else {
        // No current entry — treat as standalone line (plain list without numbers)
        current = t;
      }
    }
  });
  if (current !== null) joined.push(current);

  // Step 2: clean each joined line and extract the name
  joined.forEach(line => {
    const cleaned = cleanName(line);
    if (cleaned) names.push(cleaned);
  });

  return names;
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

// OCR config — upgrade path: set GOOGLE_VISION_KEY for best handwriting accuracy
// Get free key: console.cloud.google.com → Enable "Cloud Vision API" → Credentials
// Free tier: 1000 images/month, then ₦2.25 per 1000
const GOOGLE_VISION_KEY = ''; // paste your key here when ready

function readImageWithOCR(file) {
  showLoading('📸 Reading photo...');
  const reader = new FileReader();
  reader.onload = async ev => {
    const imgData = ev.target.result;
    const base64  = imgData.split(',')[1];
    const mime    = file.type || 'image/jpeg';
    let text = '';

    if (navigator.onLine) {
      // ── 1st choice: Google Cloud Vision (best for Nigerian handwriting) ──
      if (GOOGLE_VISION_KEY) {
        try {
          const ld = document.getElementById('csv-loading');
          if(ld) ld.textContent = '📸 Reading with Google Vision...';
          const r = await fetch(
            `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_KEY}`,
            { method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ requests:[{ image:{content:base64},
                features:[{type:'DOCUMENT_TEXT_DETECTION'}] }] }) }
          );
          const d = await r.json();
          text = d.responses?.[0]?.fullTextAnnotation?.text || '';
        } catch(e) { console.warn('Google Vision failed:', e); }
      }

      // ── 2nd choice: OCR.space free tier (no setup, decent handwriting) ──
      if (!text.trim()) {
        try {
          const ld = document.getElementById('csv-loading');
          if(ld) ld.textContent = '📸 Processing image...';
          const arr = imgData.split(','); const mtype = arr[0].match(/:(.*?);/)[1];
          const bstr = atob(arr[1]); let n = bstr.length;
          const u8 = new Uint8Array(n); while(n--) u8[n] = bstr.charCodeAt(n);
          const blob = new Blob([u8], { type: mtype });
          const fd = new FormData();
          fd.append('file', blob, 'reg.jpg');
          fd.append('language', 'eng');
          fd.append('apikey', 'helloworld'); // free demo key — get a personal key at ocr.space (25k/month free)
          fd.append('isHandwritten', 'true');
          const resp = await fetch('https://api.ocr.space/parse/image', { method:'POST', body:fd });
          const result = await resp.json();
          text = result.ParsedResults?.[0]?.ParsedText || '';
        } catch(e) { console.warn('OCR.space failed, falling back to Tesseract:', e); }
      }
    }

    if (text.trim()) {
      const names = extractNamesFromText(text);
      renderCountResult(names);
    } else {
      // ── 3rd choice: Tesseract.js (offline fallback, slower) ──
      await readImageWithTesseract(imgData);
    }
  };
  reader.onerror = () => alert('Could not read image.');
  reader.readAsDataURL(file);
}

async function readImageWithTesseract(imgData) {
  const loadTesseract = () => new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  try {
    const ld = document.getElementById('csv-loading');
    if(ld) ld.textContent = '📸 Reading offline (first time ~30s)...';
    await loadTesseract();
    const { data: { text } } = await Tesseract.recognize(imgData, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pct = Math.round((m.progress||0)*100);
          const ld2 = document.getElementById('csv-loading');
          if(ld2) ld2.textContent = '📸 Offline OCR... ' + pct + '%';
        }
      }
    });
    const names = extractNamesFromText(text);
    renderCountResult(names);
  } catch(err) {
    document.getElementById('csv-loading').style.display = 'none';
    document.getElementById('csv-count-result').style.display = 'none';
    alert('Photo reading failed.\n\nTips:\n- Clear, well-lit photo\n- Steady phone above register\n- One name per line\n\nOr type the count manually below.');
  }
}

function useCSVCount() {
  if(!csvStudentCount) { alert('Upload a file first.'); return; }
  const countInput = document.getElementById('s-count');
  countInput.value = csvStudentCount;
  autoTier();
  countInput.scrollIntoView({behavior:'smooth', block:'center'});
  countInput.style.borderColor = '#10b981';
  setTimeout(() => { countInput.style.borderColor = ''; }, 2000);
}

function resetCSVCount() {
  csvStudentCount = 0;
  csvParsedNames  = [];
  document.getElementById('csv-count-result').style.display = 'none';
  document.getElementById('register-csv').value = '';
  document.getElementById('csv-name-preview').innerHTML = '';
  // Don't clear the student count field — let agent decide if they want to keep it
}

// ── Deep-link support ──────────────────────────────────────────────────────
// When admin sends WhatsApp with ?phone=08012345678 the field pre-fills
function checkDeepLink(){
  try{
    const p = new URLSearchParams(window.location.search).get('phone') || new URLSearchParams(window.location.search).get('p');
    if(!p) return;
    const norm  = normalizePhone(p);
    const local = norm.startsWith('234') ? '0' + norm.slice(3) : norm;
    const input = $('l-phone'); if(!input) return;
    input.value = local;
    setTimeout(()=>{
      const note = document.createElement('div');
      note.style.cssText='background:rgba(37,99,235,0.12);border:1px solid rgba(37,99,235,0.3);border-radius:8px;padding:0.65rem;font-size:0.82rem;color:#60a5fa;margin-bottom:0.75rem;';
      note.textContent='📲 Phone pre-filled. Tap Login to activate your account.';
      const f=$('phone-form'); if(f) f.insertBefore(note, f.firstChild);
    },150);
  }catch(e){}
}

// ── Startup ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  SQ.ping();
  checkDeepLink();
  // ✅ Try cached session — works offline after first login
  const saved=localStorage.getItem('ag_agent');
  if(saved){
    try{
      agent=JSON.parse(saved);
      if(agent && agent.id && agent.name){
        startApp();
        // Refresh from Firestore silently in background
        if(navigator.onLine && db){
          const p = normalizePhone(agent.phone||'');
          const l = p.startsWith('234') ? '0'+p.slice(3) : p;
          refreshAgentBackground(agent.id, p, l).catch(()=>{});
        }
        return;
      }
    }catch(e){ localStorage.removeItem('ag_agent'); }
  }
  $('login').style.display='flex';
  $('app').style.display='none';
  setTab('phone');
});

// ══════════════════════════════════════════════════════════════════════════
// BLOOM VOICE AGENT — AGENT APP
// Tap the 🎙️ button and speak. Works on Android Chrome.
// Commands: "Submit Wisdom Walks, 150 students, phone 08038740131"
//           "My deals" · "My earnings" · "How many deals" · "Help"
// ══════════════════════════════════════════════════════════════════════════
(function initBloomAgentVoice(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  if(!SR) return; // silently skip unsupported browsers

  // ── Inject UI ────────────────────────────────────────────────────────
  const css = `
    #vab{position:fixed;bottom:130px;right:14px;z-index:200;
      width:54px;height:54px;border-radius:50%;
      background:var(--brand,#4f46e5);color:#fff;
      font-size:1.4rem;border:none;cursor:pointer;
      box-shadow:0 4px 18px rgba(79,70,229,.5);
      display:flex;align-items:center;justify-content:center;
      transition:background .2s,transform .15s;
      animation:vbpulse 2.5s infinite;}
    @keyframes vbpulse{
      0%{box-shadow:0 0 0 0 rgba(79,70,229,.5)}
      70%{box-shadow:0 0 0 16px rgba(79,70,229,0)}
      100%{box-shadow:0 0 0 0 rgba(79,70,229,0)}}
    #vab.vlist{background:#ef4444!important;animation:none;
      box-shadow:0 0 0 10px rgba(239,68,68,.3);transform:scale(1.08);}
    #vab.vspeak{background:#10b981!important;animation:none;}
    #vfb{position:fixed;bottom:192px;right:8px;left:8px;
      max-width:320px;margin:0 auto;
      background:#1e293b;color:#f1f5f9;border-radius:14px;
      padding:12px 15px;font-size:.86rem;
      z-index:201;display:none;
      box-shadow:0 8px 24px rgba(0,0,0,.35);}
    #vfb.vshow{display:block;}
    #vfb .vtx{font-style:italic;opacity:.6;margin-bottom:.3rem;font-size:.76rem;}
    #vfb .vrx{font-weight:600;line-height:1.5;}
    #vfb .vax{font-size:.71rem;color:#34d399;margin-top:.3rem;}`;

  const s=document.createElement('style'); s.textContent=css;
  document.head.appendChild(s);

  const btn=document.createElement('button'); btn.id='vab'; btn.textContent='🎙️';
  btn.title='Voice Agent — Tap and speak';
  document.body.appendChild(btn);

  const fb=document.createElement('div'); fb.id='vfb';
  fb.innerHTML='<div class="vtx" id="v-tx"></div><div class="vrx" id="v-rx"></div><div class="vax" id="v-ax"></div>';
  document.body.appendChild(fb);

  let rec=null, listening=false, htimer=null;

  function say(text){
    if(!synth)return; synth.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.lang='en-NG'; u.rate=0.93;
    btn.classList.add('vspeak');
    u.onend=u.onerror=()=>btn.classList.remove('vspeak');
    synth.speak(u);
  }

  function show(tx,rx,ax){
    document.getElementById('v-tx').textContent=tx?`"${tx}"` :'';
    document.getElementById('v-rx').textContent=rx||'';
    document.getElementById('v-ax').textContent=ax||'';
    fb.classList.add('vshow');
    clearTimeout(htimer);
    htimer=setTimeout(()=>fb.classList.remove('vshow'),7500);
  }

  function numV(s){return parseInt((s||'').replace(/[^0-9]/g,''))||0;}
  function fmtV(n){return '₦'+Number(n||0).toLocaleString('en-NG');}

  // ── Intent parser ─────────────────────────────────────────────────────
  function parse(text){
    const t=text.toLowerCase().trim();

    // Full deal: "submit Wisdom Walks, 150 students, phone 08038740131"
    const full=t.match(/(?:submit|new\s+school|add)\s+(.+?)[,\s]+(\d+)\s+students?[,\s]+(?:phone\s+)?(\d{8,13})/i);
    if(full) return{intent:'fillDeal',name:full[1].trim(),count:parseInt(full[2]),phone:full[3]};

    // School name only: "submit Wisdom Walks"
    const nameOnly=t.match(/^(?:submit|new\s+school|add\s+school)\s+(.{3,})$/i);
    if(nameOnly) return{intent:'setName',name:nameOnly[1].trim()};

    // Count only: "150 students"
    const cntM=t.match(/^(\d+)\s+students?$/i);
    if(cntM) return{intent:'setCount',count:parseInt(cntM[1])};

    // Phone: "phone 08038740131"
    const phM=t.match(/phone\s+(?:is\s+)?(\d{8,13})/i);
    if(phM) return{intent:'setPhone',phone:phM[1]};

    // Submit to Bayo
    if(t.match(/submit\s+to\s+bayo|send\s+(the\s+)?deal|submit\s+now/i))
      return{intent:'submit'};

    // Queries
    if(t.match(/how\s+many\s+(deals?|schools?)|deals?\s+submitted|my\s+deals?/i))
      return{intent:'queryDeals'};
    if(t.match(/my\s+earnings?|my\s+commission/i))
      return{intent:'goEarnings'};

    // Navigate
    const nav=t.match(/(?:go\s+to|open|show)\s+(deals?|submit|earnings?)/i);
    if(nav){
      const m={deal:'deals',deals:'deals',submit:'submit',earnings:'earnings',earning:'earnings'};
      return{intent:'nav',tab:m[nav[1].toLowerCase()]||'submit'};
    }

    if(t.match(/help|what\s+can\s+you/i)) return{intent:'help'};
    return{intent:'unknown',raw:text};
  }

  // ── Execute ───────────────────────────────────────────────────────────
  function exec(p){
    switch(p.intent){

      case 'fillDeal':{
        if(typeof go==='function') go('submit');
        setTimeout(()=>{
          const nm=document.getElementById('s-name');
          const ph=document.getElementById('s-phone');
          const ct=document.getElementById('s-count');
          if(nm) nm.value=p.name;
          if(ph) ph.value=p.phone;
          if(ct){ ct.value=p.count; if(typeof autoTier==='function') autoTier(); }
          const msg=`OK! Filled: ${p.name}, ${p.count} students, phone ${p.phone}. Check the tier, then say "submit to Bayo".`;
          show(null,msg,'Form filled ✓'); say(msg);
        },320); break;
      }

      case 'setName':{
        if(typeof go==='function') go('submit');
        setTimeout(()=>{
          const nm=document.getElementById('s-name');
          if(nm) nm.value=p.name;
          const msg=`School name set: ${p.name}. Now say the number of students.`;
          show(null,msg,'Name set ✓'); say(msg);
        },320); break;
      }

      case 'setCount':{
        const ct=document.getElementById('s-count');
        if(ct){ ct.value=p.count; if(typeof autoTier==='function') autoTier(); }
        const tier=(typeof selTier!=='undefined'&&selTier)?selTier.name:'';
        const msg=`${p.count} students.${tier?' Tier: '+tier+'.':''} Now say the principal's phone number.`;
        show(null,msg,'Count set ✓'); say(msg); break;
      }

      case 'setPhone':{
        const ph=document.getElementById('s-phone');
        if(ph) ph.value=p.phone;
        const msg=`Phone set: ${p.phone}. Say "submit to Bayo" to send the deal.`;
        show(null,msg,'Phone set ✓'); say(msg); break;
      }

      case 'submit':{
        if(typeof submitDeal==='function') submitDeal();
        show(null,'Submitting to Bayo...',''); say('Submitting now.'); break;
      }

      case 'queryDeals':{
        const q=(typeof SQ!=='undefined'&&SQ.q)?SQ.q.filter(x=>x.op?.t==='deal').length:0;
        const msg=q
          ?`${q} deal${q>1?'s':''} queued offline and syncing.`
          :'Check the My Deals tab to see your submitted schools.';
        show(null,msg); say(msg); break;
      }

      case 'goEarnings':
      case 'nav':{
        const tab=p.tab||'earnings';
        if(typeof go==='function') go(tab);
        const msg=`Opening ${tab}.`;
        show(null,msg); say(msg); break;
      }

      case 'help':{
        const msg='Say: "Submit Wisdom Walks, 150 students, phone 08038740131" to fill the form at once. Or say the name first, then the count, then the phone. Then say "submit to Bayo".';
        show(null,'🎙️ Quick-submit command:',msg);
        say('To submit a school in one sentence: say Submit, then school name, number of students, and phone number.'); break;
      }

      default:{
        const msg=`I did not understand that. Say "help" for commands.`;
        show(p.raw||null,msg); say(msg);
      }
    }
  }

  // ── Mic control ───────────────────────────────────────────────────────
  function startL(){
    if(!rec){
      rec=new SR();
      rec.lang='en-NG'; rec.continuous=false;
      rec.interimResults=false; rec.maxAlternatives=1;
      rec.onresult=(e)=>{
        const spoken=e.results[0][0].transcript;
        show(spoken,'Processing...');
        exec(parse(spoken)); stopL();
      };
      rec.onerror=(e)=>{
        const m=e.error==='no-speech'
          ?'Nothing heard. Tap mic and try again.'
          :'Microphone issue. Try again.';
        show(null,m); stopL();
      };
      rec.onend=()=>stopL();
    }
    try{
      rec.start(); listening=true;
      btn.classList.add('vlist'); btn.textContent='🔴';
      show(null,'Listening... speak now');
    }catch(e){ stopL(); }
  }

  function stopL(){
    listening=false;
    btn.classList.remove('vlist'); btn.textContent='🎙️';
    try{ rec?.stop(); }catch(e){}
  }

  btn.addEventListener('click',()=>{ if(listening) stopL(); else startL(); });
  window.bloomAgentVoice={start:startL,stop:stopL,say};
  console.log('🎙️ Bloom Agent Voice ready.');
})();
