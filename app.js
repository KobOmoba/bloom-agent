// ── Firebase ───────────────────────────────────────────────────────────────
const FB={apiKey:"AIzaSyCVEdunn3AZndDP5Rm1Z3Kv1e6G6W2mB_o",authDomain:"educationbloom-699ed.firebaseapp.com",projectId:"educationbloom-699ed",storageBucket:"educationbloom-699ed.firebasestorage.app",messagingSenderId:"33750392965",appId:"1:33750392965:web:2b3da887ede996ea8389ec"};
let db=null;
try{
  firebase.initializeApp(FB);
  db=firebase.firestore();
  db.enablePersistence({synchronizeTabs:true}).catch(e=>{if(e.code!=='failed-precondition'&&e.code!=='unimplemented')console.warn('Persist:',e.code);});
}catch(e){console.warn('Firebase:',e);}

// ── State ──────────────────────────────────────────────────────────────────
let agent=null,apiKeys=null,currentTab='wizard';
let selDetectedClass='';  // class detected from ledger header
let timerSec=0,timerInterval=null;
let ledgerPageCount=1,ledgerImages={};
let allStudents=[],classGroups={},selTier=null,selDetectedTerm='',selDetectedYear='',failedPages=[];

// ── Groq rate-limit tracking — read from real response headers, not guessed ─
// Groq sends x-ratelimit-remaining-tokens / x-ratelimit-reset-tokens on
// EVERY response (success or 429). Reading these lets the cooldown between
// pages be adaptive: skip the wait when budget is fine, wait exactly the
// right amount when it's not — instead of a blind fixed guess that either
// wastes time when budget is fine or isn't long enough when it's low.
let groqRateState={remainingTokens:null,resetMs:0};
function parseGroqDuration(v){
  if(!v)return 0;
  v=String(v).trim();
  if(v.endsWith('ms'))return parseFloat(v);
  if(v.endsWith('s'))return parseFloat(v)*1000;
  return parseFloat(v)*1000||0;
}
function updateGroqRateState(resp){
  try{
    const remaining=resp.headers.get('x-ratelimit-remaining-tokens');
    const reset=resp.headers.get('x-ratelimit-reset-tokens');
    if(remaining!==null)groqRateState.remainingTokens=parseInt(remaining);
    if(reset!==null)groqRateState.resetMs=parseGroqDuration(reset);
  }catch(e){/* headers not available in this environment — ignore */}
}

// ── Tiers ──────────────────────────────────────────────────────────────────
const TIERS=[
  {max:50,   price:10000, name:'Starter (1-50)'},
  {max:100,  price:20000, name:'Small (51-100)'},
  {max:200,  price:35000, name:'Medium (101-200)'},
  {max:350,  price:55000, name:'Large (201-350)'},
  {max:9999, price:75000, name:'Enterprise (351+)'}
];
const getTier=n=>TIERS.find(t=>n<=t.max)||TIERS[TIERS.length-1];

// ── Sync Queue ─────────────────────────────────────────────────────────────
const SQ={
  q:JSON.parse(localStorage.getItem('ag2_sq')||'[]'),
  save(){localStorage.setItem('ag2_sq',JSON.stringify(this.q));},
  push(op){this.q.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2),op,tries:0});this.save();this.run();},
  ping(){
    const ok=!!db;
    const el=$('sync');
    if(el){el.className='sdot '+(ok?this.q.length?'sd-sync':'sd-on':'sd-off');el.textContent=ok?this.q.length?'● Syncing':'● Online':'● Offline';}
    if(ok&&this.q.length)this.run();
  },
  async run(){
    if(!db||!this.q.length)return;
    const items=[...this.q];
    for(const item of items){
      try{await db.collection('v2_deals').add(item.op.d);this.q=this.q.filter(x=>x.id!==item.id);}
      catch(e){item.tries++;if(item.tries>3)this.q=this.q.filter(x=>x.id!==item.id);}
    }
    this.save();this.ping();
  }
};
window.addEventListener('online',()=>{SQ.ping();SQ.run();});
window.addEventListener('offline',()=>SQ.ping());

// ── Helpers ────────────────────────────────────────────────────────────────
const $=id=>document.getElementById(id);
const esc=s=>{if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;};
const fmt=n=>'₦'+Number(n||0).toLocaleString('en-NG');
const gv=id=>($( id)?.value||'').trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ── Timer ──────────────────────────────────────────────────────────────────
function startTimer(){
  clearInterval(timerInterval);timerSec=0;
  timerInterval=setInterval(()=>{
    timerSec++;
    const m=String(Math.floor(timerSec/60)).padStart(2,'0');
    const s=String(timerSec%60).padStart(2,'0');
    const el=$('timerDisplay');if(el)el.textContent=m+':'+s;
  },1000);
}
function timerText(){const m=Math.floor(timerSec/60);const s=timerSec%60;return m>0?m+'m '+s+'s':s+'s';}

// ── Login — OPEN ACCESS ────────────────────────────────────────────────────
function normPhone(raw){
  let p=raw.trim().replace(/\D/g,'');
  if(p.startsWith('0')&&p.length===11)return'234'+p.slice(1);
  if(p.startsWith('234')&&p.length===13)return p;
  if(p.length===10)return'234'+p;
  return p;
}

async function doLogin(){
  const raw=gv('l-phone');const phone=normPhone(raw);
  const localFmt=phone.startsWith('234')?'0'+phone.slice(3):phone;
  const btn=$('l-btn');const err=$('l-err');err.style.display='none';
  if(phone.length<10){showE(err,'Enter your WhatsApp number — e.g. 08038740131');return;}
  btn.textContent='Checking...';btn.disabled=true;

  const cached=localStorage.getItem('ag2_agent');
  if(cached){
    try{
      const a=JSON.parse(cached);
      const cp=normPhone(a.phone||'');
      if(cp===phone||a.phone===localFmt||cp===localFmt){
        agent=a;startApp();btn.textContent='▶ Login';btn.disabled=false;
        if(db)refreshBg(a.id,phone,localFmt).catch(()=>{});
        return;
      }
    }catch(e){localStorage.removeItem('ag2_agent');}
  }

  // ── AUTHORIZATION SUSPENDED FOR TESTING ──────────────────────────────────
  // Any valid phone number gets in as a guest agent. Registered agents still
  // get their real profile. Re-enable Firestore check when testing is done.
  let foundInDb = false;
  if(db){
    try{
      const[s1,s2]=await Promise.all([
        db.collection('admin_agents').where('phone','==',phone).get(),
        db.collection('admin_agents').where('phone','==',localFmt).get()
      ]);
      const seen=new Set();
      const docs=[...s1.docs,...s2.docs].filter(d=>{if(seen.has(d.id))return false;seen.add(d.id);return true;});
      if(docs.length){
        agent={id:docs[0].id,...docs[0].data()};
        localStorage.setItem('ag2_agent',JSON.stringify(agent));
        foundInDb=true;
      }
    }catch(e){console.warn('DB lookup:',e.message);}
  }
  if(!foundInDb){
    // Not in DB — enter as guest (auth suspended for testing)
    agent={id:'guest_'+phone,name:'Test Agent ('+localFmt+')',phone:localFmt,commission:20,_guest:true};
    localStorage.setItem('ag2_agent',JSON.stringify(agent));
  }
  startApp();
  btn.textContent='▶ Login';btn.disabled=false;
}

async function refreshBg(agentId,phone,localFmt){
  try{
    let doc=await db.collection('admin_agents').doc(agentId).get();
    if(!doc.exists){const[s1,s2]=await Promise.all([db.collection('admin_agents').where('phone','==',phone).get(),db.collection('admin_agents').where('phone','==',localFmt).get()]);const d=[...s1.docs,...s2.docs][0];if(!d)return;doc=d;}
    const fresh={id:doc.id,...doc.data()};
    localStorage.setItem('ag2_agent',JSON.stringify(fresh));
    if(agent&&agent.id===fresh.id)agent=fresh;
  }catch(e){}
}

function requestAccess(){
  const name=(gv('req-name')||'').trim();
  const phone=(gv('l-phone')||'').trim();
  const area=(gv('req-area')||'').trim();
  if(!name){alert('Enter your full name first.');return;}
  const msg='Hi Bayo, I would like to be an EduBloom agent.\n\nName: '+name+'\nPhone: '+phone+'\nArea: '+(area||'Not specified')+'\n\nPlease register me. Thank you!';
  window.open('https://wa.me/2348145073941?text='+encodeURIComponent(msg),'_blank');
}

function showE(el,msg){el.textContent=msg;el.style.display='block';}

function startApp(){
  $('login').style.display='none';
  const app=$('app');app.style.display='flex';app.style.flexDirection='column';
  SQ.ping();startTimer();
  _getApiKeys().catch(e=>console.warn('API keys:',e));
  goTab('wizard');
}

function logout(){if(!confirm('Logout?'))return;localStorage.removeItem('ag2_agent');location.reload();}

