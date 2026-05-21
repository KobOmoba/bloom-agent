// ── Firebase ──────────────────────────────────────────────────────────────
const FB = { 
  apiKey: "AIzaSyCVEdunn3AZndDP5Rm1Z3Kv1e6G6W2mB_o", 
  authDomain: "educationbloom-699ed.firebaseapp.com", 
  projectId: "educationbloom-699ed", 
  storageBucket: "educationbloom-699ed.firebasestorage.app", 
  messagingSenderId: "33750392965", 
  appId: "1:33750392965:web:2b3da887ede996ea8389ec" 
};
let db = null;
try { firebase.initializeApp(FB); db = firebase.firestore(); } catch(e) { console.warn('Firebase init:', e); }

// ── State ──────────────────────────────────────────────────────────────────
let agent = null;
let selTier = null;
const TIERS = [
  { price: 10000, name: 'Starter (1–50)',    max: 50  },
  { price: 20000, name: 'Small (51–100)',    max: 100 },
  { price: 35000, name: 'Medium (101–200)',  max: 200 },
  { price: 55000, name: 'Large (201–350)',   max: 350 },
  { price: 75000, name: 'Enterprise (351+)', max: 9999 }
];

// ─ Sync Queue ─────────────────────────────────────────────────────────────
const SQ = {
  q: JSON.parse(localStorage.getItem('ag_sq') || '[]'),
  save() { localStorage.setItem('ag_sq', JSON.stringify(this.q)); },
  push(op) { 
    this.q.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2), op, tries: 0 }); 
    this.save(); this.run(); 
  },
  ping() { 
    const ok = navigator.onLine && !!db; 
    const el = document.getElementById('sync'); 
    if (el) { 
      el.className = 'dot ' + (ok ? (this.q.length ? 'dot-sync' : 'dot-on') : 'dot-off'); 
      el.textContent = ok ? (this.q.length ? '● Syncing' : '● Online') : '● Offline'; 
    } 
    if (ok && this.q.length) this.run(); 
  },
  async run() {
    if (!db || !navigator.onLine || !this.q.length) return;
    const items = [...this.q];
    for (const item of items) {
      try { 
        await this.exec(item.op); 
        this.q = this.q.filter(x => x.id !== item.id); 
      } catch(e) { 
        item.tries++; 
        if (item.tries > 3) this.q = this.q.filter(x => x.id !== item.id);       }
    }
    this.save(); this.ping();
  },
  async exec(op) { 
    if (op.t === 'deal') await db.collection('admin_deals').add(op.d); 
  }
};
window.addEventListener('online', () => SQ.ping());
window.addEventListener('offline', () => SQ.ping());

