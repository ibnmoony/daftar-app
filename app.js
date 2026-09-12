/* ==========================================================
   المنار التجارية V3 — واجهة GitHub Pages السريعة
   الخادم: Google Apps Script Web App — البيانات: Google Sheet نفسه
   ========================================================== */

const STORE = {
  apiUrl: localStorage.getItem('DAFTAR_API_URL') || '',
  token: localStorage.getItem('DAFTAR_TOKEN') || '',
  user: JSON.parse(localStorage.getItem('DAFTAR_USER') || 'null'),
  companyName: localStorage.getItem('ALMANAR_COMPANY_NAME') || 'المنار التجارية'
};

/* ==========================================================
   طبقة الأداء V3
   - منع الطلبات المكررة المتزامنة.
   - كاش قصير للقراءات المتكررة.
   - Timeout للطلبات المعلقة.
   - لا يتم تشغيل أي تحديث تابع قبل نجاح العملية المحاسبية الأصلية.
   ========================================================== */
const PERF = {
  inflight: new Map(),
  cache: new Map(),
  routeSeq: 0,
  searchSeq: 0
};

const READ_ACTIONS = new Set([
  'checkSetup','me','getWebDashboardData','getWebReportData','getDashboardData',
  'getOverdueInstallments','getUpcomingInstallments','searchCustomers','getActiveCustomers',
  'getCustomerForView','getCustomerStatement','getCustomerAttachments','searchItems',
  'getAvailableItems','getItemCategories','getItemForView','searchInvoices','getInvoiceLookups',
  'getInvoiceForView','getInvoicesForCustomer','getOpenInvoices','getInstallmentsForInvoice',
  'getInvoiceCancellationInfo','searchReceipts','getInvoicePaymentInfo','getReceiptForEdit',
  'getRefundableReceipts','listRefunds','getRefundForView','getAllDiscounts','getPublicSettings','listUsers'
]);

function stableKey(action, payload) {
  const sortObj = obj => {
    if (Array.isArray(obj)) return obj.map(sortObj);
    if (obj && typeof obj === 'object') return Object.keys(obj).sort().reduce((o,k)=>(o[k]=sortObj(obj[k]),o),{});
    return obj;
  };
  return action + ':' + JSON.stringify(sortObj(payload || {}));
}

function clearReadCache() {
  PERF.cache.clear();
  try { sessionStorage.removeItem('ALMANAR_DASH_CACHE'); } catch (_) {}
}

function clearSessionLocal() {
  STORE.token = ''; STORE.user = null;
  localStorage.removeItem('DAFTAR_TOKEN');
  localStorage.removeItem('DAFTAR_USER');
}

async function api(action, payload, options) {
  options = options || {};
  if (!STORE.apiUrl) throw new Error('لم يتم ربط النظام بالخادم بعد.');
  const body = Object.assign({ action, token: STORE.token }, payload || {});
  const canDedupe = READ_ACTIONS.has(action) && options.dedupe !== false;
  const key = stableKey(action, payload || {});
  if (canDedupe && PERF.inflight.has(key)) return PERF.inflight.get(key);

  const runner = (async () => {
    const localController = new AbortController();
    const externalSignal = options.signal;
    if (externalSignal) {
      if (externalSignal.aborted) localController.abort();
      else externalSignal.addEventListener('abort', () => localController.abort(), { once:true });
    }
    const timeout = setTimeout(() => localController.abort(), options.timeout || 45000);
    let res;
    try {
      res = await fetch(STORE.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: localController.signal,
        cache: 'no-store'
      });
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('استغرق الخادم وقتًا أطول من المتوقع. أعد المحاولة.');
      throw new Error('تعذّر الاتصال بالخادم. تأكد من الإنترنت ورابط Web App.');
    } finally { clearTimeout(timeout); }

    let json;
    try { json = await res.json(); }
    catch (_) { throw new Error('رد غير متوقع من الخادم.'); }
    if (!json.ok) {
      const message = json.error || 'حدث خطأ غير معروف.';
      if (/انتهت.*الجلسة|جلسة غير صالحة|يجب تسجيل الدخول/i.test(message)) {
        clearSessionLocal();
        setTimeout(() => showScreen('loginScreen'), 0);
      }
      throw new Error(message);
    }
    if (!READ_ACTIONS.has(action)) clearReadCache();
    return json.data;
  })();

  if (canDedupe) PERF.inflight.set(key, runner);
  try { return await runner; }
  finally { if (canDedupe) PERF.inflight.delete(key); }
}

async function apiCached(action, payload, ttlMs) {
  const key = stableKey(action, payload || {});
  const hit = PERF.cache.get(key);
  if (hit && Date.now() - hit.at < (ttlMs || 20000)) return hit.data;
  const data = await api(action, payload || {});
  PERF.cache.set(key, { at: Date.now(), data });
  return data;
}

function debounce(fn, delay) {
  let t;
  return function(...args){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,args),delay); };
}
function idle(fn){ if ('requestIdleCallback' in window) requestIdleCallback(fn,{timeout:1200}); else setTimeout(fn,120); }
function filterLocal(rows, q, fields) {
  const x=String(q||'').trim().toLowerCase();
  if(!x) return rows;
  return rows.filter(r=>fields.some(f=>String(r[f]||'').toLowerCase().includes(x)));
}

/* ---------------- أدوات عامة ---------------- */
function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dateKey(v) {
  if (!v) return '';
  if (typeof v === 'string') {
    const m = v.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    const d = new Date(v); if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function prettyDate(v) {
  const k=dateKey(v); if(!k) return '';
  const [y,m,d]=k.split('-').map(Number);
  const dt=new Date(y,m-1,d,12,0,0);
  return dt.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'}).replace('،','');
}
async function fileToPayload(file) {
  if(!file) return null;
  const type=(file.type||'').toLowerCase();
  if(type==='application/pdf'){
    if(file.size>3*1024*1024) throw new Error('ملف PDF يجب ألا يتجاوز 3 MB.');
    return readFileAsPayload_(file);
  }
  if(!/^image\/(jpeg|png|webp)$/i.test(type)) throw new Error('المرفقات المسموحة: JPG / PNG / WEBP / PDF.');
  // الصور الكبيرة تُصغّر وتُضغط قبل الإرسال لتسريع النظام وتقليل أخطاء Apps Script.
  if(file.size<=900*1024) return readFileAsPayload_(file);
  const dataUrl=await readAsDataUrl_(file);
  const img=await loadImage_(dataUrl);
  const maxDim=1800;
  const scale=Math.min(1,maxDim/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
  canvas.height=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
  canvas.getContext('2d',{alpha:false}).drawImage(img,0,0,canvas.width,canvas.height);
  let quality=.84, blob=null;
  do{
    blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
    quality-=.08;
  }while(blob && blob.size>2.4*1024*1024 && quality>=.52);
  if(!blob) throw new Error('تعذر ضغط الصورة. جرّب صورة أخرى.');
  if(blob.size>3*1024*1024) throw new Error('الصورة كبيرة جدًا حتى بعد الضغط.');
  const compressed=new File([blob],(file.name||'image').replace(/\.[^.]+$/, '')+'.jpg',{type:'image/jpeg'});
  return readFileAsPayload_(compressed);
}
function readAsDataUrl_(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(new Error('تعذر قراءة الملف.'));r.readAsDataURL(file);});}
function readFileAsPayload_(file){return readAsDataUrl_(file).then(data=>({name:file.name,mimeType:file.type,base64:data.split(',')[1]||''}));}
function loadImage_(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('تعذر فتح الصورة.'));img.src=src;});}
async function openSecureAttachment(fileId) {
  try{
    const d=await api('getCustomerAttachmentData',{fileId});
    const w=window.open('','_blank');
    if(!w) return toast('اسمح بفتح النوافذ المنبثقة لعرض المرفق.','error');
    if((d.mimeType||'').toLowerCase()==='application/pdf'){
      w.document.write(`<title>${esc(d.name||'مرفق')}</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe src="data:application/pdf;base64,${d.base64}"></iframe>`);
    }else{
      w.document.write(`<title>${esc(d.name||'مرفق')}</title><style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh}img{max-width:100%;max-height:100vh;object-fit:contain}</style><img src="data:${esc(d.mimeType)};base64,${d.base64}">`);
    }
    w.document.close();
  }catch(err){toast(err.message,'error');}
}
function selectOptions(rows,valueKey,labelFn,placeholder){return `<option value="">${esc(placeholder||'اختر...')}</option>`+rows.map(r=>`<option value="${esc(r[valueKey])}">${labelFn(r)}</option>`).join('')}

function todayStr() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function monthStartStr() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3200);
}