// ── API Keys ───────────────────────────────────────────────────────────────
async function _getApiKeys(){
  if(apiKeys)return apiKeys;
  let fsGroq='',fsHF='',fsOcrUrl='';
  if(db){
    try{
      const doc=await db.collection('admin_settings').doc('main').get();
      if(doc.exists){
        const d=doc.data();
        fsGroq   = d.groqApiKey||'';
        fsHF     = d.hfApiKey||'';
        // Oracle VPS PaddleOCR service — base URL only, e.g. "http://123.45.67.89"
        // (no trailing slash, no /scan-ledger — that's appended automatically)
        fsOcrUrl = d.ocrServiceUrl||'';
      }
    }catch(e){console.warn('Keys fetch:',e.message);}
  }
  apiKeys={groq:fsGroq, hf:fsHF, ocrServiceUrl:fsOcrUrl};
  return apiKeys;
}

// ── Navigation ─────────────────────────────────────────────────────────────
function goTab(tab){
  currentTab=tab;
  $('sec-wizard').style.display=tab==='wizard'?'block':'none';
  $('sec-deals').style.display=tab==='deals'?'block':'none';
  document.querySelectorAll('.nlink').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
  if(tab==='deals')renderDeals();
}

function goStep(n){
  ['sec-step1','sec-step2','sec-step3','sec-step4'].forEach(id=>{
    const el=$(id);if(el){el.classList.remove('on');el.style.display='none';}
  });
  const target=$('sec-step'+n);
  if(target){target.classList.add('on');target.style.display='block';}
  for(let i=1;i<=4;i++){
    const dot=$('sd-'+i),item=$('si-'+i),line=$('sl-'+i);
    if(!dot)continue;
    dot.className='step-dot';if(item)item.className='step-item';
    if(i<n){dot.classList.add('done');dot.textContent='✓';if(item)item.classList.add('done');if(line)line.classList.add('done');}
    else if(i===n){dot.classList.add('active');dot.textContent=i;if(item)item.classList.add('active');}
    else{dot.textContent=i;if(line)line.classList.remove('done');}
  }
  if(n===3)populatePitch();
  if(n===4)populateReview();
  window.scrollTo({top:0,behavior:'smooth'});
}

// ── Step 1: Signboard ──────────────────────────────────────────────────────
function captureSignboard(){
  const input=$('sign-input');
  input.onchange=e=>{
    const file=e.target.files[0];if(!file)return;
    fileToDataUrl(file).then(url=>{markCaptured('signCap',url);processSignboard(file,url);});
    input.value='';
  };
  input.click();
}

function skipSignboard(){
  $('school-fields').style.display='block';
  $('terms-card').style.display='block';
  $('btn-step1-next').style.display='block';
}

function markCaptured(id,url){
  const el=$(id);el.classList.add('captured');
  [...el.children].forEach(c=>{if(c.tagName!=='INPUT')c.style.display='none';});
  const img=document.createElement('img');
  img.src=url;img.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:12px;opacity:.8;';
  el.insertBefore(img,el.firstChild);
  const rb=document.createElement('button');rb.className='cap-retake';rb.textContent='↺ Retake';
  rb.onclick=e=>{e.stopPropagation();el.classList.remove('captured');[...el.children].filter(c=>c.tagName!=='INPUT'&&c!==rb).forEach(c=>{if(c.tagName==='IMG')c.remove();else c.style.display='';});rb.remove();};
  el.appendChild(rb);
}

async function processSignboard(file,dataUrl){
  $('sign-proc').style.display='block';
  const prog=$('sign-prog'),status=$('sign-status');
  status.textContent='Compressing image...';prog.style.width='10%';
  try{
    const keys=await _getApiKeys();
    const compressed=await compressImage(dataUrl,800);
    prog.style.width='25%';

    const prompt='You are reading a Nigerian school signboard photograph. Extract: school name, full address, LGA, state.\nReturn ONLY valid JSON — no markdown, no explanation:\n{"name":"SCHOOL NAME","address":"full address","lga":"LGA name","state":"State name"}\nUse empty string for anything unclear.';

    // ── Groq only (proven, fast, free) ───────────────────────────────────
    const cascade=[];
    if(keys.groq) cascade.push({n:'Groq', fn:()=>callGroqVision(compressed,prompt,keys.groq,500)});
    if(!cascade.length){throw new Error('No Groq API key found in Firestore admin_settings/main');}

    let parsed={};
    for(const p of cascade){
      status.textContent='Reading signboard via '+p.n+'...';
      prog.style.width='50%';
      try{
        const raw=await p.fn();
        const clean=raw.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/```json|```/g,'').trim();
        let tmp={};
        try{tmp=JSON.parse(clean);}
        catch(e){const m=clean.match(/\{[\s\S]*?\}/);if(m)try{tmp=JSON.parse(m[0]);}catch(e2){}}
        if(tmp.name&&tmp.name.length>2){parsed=tmp;console.log('[Signboard] '+p.n+' succeeded');break;}
        console.warn('[Signboard] '+p.n+' returned no name');
      }catch(e){
        console.warn('[Signboard] '+p.n+' failed:',e.message);
      }
    }

    if(parsed.name)$('f-school-name').value=parsed.name;
    if(parsed.address)$('f-address').value=parsed.address;
    if(parsed.state)$('f-state').value=parsed.state;
    if(parsed.lga)$('f-lga').value=parsed.lga;
    const filled=[parsed.name,parsed.address,parsed.state,parsed.lga].filter(Boolean).length;
    const hint=$('ai-hint-sign');
    if(hint){
      hint.textContent=filled>0?'✨ AI filled '+filled+' of 4 fields from signboard':'⚠️ AI could not read signboard — fill manually';
      hint.style.display='block';
    }
    prog.style.width='100%';status.textContent=filled>0?'Done!':'Fill fields manually below.';
    setTimeout(()=>{$('sign-proc').style.display='none';$('school-fields').style.display='block';$('terms-card').style.display='block';$('btn-step1-next').style.display='block';},500);
  }catch(e){
    console.error('[Signboard] Fatal:',e.message);
    const prog=$('sign-prog'),status=$('sign-status');
    if(status)status.textContent='⚠️ Could not read signboard — fill manually';
    if(prog)prog.style.width='100%';
    setTimeout(()=>{$('sign-proc').style.display='none';$('school-fields').style.display='block';$('terms-card').style.display='block';$('btn-step1-next').style.display='block';},500);
  }
}

function validateStep1(){
  if(!gv('f-school-name')){alert('Enter the school name.');return;}
  if(!gv('f-phone')){alert('Enter the principal phone number.');return;}
  goStep(2);
}

// ── Step 2: Ledger ─────────────────────────────────────────────────────────
function addLedgerPage(){
  const idx=ledgerPageCount;ledgerPageCount++;
  const container=$('ledger-caps');
  const wrap=document.createElement('div');wrap.style.marginTop='.5rem';
  const btn=document.createElement('div');
  btn.className='cap-btn';btn.id='lc-'+idx;btn.onclick=()=>captureLedger(idx);
  const icon=document.createElement('div');icon.className='cap-icon';icon.textContent='📖';
  const lbl=document.createElement('div');lbl.className='cap-lbl';lbl.textContent='📷 Camera · 🖼️ Gallery — Page '+(idx+1);
  btn.appendChild(icon);btn.appendChild(lbl);
  const inp=document.createElement('input');
  inp.type='file';inp.accept='image/*';inp.id='li-'+idx;inp.style.display='none';
  btn.appendChild(inp);
  wrap.appendChild(btn);
  container.appendChild(wrap);
}

function captureLedger(idx){
  const input=$('li-'+idx);if(!input)return;
  input.onchange=e=>{
    const file=e.target.files[0];if(!file)return;
    fileToDataUrl(file).then(async url=>{
      const variance=await computeBlurScore(url);
      if(variance!==null&&variance<BLUR_VARIANCE_THRESHOLD){
        const retake=confirm('⚠️ This photo looks blurry and may not read well.\n\nTap OK to retake now, or Cancel to use it anyway.');
        if(retake){captureLedger(idx);return;}
      }
      ledgerImages[idx]=url;
      markCaptured('lc-'+idx,url);
      $('ledger-actions').style.display='block';
      $('ledger-skip-init').style.display='none';
    });
    input.value='';
  };
  input.click();
}

function skipLedger(){allStudents=[];classGroups={};$('ledger-results').style.display='block';$('step2-nav').style.display='block';}

// ── Shared reading-discipline block ─────────────────────────────────────────
// Applies to every OCR prompt in the app (signboard, ledger, and any
// future document type). The actual bug that caused every student to
// read as "OWING" wasn't a lack of names/columns — it was the prompt
// never telling the model to actively scan for status evidence instead
// of silently picking a default. This block fixes that at the root so
// future OCR features inherit the discipline instead of re-discovering
// this same bug.
const READING_DISCIPLINE=[
  'READING DISCIPLINE — apply to every field, always:',
  '- Transcribe exactly what is written. Do not paraphrase or "clean up" text.',
  '- For NUMBERS: read digit by digit, not at a glance. Common handwriting',
  '  confusions to double-check: 7 vs 1, 0 vs 6, 4 vs 9, 3 vs 8, 5 vs 6/8.',
  '- For STATUS fields: actively scan for explicit keywords, ticks, or',
  '  strikethroughs BEFORE deciding a value. Never pick a default status',
  '  just because nothing else is obviously visible — that produces a',
  '  confidently wrong answer, which is worse than no answer.',
  '- If a field is illegible or you are not confident, output "UNCLEAR"',
  '  for that field rather than guessing a plausible-looking value.'
].join('\n');