// ─ Helpers ────────────────────────────────────────────────────────────────
const esc = s => { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
const $ = id => document.getElementById(id);
const fmt = n => '₦' + Number(n).toLocaleString('en-NG');

// ── Login ──────────────────────────────────────────────────────────────────
function setTab(mode) {
  $('phone-form').style.display = mode === 'phone' ? 'block' : 'none';
  $('register-form').style.display = mode === 'register' ? 'block' : 'none';
  document.querySelectorAll('.ltab').forEach((t, i) => t.classList.toggle('on', (i === 0 && mode === 'phone') || (i === 1 && mode === 'register')));
  $('login-err').style.display = 'none';
}

function normalizePhone(raw) {
  let p = raw.trim().replace(/\D/g, '');
  if (p.startsWith('0') && p.length === 11) return '234' + p.slice(1);
  if (p.startsWith('234') && p.length === 13) return p;
  if (p.length === 10) return '234' + p;
  return p;
}

async function doLogin() {
  const raw = $('l-phone').value.trim();
  const phone = normalizePhone(raw);
  const localFmt = phone.startsWith('234') ? '0' + phone.slice(3) : phone;
  if (phone.length < 10) {
    showErr('Enter your WhatsApp number — e.g. 08038740131 or 2348038740131');
    return;
  }
  const btn = $('l-btn'); btn.textContent = 'Checking...'; btn.disabled = true;
  try {
    const [snap1, snap2] = await Promise.all([
      db.collection('admin_agents').where('phone', '==', phone).get(),
      db.collection('admin_agents').where('phone', '==', localFmt).get()
    ]);
    const allDocs = [...snap1.docs, ...snap2.docs];
    if (!allDocs.length) {
      showErr('Number not registered. Ask Bayo (AariNAT) to add you: +234 814 507 3941');
      btn.textContent = '▶ Login'; btn.disabled = false; return;    }
    const doc = allDocs[0];
    agent = { id: doc.id, ...doc.data() };
    localStorage.setItem('ag_agent', JSON.stringify(agent));
    startApp();
  } catch(e) {
    const msg = e?.message || '';
    if (msg.toLowerCase().includes('permission') || msg.includes('PERMISSION_DENIED')) {
      showErr('Firestore permission error. Update your Firestore Rules in Firebase Console.');
    } else if (!navigator.onLine) {
      showErr('No internet. Check connection and try again.');
    } else {
      showErr('Failed: ' + (msg.slice(0, 100) || 'unknown error'));
    }
    console.error('Login error:', e);
  }
  btn.textContent = '▶ Login'; btn.disabled = false;
}

async function doRegister() {
  showErr("You can't self-register. AariNAT must add you. Call +234 814 507 3941");
}

function showErr(msg) { const e = $('login-err'); e.textContent = msg; e.style.display = 'block'; }

function startApp() {
  $('login').style.display = 'none';
  $('app').style.display = 'block';
  $('agent-name-hdr').textContent = agent.name;
  SQ.ping();
  go('submit');
}

function logout() { if (!confirm('Logout?')) return; localStorage.removeItem('ag_agent'); location.reload(); }

// ── Navigation ─────────────────────────────────────────────────────────────
function go(tab) {
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('on'));
  document.querySelectorAll('.nlink').forEach(b => b.classList.remove('on'));
  $(`sec-${tab}`).classList.add('on');
  const btn = document.querySelector(`[data-tab="${tab}"]`);
  if (btn) btn.classList.add('on');
  if (tab === 'deals') renderDeals();
  if (tab === 'earnings') renderEarnings();
}

// ── Submit Deal ────────────────────────────────────────────────────────────
function selectTier(el, price, name, max) {
  document.querySelectorAll('.tier').forEach(t => t.classList.remove('sel'));
  el.classList.add('sel');  selTier = { price, name, max };
  updateCommission();
}

function autoTier() {
  const n = parseInt($('s-count').value) || 0;
  if (!n) return;
  const t = TIERS.find(x => n <= x.max) || TIERS[4];
  document.querySelectorAll('.tier').forEach((el, i) => {
    el.classList.toggle('sel', TIERS[i]?.name === t.name);
  });
  selTier = t;
  updateCommission();
}

function updateCommission() {
  if (!selTier) return;
  const terms = parseInt($('s-terms').value) || 1;
  const total = selTier.price * terms;
  const comm = Math.round(total * ((agent.commission || 20) / 100));
  $('comm-box').style.display = 'block';
  $('comm-amt').textContent = fmt(comm);
  $('comm-total').textContent = `Total school pays: ${fmt(total)} for ${terms} term${terms > 1 ? 's' : ''}`;
}