function setLoading(btn, loading, labelWhenLoading) {
  if (!btn) return;
  if (loading) { btn.dataset.label = btn.textContent; btn.textContent = labelWhenLoading || 'جارٍ الحفظ...'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

const STATUS_BADGE = {
  ACTIVE: 'badge-green', PAID: 'badge-green', AVAILABLE: 'badge-green',
  DUE: 'badge-amber', PARTIAL: 'badge-amber', RESERVED: 'badge-amber',
  CANCELLED: 'badge-red', OVERDUE: 'badge-red', SOLD: 'badge-gray', INACTIVE: 'badge-gray'
};
function badge(status, label) {
  const cls = STATUS_BADGE[status] || 'badge-gray';
  return `<span class="badge ${cls}">${esc(label || status)}</span>`;
}

/* ---------------- أيقونات (SVG بسيطة بخط واحد) ---------------- */
const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></svg>',
  customers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="8.5" r="2.3"/><path d="M21 20c0-2.6-1.7-4.7-4-5.5"/></svg>',
  items: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z"/><path d="M3 8.5V16l9 4.5 9-4.5V8.5"/><path d="M12 13v7.5"/></svg>',
  invoices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 2.5h9l3 3V21a.5.5 0 0 1-.5.5H6.5A.5.5 0 0 1 6 21V3a.5.5 0 0 1 0-.5Z"/><path d="M9 9h6M9 13h6M9 17h3"/></svg>',
  receipts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3Z"/><path d="M8.5 9h7M8.5 12.5h7"/></svg>',
  discounts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12 12 4l8 3-3 8-8 8-5-11Z"/><circle cx="9.5" cy="9.5" r="1.4" fill="currentColor" stroke="none"/></svg>',
  statement: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 3h10v18l-3-2-2 2-2-2-3 2V3Z"/><path d="M10 8h4M10 12h4"/></svg>',
  reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20V10M11 20V4M18 20v-7"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.2-1.6l2-1.4-2-3.4-2.3.7a7 7 0 0 0-2.8-1.6L13.2 2h-2.4l-.5 2.7a7 7 0 0 0-2.8 1.6l-2.3-.7-2 3.4 2 1.4a7 7 0 0 0 0 3.2l-2 1.4 2 3.4 2.3-.7a7 7 0 0 0 2.8 1.6l.5 2.7h2.4l.5-2.7a7 7 0 0 0 2.8-1.6l2.3.7 2-3.4-2-1.4c.13-.5.2-1 .2-1.6Z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="3.2"/><path d="M2.5 20c0-3.3 2.5-6 5.5-6s5.5 2.7 5.5 6"/><path d="M16 4.5c1.7.4 3 2 3 3.9s-1.3 3.5-3 3.9M17.5 14c2.3.5 4 2.6 4 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.5-4.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m14.5 4.5 5 5L8 21H3v-5L14.5 4.5Z"/></svg>'
};
function icon(name) { return ICONS[name] || ''; }

/* ---------------- تعريف التنقل ---------------- */
const NAV = [
  { id:'dashboard', label:'الرئيسية', sub:'ملخص الأعمال', icon:'dashboard' },
  { id:'customers', label:'إدارة العملاء', sub:'إضافة وتعديل ومتابعة', icon:'customers' },
  { id:'items', label:'الأصناف', sub:'المنتجات والأسعار', icon:'items' },
  { id:'invoices', label:'الفواتير', sub:'البيع بالأقساط', icon:'invoices' },
  { id:'receipts', label:'سند قبض', sub:'تسجيل التحصيلات', icon:'receipts' },
  { id:'refunds', label:'سند استرداد', sub:'إدارة المبالغ المرتجعة', icon:'receipts' },
  { id:'statement', label:'كشف حساب عميل', sub:'الحركة والرصيد', icon:'statement' },
  { id:'reports', label:'مركز التقارير', sub:'تقارير وإحصاءات', icon:'reports' },
  { id:'settings', label:'الإعدادات', sub:'بيانات المنشأة والحساب', icon:'settings', adminOnly:true, dividerBefore:true },
  { id:'users', label:'أعضاء الفريق', sub:'الحسابات والصلاحيات', icon:'users', adminOnly:true }
];

let currentRoute = '';

function buildSideNav() {
  const nav = document.getElementById('sideNav');
  if (!nav) return;
  nav.innerHTML = '';
  NAV.forEach(item => {
    if (item.adminOnly && (!STORE.user || STORE.user.role !== 'ADMIN')) return;
    if (item.dividerBefore) {
      const hr=document.createElement('div'); hr.className='nav-divider'; nav.appendChild(hr);
    }
    const div = document.createElement('div');
    div.className = 'nav-item' + (item.id === currentRoute ? ' active' : '');
    div.dataset.route=item.id;
    div.innerHTML = `<span class="nav-icon">${icon(item.icon)}</span><span><span class="nav-label">${esc(item.label)}</span><small class="nav-sub">${esc(item.sub||'')}</small></span><span class="nav-chevron">‹</span>`;
    div.onclick = () => goTo(item.id);
    nav.appendChild(div);
  });
}

function routeSkeleton() {
  return `<div class="hero skeleton" style="height:130px"></div><div class="dashboard-grid">${Array.from({length:5},()=>'<div class="metric-card skeleton" style="height:108px"></div>').join('')}</div>`;
}

function goTo(routeId, opts) {
  opts=opts||{};
  if (!VIEWS[routeId]) return;
  const shell = document.getElementById('view');
  if (!opts.force && currentRoute===routeId && shell?.dataset.loaded==='1') return;
  currentRoute = routeId;
  const seq=++PERF.routeSeq;
  buildSideNav();
  const meta = NAV.find(n => n.id === routeId);
  document.getElementById('pageTitle').textContent = meta ? meta.label : '';
  const pst=document.getElementById('pageSubTitle'); if(pst) pst.textContent=meta?.sub||'';
  document.getElementById('topbarActions').innerHTML = '';
  shell.dataset.loaded='0';
  shell.innerHTML = `<section class="route-host" data-route="${esc(routeId)}">${routeId==='dashboard'?routeSkeleton():'<div class="panel"><div class="panel-body"><div class="skeleton" style="height:18px;width:180px"></div></div></div>'}</section>`;
  const host=shell.firstElementChild;
  Promise.resolve(VIEWS[routeId](host)).then(()=>{
    if(seq===PERF.routeSeq && host.isConnected) shell.dataset.loaded='1';
  }).catch(err=>{
    if(seq===PERF.routeSeq && host.isConnected) host.innerHTML=`<div class="alert danger">${esc(err.message)}</div>`;
  });
  closeMobileSidebar();
}

/* ---------------- النافذة الجانبية (Drawer) ---------------- */
function openDrawer(title, bodyHtml) {
  document.getElementById('drawerTitle').textContent = title;
  document.getElementById('drawerBody').innerHTML = bodyHtml;
  document.getElementById('drawerOverlay').classList.remove('hidden');
}
function closeDrawer() {
  document.getElementById('drawerOverlay').classList.add('hidden');
  document.getElementById('drawerBody').innerHTML = '';
}
document.getElementById('drawerClose').onclick = closeDrawer;
document.getElementById('drawerOverlay').addEventListener('click', e => { if (e.target.id === 'drawerOverlay') closeDrawer(); });

/* ---------------- بناء جدول عام ---------------- */
function renderTable(columns, rows, emptyMsg) {
  if (!rows.length) {
    return `<table><thead><tr>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
      <tbody><tr class="empty-row"><td colspan="${columns.length}">${esc(emptyMsg || 'لا توجد بيانات لعرضها.')}</td></tr></tbody></table>`;
  }
  return `<table><thead><tr>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${columns.map(c => `<td>${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/* ================= الاتصال بالخادم / الدخول ================= */

function showScreen(id) {
  ['connectScreen', 'setupScreen', 'loginScreen', 'appShell'].forEach(s => document.getElementById(s).classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

async function boot() {
  if (!STORE.apiUrl) { showScreen('connectScreen'); return; }
  try {
    const setup = await api('checkSetup', {});
    if (setup.needsSetup) { showScreen('setupScreen'); return; }
  } catch (err) {
    document.getElementById('connectError').textContent = err.message;
    showScreen('connectScreen');
    return;
  }
  if (STORE.token && STORE.user) {
    try { await api('me', {}); enterApp(); return; }
    catch (err) { STORE.token = ''; STORE.user = null; localStorage.removeItem('DAFTAR_TOKEN'); localStorage.removeItem('DAFTAR_USER'); }
  }
  showScreen('loginScreen');
}

document.getElementById('btnSaveApiUrl').onclick = () => {
  const val = document.getElementById('apiUrlInput').value.trim();
  if (!val.startsWith('http')) { document.getElementById('connectError').textContent = 'الرجاء لصق رابط صحيح.'; return; }
  STORE.apiUrl = val;
  localStorage.setItem('DAFTAR_API_URL', val);
  boot();
};
document.getElementById('btnChangeApiFromSetup').onclick = () => showScreen('connectScreen');
document.getElementById('btnChangeApiFromLogin').onclick = () => showScreen('connectScreen');

document.getElementById('btnCreateAdmin').onclick = async (e) => {
  const btn = e.target;
  const email = document.getElementById('setupEmail').value.trim();
  const name = document.getElementById('setupName').value.trim();
  const password = document.getElementById('setupPassword').value;
  setLoading(btn, true, 'جارٍ الإنشاء...');
  try {
    const res = await api('createFirstAdmin', { email, name, password });
    persistSession(res);
    enterApp();
  } catch (err) { document.getElementById('setupError').textContent = err.message; }
  setLoading(btn, false);
};

document.getElementById('btnLogin').onclick = async (e) => {
  const btn = e.target;
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  setLoading(btn, true, 'جارٍ الدخول...');
  try {
    const res = await api('login', { email, password });
    persistSession(res);
    enterApp();
  } catch (err) { document.getElementById('loginError').textContent = err.message; }
  setLoading(btn, false);
};

function persistSession(res) {
  STORE.token = res.token;
  STORE.user = { email: res.email, name: res.name, role: res.role };
  localStorage.setItem('DAFTAR_TOKEN', STORE.token);
  localStorage.setItem('DAFTAR_USER', JSON.stringify(STORE.user));
}

document.getElementById('btnLogout').onclick = async () => {
  try { await api('logout', {}); } catch (err) { /* تجاهل */ }
  clearSessionLocal();
  clearReadCache();
  showScreen('loginScreen');
};

function enterApp() {
  syncUserUI();
  applyBrand();
  showScreen('appShell');
  buildSideNav();
  goTo('dashboard',{force:true});
  // اسم المنشأة ليس مسارًا حرجًا؛ يُجلب بعد أول رسم حتى لا يؤخر لوحة التحكم.
  idle(async()=>{try{const st=await apiCached('getPublicSettings',{},10*60*1000);if(st?.COMPANY_NAME){STORE.companyName=st.COMPANY_NAME;localStorage.setItem('ALMANAR_COMPANY_NAME',STORE.companyName);applyBrand()}}catch(_){}});
}

/* ================= الصفحات (Views) ================= */

const VIEWS = {};

/* ---------- لوحة التحكم ---------- */
function dashboardPercent(d){
  const sales=Number(d.totalSales||0), paid=Number(d.netCollected||0);
  if(!sales) return 0;
  return Math.max(0,Math.min(100,Math.round((paid/sales)*100)));
}
function renderDashboard(view,d,isCached){
  if(!view || !view.isConnected) return;
  const p=dashboardPercent(d);
  const due=[...(d.overdue||[]).slice(0,3),...(d.dueSoon||[]).slice(0,3)].slice(0,5);
  view.innerHTML=`
  <section class="hero">
    <div class="hero-copy"><h1>مرحبًا بك، ${esc(STORE.user?.name||'')}</h1><p>${isCached?'عرض سريع من آخر بيانات محفوظة، ويتم التحديث تلقائيًا.':'كل شيء تحت السيطرة — تابع التحصيل والأقساط من مكان واحد.'}</p>
      <div class="hero-tags"><span class="hero-tag">V3</span><span class="hero-tag">${prettyDate(d.date)}</span><span class="hero-tag">بيانات مباشرة من Google Sheets</span></div>
    </div>
    <div class="hero-art"><div class="hero-city"></div><div class="hero-store"></div></div>
  </section>
  <div class="dashboard-grid">
    <div class="metric-card"><div class="metric-head"><div><div class="metric-label">عدد العملاء</div><div class="metric-value num">${d.customers}</div></div><span class="metric-icon mi-blue">👥</span></div><div class="metric-foot">إجمالي العملاء المسجلين</div></div>
    <div class="metric-card"><div class="metric-head"><div><div class="metric-label">الفواتير السارية</div><div class="metric-value num">${d.invoices}</div></div><span class="metric-icon mi-violet">▤</span></div><div class="metric-foot">غير الملغاة</div></div>
    <div class="metric-card"><div class="metric-head"><div><div class="metric-label">صافي التحصيل</div><div class="metric-value num">${money(d.netCollected)} <small>ر.س</small></div></div><span class="metric-icon mi-teal">◉</span></div><div class="metric-foot">القبض بعد الاستردادات</div></div>
    <div class="metric-card"><div class="metric-head"><div><div class="metric-label">إجمالي المتبقي</div><div class="metric-value num">${money(d.totalOutstanding)} <small>ر.س</small></div></div><span class="metric-icon mi-red">◷</span></div><div class="metric-foot">الرصيد المطلوب تحصيله</div></div>
    <div class="metric-card"><div class="metric-head"><div><div class="metric-label">تحصيل اليوم</div><div class="metric-value num">${money(d.todayReceipts)} <small>ر.س</small></div></div><span class="metric-icon mi-green">↗</span></div><div class="metric-foot">${d.todayInvoices||0} فاتورة اليوم</div></div>
  </div>
  <div class="dashboard-body">
    <div>
      <div class="panel"><div class="panel-head"><h3>الأقساط المطلوب متابعتها</h3><span class="muted">الأقرب أولًا</span></div>${renderTable([
        {label:'الحالة',render:r=>badge(r.DUE_DATE<d.date?'OVERDUE':'DUE',r.DUE_DATE<d.date?'متأخر':'قريب')},
        {label:'العميل',key:'CUSTOMER_NAME'},{label:'الفاتورة',key:'INVOICE_NO'},{label:'الصنف',key:'ITEM_DESC'},
        {label:'الاستحقاق',render:r=>prettyDate(r.DUE_DATE)},{label:'المتبقي',render:r=>`<span class="num">${money(r.BALANCE)}</span>`}
      ],due,'لا توجد أقساط تحتاج متابعة حاليًا.')}</div>
      <div class="panel"><div class="panel-head"><h3>ملخص الالتزامات</h3><span class="muted">قراءة لحظية</span></div><div class="stat-grid panel-body">
        <div class="stat-card warn"><div class="label">أقساط متأخرة</div><div class="value num">${d.overdueCount}</div><small>${money(d.overdueTotal)} ر.س</small></div>
        <div class="stat-card"><div class="label">مستحقة قريبًا</div><div class="value num">${d.dueSoonCount}</div><small>${money(d.dueSoonTotal)} ر.س</small></div>
        <div class="stat-card good"><div class="label">صافي تحصيل اليوم</div><div class="value num">${money(Number(d.todayReceipts||0)-Number(d.todayRefunds||0))}</div><small>ر.س</small></div>
      </div></div>
    </div>
    <div>
      <div class="panel"><div class="panel-head"><h3>نسبة التحصيل</h3><span class="muted">من إجمالي المبيعات</span></div><div class="collection-card">
        <div class="donut" style="--p:${p}"><div class="donut-content"><b>${p}%</b><small>تم تحصيله</small></div></div>
        <div class="collection-stats"><div class="collection-stat"><span>إجمالي المبيعات</span><b class="num">${money(d.totalSales)} ر.س</b></div><div class="collection-stat"><span>صافي التحصيل</span><b class="num">${money(d.netCollected)} ر.س</b></div><div class="collection-stat"><span>المتبقي</span><b class="num">${money(d.totalOutstanding)} ر.س</b></div></div>
      </div></div>
      <div class="panel"><div class="panel-head"><h3>إجراءات سريعة</h3><span class="muted">الأكثر استخدامًا</span></div><div class="quick-actions">
        <button class="quick-action" data-quick="customers"><span class="qa-icon">👥</span>إدارة العملاء</button>
        <button class="quick-action" data-quick="invoices"><span class="qa-icon">▤</span>الفواتير</button>
        <button class="quick-action" data-quick="receipts"><span class="qa-icon">◉</span>سند قبض</button>
        <button class="quick-action" data-quick="statement"><span class="qa-icon">≡</span>كشف حساب</button>
      </div></div>
    </div>
  </div>`;
  view.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>goTo(b.dataset.quick));
}
VIEWS.dashboard = async function(view){
  let cached=null;
  try{ cached=JSON.parse(sessionStorage.getItem('ALMANAR_DASH_CACHE')||'null'); }catch(_){}
  if(cached?.data) renderDashboard(view,cached.data,true);
  if(cached?.at && Date.now()-cached.at<15000) return;
  const d=await api('getWebDashboardData',{});
  try{sessionStorage.setItem('ALMANAR_DASH_CACHE',JSON.stringify({at:Date.now(),data:d}));}catch(_){}
  renderDashboard(view,d,false);
};

/* ---------- العملاء ---------- */
VIEWS.customers = async function(view){
  document.getElementById('topbarActions').innerHTML=`<button class="btn btn-primary" id="btnNewCustomer">${icon('plus')} إضافة عميل جديد</button>`;
  const rows=await api('searchCustomers',{q:''});
  view.innerHTML=`<div class="panel"><div class="panel-head"><h3>استعراض العملاء</h3></div><div class="toolbar lookup-toolbar">
    <input class="search-input" id="custFilter" placeholder="بحث بالاسم / الجوال / الهوية...">
    <select id="custSelect" class="wide-select">${selectOptions(rows,'CUSTOMER_ID',r=>`${esc(r.NAME)} — ${esc(r.PHONE||r.CUSTOMER_ID)}`,'اختر العميل')}</select>
    <button class="btn btn-teal" id="custShow">عرض</button>
  </div></div><div id="custCard"></div>
  <div class="panel"><div class="panel-head"><h3>كشف العملاء</h3><span class="muted">${rows.length} عميل</span></div><div id="custTableWrap"></div></div>`;
  const renderList=(list)=>{document.getElementById('custTableWrap').innerHTML=renderTable([
    {label:'الكود',key:'CUSTOMER_ID'},{label:'الاسم',key:'NAME'},{label:'الهاتف',key:'PHONE'},{label:'المدينة',key:'CITY'},
    {label:'الحالة',render:r=>badge(r.STATUS,r.STATUS_LABEL)},{label:'',render:r=>`<button class="btn btn-sm" data-cshow="${esc(r.CUSTOMER_ID)}">عرض</button>`}
  ],list,'لا يوجد عملاء.'); document.querySelectorAll('[data-cshow]').forEach(b=>b.onclick=()=>showCustomerCard(b.dataset.cshow));};
  renderList(rows);
  document.getElementById('custFilter').oninput=e=>{const q=(e.target.value||'').trim().toLowerCase();const list=!q?rows:rows.filter(r=>[r.NAME,r.PHONE,r.NATIONAL_ID,r.CUSTOMER_ID,r.CITY].some(v=>String(v||'').toLowerCase().includes(q)));renderList(list);const sel=document.getElementById('custSelect');sel.innerHTML=selectOptions(list,'CUSTOMER_ID',r=>`${esc(r.NAME)} — ${esc(r.PHONE||r.CUSTOMER_ID)}`,'اختر العميل')};
  document.getElementById('custShow').onclick=()=>{const id=document.getElementById('custSelect').value;if(!id)return toast('اختر العميل ثم اضغط عرض.','error');showCustomerCard(id)};
  document.getElementById('btnNewCustomer').onclick=()=>openCustomerDrawer(null);
};
async function showCustomerCard(customerId){
  const [c,files]=await Promise.all([api('getCustomerForView',{customerId}),api('getCustomerAttachments',{customerId})]);
  document.getElementById('custCard').innerHTML=`<div class="customer-card panel"><div class="panel-head"><div><h3>${esc(c.NAME)}</h3><span class="muted">${esc(c.CUSTOMER_ID)}</span></div><div>${badge(c.STATUS,c.STATUS_LABEL)}</div></div>
  <div class="info-grid"><div><span>رقم الهوية</span><b>${esc(c.NATIONAL_ID||'—')}</b></div><div><span>الهاتف</span><b>${esc(c.PHONE||'—')}</b></div><div><span>هاتف بديل</span><b>${esc(c.ALT_PHONE||'—')}</b></div><div><span>المدينة</span><b>${esc(c.CITY||'—')}</b></div><div><span>الحد الائتماني</span><b class="num">${money(c.CREDIT_LIMIT)}</b></div><div><span>ملاحظات</span><b>${esc(c.NOTES||'—')}</b></div></div>
  <div class="attachments"><h4>المرفقات</h4><div class="attachment-list">${files.length?files.map(f=>`<button class="attachment-link" data-file="${esc(f.FILE_ID)}">📎 ${esc(f.TYPE_LABEL)} <small>${esc(f.FILE_NAME)}</small></button>`).join(''):'<span class="muted">لا توجد مرفقات.</span>'}</div></div>
  <div class="form-actions"><button class="btn btn-primary" id="editCustomer">تعديل البيانات</button><button class="btn" id="customerStatementBtn">كشف الحساب</button></div></div>`;
  document.querySelectorAll('[data-file]').forEach(b=>b.onclick=()=>openSecureAttachment(b.dataset.file));
  document.getElementById('editCustomer').onclick=()=>openCustomerDrawer(customerId);
  document.getElementById('customerStatementBtn').onclick=()=>{goTo('statement');setTimeout(()=>loadStatementCustomer(customerId),100)};
}
async function openCustomerDrawer(customerId){
  let c={NAME:'',NATIONAL_ID:'',PHONE:'',ALT_PHONE:'',CITY:'',CREDIT_LIMIT:'',NOTES:'',STATUS:'ACTIVE'};
  if(customerId)c=await api('getCustomerForView',{customerId});
  const isAdmin=STORE.user.role==='ADMIN';
  openDrawer(customerId?'تعديل بيانات العميل':'إضافة عميل جديد',`
    <div class="form-field"><label>الاسم *</label><input id="f_name" value="${esc(c.NAME)}"></div>
    <div class="form-row"><div class="form-field"><label>رقم الهوية</label><input id="f_nid" value="${esc(c.NATIONAL_ID)}"></div><div class="form-field"><label>الهاتف</label><input id="f_phone" value="${esc(c.PHONE)}"></div></div>
    <div class="form-row"><div class="form-field"><label>هاتف بديل</label><input id="f_altphone" value="${esc(c.ALT_PHONE)}"></div><div class="form-field"><label>المدينة</label><input id="f_city" value="${esc(c.CITY)}"></div></div>
    <div class="form-row"><div class="form-field"><label>الحد الائتماني</label><input id="f_credit" inputmode="decimal" value="${c.CREDIT_LIMIT||''}"></div><div class="form-field"><label>ملاحظات</label><input id="f_notes" value="${esc(c.NOTES)}"></div></div>
    <hr class="divider"><h4>مرفقات العميل <small class="muted">(اختياري — بحد أقصى 3 MB للصورة)</small></h4>
    <div class="form-field"><label>صورة الهوية</label><input id="f_idimg" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></div>
    <div class="form-field"><label>صورة السند / المستند</label><input id="f_docimg" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></div>
    <div class="form-field"><label>مرفق آخر</label><input id="f_otherimg" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></div>
    ${customerId&&isAdmin?`<div class="form-field"><label>الحالة</label><select id="f_status"><option value="ACTIVE" ${c.STATUS==='ACTIVE'?'selected':''}>نشط</option><option value="INACTIVE" ${c.STATUS==='INACTIVE'?'selected':''}>غير نشط</option></select></div>`:''}
    <div class="form-actions"><button class="btn btn-primary" id="f_save">حفظ</button><button class="btn" id="f_cancel">إلغاء</button></div>`);
  document.getElementById('f_cancel').onclick=closeDrawer;
  document.getElementById('f_save').onclick=async(e)=>{const btn=e.target;setLoading(btn,true);try{
    const data={name:f_name.value,nationalId:f_nid.value,phone:f_phone.value,altPhone:f_altphone.value,city:f_city.value,creditLimit:f_credit.value,notes:f_notes.value};
    let id=customerId;if(id){await api('updateCustomer',{customerId:id,data});const st=document.getElementById('f_status');if(st&&st.value!==c.STATUS)await api('setCustomerStatus',{customerId:id,active:st.value==='ACTIVE'});}else{const res=await api('saveCustomer',{data});id=res.id;}
    const uploads=[['IDENTITY',document.getElementById('f_idimg').files[0]],['DOCUMENT',document.getElementById('f_docimg').files[0]],['OTHER',document.getElementById('f_otherimg').files[0]]];
    const failed=[]; let uploaded=0;
    for(const [type,file] of uploads){if(!file)continue;try{btn.textContent='جارٍ تجهيز '+file.name+'...';const p=await fileToPayload(file);btn.textContent='جارٍ رفع '+file.name+'...';await api('uploadCustomerAttachment',{customerId:id,type,file:p});uploaded++;}catch(upErr){failed.push(file.name+': '+upErr.message);}}
    if(failed.length){toast('تم حفظ العميل، لكن تعذر رفع: '+failed.join(' | '),'error');}else{toast(uploaded?'تم حفظ العميل والمرفقات بنجاح':'تم حفظ العميل بنجاح','success');}
    closeDrawer();goTo('customers');setTimeout(()=>showCustomerCard(id),150);
  }catch(err){toast(err.message,'error')}setLoading(btn,false)};
}

/* ---------- الأصناف ---------- */
VIEWS.items=async function(view){
  document.getElementById('topbarActions').innerHTML=`<button class="btn btn-primary" id="btnNewItem">${icon('plus')} إضافة صنف جديد</button>`;
  const rows=await api('searchItems',{q:''});
  view.innerHTML=`<div class="panel"><div class="panel-head"><h3>عرض وتعديل صنف</h3></div><div class="toolbar lookup-toolbar"><select id="itemSelect" class="wide-select">${selectOptions(rows,'ITEM_ID',r=>`${esc(r.NAME)} — ${esc(r.CATEGORY)} — ${money(r.SALE_PRICE)}`,'اختر الصنف')}</select><button class="btn btn-teal" id="itemShow">عرض</button></div></div><div id="itemCard"></div>
  <div class="panel"><div class="panel-head"><h3>كل الأصناف</h3><span class="muted">${rows.length} صنف</span></div>${renderTable([{label:'الكود',key:'ITEM_ID'},{label:'الفئة',key:'CATEGORY'},{label:'الاسم',key:'NAME'},{label:'السعر',render:r=>`<span class="num">${money(r.SALE_PRICE)}</span>`},{label:'الحالة',render:r=>badge(r.STATUS,r.STATUS_LABEL)}],rows,'لا توجد أصناف.')}</div>`;
  itemShow.onclick=()=>{if(!itemSelect.value)return toast('اختر الصنف أولًا.','error');showItemCard(itemSelect.value)};btnNewItem.onclick=()=>openItemDrawer(null);
};
async function showItemCard(id){const it=await api('getItemForView',{itemId:id});document.getElementById('itemCard').innerHTML=`<div class="panel customer-card"><div class="panel-head"><div><h3>${esc(it.NAME)}</h3><span class="muted">${esc(it.ITEM_ID)}</span></div>${badge(it.STATUS,it.STATUS_LABEL)}</div><div class="info-grid"><div><span>الفئة</span><b>${esc(it.CATEGORY)}</b></div><div><span>الرقم التسلسلي</span><b>${esc(it.SERIAL_NO||'—')}</b></div><div><span>سعر البيع</span><b class="num">${money(it.SALE_PRICE)}</b></div><div><span>سعر التكلفة</span><b class="num">${STORE.user.role==='ADMIN'?money(it.COST_PRICE):'—'}</b></div><div class="span2"><span>المواصفات</span><b>${esc(it.SPECS||'—')}</b></div></div><div class="form-actions"><button class="btn btn-primary" id="editItem">تعديل الصنف</button></div></div>`;editItem.onclick=()=>openItemDrawer(id)}
async function openItemDrawer(itemId){
 const cats=await api('getItemCategories',{});let it={CATEGORY:'',NAME:'',SERIAL_NO:'',SPECS:'',SALE_PRICE:'',COST_PRICE:'',STATUS:'AVAILABLE'};if(itemId)it=await api('getItemForView',{itemId});const adm=STORE.user.role==='ADMIN';
 openDrawer(itemId?'تعديل الصنف':'إضافة صنف جديد',`<div class="form-row"><div class="form-field"><label>الفئة *</label><input id="f_cat" list="catList" value="${esc(it.CATEGORY)}"><datalist id="catList">${cats.map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div><div class="form-field"><label>اسم الصنف *</label><input id="f_name" value="${esc(it.NAME)}"></div></div><div class="form-row"><div class="form-field"><label>الرقم التسلسلي</label><input id="f_serial" value="${esc(it.SERIAL_NO)}"></div><div class="form-field"><label>سعر البيع</label><input id="f_price" inputmode="decimal" value="${it.SALE_PRICE||''}"></div></div><div class="form-field"><label>المواصفات</label><textarea id="f_specs">${esc(it.SPECS)}</textarea></div>${adm?`<div class="form-field"><label>سعر التكلفة</label><input id="f_cost" inputmode="decimal" value="${it.COST_PRICE||''}"></div>`:''}${itemId&&adm?`<div class="form-field"><label>الحالة</label><select id="f_status">${['AVAILABLE','RESERVED','SOLD'].map(x=>`<option value="${x}" ${it.STATUS===x?'selected':''}>${{AVAILABLE:'متاح',RESERVED:'محجوز',SOLD:'مباع'}[x]}</option>`).join('')}</select></div>`:''}<div class="form-actions"><button class="btn btn-primary" id="f_save">حفظ</button><button class="btn" id="f_cancel">إلغاء</button></div>`);
 f_cancel.onclick=closeDrawer;f_save.onclick=async(e)=>{setLoading(e.target,true);try{const data={category:f_cat.value,name:f_name.value,serialNo:f_serial.value,specs:f_specs.value,salePrice:f_price.value,costPrice:document.getElementById('f_cost')?f_cost.value:(it.COST_PRICE||0)};if(itemId){await api('updateItem',{itemId,data});const st=document.getElementById('f_status');if(st&&st.value!==it.STATUS)await api('setItemStatus',{itemId,status:st.value});}else await api('saveItem',{data});toast('تم حفظ الصنف','success');closeDrawer();goTo('items')}catch(err){toast(err.message,'error')}setLoading(e.target,false)};
}

/* ---------- الفواتير ---------- */
VIEWS.invoices=async function(view){
 document.getElementById('topbarActions').innerHTML=`<button class="btn btn-primary" id="btnNewInvoice">${icon('plus')} فاتورة جديدة</button>`;
 const allInvoiceRows=await api('searchInvoices',{q:''}); let rows=allInvoiceRows;
 view.innerHTML=`<div class="panel"><div class="panel-head"><h3>بحث وعرض فاتورة</h3></div><div class="toolbar lookup-toolbar"><input class="search-input" id="invSearch" placeholder="رقم الفاتورة / العميل / الصنف"><select id="invSelect" class="wide-select">${selectOptions(rows,'INVOICE_ID',r=>`${esc(r.INVOICE_NO)} — ${esc(r.CUSTOMER_NAME)} — ${esc(r.ITEM_DESC)}`,'اختر الفاتورة')}</select><button class="btn btn-teal" id="invShow">عرض</button><button class="btn btn-danger" id="invCancel" ${STORE.user.role!=='ADMIN'?'disabled':''}>إلغاء الفاتورة</button></div></div><div id="invoiceSelectedCard"></div><div class="panel"><div class="panel-head"><h3>كل الفواتير</h3></div><div id="invTableWrap"></div></div>`;
 const draw=(list)=>{invSelect.innerHTML=selectOptions(list,'INVOICE_ID',r=>`${esc(r.INVOICE_NO)} — ${esc(r.CUSTOMER_NAME)} — ${esc(r.ITEM_DESC)}`,'اختر الفاتورة');invTableWrap.innerHTML=renderTable([{label:'رقم الفاتورة',key:'INVOICE_NO'},{label:'التاريخ',render:r=>prettyDate(r.DATE)},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الصنف',key:'ITEM_DESC'},{label:'الإجمالي',render:r=>`<span class="num">${money(r.TOTAL)}</span>`},{label:'الحالة',render:r=>badge(r.STATUS,r.STATUS_LABEL)},{label:'',render:r=>`<button class="btn btn-sm" data-ishow="${esc(r.INVOICE_ID)}">عرض</button>`}],list,'لا توجد فواتير.');document.querySelectorAll('[data-ishow]').forEach(b=>b.onclick=()=>{invSelect.value=b.dataset.ishow;showSelectedInvoice(b.dataset.ishow)})};
 draw(rows);invSearch.oninput=e=>{const q=(e.target.value||'').trim().toLowerCase();const list=!q?allInvoiceRows:allInvoiceRows.filter(r=>[r.INVOICE_NO,r.CUSTOMER_NAME,r.ITEM_DESC,r.INVOICE_ID].some(v=>String(v||'').toLowerCase().includes(q)));draw(list)};invShow.onclick=()=>{if(!invSelect.value)return toast('اختر الفاتورة ثم اضغط عرض.','error');showSelectedInvoice(invSelect.value)};invCancel.onclick=()=>cancelSelectedInvoice();btnNewInvoice.onclick=openNewInvoiceDrawer;
};
async function showSelectedInvoice(id){await openInvoiceDetail(id,true)}
async function cancelSelectedInvoice(){const id=document.getElementById('invSelect')?.value;if(!id)return toast('اختر الفاتورة المطلوب إلغاؤها أولًا.','error');const info=await api('getInvoiceCancellationInfo',{invoiceId:id});if(!info.canCancel)return toast(`يوجد ${money(info.unresolved)} ريال يجب عكسه أو استرداده قبل إلغاء الفاتورة.`,'error');const reason=prompt('اكتب سبب إلغاء الفاتورة:');if(!reason)return;await api('cancelInvoice',{invoiceId:id,reason});toast('تم إلغاء الفاتورة','success');goTo('invoices')}

function searchPicker(inputEl, resultsEl, searchFn, renderLabel, onPick) {
  let timer=0, seq=0;
  inputEl.addEventListener('input', () => {
    clearTimeout(timer);
    const q=inputEl.value.trim();
    if(!q){resultsEl.innerHTML='';return;}
    timer=setTimeout(async()=>{
      const my=++seq;
      try{
        const rows=await searchFn(q);
        if(my!==seq || inputEl.value.trim()!==q) return;
        resultsEl.innerHTML=(rows||[]).slice(0,8).map((r,i)=>`<div class="pick-row" data-i="${i}">${renderLabel(r)}</div>`).join('');
        resultsEl.querySelectorAll('.pick-row').forEach(el=>el.onclick=()=>{onPick(rows[Number(el.dataset.i)]);resultsEl.innerHTML='';});
      }catch(err){ if(my===seq) resultsEl.innerHTML=`<div class="pick-row">${esc(err.message)}</div>`; }
    },160);
  });
}

async function openNewInvoiceDrawer() {
  const lookups = await api('getInvoiceLookups', {});
  let picked = { customer: null, item: null };
  openDrawer('فاتورة بيع جديدة', `
    <div class="form-field"><label>العميل *</label>
      <input id="f_custq" placeholder="اكتب اسم العميل أو رقم الجوال...">
      <div id="f_custResults" class="pick-results"></div>
      <div id="f_custPicked" class="form-help"></div>
    </div>
    <div class="form-field"><label>الصنف *</label>
      <input id="f_itemq" placeholder="اكتب اسم الصنف أو الرقم التسلسلي...">
      <div id="f_itemResults" class="pick-results"></div>
      <div id="f_itemPicked" class="form-help"></div>
    </div>
    <div class="form-row">
      <div class="form-field"><label>السعر (قابل للتعديل)</label><input id="f_subtotal" type="number" step="0.01"></div>
      <div class="form-field"><label>الخصم</label><input id="f_discount" type="number" step="0.01" value="0"></div>
    </div>
    <div class="form-row">
      <div class="form-field"><label>نسبة الضريبة %</label><input id="f_tax" type="number" step="0.01" value="${lookups.settings.TAX_RATE || 15}"></div>
      <div class="form-field"><label>الدفعة المقدمة</label><input id="f_down" type="number" step="0.01" value="0"></div>
    </div>
    <div class="form-row">
      <div class="form-field"><label>عدد الأقساط</label><input id="f_count" type="number" value="0"></div>
      <div class="form-field"><label>تاريخ أول استحقاق</label><input id="f_firstdue" type="date"></div>
    </div>
    <div class="form-field"><label>طريقة دفع المقدم</label>
      <select id="f_paymethod"><option>نقدي</option><option>تحويل بنكي</option><option>شبكة</option><option>شيك</option></select>
    </div>
    <hr class="divider">
    <div class="kv" id="f_summary">
      <dt>الإجمالي بعد الضريبة</dt><dd class="num">0.00</dd>
      <dt>المبلغ الممول</dt><dd class="num">0.00</dd>
      <dt>قيمة القسط</dt><dd class="num">0.00</dd>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" id="f_save">حفظ الفاتورة</button>
      <button class="btn" id="f_cancel">إلغاء</button>
    </div>`);

  // بيانات العميل والصنف وصلت بالفعل في getInvoiceLookups؛ البحث هنا محلي ولا يولد طلبات إضافية.
  searchPicker(document.getElementById('f_custq'), document.getElementById('f_custResults'),
    q => Promise.resolve(filterLocal(lookups.customers || [], q, ['NAME','PHONE','NATIONAL_ID','CUSTOMER_ID'])),
    r => `${esc(r.NAME)} — ${esc(r.PHONE || r.CUSTOMER_ID || '')}`,
    r => { picked.customer = r; document.getElementById('f_custPicked').textContent = 'المختار: ' + r.NAME; document.getElementById('f_custq').value = r.NAME; });

  searchPicker(document.getElementById('f_itemq'), document.getElementById('f_itemResults'),
    q => Promise.resolve(filterLocal(lookups.items || [], q, ['NAME','CATEGORY','SERIAL_NO','ITEM_ID'])),
    r => `${esc(r.NAME)} — ${esc(r.CATEGORY)} — ${money(r.SALE_PRICE)}`,
    r => {
      picked.item = r;
      document.getElementById('f_itemPicked').textContent = 'المختار: ' + r.NAME;
      document.getElementById('f_itemq').value = r.NAME;
      document.getElementById('f_subtotal').value = r.SALE_PRICE;
      recalc();
    });

  const recalc = () => {
    const subtotal = Number(document.getElementById('f_subtotal').value || 0);
    const discount = Number(document.getElementById('f_discount').value || 0);
    const taxRate = Number(document.getElementById('f_tax').value || 0);
    const down = Number(document.getElementById('f_down').value || 0);
    const count = Number(document.getElementById('f_count').value || 0);
    const taxable = Math.max(0, subtotal - discount);
    const tax = taxable * taxRate / 100;
    const total = taxable + tax;
    const financed = Math.max(0, total - down);
    const installment = count > 0 ? financed / count : 0;
    document.getElementById('f_summary').innerHTML = `
      <dt>الإجمالي بعد الضريبة</dt><dd class="num">${money(total)}</dd>
      <dt>المبلغ الممول</dt><dd class="num">${money(financed)}</dd>
      <dt>قيمة القسط</dt><dd class="num">${money(installment)}</dd>`;
  };
  ['f_subtotal', 'f_discount', 'f_tax', 'f_down', 'f_count'].forEach(id => document.getElementById(id).addEventListener('input', recalc));

  document.getElementById('f_cancel').onclick = closeDrawer;
  document.getElementById('f_save').onclick = async (e) => {
    const btn = e.target;
    if (!picked.customer) return toast('اختر العميل أولاً', 'error');
    if (!picked.item) return toast('اختر الصنف أولاً', 'error');
    const data = {
      customerId: picked.customer.CUSTOMER_ID, itemId: picked.item.ITEM_ID,
      subtotal: document.getElementById('f_subtotal').value, discount: document.getElementById('f_discount').value,
      taxRate: document.getElementById('f_tax').value, downPayment: document.getElementById('f_down').value,
      installmentsCount: document.getElementById('f_count').value, firstDueDate: document.getElementById('f_firstdue').value,
      paymentMethod: document.getElementById('f_paymethod').value
    };
    setLoading(btn, true, 'جارٍ الإصدار...');
    try {
      const res = await api('createInvoice', { data });
      toast('تم إصدار الفاتورة ' + res.no, 'success');
      closeDrawer();
      goTo('invoices');
    } catch (err) { toast(err.message, 'error'); }
    setLoading(btn, false);
  };
}

async function openInvoiceDetail(invoiceId) {
  const [inv, installments] = await Promise.all([api('getInvoiceForView', { invoiceId }), api('getInstallmentsForInvoice', { invoiceId })]);
  const isAdmin = STORE.user.role === 'ADMIN';
  openDrawer('فاتورة ' + inv.INVOICE_NO, `
    <div class="kv">
      <dt>العميل</dt><dd>${esc(inv.CUSTOMER_NAME)}</dd>
      <dt>الصنف</dt><dd>${esc(inv.ITEM_DESC)}</dd>
      <dt>التاريخ</dt><dd>${prettyDate(inv.DATE)}</dd>
      <dt>الحالة</dt><dd>${badge(inv.STATUS, inv.STATUS_LABEL)}</dd>
      <dt>الإجمالي</dt><dd class="num">${money(inv.TOTAL)}</dd>
      <dt>الدفعة المقدمة</dt><dd class="num">${money(inv.DOWN_PAYMENT)}</dd>
      <dt>الممول</dt><dd class="num">${money(inv.FINANCED)}</dd>
    </div>
    <hr class="divider">
    <h4 style="margin-bottom:10px">جدول الأقساط</h4>
    ${renderTable([
      { label: '#', key: 'NO' }, { label: 'الاستحقاق', render: r => prettyDate(r.DUE_DATE) },
      { label: 'القيمة', render: r => `<span class="num">${money(r.AMOUNT)}</span>` },
      { label: 'المتبقي', render: r => `<span class="num">${money(r.BALANCE)}</span>` },
      { label: 'الحالة', render: r => badge(r.STATUS, r.STATUS_LABEL) }
    ], installments, 'لا توجد أقساط (فاتورة نقدية بالكامل).')}
    <div class="form-actions">
      ${inv.PDF_URL ? `<a class="btn" target="_blank" href="${esc(inv.PDF_URL)}">فتح PDF</a>` : ''}
      ${inv.STATUS !== 'CANCELLED' ? `<button class="btn btn-teal" id="f_topay">تسجيل تحصيل</button>` : ''}
    </div>
    ${inv.CANCEL_REASON ? `<p class="form-help">سبب الإلغاء: ${esc(inv.CANCEL_REASON)}</p>` : ''}`);

  const topay = document.getElementById('f_topay');
  if (topay) topay.onclick = () => { closeDrawer(); openReceiptDrawer(null, inv); };

}


/* ---------- سندات القبض ---------- */
VIEWS.receipts=async function(view){
 document.getElementById('topbarActions').innerHTML=`<button class="btn btn-primary" id="btnNewReceipt">${icon('plus')} سند قبض جديد</button>`;
 let rows=await api('searchReceipts',{q:''}); const allReceiptRows=rows.slice();
 view.innerHTML=`<div class="panel"><div class="panel-head"><h3>سندات القبض</h3></div><div class="toolbar lookup-toolbar"><input class="search-input" id="recSearch" placeholder="السند / العميل / الفاتورة"><select id="recSelect" class="wide-select">${selectOptions(rows,'RECEIPT_ID',r=>`${esc(r.RECEIPT_NO)} — ${esc(r.CUSTOMER_NAME)} — ${money(r.AMOUNT)}`,'اختر سند القبض')}</select><button class="btn btn-teal" id="recShow">عرض</button></div></div><div id="recTableWrap" class="panel"></div>`;
 const draw=list=>{rows=list;recSelect.innerHTML=selectOptions(list,'RECEIPT_ID',r=>`${esc(r.RECEIPT_NO)} — ${esc(r.CUSTOMER_NAME)} — ${money(r.AMOUNT)}`,'اختر سند القبض');recTableWrap.innerHTML=renderTable([{label:'السند',key:'RECEIPT_NO'},{label:'التاريخ',render:r=>prettyDate(r.DATE)},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الفاتورة',key:'INVOICE_NO'},{label:'المبلغ',render:r=>`<span class="num">${money(r.AMOUNT)}</span>`},{label:'الحالة',render:r=>badge(r.STATUS||'ACTIVE',r.STATUS==='REVERSED'?'معكوس':'ساري')},{label:'',render:r=>`<button class="btn btn-sm" data-rshow="${esc(r.RECEIPT_ID)}">عرض</button>`}],list,'لا توجد سندات.');document.querySelectorAll('[data-rshow]').forEach(b=>b.onclick=()=>openReceiptDrawer(b.dataset.rshow,null))};draw(rows);recSearch.oninput=e=>draw(filterLocal(allReceiptRows,e.target.value,['RECEIPT_NO','CUSTOMER_NAME','INVOICE_NO','REFERENCE_NO']));recShow.onclick=()=>{if(!recSelect.value)return toast('اختر السند أولًا.','error');openReceiptDrawer(recSelect.value,null)};btnNewReceipt.onclick=()=>openReceiptDrawer(null,null);
};
async function openReceiptDrawer(receiptId,presetInvoice){
 let invoiceInfo=null,r={AMOUNT:'',PAYMENT_METHOD:'نقدي',REFERENCE_NO:'',NOTES:'',STATUS:'ACTIVE'};if(receiptId){r=await api('getReceiptForEdit',{receiptId});invoiceInfo=r.invoice}else if(presetInvoice)invoiceInfo=await api('getInvoicePaymentInfo',{invoiceId:presetInvoice.INVOICE_ID});const reversed=String(r.STATUS||'ACTIVE')==='REVERSED';
 openDrawer(receiptId?`سند القبض ${r.RECEIPT_NO}`:'سند قبض جديد',`<div class="form-field"><label>الفاتورة *</label><input id="f_invq" placeholder="ابحث بالفاتورة أو العميل" ${invoiceInfo?'style="display:none"':''}><div id="f_invResults" class="pick-results"></div><div id="f_invPicked" class="form-help">${invoiceInfo?`الفاتورة ${esc(invoiceInfo.INVOICE_NO)} — ${esc(invoiceInfo.CUSTOMER_NAME)} — المتاح: <span class="num">${money(invoiceInfo.BALANCE_AVAILABLE)}</span>`:''}</div></div><div class="form-field"><label>المبلغ *</label><input id="f_amount" inputmode="decimal" value="${r.AMOUNT||''}" ${reversed?'disabled':''}></div><div class="form-help" id="f_remainPreview"></div><div class="form-field"><label>طريقة الدفع</label><select id="f_method" ${reversed?'disabled':''}><option ${r.PAYMENT_METHOD==='نقدي'?'selected':''}>نقدي</option><option ${r.PAYMENT_METHOD==='تحويل بنكي'?'selected':''}>تحويل بنكي</option><option ${r.PAYMENT_METHOD==='شبكة'?'selected':''}>شبكة</option><option ${r.PAYMENT_METHOD==='شيك'?'selected':''}>شيك</option></select></div><div class="form-field"><label>المرجع</label><input id="f_ref" value="${esc(r.REFERENCE_NO)}" ${reversed?'disabled':''}></div><div class="form-field"><label>ملاحظات</label><textarea id="f_notes" ${reversed?'disabled':''}>${esc(r.NOTES)}</textarea></div>${reversed?`<div class="alert danger">هذا السند معكوس. ${esc(r.REVERSE_REASON||'')}</div>`:''}<div class="form-actions">${!reversed?`<button class="btn btn-primary" id="f_save">حفظ</button>`:''}${receiptId&&!reversed&&STORE.user.role==='ADMIN'?`<button class="btn btn-danger" id="f_reverse">عكس سند القبض</button>`:''}<button class="btn" id="f_cancel">إغلاق</button></div>${r.PDF_URL?`<a class="btn-link" target="_blank" href="${esc(r.PDF_URL)}">فتح PDF</a>`:''}`);
 if(!invoiceInfo){const openRows=await apiCached('getOpenInvoices',{},12000);searchPicker(f_invq,f_invResults,q=>Promise.resolve(filterLocal(openRows,q,['INVOICE_NO','CUSTOMER_NAME','ITEM_DESC','CUSTOMER_ID'])),x=>`${esc(x.INVOICE_NO)} — ${esc(x.CUSTOMER_NAME)} — ${esc(x.ITEM_DESC)}`,async x=>{invoiceInfo=await api('getInvoicePaymentInfo',{invoiceId:x.INVOICE_ID});f_invPicked.innerHTML=`الفاتورة ${esc(invoiceInfo.INVOICE_NO)} — ${esc(invoiceInfo.CUSTOMER_NAME)} — المتاح: <span class="num">${money(invoiceInfo.BALANCE_AVAILABLE)}</span>`;f_invq.value=`${x.CUSTOMER_NAME} — ${x.INVOICE_NO}`})}
 f_cancel.onclick=closeDrawer;if(document.getElementById('f_amount'))f_amount.oninput=()=>{if(invoiceInfo)f_remainPreview.textContent='المتبقي الجديد: '+money(invoiceInfo.BALANCE_AVAILABLE-Number(f_amount.value||0))};
 const sv=document.getElementById('f_save');if(sv)sv.onclick=async e=>{if(!invoiceInfo)return toast('اختر الفاتورة أولًا.','error');setLoading(e.target,true);try{const data={invoiceId:invoiceInfo.INVOICE_ID,amount:f_amount.value,paymentMethod:f_method.value,referenceNo:f_ref.value,notes:f_notes.value};if(receiptId)await api('updateReceipt',{receiptId,data});else await api('createReceipt',{data});toast('تم حفظ السند','success');closeDrawer();goTo('receipts')}catch(err){toast(err.message,'error')}setLoading(e.target,false)};
 const rv=document.getElementById('f_reverse');if(rv)rv.onclick=async()=>{const reason=prompt('سبب عكس سند القبض:');if(!reason)return;try{await api('reverseReceipt',{receiptId,reason});toast('تم عكس سند القبض','success');closeDrawer();goTo('receipts')}catch(err){toast(err.message,'error')}};
}
/* ---------- الاستردادات ---------- */
VIEWS.refunds=async function(view){
 document.getElementById('topbarActions').innerHTML=`<button class="btn btn-primary" id="btnNewRefund">${icon('plus')} سند استرداد جديد</button>`;const rows=await api('listRefunds',{});view.innerHTML=`<div class="panel"><div class="panel-head"><h3>سندات الاسترداد</h3></div>${renderTable([{label:'السند',key:'REFUND_NO'},{label:'التاريخ',render:r=>prettyDate(r.DATE)},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الفاتورة',key:'INVOICE_NO'},{label:'سند القبض',key:'RECEIPT_NO'},{label:'المبلغ',render:r=>`<span class="num">${money(r.AMOUNT)}</span>`}],rows,'لا توجد استردادات.')}</div>`;btnNewRefund.onclick=openRefundDrawer;
};
async function openRefundDrawer(){const choices=await api('getRefundableReceipts',{});openDrawer('سند استرداد للعميل',`<div class="form-field"><label>سند القبض الأصلي</label><select id="rf_receipt">${selectOptions(choices,'RECEIPT_ID',r=>`${esc(r.CUSTOMER_NAME)} — ${esc(r.INVOICE_NO)} — ${esc(r.RECEIPT_NO)} — متاح ${money(r.REFUNDABLE)}`,'اختر سند القبض')}</select></div><div id="rf_info" class="form-help"></div><div class="form-field"><label>المبلغ</label><input id="rf_amount" inputmode="decimal"></div><div class="form-field"><label>طريقة الاسترداد</label><select id="rf_method"><option>نقدي</option><option>تحويل بنكي</option><option>شبكة</option><option>شيك</option></select></div><div class="form-field"><label>المرجع</label><input id="rf_ref"></div><div class="form-field"><label>سبب الاسترداد *</label><textarea id="rf_reason"></textarea></div><div class="form-actions"><button class="btn btn-primary" id="rf_save">حفظ الاسترداد</button><button class="btn" id="rf_cancel">إلغاء</button></div>`);rf_cancel.onclick=closeDrawer;rf_receipt.onchange=()=>{const x=choices.find(v=>v.RECEIPT_ID===rf_receipt.value);if(x){rf_info.innerHTML=`${esc(x.CUSTOMER_NAME)} — ${esc(x.ITEM_DESC||'')} — المتاح <b class="num">${money(x.REFUNDABLE)}</b>`;rf_amount.value=x.REFUNDABLE}};rf_save.onclick=async e=>{if(!rf_receipt.value)return toast('اختر سند القبض.','error');if(!rf_reason.value.trim())return toast('سبب الاسترداد مطلوب.','error');setLoading(e.target,true);try{await api('createRefund',{data:{receiptId:rf_receipt.value,amount:rf_amount.value,paymentMethod:rf_method.value,referenceNo:rf_ref.value,reason:rf_reason.value}});toast('تم إنشاء سند الاسترداد','success');closeDrawer();goTo('refunds')}catch(err){toast(err.message,'error')}setLoading(e.target,false)}}

/* ---------- كشف حساب عميل ---------- */
VIEWS.statement=async function(view){
  let picked=null;
  view.innerHTML=`<div class="panel"><div class="panel-head"><h3>كشف حساب العميل</h3><span class="muted">بحث واختيار في حقل واحد</span></div><div class="toolbar" style="display:grid;grid-template-columns:1fr auto"><div class="form-field" style="margin:0;position:relative"><label>العميل</label><input id="stSearch" class="search-input" autocomplete="off" placeholder="اكتب الاسم أو الجوال أو رقم العميل..."><div id="stResults" class="pick-results"></div></div><button class="btn btn-primary" id="stShow" disabled>عرض</button></div></div><div id="stResult"></div>`;
  const input=view.querySelector('#stSearch'), results=view.querySelector('#stResults'), btn=view.querySelector('#stShow');
  searchPicker(input,results,async q=>{
    if(q.trim().length<2) return [];
    return api('searchCustomers',{q:q.trim()});
  },r=>`${esc(r.NAME)} — ${esc(r.PHONE||r.CUSTOMER_ID)}`,r=>{picked=r;input.value=`${r.NAME} — ${r.PHONE||r.CUSTOMER_ID}`;btn.disabled=false;});
  input.addEventListener('input',()=>{picked=null;btn.disabled=true});
  btn.onclick=()=>{if(!picked)return toast('اختر العميل من نتائج البحث أولًا.','error');loadStatementCustomer(picked.CUSTOMER_ID)};
};
async function loadStatementCustomer(customerId){
  const result=document.getElementById('stResult'); if(!result)return;
  result.innerHTML='<div class="panel"><div class="panel-body"><div class="skeleton" style="height:20px;width:220px"></div></div></div>';
  const [st,c]=await Promise.all([api('getCustomerStatement',{customerId}),apiCached('getCustomerForView',{customerId},20000)]);
  if(!result.isConnected)return;
  result.innerHTML=`<div class="page-intro"><div><h3>${esc(c.NAME)}</h3><p>${esc(c.PHONE||'')} — ${esc(c.CITY||'')}</p></div><button class="btn" id="btnStPdf">تصدير PDF</button></div><div class="stat-grid"><div class="stat-card"><div class="label">إجمالي الفواتير</div><div class="value num">${money(st.totals.totalInvoices)}</div></div><div class="stat-card good"><div class="label">إجمالي المحصل</div><div class="value num">${money(st.totals.totalPaid)}</div></div><div class="stat-card"><div class="label">الخصومات</div><div class="value num">${money(st.totals.totalDiscounts)}</div></div><div class="stat-card warn"><div class="label">الرصيد</div><div class="value num">${money(st.totals.outstanding)}</div></div></div><div class="panel"><div class="panel-head"><h3>حركة الحساب</h3></div>${renderTable([{label:'التاريخ',render:x=>prettyDate(x.date)},{label:'النوع',key:'typeLabel'},{label:'المرجع',key:'refNo'},{label:'البيان',key:'description'},{label:'مدين',render:x=>x.debit?`<span class="num">${money(x.debit)}</span>`:''},{label:'دائن',render:x=>x.credit?`<span class="num">${money(x.credit)}</span>`:''},{label:'الرصيد',render:x=>`<span class="num">${money(x.balance)}</span>`}],st.rows,'لا توجد حركات.')}</div>`;
  const pdfBtn=document.getElementById('btnStPdf'); if(pdfBtn)pdfBtn.onclick=async()=>{setLoading(pdfBtn,true,'جارٍ تجهيز PDF...');try{const pdf=await api('createCustomerStatementPdf',{customerId});window.open(pdf.url,'_blank')}catch(e){toast(e.message,'error')}setLoading(pdfBtn,false)};
}

/* ---------- التقارير ---------- */
VIEWS.reports=async function(view){view.innerHTML=`<div class="panel"><div class="panel-head"><h3>مركز التقارير</h3><span class="muted">تقرير موحد بدل الصفحات المتفرقة</span></div><div class="toolbar"><div class="form-field compact"><label>من</label><input type="date" id="rpFrom" value="${monthStartStr()}"></div><div class="form-field compact"><label>إلى</label><input type="date" id="rpTo" value="${todayStr()}"></div><button class="btn btn-primary" id="rpGo">تحديث التقرير</button></div></div><div id="rpResult"></div>`;rpGo.onclick=runWebReport;await runWebReport()}
async function runWebReport(){const box=document.getElementById('rpResult');box.innerHTML='<div class="panel"><div class="panel-body">جارٍ تحليل البيانات...</div></div>';try{const d=await api('getWebReportData',{fromDate:rpFrom.value,toDate:rpTo.value});box.innerHTML=`<div class="page-intro"><div><h3>الفترة: ${prettyDate(d.fromDate)} — ${prettyDate(d.toDate)}</h3><p>الحسابات تعتمد على المستندات السارية مع خصم الاستردادات وعكس السندات.</p></div></div><div class="stat-grid"><div class="stat-card"><div class="label">عدد الفواتير</div><div class="value num">${d.invoiceCount}</div></div><div class="stat-card accent"><div class="label">المبيعات</div><div class="value num">${money(d.sales)}</div></div><div class="stat-card good"><div class="label">سندات القبض</div><div class="value num">${money(d.receipts)}</div></div><div class="stat-card"><div class="label">الاستردادات</div><div class="value num">${money(d.refunds)}</div></div><div class="stat-card good"><div class="label">صافي التحصيل</div><div class="value num">${money(d.netCollection)}</div></div><div class="stat-card warn"><div class="label">الرصيد الحالي لفواتير الفترة</div><div class="value num">${money(d.currentOutstanding)}</div></div><div class="stat-card"><div class="label">الأقساط المتأخرة</div><div class="value num">${d.overdueCount}</div></div><div class="stat-card"><div class="label">المستحقة قريبًا</div><div class="value num">${d.dueSoonCount}</div></div></div>
 <div class="two-col"><div class="panel"><div class="panel-head"><h3>التحصيل حسب طريقة الدفع</h3></div>${renderTable([{label:'الطريقة',key:'method'},{label:'القبض',render:r=>`<span class="num">${money(r.receipts)}</span>`},{label:'الاسترداد',render:r=>`<span class="num">${money(r.refunds)}</span>`},{label:'الصافي',render:r=>`<span class="num">${money(r.net)}</span>`}],d.byMethod,'لا توجد حركات.')}</div><div class="panel"><div class="panel-head"><h3>المبيعات حسب الفئة</h3></div>${renderTable([{label:'الفئة',key:'category'},{label:'العدد',key:'count'},{label:'المبيعات',render:r=>`<span class="num">${money(r.sales)}</span>`}],d.byCategory,'لا توجد مبيعات.')}</div></div>
 <div class="panel"><div class="panel-head"><h3>الفواتير ضمن الفترة</h3></div>${renderTable([{label:'الفاتورة',key:'INVOICE_NO'},{label:'التاريخ',render:r=>prettyDate(r.DATE)},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الصنف',key:'ITEM_DESC'},{label:'الإجمالي',render:r=>`<span class="num">${money(r.TOTAL)}</span>`},{label:'المحصل الصافي',render:r=>`<span class="num">${money(r.NET_COLLECTED)}</span>`},{label:'المتبقي',render:r=>`<span class="num">${money(r.BALANCE)}</span>`}],d.invoices,'لا توجد فواتير في الفترة.')}</div>
 <div class="panel"><div class="panel-head"><h3>السندات ضمن الفترة</h3></div>${renderTable([{label:'السند',key:'RECEIPT_NO'},{label:'التاريخ',render:r=>prettyDate(r.DATE)},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الفاتورة',key:'INVOICE_NO'},{label:'المبلغ',render:r=>`<span class="num">${money(r.AMOUNT)}</span>`},{label:'الطريقة',key:'PAYMENT_METHOD'}],d.receiptRows,'لا توجد سندات في الفترة.')}</div>
 <div class="panel"><div class="panel-head"><h3>الأقساط المتأخرة والمستحقة قريبًا</h3></div>${renderTable([{label:'الحالة',key:'DUE_LABEL'},{label:'الفاتورة',key:'INVOICE_NO'},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الصنف',key:'ITEM_DESC'},{label:'الاستحقاق',render:r=>prettyDate(r.DUE_DATE)},{label:'المتبقي',render:r=>`<span class="num">${money(r.BALANCE)}</span>`}],d.installments,'لا توجد أقساط مطلوبة.')}</div>`}catch(err){box.innerHTML=`<div class="alert danger">${esc(err.message)}</div>`}}

/* ---------- الإعدادات ---------- */
VIEWS.settings = async function (view) {
  if(STORE.user?.role!=='ADMIN') throw new Error('الإعدادات متاحة لمدير النظام فقط.');
  const s = await apiCached('getPublicSettings', {}, 60000);
  const fields = [
    ['COMPANY_NAME','اسم المنشأة'],['COMPANY_ADDRESS','العنوان'],['COMPANY_PHONE','هاتف المنشأة'],
    ['VAT_NUMBER','الرقم الضريبي'],['COMMERCIAL_REG','السجل التجاري'],['TAX_RATE','نسبة الضريبة الافتراضية %'],
    ['CURRENCY','العملة'],['DUE_SOON_DAYS','أيام الاستحقاق القريب'],['ITEM_CATEGORIES','فئات الأصناف (مفصولة بفاصلة)']
  ];
  view.innerHTML=`<div class="settings-layout"><div class="panel"><div class="panel-head"><h3>إعدادات المنشأة</h3><span class="muted">مدير النظام</span></div><div class="settings-fields">${fields.map(([key,label])=>`<div class="form-field"><label>${label}</label><input data-key="${key}" value="${esc(s[key]||'')}"></div>`).join('')}<div class="form-actions"><button class="btn btn-primary" id="btnSaveSettings">حفظ الإعدادات</button></div></div></div>
  <div><div class="panel"><div class="panel-head"><h3>حساب مدير النظام</h3></div><div class="panel-body"><div class="form-field"><label>كلمة المرور الحالية</label><input id="oldPass" type="password" autocomplete="current-password"></div><div class="form-field"><label>كلمة المرور الجديدة</label><input id="newPass" type="password" autocomplete="new-password" placeholder="6 خانات على الأقل"></div><button class="btn btn-teal" id="changePassBtn">تغيير كلمة المرور</button></div></div><div class="panel"><div class="panel-body"><b>أعضاء الفريق</b><p class="muted">أضف حسابات العمل وحدد صلاحية كل عضو من صفحة أعضاء الفريق.</p><button class="btn" id="goUsersBtn">إدارة أعضاء الفريق</button></div></div></div></div>`;
  view.querySelector('#btnSaveSettings').onclick=async e=>{const obj={};view.querySelectorAll('[data-key]').forEach(el=>obj[el.dataset.key]=el.value);setLoading(e.target,true);try{await api('saveSettings',{obj});STORE.companyName=obj.COMPANY_NAME||'المنار التجارية';localStorage.setItem('ALMANAR_COMPANY_NAME',STORE.companyName);applyBrand();toast('تم حفظ الإعدادات','success')}catch(err){toast(err.message,'error')}setLoading(e.target,false)};
  view.querySelector('#changePassBtn').onclick=async e=>{const oldPassword=view.querySelector('#oldPass').value,newPassword=view.querySelector('#newPass').value;if(!oldPassword||newPassword.length<6)return toast('أدخل كلمة المرور الحالية وجديدة من 6 خانات على الأقل.','error');setLoading(e.target,true);try{await api('changeMyPassword',{oldPassword,newPassword});view.querySelector('#oldPass').value='';view.querySelector('#newPass').value='';toast('تم تغيير كلمة المرور','success')}catch(err){toast(err.message,'error')}setLoading(e.target,false)};
  view.querySelector('#goUsersBtn').onclick=()=>goTo('users');
};

/* ---------- المستخدمون ---------- */
VIEWS.users = async function (view) {
  if(STORE.user?.role!=='ADMIN') throw new Error('إدارة الأعضاء متاحة لمدير النظام فقط.');
  document.getElementById('topbarActions').innerHTML=`<button class="btn btn-primary" id="btnNewUser">${icon('plus')} إضافة عضو</button>`;
  const load=async()=>{
    const rows=await api('listUsers',{});
    if(!view.isConnected)return;
    view.innerHTML=`<div class="page-intro"><div><h3>أعضاء الفريق</h3><p>إدارة حسابات الدخول والصلاحيات دون مشاركة حساب المدير.</p></div><span class="date-chip">${rows.length} حساب</span></div><div class="panel"><div class="member-grid">${rows.map(r=>`<div class="member-card"><div class="member-top"><div style="display:flex;align-items:center;gap:9px"><span class="member-avatar">${esc((r.NAME||r.EMAIL||'?').charAt(0))}</span><div><div class="member-name">${esc(r.NAME||r.EMAIL)}</div><div class="member-email">${esc(r.EMAIL)}</div></div></div>${badge(r.ACTIVE?'ACTIVE':'INACTIVE',r.ACTIVE?'مفعّل':'معطّل')}</div><div class="member-meta"><span>${r.ROLE==='ADMIN'?'مدير النظام':'موظف مبيعات'}</span>${String(r.EMAIL).toLowerCase()===String(STORE.user.email).toLowerCase()?'<small class="muted">حسابك الحالي</small>':`<button class="btn btn-sm ${r.ACTIVE?'btn-danger':''}" data-toggle="${esc(r.EMAIL)}" data-active="${r.ACTIVE?1:0}">${r.ACTIVE?'تعطيل':'تفعيل'}</button>`}</div></div>`).join('')}</div></div>`;
    view.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('setUserActive',{email:b.dataset.toggle,active:b.dataset.active==='0'});toast('تم تحديث حالة الحساب','success');await load()}catch(err){toast(err.message,'error');b.disabled=false}});
  };
  const newBtn=document.getElementById('btnNewUser');
  newBtn.onclick=()=>{openDrawer('إضافة عضو جديد',`<div class="form-field"><label>البريد الإلكتروني *</label><input id="f_email" type="email" autocomplete="off"></div><div class="form-field"><label>الاسم *</label><input id="f_uname"></div><div class="form-field"><label>الصلاحية</label><select id="f_role"><option value="SALES">موظف مبيعات</option><option value="ADMIN">مدير نظام</option></select></div><div class="form-field"><label>كلمة المرور المبدئية *</label><input id="f_upass" type="password" autocomplete="new-password" placeholder="6 خانات على الأقل"></div><div class="form-actions"><button class="btn btn-primary" id="f_save">إنشاء الحساب</button><button class="btn" id="f_cancel">إلغاء</button></div>`);document.getElementById('f_cancel').onclick=closeDrawer;document.getElementById('f_save').onclick=async e=>{const email=document.getElementById('f_email').value.trim(),name=document.getElementById('f_uname').value.trim(),password=document.getElementById('f_upass').value;if(!email||!name||password.length<6)return toast('الاسم والبريد وكلمة مرور من 6 خانات مطلوبة.','error');setLoading(e.target,true,'جارٍ إنشاء الحساب...');try{await api('createUser',{email,name,role:document.getElementById('f_role').value,password});toast('تم إنشاء حساب العضو','success');closeDrawer();await load()}catch(err){toast(err.message,'error')}setLoading(e.target,false)};};
  await load();
};

/* ==========================================================
   واجهة عامة: الهوية، البحث السريع، القائمة المتنقلة
   ========================================================== */
function applyBrand(){
  const name=STORE.companyName||'المنار التجارية';
  const el=document.getElementById('brandCompanyName'); if(el)el.textContent=name;
  document.title=`${name} — نظام البيع بالتقسيط V3`;
}
function syncUserUI(){
  const name=STORE.user?.name||'—', role=STORE.user?.role==='ADMIN'?'مدير النظام':'مبيعات';
  ['userName','topUserName'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=name});
  ['userRole','topUserRole'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=role});
  ['userInitial','topUserInitial'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=(name||'?').trim().charAt(0)});
  const hint=document.getElementById('adminOnlyHint'); if(hint)hint.style.display=STORE.user?.role==='ADMIN'?'block':'none';
}
function closeMobileSidebar(){document.getElementById('sidebar')?.classList.remove('open');document.getElementById('mobileSidebarBackdrop')?.classList.add('hidden')}
function initShellEvents(){
  const toggle=document.getElementById('sidebarToggle'),side=document.getElementById('sidebar'),back=document.getElementById('mobileSidebarBackdrop');
  if(toggle)toggle.onclick=()=>{side.classList.toggle('open');back.classList.toggle('hidden',!side.classList.contains('open'))};
  if(back)back.onclick=closeMobileSidebar;
  const gs=document.getElementById('globalSearch'),box=document.getElementById('globalSearchResults');
  if(gs&&box){
    let ctrl=null;
    const run=debounce(async()=>{const q=gs.value.trim();const seq=++PERF.searchSeq;if(q.length<3){box.classList.add('hidden');box.innerHTML='';return}if(ctrl)ctrl.abort();ctrl=new AbortController();box.classList.remove('hidden');box.innerHTML='<div class="gs-head">جارٍ البحث...</div>';try{const [cs,is]=await Promise.all([api('searchCustomers',{q},{signal:ctrl.signal}),api('searchInvoices',{q},{signal:ctrl.signal})]);if(seq!==PERF.searchSeq)return;box.innerHTML=`${cs.length?'<div class="gs-head">العملاء</div>'+cs.slice(0,4).map(r=>`<div class="gs-row" data-gc="${esc(r.CUSTOMER_ID)}"><b>${esc(r.NAME)}</b><small>${esc(r.PHONE||r.CUSTOMER_ID)}</small></div>`).join(''):''}${is.length?'<div class="gs-head">الفواتير</div>'+is.slice(0,4).map(r=>`<div class="gs-row" data-gi="${esc(r.INVOICE_ID)}"><b>${esc(r.INVOICE_NO)} — ${esc(r.CUSTOMER_NAME)}</b><small>${esc(r.ITEM_DESC||'')}</small></div>`).join(''):''}${!cs.length&&!is.length?'<div class="gs-head">لا توجد نتائج</div>':''}`;box.querySelectorAll('[data-gc]').forEach(x=>x.onclick=()=>{box.classList.add('hidden');gs.value='';goTo('customers');setTimeout(()=>showCustomerCard(x.dataset.gc),50)});box.querySelectorAll('[data-gi]').forEach(x=>x.onclick=()=>{box.classList.add('hidden');gs.value='';goTo('invoices');setTimeout(()=>showSelectedInvoice(x.dataset.gi),50)});}catch(err){if(seq===PERF.searchSeq&&!ctrl.signal.aborted)box.innerHTML=`<div class="gs-head">${esc(err.message)}</div>`}},210);
    gs.addEventListener('input',run);
    document.addEventListener('click',e=>{if(!e.target.closest('.global-search-wrap'))box.classList.add('hidden')});
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();gs.focus()}if(e.key==='Escape')box.classList.add('hidden')});
  }
}
initShellEvents();applyBrand();
boot();