const LEDGER_PROMPT=[
  'You are reading the LEFT ~62% of a Nigerian SCHOOL FEES LEDGER (handwritten).',
  'This image is cropped — the 2nd and 3rd payment-installment columns are',
  'NOT visible. Do not look for them. The 1st part-payment/teller columns ARE visible.',
  'The columns you can see are:',
  '  Col 1: SERIAL NO (1, 2, 3...)',
  '  Col 2: SURNAME (family name — all caps)',
  '  Col 3: FIRSTNAME (given name — all caps)',
  '  Col 4: BALANCE FROM LAST TERM (debt carried forward — 0 or blank means none)',
  '  Col 5: CURRENT TERM FEES (the fee charged this term, e.g. 24000, 26000, 28000)',
  '  Col 6: TOTAL (col4 + col5 = everything this student owes)',
  '  Col 7: 1ST PART PAYMENT (an amount, OR a handwritten status word)',
  '  Col 8: TELLER NO / RECEIPT NO (often overwritten with a status word instead of a number)',
  '',
  READING_DISCIPLINE,
  '',
  'PAYMENT STATUS — this is the field that was getting this wrong before:',
  'Look in columns 7-8 (and the space around/above/below them — handwriting is',
  'often diagonal or overflows its cell) for any of these words or close variants:',
  '  "FULLY PAID", "FULL PAID", "FULLY", "PAID", "F/PAID", "PART PAYMENT"',
  'Decide payment_status using this priority:',
  '  1. If "FULLY PAID"/"FULL PAID"/"FULLY"+"PAID" appears anywhere on the row -> "PAID"',
  '  2. Else if a part-payment amount is visible and it is LESS than the total -> "PARTIAL"',
  '  3. Else if the row is completely blank in columns 7-8 with no annotation -> "UNCLEAR"',
  '  4. Only mark "OWING" if there is clear evidence of a remaining unpaid amount',
  '     (a positive number written as still-owed, or an explicit note) — never as a',
  '     silent default just because you found nothing else.',
  'When in doubt between OWING and UNCLEAR, choose UNCLEAR — a wrong confident',
  '"OWING" tells a parent who already paid that they still owe money.',
  '',
  'YOUR TASK: For every numbered student row return:',
  '  name           = SURNAME + space + FIRSTNAME',
  '  balance_bf     = col 4 value (integer, 0 if blank or dash)',
  '  termFees       = col 5 value (integer)',
  '  total          = col 6 value (integer)',
  '  payment_status = one of "PAID", "PARTIAL", "OWING", "UNCLEAR" (see rules above)',
  '  ocr_confidence  = "HIGH", "MEDIUM", or "LOW" — your confidence in this row overall',
  '  detected_class = class label at the top of the page (e.g. K-G, BASIC FOUR, NURSERY 1, BASIC THREE)',
  '  year           = year written at top of ledger (e.g. 2026)',
  '  term           = term number at top of ledger (e.g. 3)',
  '',
  'Nigerian SURNAMES (common): OGUNDETI, OYERINDE, OLATUNDE, OBASA, OKENDINMI, ILELABOYE,',
  'AFOLABI, OLIYIDE, KOLANDLE, ADEGUNLE, ADEOYE, SABIU, OGUNLADE, ALIMI, JOHN, AKINOLA,',
  'KASALI, ALAWODE, OYESANWO, OGUNDEYI, ALAO, AKINWANDE, OLAWALE, ODEREYE, AKINBELE,',
  'ADEBAYO, AYANDIYA, SHONIPE, GBELEKALE, FAFIOLU, DADA, MOSES, OYEBOLA, ADERIBIGBE,',
  'LAWAL, OLAYINOLA, IDOWU, ATAJA, AWOLOWO, AKINDELE, OGUNSOLA',
  '',
  'Nigerian FIRSTNAMES (common): SALAM, OYEDEPO, WAJUD, MICHEAL, IBRAHIM, RAHMON, AISHAT,',
  'CHRISTIANA, AFEEZ, DOMINION, SAMUEL, MALEEK, FATHIA, INIOLUWA, QUARIBAT, AWAL, GOLD,',
  'TOHEEB, GODWIN, ELIZABETH, TIBESIMI, WASLAT, MOZEED, DEBORAH, SHINDARA, GABRIEL,',
  'RASAQ, ENOCH, ABIGEAL, KOREDE, ADEMIDE, AMINDAT, WIQUYAT, ISREA, DORCAS, MARIAM,',
  'CYNTHIA, AMINAT, FATOBI, MUSTEQEEM, GIFT, SUCCESS, RASHEEDAT, KOREDE',
  '',
  'RULES:',
  '1. Every numbered row = one student. Read ALL rows. A page typically has 10-30 students.',
  '2. Crossed-out numbers: ignore the crossed-out value, read the correction written nearby.',
  '3. SELF-CHECK before finalizing each row: total must equal balance_bf + termFees.',
  '   If they do not match, re-read that row\'s digits and correct before moving on.',
  '4. Return ONLY valid JSON — no markdown fences, no explanation text.',
  '',
  'EXAMPLE OUTPUT:',
  '{"detected_class":"K-G","year":"2026","term":"3","students":[',
  '{"name":"OLIYIDE GODWIN","balance_bf":0,"termFees":24000,"total":24000,"payment_status":"PAID","ocr_confidence":"HIGH"},',
  '{"name":"KASALI RASAQ","balance_bf":5000,"termFees":24000,"total":29000,"payment_status":"PARTIAL","ocr_confidence":"MEDIUM"},',
  '{"name":"JOHN DEBORAH","balance_bf":3000,"termFees":26000,"total":29000,"payment_status":"UNCLEAR","ocr_confidence":"LOW"}',
  ']}'
].join('\n');

// ── Cascade builder — shared by full scan and targeted retry ────────────────
// PaddleOCR (Oracle VPS, coordinate-based column reading — free forever,
// structurally more reliable than vision-LLM guessing) tried first when
// configured. Direct Groq (qwen3.6-27b) next. HuggingFace last — works
// without a key, rate-limited but functional.
function buildLedgerCascade(imgUrl,keys){
  const cascade=[];
  if(keys.ocrServiceUrl)cascade.push({name:'PaddleOCR (VPS)', fn:()=>callPaddleOCR(imgUrl,keys.ocrServiceUrl)});
  if(keys.groq)cascade.push({name:'Groq', fn:()=>callGroqVision(imgUrl,LEDGER_PROMPT,keys.groq,4096)});
  cascade.push({name:'HuggingFace', fn:()=>callHFVision(imgUrl,LEDGER_PROMPT,keys.hf||'')});
  return cascade;
}

// ── Process one ledger page — shared by full scan and targeted retry ────────
// Returns {pageNum, succeeded, students, pageClass, term, year} without
// touching allStudents/classGroups — the caller decides how to merge.
async function processOnePage(idxKey,keys,statusEl,imagesTotal){
  const url=ledgerImages[idxKey];
  const pageNum=parseInt(idxKey)+1;
  if(statusEl)statusEl.textContent='Compressing page '+pageNum+'...';
  let compressed;
  try{compressed=await compressLedger(url);}
  catch(e){console.warn('Compress failed:',e.message);compressed=url;}

  const cascade=buildLedgerCascade(compressed,keys);
  let pageStudents=[],pageClass='',succeeded=false,term='',year='';

  for(const provider of cascade){
    if(statusEl)statusEl.textContent='Page '+pageNum+(imagesTotal?'/'+imagesTotal:'')+' → '+provider.name+'...';
    try{
      const rawText=await Promise.race([
        provider.fn(),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error(provider.name+' timed out after 30s')),30000))
      ]);
      const result=parseLedgerJSON(rawText);
      if(result.students.length>0){
        pageStudents=result.students;
        pageClass=result.detected_class;
        term=result.term;year=result.year;
        console.log('[v2 Ledger] '+provider.name+' page '+pageNum+': '+pageStudents.length+' students');
        succeeded=true;
        break;
      }
      console.warn('[v2 Ledger] '+provider.name+': 0 students — trying next');
    }catch(e){
      console.warn('[v2 Ledger] '+provider.name+' error:',e.message);
    }
  }
  return{pageNum,succeeded,students:pageStudents,pageClass,term,year};
}