async function submitDeal() {
  const name = $('s-name').value.trim();
  const phone = $('s-phone').value.trim().replace(/\D/g, '');
  const email = $('s-email').value.trim();
  const count = parseInt($('s-count').value) || 0;
  const terms = parseInt($('s-terms').value) || 1;
  const notes = $('s-notes').value.trim();
  const fb = $('submit-fb');
  
  if (!name) { showFB(fb, 'bad', 'Enter the school name.'); return; }
  if (!phone || phone.length < 10) { showFB(fb, 'bad', 'Enter principal\'s WhatsApp (e.g. 2348012345678).'); return; }
  if (!count || count < 1) { showFB(fb, 'bad', 'Enter approximate number of students.'); return; }
  if (!selTier) { showFB(fb, 'bad', 'Select a pricing tier.'); return; }
  
  const btn = $('submit-btn');
  btn.textContent = 'Submitting...';
  btn.disabled = true;
  btn.style.opacity = '0.7';

  const deal = {
    timestamp: new Date(), status: 'pending',
    agent: { id: agent.id, name: agent.name, phone: agent.phone, commission: agent.commission || 20 },
    school: { name, phone, email, studentCount: count },
    tier: { name: selTier.name, price: selTier.price },
    terms, notes  };

  try {
    if (db && navigator.onLine) {
      await db.collection('admin_deals').add(deal);
    } else {
      SQ.push({ t: 'deal', d: deal });
    }
    showFB(fb, 'ok', `✅ "${name}" submitted! Your commission will be ${fmt(Math.round(selTier.price * terms * ((agent.commission || 20) / 100)))} on approval.`);
    ['s-name', 's-phone', 's-email', 's-count', 's-notes'].forEach(id => $(id).value = '');
    $('s-terms').value = '1';
    document.querySelectorAll('.tier').forEach(t => t.classList.remove('sel'));
    selTier = null; $('comm-box').style.display = 'none';
  } catch(e) {
    console.error('Submit Error:', e);
    SQ.push({ t: 'deal', d: deal });
    showFB(fb, 'ok', '️ Network issue. Deal saved offline & will sync automatically.');
  } finally {
    btn.textContent = '📤 Submit to Bayo';
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

function showFB(el, type, msg) { el.className = `feedback ${type}`; el.textContent = msg; el.style.display = 'block'; }

// ── My Deals ───────────────────────────────────────────────────────────────
async function renderDeals() {
  const c = $('deals-list'); c.innerHTML = '<p style="text-align:center;color:var(--sub);padding:2rem;">Loading...</p>';
  try {
    const snap = await db.collection('admin_deals').where('agent.phone', '==', agent.phone).get();
    const deals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    deals.sort((a, b) => {
      const ta = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp || 0);
      const tb = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp || 0);
      return tb - ta;
    });
    if (!deals.length) { c.innerHTML = '<p style="text-align:center;color:var(--sub);padding:2rem;">No deals yet. Submit your first school!</p>'; return; }
    c.innerHTML = deals.map(d => {
      const chipCls = { pending: 'chip-p', approved: 'chip-a', rejected: 'chip-r' }[d.status || 'pending'];
      const comm = Math.round((d.tier?.price || 0) * ((d.agent?.commission || 20) / 100) * (d.terms || 1));
      return `<div class="deal ${d.status || 'pending'}">
        <span class="chip ${chipCls}">${(d.status || 'pending').toUpperCase()}</span>
        <div class="deal-name">${esc(d.school?.name)}</div>
        <div class="deal-meta">📊 ${d.school?.studentCount || 0} students · ${esc(d.tier?.name || '—')}</div>
        <div class="deal-meta"> ${esc(d.school?.phone || '—')}</div>
        <div class="deal-meta" style="color:var(--money);font-weight:600;">Your commission: ${fmt(comm)}</div>
        ${d.schoolId ? `<div class="deal-meta" style="color:#60a5fa;">School ID: ${d.schoolId}</div>` : ''}
        ${d.status === 'approved' ? `<div style="margin-top:0.5rem;"><button class="btn-money btn-sm" onclick="resendOnboarding('${esc(d.school?.phone)}','${esc(d.school?.name)}','${d.schoolId || ''}')">📲 Send Onboarding WhatsApp</button></div>` : ''}
      </div>`;    }).join('');
  } catch(e) { c.innerHTML = '<p style="color:var(--danger);padding:1rem;">Failed to load. Check connection.</p>'; }
}

