// ── Firebase ───────────────────────────────────────────────────────────────
const FB = { apiKey:"AIzaSyCVEdunn3AZndDP5Rm1Z3Kv1e6G6W2mB_o", authDomain:"educationbloom-699ed.firebaseapp.com", projectId:"educationbloom-699ed", storageBucket:"educationbloom-699ed.firebasestorage.app", messagingSenderId:"33750392965", appId:"1:33750392965:web:2b3da887ede996ea8389ec" };
let db = null;
try { firebase.initializeApp(FB); db = firebase.firestore(); } catch(e){ console.warn('Firebase:',e); }

// ── State ──────────────────────────────────────────────────────────────────
let agent = null;    // { id, name, phone, commission }
let selTier = null;  // { price, name, max }
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
window.addEventListener('online', ()=>SQ.ping());
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

  try {
    // Search both formats — admin may have saved with or without country code
    const [snap1, snap2] = await Promise.all([
      db.collection('admin_agents').where('phone','==',phone).get(),
      db.collection('admin_agents').where('phone','==',localFmt).get()
    ]);
    const allDocs = [...snap1.docs, ...snap2.docs];

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
      showErr('Firestore permission error. Update your Firestore Rules in Firebase Console — see fix below.');
    } else if(!navigator.onLine){
      showErr('No internet. Check connection and try again.');
    } else {
      showErr('Failed: ' + (msg.slice(0,100)||'unknown error'));
    }
    console.error('Login error:', e);
  }
  btn.textContent='▶ Login'; btn.disabled=false;
}

async function doRegister(){
  // Self-registration is not allowed — agents must be added by admin
  showErr("You can't self-register. AariNAT must add you. Call +234 814 507 3941");
}

function showErr(msg){ const e=$('login-err'); e.textContent=msg; e.style.display='block'; }