// ── Merge one page's results into allStudents/classGroups (dedup by name) ──
function mergePageIntoResults(pageStudents,pageClass,term,year){
  if(pageClass){
    const dc=String(pageClass).trim().toUpperCase();
    if(dc&&dc!=='NULL'&&dc!=='UNKNOWN')selDetectedClass=dc;
  }
  if(term&&String(term).trim())selDetectedTerm=String(term).trim();
  if(year&&String(year).trim())selDetectedYear=String(year).trim();

  const seenNames=new Set(allStudents.map(s=>s.name.toLowerCase().replace(/[^a-z]/g,'')));
  const added=[];
  pageStudents.forEach(s=>{
    if(!s.name||s.name.length<2)return;
    s.name=s.name.toUpperCase().replace(/[^A-Z\s'\-.]/g,'').replace(/\s+/g,' ').trim();
    if(!s.name||s.name.length<2)return;
    const key=s.name.toLowerCase().replace(/[^a-z]/g,'');
    if(seenNames.has(key))return;
    seenNames.add(key);
    s.termFees = s.termFees||s.total||0;
    s.balance  = s.balance_bf||s.balance||0;
    s.total    = s.total||(s.termFees+s.balance);
    const ps=String(s.payment_status||'').toUpperCase().trim();
    if(ps==='PAID'||s.fully_paid===true){
      s.paid   = s.paid||s.total;
      s.status = 'FULLY PAID';
    } else if(ps==='PARTIAL'){
      s.paid   = s.paid||0;
      s.status = 'PART PAID';
    } else if(ps==='OWING'){
      s.paid   = s.paid||0;
      s.status = 'OWING';
    } else {
      s.paid   = s.paid||0;
      s.status = 'NEEDS REVIEW';
    }
    s.confidence=calcConf(s);
    s.class=pageClass?String(pageClass).trim().toUpperCase():(selDetectedClass||'UNKNOWN');
    allStudents.push(s);
    const cls=s.class;
    if(!classGroups[cls])classGroups[cls]=[];
    classGroups[cls].push(s);
    added.push(s);
  });
  return added;
}

// ── Retry ONLY the pages that failed — does not touch pages that already ───
// succeeded, and does not re-spend time/quota re-scanning good pages.
async function retryFailedPages(){
  if(!failedPages.length){alert('Nothing to retry — no failed pages.');return;}
  const pagesToRetry=[...failedPages];
  $('ledger-proc').style.display='block';
  $('ledger-results').style.display='none';
  const prog=$('ledger-prog'),status=$('ledger-status');
  prog.style.width='10%';
  const keys=await _getApiKeys();

  const stillFailed=[];
  for(let i=0;i<pagesToRetry.length;i++){
    const pageNum=pagesToRetry[i];
    const idxKey=String(pageNum-1);
    if(!ledgerImages[idxKey]){stillFailed.push(pageNum);continue;}
    prog.style.width=Math.round((i/pagesToRetry.length)*85)+'%';
    if(i>0)await ledgerCooldown(status,pageNum);
    const result=await processOnePage(idxKey,keys,status,pagesToRetry.length);
    if(result.succeeded){
      mergePageIntoResults(result.students,result.pageClass,result.term,result.year);
    } else {
      stillFailed.push(pageNum);
    }
  }
  failedPages=stillFailed;
  selTier=getTier(allStudents.length);
  prog.style.width='100%';
  status.textContent='Retry done — '+allStudents.length+' students total';
  setTimeout(()=>{$('ledger-proc').style.display='none';showLedgerResults();},600);
}

// ── Adaptive cooldown before the next page ──────────────────────────────────
// Replaces a blind fixed wait with a check against Groq's actual reported
// remaining budget. If there's comfortably enough left for another page,
// barely pause at all. If it's genuinely low, wait exactly what Groq says
// is left in the window (resetMs) instead of guessing — this is what
// collapsed "5-6 manual retries" down to close to zero.
async function ledgerCooldown(status,pageNum){
  const EXPECTED_PAGE_TOKENS=5000; // generous buffer above max_tokens(4096)+image encoding
  const r=groqRateState.remainingTokens;
  if(r===null||r>=EXPECTED_PAGE_TOKENS){
    // No data yet, or plenty of budget left — just a short courtesy pause
    // (separate RPM/RPD limits still apply even when TPM is fine).
    for(let s=3;s>0;s--){
      status.textContent='Next: page '+pageNum+' in '+s+'s...';
      await new Promise(res=>setTimeout(res,1000));
    }
    return;
  }
  const waitMs=Math.min(Math.max(groqRateState.resetMs,3000),65000);
  const waitS=Math.ceil(waitMs/1000);
  for(let s=waitS;s>0;s--){
    status.textContent='Token budget low ('+r+' left) — waiting '+s+'s before page '+pageNum+'...';
    await new Promise(res=>setTimeout(res,1000));
  }
}

async function processAllLedgers(){
  const images=Object.entries(ledgerImages);
  if(!images.length){alert('Photograph at least one ledger page first.');return;}
  $('ledger-proc').style.display='block';
  $('live-feed').style.display='block';
  const liveContent=$('live-content');liveContent.innerHTML='';
  const prog=$('ledger-prog'),status=$('ledger-status');
  prog.style.width='5%';

  const keys=await _getApiKeys();
  const hasAnyKey=keys.groq||keys.hf||keys.ocrServiceUrl;
  if(!hasAnyKey){
    $('ledger-proc').style.display='none';
    $('ledger-results').style.display='block';
    return;
  }

  allStudents=[];classGroups={};selDetectedClass='';selDetectedTerm='';selDetectedYear='';failedPages=[];

  await new Promise(r=>setTimeout(r,2000));

  for(let i=0;i<images.length;i++){
    const[idxKey]=images[i];
    const pageNum=parseInt(idxKey)+1;
    prog.style.width=Math.round((i/images.length)*85)+'%';

    if(i>0)await ledgerCooldown(status,pageNum);

    const result=await processOnePage(idxKey,keys,status,images.length);

    if(!result.succeeded){
      status.textContent='Page '+pageNum+': all providers returned 0 students';
      failedPages.push(pageNum);
      await new Promise(r=>setTimeout(r,1500));
      continue;
    }

    const added=mergePageIntoResults(result.students,result.pageClass,result.term,result.year);
    added.forEach(s=>addLiveItem(liveContent,s));
  }

  selTier=getTier(allStudents.length);
  prog.style.width='100%';
  status.textContent='Done — '+allStudents.length+' students found';
  setTimeout(()=>{$('ledger-proc').style.display='none';showLedgerResults();},800);
}



function calcConf(s){
  let c=50;
  if(s.name&&s.name.length>8)c+=20;
  if(s.class&&s.class!=='UNKNOWN')c+=15;
  if((s.termFees||0)>0)c+=10;
  if((s.paid||0)>0)c+=5;
  const oc=String(s.ocr_confidence||'').toUpperCase();
  if(oc==='HIGH')c+=10; else if(oc==='LOW')c-=20;
  if(s.status==='NEEDS REVIEW')c-=15;
  return Math.max(10,Math.min(99,c));
}

function addLiveItem(container,s){
  const div=document.createElement('div');div.className='live-item';
  const conf=s.confidence||50;
  const col=conf>80?'var(--money)':conf>60?'var(--warn)':'var(--danger)';
  const dot=document.createElement('div');dot.className='live-dot';dot.style.background=col;
  const nm=document.createElement('span');nm.style.cssText='flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem;';nm.textContent=s.name;
  const cl=document.createElement('span');cl.style.cssText='font-size:.65rem;color:var(--sub);flex-shrink:0;';cl.textContent=s.class||'?';
  div.appendChild(dot);div.appendChild(nm);div.appendChild(cl);
  container.appendChild(div);
  container.scrollTop=container.scrollHeight;
}

function showLedgerResults(){
  $('ledger-results').style.display='block';
  $('as-total').textContent=allStudents.length;
  $('as-classes').textContent=Object.keys(classGroups).length;
  const avgConf=allStudents.length>0?Math.round(allStudents.reduce((s,r)=>s+(r.confidence||50),0)/allStudents.length):0;
  $('as-conf').textContent=avgConf+'%';

  const groupsEl=$('class-groups');groupsEl.innerHTML='';

  if(failedPages.length){
    const warn=document.createElement('div');
    warn.className='card';
    warn.style.cssText='background:rgba(220,38,38,.12);border:1px solid rgba(220,38,38,.35);margin-bottom:.65rem;';
    const pageList=failedPages.join(', ');
    warn.innerHTML='<div style="font-weight:800;color:#fca5a5;font-size:.85rem;">⚠️ Page'+(failedPages.length>1?'s':'')+' '+pageList+' could not be read</div>'
      +'<div style="font-size:.76rem;color:#fecaca;margin-top:3px;">All OCR providers returned 0 students for '+(failedPages.length>1?'these pages':'this page')+'. Those students are NOT included below.</div>'
      +'<button class="btn-p" style="margin-top:.5rem;width:100%;" onclick="retryFailedPages()">🔁 Retry just page'+(failedPages.length>1?'s':'')+' '+pageList+' (not the whole scan)</button>'
      +'<div style="font-size:.7rem;color:#fecaca;margin-top:5px;opacity:.8;">If it still fails after retrying, retake the photo first, then retry — or add the students manually.</div>';
    groupsEl.appendChild(warn);
  }
  for(const[cls,students]of Object.entries(classGroups)){
    const paid=students.filter(s=>s.status==='FULLY PAID').length;
    const part=students.filter(s=>s.status==='PART PAID').length;
    const owing=students.filter(s=>s.status==='OWING').length;
    const review=students.filter(s=>s.status==='NEEDS REVIEW').length;
    const div=document.createElement('div');div.className='class-g';
    const rows=students.map((s,i)=>{
      const conf=s.confidence||50;
      const bc=conf>80?'var(--money)':conf>60?'var(--warn)':'var(--danger)';
      return '<div class="stu-row"><span style="color:var(--sub);font-size:.68rem;width:18px;text-align:right;flex-shrink:0;">'+(i+1)+'</span><input class="stu-inp" value="'+esc(s.name)+'" onchange="fixName(\''+esc(cls)+'\','+i+',this.value)"><span style="font-size:.62rem;color:var(--sub);width:55px;text-align:right;flex-shrink:0;">'+(s.status||'—')+'</span><div class="conf-bg"><div class="conf-bar" style="width:'+conf+'%;background:'+bc+';"></div></div></div>';
    }).join('');
    const paidPct=Math.round((paid/students.length)*100);
    const partPct=Math.round((part/students.length)*100);
    div.innerHTML='<div class="class-hdr"><div style="display:flex;align-items:center;gap:5px;"><span class="class-name">'+esc(cls)+'</span><span class="badge bb">'+students.length+'</span></div><div style="display:flex;gap:3px;">'+(paid?'<span class="badge bg">'+paid+'✓</span>':'')+(part?'<span class="badge ba">'+part+'½</span>':'')+(owing?'<span class="badge br">'+owing+'✗</span>':'')+(review?'<span class="badge bq">'+review+'?</span>':'')+'</div></div><div class="cbar-bg"><div class="cbar-paid" style="width:'+paidPct+'%;"></div><div class="cbar-part" style="width:'+partPct+'%;"></div></div><div style="max-height:190px;overflow-y:auto;margin-top:6px;">'+rows+'</div>';
    groupsEl.appendChild(div);
  }

  if(selTier){
    const comm=Math.round(selTier.price*(agent.commission||20)/100);
    const tc=$('tier-auto-card');
    if(tc)tc.innerHTML='<div class="card"><div class="ct">💡 Auto-selected Plan</div><p style="font-size:.74rem;color:var(--sub);margin-bottom:.4rem;">Based on '+allStudents.length+' students scanned</p><div style="background:rgba(37,99,235,.1);border:1px solid rgba(37,99,235,.3);border-radius:10px;padding:.65rem;"><div style="font-weight:800;">'+esc(selTier.name)+'</div><div style="color:var(--money);font-weight:700;">'+fmt(selTier.price)+'/term</div><div style="font-size:.7rem;color:var(--sub);margin-top:3px;">Your commission: <strong style="color:var(--money);">'+fmt(comm)+'</strong></div></div><label style="margin-top:.5rem;">Change plan (optional)</label><select id="tier-override" onchange="overrideTier(this.value)">'+TIERS.map(t=>'<option value="'+t.max+'"'+(t.max===selTier.max?' selected':'')+'>'+t.name+' — '+fmt(t.price)+'/term</option>').join('')+'</select></div>';
  }

  // Failed-page warning (if any) rendered above, inside class-groups

  $('step2-nav').style.display='block';
}

function fixName(cls,idx,val){
  if(classGroups[cls]&&classGroups[cls][idx]){
    const s=classGroups[cls][idx];s.name=val.toUpperCase().trim();
    const ai=allStudents.findIndex(x=>x===s);if(ai>=0)allStudents[ai].name=s.name;
  }
}

function overrideTier(maxStr){selTier=TIERS.find(t=>t.max===parseInt(maxStr))||selTier;}

// ── Step 3: Pitch ──────────────────────────────────────────────────────────
function populatePitch(){
  const name=gv('f-school-name')||'School';
  const loc=[gv('f-lga'),gv('f-state')].filter(Boolean).join(', ')||'Nigeria';
  $('pitch-name').textContent=name;$('pitch-loc').textContent=loc;
  const total=allStudents.length,classes=Object.keys(classGroups).length;
  $('p-students').textContent=total;$('p-classes').textContent=classes;
  let tPaid=0,tDue=0,reviewCnt=0,reviewAmt=0;
  allStudents.forEach(s=>{
    if(s.status==='NEEDS REVIEW'){
      // Payment status couldn't be determined — do NOT count this student's
      // fee as confidently "outstanding". That was the exact bug that made
      // paid students show up as owing. Track separately instead.
      reviewCnt++;reviewAmt+=(s.termFees||0);
      return;
    }
    tDue+=(s.termFees||0);tPaid+=(s.paid||0);
  });
  const rate=tDue>0?Math.round((tPaid/tDue)*100):0;
  const outstanding=tDue-tPaid;
  const owingCnt=allStudents.filter(s=>s.status==='OWING'||s.status==='PART PAID').length;
  $('p-rate').textContent=rate+'%';
  $('p-outstanding').textContent=fmt(outstanding);
  $('p-owing-txt').textContent=owingCnt+' student'+(owingCnt!==1?'s':'')+' with outstanding fees'
    +(reviewCnt?' · '+reviewCnt+' need'+(reviewCnt===1?'s':'')+' manual review ('+fmt(reviewAmt)+' not counted above)':'');
  const barsEl=$('pitch-bars');barsEl.innerHTML='';
  for(const[cls,students]of Object.entries(classGroups)){
    const paid=students.filter(s=>s.status==='FULLY PAID').length;
    const part=students.filter(s=>s.status==='PART PAID').length;
    const div=document.createElement('div');div.className='card';div.style.padding='.7rem';
    const paidPct=Math.round((paid/students.length)*100);
    const partPct=Math.round((part/students.length)*100);
    div.innerHTML='<div class="class-hdr" style="margin-bottom:5px;"><div style="display:flex;align-items:center;gap:5px;"><span class="class-name" style="font-size:.8rem;">'+esc(cls)+'</span><span class="badge bb">'+students.length+'</span></div><span style="font-size:.72rem;color:var(--sub);">'+paidPct+'% paid</span></div><div class="cbar-bg"><div class="cbar-paid" style="width:'+paidPct+'%;"></div><div class="cbar-part" style="width:'+partPct+'%;"></div></div>';
    barsEl.appendChild(div);
  }
}

let presenting=false;
function togglePresent(){presenting=!presenting;document.body.classList.toggle('presenting',presenting);}

// ── Step 4: Review & Submit ────────────────────────────────────────────────
function populateReview(){
  const name=gv('f-school-name')||'—';
  const loc=[gv('f-lga'),gv('f-state')].filter(Boolean).join(', ')||'—';
  const terms=parseInt($('f-terms')?.value)||1;
  const tier=selTier||getTier(allStudents.length);
  const total=tier.price*terms;
  const comm=Math.round(total*(agent.commission||20)/100);
  $('review-rows').innerHTML='<div class="rv-row"><span class="rv-l">School</span><span class="rv-v">'+esc(name)+'</span></div><div class="rv-row"><span class="rv-l">Location</span><span class="rv-v">'+esc(loc)+'</span></div><div class="rv-row"><span class="rv-l">Principal</span><span class="rv-v">'+esc(gv('f-principal')||'—')+'</span></div><div class="rv-row"><span class="rv-l">Phone</span><span class="rv-v">'+esc(gv('f-phone')||'—')+'</span></div><div class="rv-row"><span class="rv-l">Students</span><span class="rv-v">'+allStudents.length+'</span></div><div class="rv-row"><span class="rv-l">Classes</span><span class="rv-v">'+Object.keys(classGroups).length+'</span></div><div class="rv-row"><span class="rv-l">Plan</span><span class="rv-v">'+esc(tier.name)+'</span></div><div class="rv-row"><span class="rv-l">Terms</span><span class="rv-v">'+terms+'</span></div><div class="rv-row"><span class="rv-l">Onboarding time</span><span class="rv-v">'+timerText()+'</span></div>';
  $('tier-confirm-card').style.display='block';
  $('tier-confirm-inner').innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem;background:rgba(37,99,235,.1);border-radius:10px;border:1px solid rgba(37,99,235,.3);"><div><div style="font-weight:800;">'+esc(tier.name)+'</div><div style="font-size:.7rem;color:var(--sub);">'+terms+' term'+(terms>1?'s':'')+' x '+fmt(tier.price)+'</div></div><div style="text-align:right;"><div style="font-size:1.1rem;font-weight:800;color:var(--money);">'+fmt(total)+'</div><div style="font-size:.68rem;color:var(--sub);">school pays</div></div></div>';
  $('comm-preview').textContent='Your commission: '+fmt(comm);
}

async function submitDeal(){
  const name=gv('f-school-name');const phone=gv('f-phone').replace(/\D/g,'');
  const fb=$('submit-fb');
  if(!name){showFB(fb,'bad','Enter school name in Step 1.');return;}
  if(!phone||phone.length<10){showFB(fb,'bad','Enter principal WhatsApp in Step 1.');return;}
  const tier=selTier||getTier(allStudents.length);
  const terms=parseInt($('f-terms')?.value)||1;
  const comm=Math.round(tier.price*terms*(agent.commission||20)/100);
  const deal={
    timestamp:new Date(),status:'pending',version:2,
    agent:{id:agent.id,name:agent.name,phone:agent.phone,commission:agent.commission||20,_guest:agent._guest||false},
    school:{name,phone:normPhone(phone),email:gv('f-email'),principalName:gv('f-principal'),address:gv('f-address'),lga:gv('f-lga'),state:gv('f-state'),studentCount:allStudents.length},
    tier:{name:tier.name,price:tier.price},terms,onboardingTimeSec:timerSec,
    students:allStudents.map(s=>({name:s.name,class:s.class||'',totalFee:s.termFees||0,paid:s.paid||0,balance:s.balance||0,status:s.status||'OWING',phone:'',gender:''})),
    classBreakdown:Object.fromEntries(Object.entries(classGroups).map(([k,v])=>[k,v.length]))
  };
  const btn=$('btn-submit');btn.textContent='Submitting...';btn.disabled=true;
  try{
    if(db){await db.collection('v2_deals').add(deal);}
    else{SQ.push({t:'deal',d:deal});}
    showFB(fb,'ok','✅ "'+name+'" submitted with '+allStudents.length+' students! Commission: '+fmt(comm));
    btn.textContent='✓ Submitted!';btn.style.background='var(--money)';
    clearInterval(timerInterval);
  }catch(e){
    SQ.push({t:'deal',d:deal});
    showFB(fb,'ok','📥 Saved offline — will reach Bayo when connected. Commission: '+fmt(comm));
    btn.textContent='📤 Submit';btn.disabled=false;
  }
}

function showFB(el,type,msg){el.className='fb '+type;el.textContent=msg;el.style.display='block';}

// ── My Deals ───────────────────────────────────────────────────────────────
async function renderDeals(){
  const c=$('deals-list');
  c.innerHTML='<p style="color:var(--sub);font-size:.8rem;text-align:center;padding:1rem;">Loading...</p>';
  let deals=[];
  try{
    if(db){
      const snap=await db.collection('v2_deals').where('agent.id','==',agent.id).get();
      deals=snap.docs.map(d=>({id:d.id,...d.data()}));
      deals.sort((a,b)=>{const ta=a.timestamp?.toDate?a.timestamp.toDate():new Date(a.timestamp||0);const tb=b.timestamp?.toDate?b.timestamp.toDate():new Date(b.timestamp||0);return tb-ta;});
    }
  }catch(e){console.warn('Deals:',e);}
  if(!deals.length){c.innerHTML='<p style="color:var(--sub);font-size:.8rem;text-align:center;padding:2rem;">No deals yet. Submit your first school!</p>';return;}
  c.innerHTML=deals.map(d=>{
    const sc=d.status==='approved'?'bg':d.status==='rejected'?'br':'ba';
    const comm=Math.round((d.tier?.price||0)*(d.agent?.commission||20)/100*(d.terms||1));
    const ts=d.timestamp?.toDate?d.timestamp.toDate().toLocaleDateString('en-NG'):'just now';
    return'<div class="card" style="margin-bottom:.6rem;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><span class="badge '+sc+'">'+(d.status||'pending').toUpperCase()+'</span><span style="font-size:.68rem;color:var(--sub);">'+ts+'</span></div><div style="font-weight:700;font-size:.88rem;">'+esc(d.school?.name)+'</div><div style="font-size:.74rem;color:var(--sub);">'+(d.school?.studentCount||0)+' students · '+esc(d.tier?.name||'—')+'</div><div style="color:var(--money);font-weight:700;font-size:.8rem;margin-top:3px;">Commission: '+fmt(comm)+'</div>'+(d.students?.length?'<div style="margin-top:4px;"><span class="badge bb">📊 '+d.students.length+' students pre-loaded</span></div>':'')+'</div>';
  }).join('');
}

// ── Image Utilities ────────────────────────────────────────────────────────
// ── OpenCV 5.0 — Ledger Image Preprocessing ─────────────────────────────────
// Loads opencv.js on demand (first use only, ~7MB, cached after that).
// Tries OpenCV 5.0 first, falls back to 4.10.0 if not yet available on CDN.
let _cvLoaded=false;
function loadOpenCV(){
  return new Promise((resolve,reject)=>{
    if(_cvLoaded&&window.cv&&cv.Mat){resolve();return;}
    if(window.cv){
      const wait=()=>{if(window.cv&&cv.Mat){_cvLoaded=true;resolve();}else setTimeout(wait,50);};
      wait();return;
    }
    const tryLoad=(url,fallbackUrl)=>{
      const s=document.createElement('script');s.async=true;
      s.src=url;
      s.onload=()=>{
        const wait=()=>{if(window.cv&&cv.Mat){_cvLoaded=true;resolve();}else setTimeout(wait,50);};
        wait();
      };
      s.onerror=()=>{
        if(fallbackUrl){
          console.warn('[OpenCV] 5.0 not available, trying 4.10...');
          tryLoad(fallbackUrl,null);
        } else {
          reject(new Error('OpenCV load failed'));
        }
      };
      document.head.appendChild(s);
    };
    tryLoad('https://docs.opencv.org/5.0.0/opencv.js',
            'https://docs.opencv.org/4.10.0/opencv.js');
  });
}

// ── Line intersection helper (standard two-line intersection formula) ──────
function lineIntersect(p1,p2,p3,p4){
  const d=(p1.x-p2.x)*(p3.y-p4.y)-(p1.y-p2.y)*(p3.x-p4.x);
  if(Math.abs(d)<1e-6)return null; // parallel — no intersection
  const t=((p1.x-p3.x)*(p3.y-p4.y)-(p1.y-p3.y)*(p3.x-p4.x))/d;
  return{x:p1.x+t*(p2.x-p1.x),y:p1.y+t*(p2.y-p1.y)};
}

// ── Perspective correction — BEST EFFORT, experimental ─────────────────────
// A camera held at an angle to the page produces trapezoidal ("keystone")
// distortion — one side of the ledger table bigger than the other. Simple
// rotation (tryDeskew below) does NOT fix this. This detects the ledger's
// own ruled grid lines (not a page edge against a background — agents
// photograph tight crops of the table itself, so classic "document scanner"
// edge detection doesn't apply here) and warps the four estimated corners
// back to a flat rectangle.
// This is genuinely best-effort: it requires enough horizontal AND vertical
// ruled lines to be detected and to form a plausible (non-degenerate)
// quadrilateral. If that validation fails for any reason, it returns null
// and the caller falls back to the existing rotation-only deskew — it never
// applies a warp it isn't reasonably confident about.
function tryPerspectiveCorrect(grayMat,w,h){
  try{
    const edges=new cv.Mat();
    cv.Canny(grayMat,edges,50,150);
    const linesH=new cv.Mat(),linesV=new cv.Mat();
    cv.HoughLinesP(edges,linesH,1,Math.PI/180,Math.round(w*0.25),Math.round(w*0.30),20);
    cv.HoughLinesP(edges,linesV,1,Math.PI/180,Math.round(h*0.12),Math.round(h*0.18),20);

    const hLines=[],vLines=[];
    for(let i=0;i<linesH.rows;i++){
      const x1=linesH.intAt(i,0),y1=linesH.intAt(i,1),x2=linesH.intAt(i,2),y2=linesH.intAt(i,3);
      const ang=Math.atan2(y2-y1,x2-x1)*180/Math.PI;
      if(Math.abs(ang)<12)hLines.push({p1:{x:x1,y:y1},p2:{x:x2,y:y2},mid:(y1+y2)/2});
    }
    for(let i=0;i<linesV.rows;i++){
      const x1=linesV.intAt(i,0),y1=linesV.intAt(i,1),x2=linesV.intAt(i,2),y2=linesV.intAt(i,3);
      const ang=Math.atan2(y2-y1,x2-x1)*180/Math.PI;
      if(Math.abs(Math.abs(ang)-90)<12)vLines.push({p1:{x:x1,y:y1},p2:{x:x2,y:y2},mid:(x1+x2)/2});
    }
    edges.delete();linesH.delete();linesV.delete();

    // Need a confident sample of both line families — otherwise this is
    // guesswork, and guesswork here means silently mangling a good photo.
    if(hLines.length<3||vLines.length<3)return null;

    hLines.sort((a,b)=>a.mid-b.mid);
    vLines.sort((a,b)=>a.mid-b.mid);
    const topLine=hLines[0],botLine=hLines[hLines.length-1];
    const leftLine=vLines[0],rightLine=vLines[vLines.length-1];

    const tl=lineIntersect(topLine.p1,topLine.p2,leftLine.p1,leftLine.p2);
    const tr=lineIntersect(topLine.p1,topLine.p2,rightLine.p1,rightLine.p2);
    const bl=lineIntersect(botLine.p1,botLine.p2,leftLine.p1,leftLine.p2);
    const br=lineIntersect(botLine.p1,botLine.p2,rightLine.p1,rightLine.p2);
    if(!tl||!tr||!bl||!br)return null;

    // Sanity checks — reject anything that doesn't look like a real
    // slightly-skewed rectangle. Allow generous margin (corners can fall
    // just outside the frame) but reject wildly degenerate estimates.
    const pts=[tl,tr,bl,br];
    const margin=w*0.25;
    for(const p of pts){
      if(!isFinite(p.x)||!isFinite(p.y))return null;
      if(p.x<-margin||p.x>w+margin||p.y<-h*0.25||p.y>h+h*0.25)return null;
    }
    const topW=Math.hypot(tr.x-tl.x,tr.y-tl.y), botW=Math.hypot(br.x-bl.x,br.y-bl.y);
    const leftH=Math.hypot(bl.x-tl.x,bl.y-tl.y), rightH=Math.hypot(br.x-tr.x,br.y-tr.y);
    if(topW<w*0.3||botW<w*0.3||leftH<h*0.3||rightH<h*0.3)return null; // too small/collapsed
    const wRatio=Math.max(topW,botW)/Math.max(1,Math.min(topW,botW));
    const hRatio=Math.max(leftH,rightH)/Math.max(1,Math.min(leftH,rightH));
    if(wRatio>1.6||hRatio>1.6)return null; // too skewed to trust — likely a bad detection

    const srcPts=cv.matFromArray(4,1,cv.CV_32FC2,[tl.x,tl.y,tr.x,tr.y,br.x,br.y,bl.x,bl.y]);
    const dstPts=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,w,0,w,h,0,h]);
    const M=cv.getPerspectiveTransform(srcPts,dstPts);
    const warped=new cv.Mat();
    cv.warpPerspective(grayMat,warped,M,new cv.Size(w,h),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    srcPts.delete();dstPts.delete();M.delete();
    console.log('[OpenCV] Perspective-corrected (skew ratios '+wRatio.toFixed(2)+'/'+hRatio.toFixed(2)+')');
    return warped;
  }catch(e){console.warn('[OpenCV] Perspective correction failed:',e.message);return null;}
}

// ── Blur detection — Laplacian variance, computed right after capture ──────
// Cheap, standard technique: sharp images have high-variance edges, blurry
// images have low variance. This runs BEFORE the photo is even sent for
// OCR, so a genuinely unusable photo (shaky hands, autofocus failure) gets
// caught in ~1 second with an immediate retake prompt, instead of the agent
// finding out 30-90 seconds later when every OCR provider returns nothing.
// Threshold is a heuristic tuned on a resized reference width for
// consistency across different phone camera resolutions — may need
// adjustment from real field data over time.
async function computeBlurScore(dataUrl){
  try{await loadOpenCV();}catch(e){return null;}
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      try{
        const refW=800;
        const scale=Math.min(1,refW/(img.naturalWidth||img.width||refW));
        const w=Math.round((img.naturalWidth||img.width)*scale);
        const h=Math.round((img.naturalHeight||img.height)*scale);
        const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;
        tmp.getContext('2d').drawImage(img,0,0,w,h);
        const src=cv.imread(tmp);
        const gray=new cv.Mat();
        cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
        const lap=new cv.Mat();
        cv.Laplacian(gray,lap,cv.CV_64F);
        const mean=new cv.Mat(),stddev=new cv.Mat();
        cv.meanStdDev(lap,mean,stddev);
        const variance=Math.pow(stddev.doubleAt(0,0),2);
        [src,gray,lap,mean,stddev].forEach(m=>m.delete());
        resolve(variance);
      }catch(e){console.warn('[Blur check] error:',e.message);resolve(null);}
    };
    img.onerror=()=>resolve(null);
    img.src=dataUrl;
  });
}
const BLUR_VARIANCE_THRESHOLD=60; // below this = flag as likely blurry