function resendOnboarding(phone, schoolName, schoolId) {
  const msg = `Hi! I'm your Educational Bloom agent.\n\nYour school "${schoolName}" has been activated! \n\n*School ID:* ${schoolId}\n\nLog in at: https://kobomoba.github.io/bloom-portal/\n\nI'll guide you through the setup. Call me anytime! 📞\n– ${agent.name}`;
  window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ── Earnings ───────────────────────────────────────────────────────────────
async function renderEarnings() {
  try {
    const snap = await db.collection('admin_ledger').where('agentPhone', '==', agent.phone).get();
    const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const total = entries.reduce((s, e) => s + (e.amount || 0), 0);
    const paid = entries.filter(e => e.paid).reduce((s, e) => s + (e.amount || 0), 0);
    $('earn-total').textContent = fmt(total);
    $('earn-paid').textContent = fmt(paid);
    $('earn-pending').textContent = fmt(total - paid);
    const tbody = $('earn-body');
    tbody.innerHTML = entries.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:var(--sub);padding:2rem;">No earnings yet.</td></tr>' : entries.map(e => {
      const dt = e.date?.toDate ? e.date.toDate() : new Date();
      const paidCls = e.paid ? 'chip-a' : 'chip-p';
      return `<tr>
        <td>${dt.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</td>
        <td style="font-size:0.75rem;">${e.schoolId || '—'}</td>
        <td style="color:var(--money);font-weight:700;">${fmt(e.amount || 0)}</td>
        <td><span class="chip ${paidCls}" style="position:static;">${e.paid ? 'Paid' : 'Pending'}</span></td>
      </tr>`;
    }).join('');
  } catch(e) { console.warn('Earnings:', e); }
}

// ── Smart Register Counter ─────────────────────────────────────────────────
let csvStudentCount = 0;
let csvParsedNames = [];
const TIERS_LIST = [
  { max: 50, price: 10000, name: 'Starter (1-50 students)' },
  { max: 100, price: 20000, name: 'Small (51-100 students)' },
  { max: 200, price: 35000, name: 'Medium (101-200 students)' },
  { max: 350, price: 55000, name: 'Large (201-350 students)' },
  { max: 9999, price: 75000, name: 'Enterprise (351+ students)' }
];

function cleanName(raw) {
  let s = raw.replace(/^[\s]*\d+[.)\s]+/, '').trim();
  s = s.replace(/^[\s\u2022-*]+/, '').trim();
  s = s.replace(/^((?:[A-Z][a-zA-Z]/)[A-Z][a-zA-Z].\s)+/g, '').trim();
  s = s.replace(/^(M/C|MC|C/P|S/P/S|C/E/B|L/S/[A-Z/]+)\s+/i, '').trim();
  if (!s || s.length < 3) return null;  const letters = s.replace(/[^a-zA-Z\s]/g, '').trim();
  if (letters.length < 3) return null;
  const specialRatio = s.replace(/[a-zA-Z\s]/g, '').length / s.length;
  if (specialRatio > 0.35) return null;
  if (/^(general|members|list|students|class|section|total|name|s/n|serial|no.|page|date|school|am|pm|\d{1,2}:\d{2})/i.test(letters.trim())) return null;
  const letterRatio = letters.length / Math.max(s.length, 1);
  if (letterRatio < 0.55) return null;
  const words = s.split(/\s+/).filter(w => /[a-zA-Z]{2,}/.test(w));
  if (words.length < 1) return null;
  return s;
}

function isNumberedLine(line) { return /^\s*\d+[.)\s]/.test(line); }
function isBulletLine(line) { return /^\s*[\u2022-*]\s/.test(line); }

function showLoading(msg) {
  const box = document.getElementById('csv-count-result');
  const ld = document.getElementById('csv-loading');
  box.style.display = 'block';
  ld.style.display = 'block';
  ld.textContent = msg || 'Reading...';
  document.getElementById('csv-name-preview').innerHTML = '';
  document.getElementById('csv-class-breakdown').innerHTML = '';
}