function startApp(){
  $('login').style.display='none';
  $('app').style.display='block';
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
  const t=TIERS.find(x=>n<=x.max)||TIERS[4];
  document.querySelectorAll('.tier').forEach((el,i)=>{
    el.classList.toggle('sel', TIERS[i]?.name===t.name);
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
    showFB(fb,'ok',`✅ "${name}" submitted! Your commission will be ${fmt(Math.round(selTier.price*terms*((agent.commission||20)/100))/1)} on approval.`);
    // Reset form
    ['s-name','s-phone','s-email','s-count','s-notes'].forEach(id=>$(id).value='');
    $('s-terms').value='1';
    document.querySelectorAll('.tier').forEach(t=>t.classList.remove('sel'));
    selTier=null; $('comm-box').style.display='none';
  }catch(e){ showFB(fb,'bad','Submission failed. Check connection.'); }
  btn.textContent='📤 Submit to Bayo'; btn.disabled=false;
}

function showFB(el,type,msg){ el.className=`feedback ${type}`; el.textContent=msg; el.style.display='block'; }

// ── My Deals ───────────────────────────────────────────────────────────────
async function renderDeals(){
  const c=$('deals-list'); c.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">Loading...</p>';
  try{
    const snap=await db.collection('admin_deals').where('agent.phone','==',agent.phone).get();
    const deals=snap.docs.map(d=>({id:d.id,...d.data()}));
    deals.sort((a,b)=>{ const ta=a.timestamp?.toDate?a.timestamp.toDate():new Date(a.timestamp||0); const tb=b.timestamp?.toDate?b.timestamp.toDate():new Date(b.timestamp||0); return tb-ta; });
    if(!deals.length){ c.innerHTML='<p style="text-align:center;color:var(--sub);padding:2rem;">No deals yet. Submit your first school!</p>'; return; }
    c.innerHTML=deals.map(d=>{
      const chipCls={pending:'chip-p',approved:'chip-a',rejected:'chip-r'}[d.status||'pending'];
      const comm=Math.round((d.tier?.price||0)*((d.agent?.commission||20)/100)*(d.terms||1));
      return `<div class="deal ${d.status||'pending'}">
        <span class="chip ${chipCls}">${(d.status||'pending').toUpperCase()}</span>
        <div class="deal-name">${esc(d.school?.name)}</div>
        <div class="deal-meta">📊 ${d.school?.studentCount||0} students · ${esc(d.tier?.name||'—')}</div>
        <div class="deal-meta">📱 ${esc(d.school?.phone||'—')}</div>
        <div class="deal-meta" style="color:var(--money);font-weight:600;">Your commission: ${fmt(comm)}</div>
        ${d.schoolId?`<div class="deal-meta" style="color:#60a5fa;">School ID: ${d.schoolId}</div>`:''}
        ${d.status==='approved'?`<div style="margin-top:0.5rem;"><button class="btn-money btn-sm" onclick="resendOnboarding('${esc(d.school?.phone)}','${esc(d.school?.name)}','${d.schoolId||''}')">📲 Send Onboarding WhatsApp</button></div>`:''}
      </div>`;
    }).join('');
  }catch(e){ c.innerHTML='<p style="color:var(--danger);padding:1rem;">Failed to load. Check connection.</p>'; }
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


// ── CSV Register Counter ───────────────────────────────────────────────────
let csvStudentCount = 0;

function handleRegisterCSV(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const lines = ev.target.result.split(/\r?\n/).filter(l => l.trim() && !l.toLowerCase().startsWith('name'));
    const students = lines.filter(l => {
      const cols = l.split(',');
      return cols[0] && cols[0].trim().length > 1; // must have a name with at least 2 chars
    });
    csvStudentCount = students.length;
    if(!csvStudentCount){ alert('No students found in CSV. Check format: Name, Class (header optional).'); return; }

    // Count by class
    const byClass = {};
    students.forEach(l => {
      const cols = l.split(',').map(c => c.trim());
      const cls = cols[1] || 'Unknown';
      byClass[cls] = (byClass[cls]||0) + 1;
    });

    // Determine tier
    const TIERS = [
      {max:50,  price:10000, name:'Starter (1–50 students)'},
      {max:100, price:20000, name:'Small (51–100 students)'},
      {max:200, price:35000, name:'Medium (101–200 students)'},
      {max:350, price:55000, name:'Large (201–350 students)'},
      {max:9999,price:75000, name:'Enterprise (351+ students)'}
    ];
    const tier = TIERS.find(t => csvStudentCount <= t.max) || TIERS[4];
    const comm = Math.round(tier.price * 0.20);

    // Show result box
    document.getElementById('csv-student-count').textContent = csvStudentCount;
    document.getElementById('csv-tier-name').textContent = tier.name;
    document.getElementById('csv-school-pays').textContent = '\u20a6'+tier.price.toLocaleString('en-NG')+'/term';
    document.getElementById('csv-your-comm').textContent = '\u20a6'+comm.toLocaleString('en-NG');

    const classList = Object.entries(byClass).sort((a,b)=>b[1]-a[1]);
    document.getElementById('csv-class-breakdown').innerHTML =
      '<strong>Breakdown by class:</strong><br>' +
      classList.map(([cls,cnt]) => `${cls}: ${cnt} student${cnt!==1?'s':''}`).join(' &nbsp;·&nbsp; ');

    document.getElementById('csv-count-result').style.display = 'block';

    // Reset file input so same file can be re-uploaded
    e.target.value = '';
  };
  reader.onerror = () => alert('Could not read file. Please try again.');
  reader.readAsText(file);
}

function useCSVCount(){
  if(!csvStudentCount){ alert('Upload a CSV first.'); return; }
  const countInput = document.getElementById('s-count');
  countInput.value = csvStudentCount;
  autoTier(); // auto-select the correct tier
  // Scroll to count field so user sees it updated
  countInput.scrollIntoView({behavior:'smooth', block:'center'});
  // Flash the field green briefly
  countInput.style.borderColor = '#10b981';
  setTimeout(() => { countInput.style.borderColor = ''; }, 2000);
}

// ── Startup ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  SQ.ping();
  const saved=localStorage.getItem('ag_agent');
  if(saved){ try{ agent=JSON.parse(saved); startApp(); return; }catch(e){} }
  $('login').style.display='flex';
  $('app').style.display='none';
  setTab('phone');
});