// ── Deskew helper: detect ledger ruled lines via Hough transform → rotate ──
function tryDeskew(grayMat,w,h){
  try{
    const edges=new cv.Mat();
    cv.Canny(grayMat,edges,50,150);
    const lines=new cv.Mat();
    cv.HoughLinesP(edges,lines,1,Math.PI/180,Math.round(w*0.25),Math.round(w*0.20),30);
    const angles=[];
    for(let i=0;i<lines.rows;i++){
      const x1=lines.intAt(i,0),y1=lines.intAt(i,1);
      const x2=lines.intAt(i,2),y2=lines.intAt(i,3);
      const ang=Math.atan2(y2-y1,x2-x1)*180/Math.PI;
      if(Math.abs(ang)<12)angles.push(ang); // near-horizontal = ledger rows
    }
    edges.delete();lines.delete();
    if(!angles.length)return null;
    const avgAng=angles.reduce((a,b)=>a+b,0)/angles.length;
    if(Math.abs(avgAng)<0.5)return null; // already straight
    console.log('[OpenCV] Deskewing by',avgAng.toFixed(2)+'°');
    const center=new cv.Point(w/2,h/2);
    const M=cv.getRotationMatrix2D(center,avgAng,1.0);
    const rotated=new cv.Mat();
    cv.warpAffine(grayMat,rotated,M,new cv.Size(w,h),
      cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    M.delete();
    return rotated;
  }catch(e){console.warn('[OpenCV] Deskew failed:',e.message);return null;}
}

// ── Main OpenCV preprocessing pipeline ────────────────────────────────────
// Grayscale → Denoise → Histogram Equalisation → Deskew
// Falls back silently to raw dataUrl if OpenCV unavailable or fails.
async function openCVPreprocess(dataUrl){
  try{
    await loadOpenCV();
  }catch(e){
    console.warn('[OpenCV] Not loaded:',e.message);
    return dataUrl; // graceful fallback
  }
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      try{
        // Draw original to temp canvas so cv.imread can read it
        const tmp=document.createElement('canvas');
        tmp.width=img.naturalWidth||img.width;
        tmp.height=img.naturalHeight||img.height;
        tmp.getContext('2d').drawImage(img,0,0);

        const src=cv.imread(tmp);
        const gray=new cv.Mat();
        const blurred=new cv.Mat();
        const equalized=new cv.Mat();

        // Step 1: Grayscale (proper luminance weights via OpenCV)
        cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);

        // Step 2: Perspective correction (best-effort) — fixes trapezoidal
        // keystone distortion from a camera held at an angle, which simple
        // rotation (step 5) cannot fix. Falls back safely to the uncorrected
        // grayscale if a confident quadrilateral wasn't found.
        const perspectiveCorrected=tryPerspectiveCorrect(gray,tmp.width,tmp.height);
        const workingMat=perspectiveCorrected||gray;

        // Step 3: Light Gaussian blur — kills paper grain without hurting handwriting
        cv.GaussianBlur(workingMat,blurred,new cv.Size(3,3),0);

        // Step 4: CLAHE (adaptive/local histogram equalisation) — corrects
        // uneven lighting REGION BY REGION instead of across the whole page.
        // Cheaper cameras handle exposure worse, so it's common to get one
        // half of a page brighter than the other (shadow from the phone
        // itself, uneven room lighting) — global equalizeHist doesn't fix
        // that unevenness, CLAHE does.
        const clahe=new cv.CLAHE(3.0,new cv.Size(8,8));
        clahe.apply(blurred,equalized);
        clahe.delete();

        // Step 5: Deskew — catches any small residual rotation. If step 2
        // already applied a perspective correction, this is mostly a
        // touch-up pass; if step 2 was skipped, this is the only rotation
        // correction, same as before.
        const deskewed=tryDeskew(equalized,tmp.width,tmp.height);
        const final=deskewed||equalized;

        const out=document.createElement('canvas');
        cv.imshow(out,final);

        // Cleanup all Mats
        [src,gray,perspectiveCorrected,blurred,equalized,deskewed].forEach(m=>{
          if(m)try{m.delete();}catch(e){}
        });

        console.log('[OpenCV] Preprocessing done —',tmp.width+'×'+tmp.height,'→ perspective:'+(perspectiveCorrected?'yes':'no'),'deskew:'+(deskewed?'yes':'no'));
        resolve(out.toDataURL('image/jpeg',0.97));
      }catch(e){
        console.warn('[OpenCV] Preprocessing error:',e.message);
        resolve(dataUrl); // graceful fallback
      }
    };
    img.onerror=()=>resolve(dataUrl);
    img.src=dataUrl;
  });
}