function renderCountResult(names) {
  const unique = [...new Set(names.map(n => n.trim()).filter(n => n.length > 1))];
  document.getElementById('csv-loading').style.display = 'none';
  if (!unique.length) {
    document.getElementById('csv-count-result').style.display = 'none';
    alert('No student names found.\n\nFor photos: ensure the image is clear and well-lit.\nFor CSV/text: one name per line.');
    return;
  }
  csvStudentCount = unique.length;
  csvParsedNames = unique.map(name => ({ name, class: null }));
  const tier = TIERS_LIST.find(t => csvStudentCount <= t.max) || TIERS_LIST[4];
  const comm = Math.round(tier.price * 0.20);
  document.getElementById('csv-student-count').textContent = csvStudentCount;
  document.getElementById('csv-tier-name').textContent = tier.name;
  document.getElementById('csv-school-pays').textContent = '₦' + tier.price.toLocaleString('en-NG') + '/term';
  document.getElementById('csv-your-comm').textContent = '₦' + comm.toLocaleString('en-NG');
  const preview = unique.slice(0, 15);
  const extra = unique.length - preview.length;
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

function extractNamesFromText(raw) {
  const rawLines = raw.split(/\r?\n/);
  const names = [];
  const joined = [];
  let current = null;
  rawLines.forEach(line => {
    const t = line.trim();
    if (!t) {
      if (current !== null) { joined.push(current); current = null; }
      return;
    }
    if (t.includes(',') && !isNumberedLine(t) && !isBulletLine(t)) {
      if (current !== null) { joined.push(current); current = null; }
      joined.push(t.split(',')[0].replace(/"/g, '').trim());
      return;
    }
    if (isNumberedLine(t) || isBulletLine(t)) {
      if (current !== null) joined.push(current);
      current = t;
    } else {
      if (current !== null) {
        const words = t.replace(/[^a-zA-Z\s]/g, '').trim();
        if (words.length > 1 && t.length < 40) {
          current = current + ' ' + t;
        } else {
          joined.push(current);
          current = t;
        }
      } else {
        current = t;
      }
    }
  });
  if (current !== null) joined.push(current);
  joined.forEach(line => {    const cleaned = cleanName(line);
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

function readImageWithOCR(file) {
  showLoading('📸 Reading photo... loading OCR engine (first time takes 30 seconds)');
  const loadTesseract = () => new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      await loadTesseract();
      const { data: { text } } = await Tesseract.recognize(ev.target.result, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            const pct = Math.round((m.progress || 0) * 100);
            const ld = document.getElementById('csv-loading');
            if (ld) ld.textContent = '📸 Reading photo... ' + pct + '%';
          }
        }
      });
      const names = extractNamesFromText(text);
      renderCountResult(names);
    } catch(err) {
      document.getElementById('csv-loading').style.display = 'none';
      document.getElementById('csv-count-result').style.display = 'none';
      alert('Photo reading failed: ' + (err.message || 'unknown') + '\n\nTips:\n- Make sure photo is clear and well-lit\n- Hold phone steady above the register\n- Each name should be on its own line\n\nOr type the student count manually in the field below.');
    }
  };
  reader.onerror = () => alert('Could not read image.');
  reader.readAsDataURL(file);
}
function useCSVCount() {
  if (!csvStudentCount) { alert('Upload a file first.'); return; }
  const countInput = document.getElementById('s-count');
  countInput.value = csvStudentCount;
  autoTier();
  countInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  countInput.style.borderColor = '#10b981';
  setTimeout(() => { countInput.style.borderColor = ''; }, 2000);
}

function resetCSVCount() {
  csvStudentCount = 0;
  csvParsedNames = [];
  document.getElementById('csv-count-result').style.display = 'none';
  document.getElementById('register-csv').value = '';
  document.getElementById('csv-name-preview').innerHTML = '';
}

// ── Startup ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  SQ.ping();
  const saved = localStorage.getItem('ag_agent');
  if (saved) { try { agent = JSON.parse(saved); startApp(); return; } catch(e) { } }
  $('login').style.display = 'flex';
  $('app').style.display = 'none';
  setTab('phone');
});