async function compressLedger(dataUrl){
  // OpenCV preprocessing (deskew + denoise + equalise) runs first.
  // Falls back silently if OpenCV isn't available.
  let preprocessed = dataUrl;
  try{ preprocessed = await openCVPreprocess(dataUrl); }
  catch(e){ console.warn('[compressLedger] OpenCV skip:',e.message); }

  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      const origW=img.naturalWidth||img.width||1000;
      const origH=img.naturalHeight||img.height||750;
      // Crop to LEFT 62% before scaling. The ledger has ~15-16 columns.
      // The core 6 (Serial, Surname, Firstname, Balance, Current Fees, Total)
      // are essential for names/amounts. But "FULLY PAID"/"PAID" status
      // annotations are physically handwritten around the 1st Part Payment
      // and Teller No columns (columns 6-7) — right at the old 50% boundary.
      // That's the real root cause of payment status always reading OWING:
      // the crop was cutting through the exact region where paid/owing
      // evidence lives. 62% reliably includes through that column while
      // still cropping out the 2nd/3rd part payment columns (8-14) that
      // don't matter — still a real resolution win over the uncropped page.
      const cropW=Math.round(origW*0.62);
      const scale=Math.min(1,1024/cropW);
      const outW=Math.round(cropW*scale);
      const outH=Math.round(origH*scale);
      const cv=document.createElement('canvas');cv.width=outW;cv.height=outH;
      const cx=cv.getContext('2d');
      // Source rect: left half only. Dest rect: full canvas.
      cx.drawImage(img,0,0,cropW,origH,0,0,outW,outH);
      // Contrast enhancement — darken text, brighten paper
      const id=cx.getImageData(0,0,outW,outH);const d=id.data;
      let minV=255,maxV=0;
      for(let i=0;i<d.length;i+=4){
        const g=Math.round(d[i]*.299+d[i+1]*.587+d[i+2]*.114);
        if(g<minV)minV=g;if(g>maxV)maxV=g;
      }
      const range=Math.max(maxV-minV,1);
      for(let i=0;i<d.length;i+=4){
        const g=Math.round(d[i]*.299+d[i+1]*.587+d[i+2]*.114);
        const norm=Math.round((g-minV)/range*255);
        const c=norm<128?Math.max(0,Math.round(norm*0.4)):Math.min(255,Math.round(128+(norm-128)*2.2));
        d[i]=c;d[i+1]=c;d[i+2]=c;
      }
      cx.putImageData(id,0,0);
      resolve(cv.toDataURL('image/jpeg',0.95));
    };
    img.onerror=reject;img.src=preprocessed;
  });
}

async function compressImage(dataUrl,maxW){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      let w=img.naturalWidth||img.width||800;
      let h=img.naturalHeight||img.height||600;
      const scale=maxW?Math.min(1,maxW/w):1;
      w=Math.round(w*scale);h=Math.round(h*scale);
      const cv=document.createElement('canvas');cv.width=w;cv.height=h;
      const cx=cv.getContext('2d');
      cx.filter='contrast(1.2) brightness(1.1)';
      cx.drawImage(img,0,0,w,h);
      resolve(cv.toDataURL('image/jpeg',0.85));
    };
    img.onerror=reject;img.src=dataUrl;
  });
}



// ── Parse ledger JSON from any provider's text response ───────────────────
function parseLedgerJSON(text){
  text=text.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
  window._lastOCRRaw=text;
  let parsed={};
  try{parsed=JSON.parse(text);}
  catch(e){
    const m=text.match(/\{[\s\S]*\}/);
    try{parsed=m?JSON.parse(m[0]):{};}catch(e2){parsed={};}
  }
  let students=Array.isArray(parsed.students)?parsed.students:[];
  // Safety net: if the whole-JSON parse produced nothing (e.g. the response
  // got cut off mid-array because it hit the token limit), salvage whatever
  // complete {..."name":...} objects exist in the raw text rather than
  // losing every student on that page.
  if(!students.length){
    const objMatches=text.match(/\{[^{}]*"name"[^{}]*\}/g)||[];
    objMatches.forEach(m=>{
      try{const o=JSON.parse(m);if(o&&o.name)students.push(o);}catch(e){}
    });
    if(students.length)console.warn('[parseLedgerJSON] Recovered '+students.length+' students from truncated/invalid JSON');
  }
  const result={
    detected_class:parsed.detected_class||'',
    term:parsed.term||'',
    year:parsed.year||'',
    students
  };
  parseLedgerJSON._lastResult=result;
  return result;
}

// ── HuggingFace — Qwen2.5-VL-7B-Instruct ────────────────────────────────
async function callHFVision(imageDataUrl,prompt,apiKey){
  const base64=imageDataUrl.split(',')[1];
  const mimeType=imageDataUrl.split(';')[0].split(':')[1]||'image/jpeg';
  const HF_URL='https://api-inference.huggingface.co/models/Qwen/Qwen2.5-VL-7B-Instruct/v1/chat/completions';
  const headers={'Content-Type':'application/json'};
  if(apiKey)headers['Authorization']='Bearer '+apiKey;
  const body=JSON.stringify({
    model:'Qwen/Qwen2.5-VL-7B-Instruct',
    max_tokens:2000,temperature:0.1,
    messages:[{role:'user',content:[
      {type:'image_url',image_url:{url:'data:'+mimeType+';base64,'+base64}},
      {type:'text',text:prompt}
    ]}]
  });
  let resp=await fetch(HF_URL,{method:'POST',headers,body});
  if(resp.status===503){
    const errData=await resp.json().catch(()=>({}));
    const wait=Math.min((errData.estimated_time||20)*1000,35000);
    console.log('[HF] Cold start — waiting',Math.round(wait/1000)+'s');
    await new Promise(r=>setTimeout(r,wait));
    resp=await fetch(HF_URL,{method:'POST',headers,body});
  }
  if(!resp.ok){const err=await resp.json().catch(()=>({}));throw new Error(err.error?.message||'HF '+resp.status);}
  const data=await resp.json();
  const text=(data.choices?.[0]?.message?.content||'').trim();
  console.log('[HuggingFace] Raw response ('+text.length+' chars):',text.slice(0,300));
  return text;
}

// ── Oracle VPS — PaddleOCR (self-hosted, free forever) ────────────────────
// Coordinate-based column reconstruction — this is the PRIMARY ledger
// reader once ocrServiceUrl is configured in Firestore admin_settings.
// Falls through silently to the vision-LLM cascade below if unset or if
// the VPS is unreachable — safe to leave dormant until deployed.
async function callPaddleOCR(imageDataUrl,serviceUrl){
  if(!serviceUrl)throw new Error('No OCR service URL configured');
  const base64=imageDataUrl.split(',')[1];
  const resp=await fetch(serviceUrl.replace(/\/$/,'')+'/scan-ledger',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({image:base64})
  });
  if(!resp.ok){
    const err=await resp.json().catch(()=>({}));
    throw new Error(err.detail||'PaddleOCR service '+resp.status);
  }
  const data=await resp.json();
  // Return in the same shape parseLedgerJSON produces, so the rest of the
  // pipeline (dedup, merge, class detection) needs zero changes.
  return JSON.stringify({
    detected_class: data.detected_class||'',
    students: (data.students||[]).map(s=>({
      name: s.name,
      balance_bf: s.balance_bf||0,
      termFees: s.termFees||0,
      total: s.total||0,
      // PaddleOCR only returns a boolean, not the richer PAID/PARTIAL/OWING/
      // UNCLEAR status. Default to UNCLEAR rather than OWING when it's not
      // explicitly true — same never-guess-a-negative-status discipline as
      // the Groq prompt.
      payment_status: s.fully_paid?'PAID':'UNCLEAR'
    }))
  });
}



async function callGroqVision(imageDataUrl,prompt,apiKey,maxTokens,_retry){
  if(_retry===undefined)_retry=0;
  if(!maxTokens)maxTokens=600;
  const base64=imageDataUrl.split(',')[1];
  const mimeType=imageDataUrl.split(';')[0].split(':')[1]||'image/jpeg';
  // qwen/qwen3.6-27b is the current reliable free-tier Groq vision model.
  // llama-4-scout / llama-4-maverick / llama-3.2-90b-vision-preview are deprecated
  // and return 400s — this was why signboard OCR stopped working.
  const model='qwen/qwen3.6-27b';
  const controller=new AbortController();
  const fetchTimer=setTimeout(()=>controller.abort(),45000);
  let resp;
  try{
    resp=await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      signal:controller.signal,
      headers:{'Authorization':'Bearer '+apiKey,'Content-Type':'application/json'},
      body:JSON.stringify({
        model,
        messages:[{role:'user',content:[
          {type:'image_url',image_url:{url:'data:'+mimeType+';base64,'+base64}},
          {type:'text',text:prompt}
        ]}],
        temperature:0,
        max_tokens:maxTokens,
        reasoning_effort:'none',
        response_format:{type:'json_object'}
      })
    });
    clearTimeout(fetchTimer);
    updateGroqRateState(resp);
  }catch(fetchErr){
    clearTimeout(fetchTimer);
    if(_retry<2){
      await new Promise(r=>setTimeout(r,1500));
      return callGroqVision(imageDataUrl,prompt,apiKey,maxTokens,_retry+1);
    }
    throw new Error(fetchErr.name==='AbortError'?'Groq timed out':fetchErr.message);
  }
  if(resp.status===429||resp.status===503||resp.status===529){
    // A fixed 3s backoff was nowhere near long enough — Groq's free-tier
    // rate limit is a rolling per-MINUTE window, not a per-few-seconds one.
    // That mismatch is what caused a different random page to fail on every
    // run of the same 5 photos: whichever page happened to land right as
    // the TPM budget ran out got a 429, retried for only ~6 seconds total,
    // then gave up. Respect the server's own Retry-After header — it knows
    // exactly how long is left in the window — and allow more attempts
    // since this is a fully recoverable, expected condition, not an error.
    const retryAfterHeader=resp.headers.get('retry-after');
    let waitMs=parseFloat(retryAfterHeader)*1000;
    if(!waitMs||isNaN(waitMs))waitMs=20000; // no header given — assume a full window
    waitMs=Math.min(Math.max(waitMs,3000),65000); // clamp 3s-65s
    if(_retry>=4){const e=await resp.json().catch(()=>({}));throw new Error((e.error&&e.error.message)||'Groq rate-limited after multiple retries');}
    console.warn('[Groq] rate-limited (attempt '+(_retry+1)+'), waiting '+Math.round(waitMs/1000)+'s per Retry-After');
    await new Promise(r=>setTimeout(r,waitMs));
    return callGroqVision(imageDataUrl,prompt,apiKey,maxTokens,_retry+1);
  }
  if(!resp.ok){const e=await resp.json().catch(()=>({}));throw new Error((e.error&&e.error.message)||'Groq '+resp.status);}
  const data=await resp.json();
  let text=data.choices?.[0]?.message?.content||'';
  text=text.replace(/<ildo>[\s\S]*?<\/ildo>/gi,'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
  console.log('[Groq] '+model+' responded ('+text.length+' chars, budget '+maxTokens+')');
  return text;
}

function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();r.onload=e=>resolve(e.target.result);r.onerror=reject;r.readAsDataURL(file);
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  SQ.ping();
  const saved=localStorage.getItem('ag2_agent');
  if(saved){
    try{
      agent=JSON.parse(saved);
      if(agent&&agent.id){
        startApp();
        if(db&&!agent._guest){const p=normPhone(agent.phone||'');const l=p.startsWith('234')?'0'+p.slice(3):p;refreshBg(agent.id,p,l).catch(()=>{});}
        return;
      }
    }catch(e){localStorage.removeItem('ag2_agent');}
  }
  $('login').style.display='flex';$('login').style.flexDirection='column';
  $('app').style.display='none';
});
