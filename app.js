/* ==========================================================
   دفتر — نظام البيع بالتقسيط (واجهة ويب مستقلة)
   الخادم: Google Apps Script Web App — البيانات: Google Sheet نفسه
   ========================================================== */

const STORE = {
  apiUrl: localStorage.getItem('DAFTAR_API_URL') || '',
  token: localStorage.getItem('DAFTAR_TOKEN') || '',
  user: JSON.parse(localStorage.getItem('DAFTAR_USER') || 'null')
};

/* ---------------- عميل الاتصال بالخادم ---------------- */
// نرسل بصيغة text/plain لتفادي طلب OPTIONS المسبق (preflight) الذي لا يدعمه Apps Script.
async function api(action, payload) {
  if (!STORE.apiUrl) throw new Error('لم يتم ربط النظام بالخادم بعد.');
  const body = Object.assign({ action, token: STORE.token }, payload || {});
  let res;
  try {
    res = await fetch(STORE.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error('تعذّر الاتصال بالخادم. تأكد من صحة الرابط ومن نشر التطبيق بصلاحية "Anyone".');
  }
  let json;
  try { json = await res.json(); }
  catch (err) { throw new Error('رد غير متوقع من الخادم.'); }
  if (!json.ok) throw new Error(json.error || 'حدث خطأ غير معروف.');
  return json.data;
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
function fileToPayload(file) {
  return new Promise((resolve,reject)=>{
    if(!file) return resolve(null);
    if(file.size > 3*1024*1024) return reject(new Error('حجم كل مرفق يجب ألا يتجاوز 3 MB.'));
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type||'')) return reject(new Error('المرفقات المسموحة: JPG / PNG / WEBP فقط.'));
    const r=new FileReader();
    r.onload=()=>resolve({name:file.name,mimeType:file.type,base64:String(r.result).split(',')[1]||''});
    r.onerror=()=>reject(new Error('تعذر قراءة الملف.'));
    r.readAsDataURL(file);
  });
}
async function openSecureAttachment(fileId) {
  const d=await api('getCustomerAttachmentData',{fileId});
  const w=window.open('','_blank');
  if(!w) return toast('اسمح بفتح النوافذ المنبثقة لعرض المرفق.','error');
  w.document.write(`<title>${esc(d.name||'مرفق')}</title><style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh}img{max-width:100%;max-height:100vh;object-fit:contain}</style><img src="data:${esc(d.mimeType)};base64,${d.base64}">`);
  w.document.close();
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
  { id: 'dashboard', label: 'لوحة التحكم', icon: 'dashboard' },
  { id: 'customers', label: 'العملاء', icon: 'customers' },
  { id: 'items', label: 'الأصناف', icon: 'items' },
  { id: 'invoices', label: 'الفواتير', icon: 'invoices' },
  { id: 'receipts', label: 'سندات القبض', icon: 'receipts' },
  { id: 'refunds', label: 'الاستردادات', icon: 'receipts' },
  { id: 'statement', label: 'كشف حساب عميل', icon: 'statement' },
  { id: 'reports', label: 'التقارير', icon: 'reports' },
  { id: 'settings', label: 'الإعدادات', icon: 'settings', adminOnly: true },
  { id: 'users', label: 'المستخدمون', icon: 'users', adminOnly: true }
];

let currentRoute = 'dashboard';

function buildSideNav() {
  const nav = document.getElementById('sideNav');
  nav.innerHTML = '';
  NAV.forEach(item => {
    if (item.adminOnly && (!STORE.user || STORE.user.role !== 'ADMIN')) return;
    const div = document.createElement('div');
    div.className = 'nav-item' + (item.id === currentRoute ? ' active' : '');
    div.innerHTML = icon(item.icon) + `<span>${item.label}</span>`;
    div.onclick = () => goTo(item.id);
    nav.appendChild(div);
  });
}

function goTo(routeId) {
  currentRoute = routeId;
  buildSideNav();
  const meta = NAV.find(n => n.id === routeId);
  document.getElementById('pageTitle').textContent = meta ? meta.label : '';
  document.getElementById('topbarActions').innerHTML = '';
  const view = document.getElementById('view');
  view.innerHTML = '<p style="color:var(--text-mute)">جارٍ التحميل...</p>';
  const renderFn = VIEWS[routeId];
  if (renderFn) renderFn(view).catch(err => view.innerHTML = `<div class="panel"><div class="panel-body">${esc(err.message)}</div></div>`);
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
  STORE.token = ''; STORE.user = null;
  localStorage.removeItem('DAFTAR_TOKEN'); localStorage.removeItem('DAFTAR_USER');
  showScreen('loginScreen');
};

function enterApp() {
  document.getElementById('userName').textContent = STORE.user.name;
  document.getElementById('userRole').textContent = STORE.user.role === 'ADMIN' ? 'مدير النظام' : 'مبيعات';
  document.getElementById('userInitial').textContent = (STORE.user.name || '?').trim().charAt(0);
  showScreen('appShell');
  goTo('dashboard');
}

/* ================= الصفحات (Views) ================= */

const VIEWS = {};

/* ---------- لوحة التحكم ---------- */
VIEWS.dashboard = async function(view){
  const d=await api('getWebDashboardData',{});
  view.innerHTML=`
  <div class="page-intro"><div><h3>ملخص النشاط</h3><p>قراءة مباشرة من الفواتير والسندات والأقساط السارية.</p></div><div class="date-chip">${prettyDate(d.date)}</div></div>
  <div class="stat-grid">
    <div class="stat-card"><div class="label">عدد العملاء</div><div class="value num">${d.customers}</div></div>
    <div class="stat-card"><div class="label">الفواتير السارية</div><div class="value num">${d.invoices}</div></div>
    <div class="stat-card accent"><div class="label">إجمالي المبيعات</div><div class="value num">${money(d.totalSales)}</div></div>
    <div class="stat-card good"><div class="label">صافي التحصيل</div><div class="value num">${money(d.netCollected)}</div></div>
    <div class="stat-card warn"><div class="label">إجمالي المتبقي</div><div class="value num">${money(d.totalOutstanding)}</div></div>
    <div class="stat-card good"><div class="label">تحصيل اليوم من السندات</div><div class="value num">${money(d.todayReceipts)}</div></div>
    <div class="stat-card"><div class="label">فواتير اليوم</div><div class="value num">${d.todayInvoices}</div></div>
    <div class="stat-card warn"><div class="label">أقساط متأخرة</div><div class="value num">${d.overdueCount}<small> (${money(d.overdueTotal)})</small></div></div>
    <div class="stat-card"><div class="label">مستحقة قريبًا</div><div class="value num">${d.dueSoonCount}<small> (${money(d.dueSoonTotal)})</small></div></div>
  </div>
  <div class="two-col">
    <div class="panel"><div class="panel-head"><h3>الأقساط المتأخرة</h3></div>${renderTable([
      {label:'الفاتورة',key:'INVOICE_NO'},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الصنف',key:'ITEM_DESC'},
      {label:'الاستحقاق',render:r=>prettyDate(r.DUE_DATE)},{label:'المتبقي',render:r=>`<span class="num">${money(r.BALANCE)}</span>`}
    ],d.overdue,'لا توجد أقساط متأخرة.')}</div>
    <div class="panel"><div class="panel-head"><h3>المستحقة قريبًا</h3></div>${renderTable([
      {label:'الفاتورة',key:'INVOICE_NO'},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الصنف',key:'ITEM_DESC'},
      {label:'الاستحقاق',render:r=>prettyDate(r.DUE_DATE)},{label:'المتبقي',render:r=>`<span class="num">${money(r.BALANCE)}</span>`}
    ],d.dueSoon,'لا توجد أقساط مستحقة قريبًا.')}</div>
  </div>`;
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
  document.getElementById('custFilter').oninput=async e=>{const list=await api('searchCustomers',{q:e.target.value});renderList(list);const sel=document.getElementById('custSelect');sel.innerHTML=selectOptions(list,'CUSTOMER_ID',r=>`${esc(r.NAME)} — ${esc(r.PHONE||r.CUSTOMER_ID)}`,'اختر العميل')};
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
    <div class="form-field"><label>صورة الهوية</label><input id="f_idimg" type="file" accept="image/jpeg,image/png,image/webp"></div>
    <div class="form-field"><label>صورة السند / المستند</label><input id="f_docimg" type="file" accept="image/jpeg,image/png,image/webp"></div>
    <div class="form-field"><label>مرفق آخر</label><input id="f_otherimg" type="file" accept="image/jpeg,image/png,image/webp"></div>
    ${customerId&&isAdmin?`<div class="form-field"><label>الحالة</label><select id="f_status"><option value="ACTIVE" ${c.STATUS==='ACTIVE'?'selected':''}>نشط</option><option value="INACTIVE" ${c.STATUS==='INACTIVE'?'selected':''}>غير نشط</option></select></div>`:''}
    <div class="form-actions"><button class="btn btn-primary" id="f_save">حفظ</button><button class="btn" id="f_cancel">إلغاء</button></div>`);
  document.getElementById('f_cancel').onclick=closeDrawer;
  document.getElementById('f_save').onclick=async(e)=>{const btn=e.target;setLoading(btn,true);try{
    const data={name:f_name.value,nationalId:f_nid.value,phone:f_phone.value,altPhone:f_altphone.value,city:f_city.value,creditLimit:f_credit.value,notes:f_notes.value};
    let id=customerId;if(id){await api('updateCustomer',{customerId:id,data});const st=document.getElementById('f_status');if(st&&st.value!==c.STATUS)await api('setCustomerStatus',{customerId:id,active:st.value==='ACTIVE'});}else{const res=await api('saveCustomer',{data});id=res.id;}
    const uploads=[['IDENTITY',f_idimg.files[0]],['DOCUMENT',f_docimg.files[0]],['OTHER',f_otherimg.files[0]]];
    for(const [type,file] of uploads){if(file){const p=await fileToPayload(file);await api('uploadCustomerAttachment',{customerId:id,type,file:p});}}
    toast('تم حفظ العميل ومرفقاته بنجاح','success');closeDrawer();goTo('customers');setTimeout(()=>showCustomerCard(id),150);
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
 let rows=await api('searchInvoices',{q:''});
 view.innerHTML=`<div class="panel"><div class="panel-head"><h3>بحث وعرض فاتورة</h3></div><div class="toolbar lookup-toolbar"><input class="search-input" id="invSearch" placeholder="رقم الفاتورة / العميل / الصنف"><select id="invSelect" class="wide-select">${selectOptions(rows,'INVOICE_ID',r=>`${esc(r.INVOICE_NO)} — ${esc(r.CUSTOMER_NAME)} — ${esc(r.ITEM_DESC)}`,'اختر الفاتورة')}</select><button class="btn btn-teal" id="invShow">عرض</button><button class="btn btn-danger" id="invCancel" ${STORE.user.role!=='ADMIN'?'disabled':''}>إلغاء الفاتورة</button></div></div><div id="invoiceSelectedCard"></div><div class="panel"><div class="panel-head"><h3>كل الفواتير</h3></div><div id="invTableWrap"></div></div>`;
 const draw=(list)=>{rows=list;invSelect.innerHTML=selectOptions(list,'INVOICE_ID',r=>`${esc(r.INVOICE_NO)} — ${esc(r.CUSTOMER_NAME)} — ${esc(r.ITEM_DESC)}`,'اختر الفاتورة');invTableWrap.innerHTML=renderTable([{label:'رقم الفاتورة',key:'INVOICE_NO'},{label:'التاريخ',render:r=>prettyDate(r.DATE)},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الصنف',key:'ITEM_DESC'},{label:'الإجمالي',render:r=>`<span class="num">${money(r.TOTAL)}</span>`},{label:'الحالة',render:r=>badge(r.STATUS,r.STATUS_LABEL)},{label:'',render:r=>`<button class="btn btn-sm" data-ishow="${esc(r.INVOICE_ID)}">عرض</button>`}],list,'لا توجد فواتير.');document.querySelectorAll('[data-ishow]').forEach(b=>b.onclick=()=>{invSelect.value=b.dataset.ishow;showSelectedInvoice(b.dataset.ishow)})};
 draw(rows);invSearch.oninput=async e=>draw(await api('searchInvoices',{q:e.target.value}));invShow.onclick=()=>{if(!invSelect.value)return toast('اختر الفاتورة ثم اضغط عرض.','error');showSelectedInvoice(invSelect.value)};invCancel.onclick=()=>cancelSelectedInvoice();btnNewInvoice.onclick=openNewInvoiceDrawer;
};
async function showSelectedInvoice(id){await openInvoiceDetail(id,true)}
async function cancelSelectedInvoice(){const id=document.getElementById('invSelect')?.value;if(!id)return toast('اختر الفاتورة المطلوب إلغاؤها أولًا.','error');const info=await api('getInvoiceCancellationInfo',{invoiceId:id});if(!info.canCancel)return toast(`يوجد ${money(info.unresolved)} ريال يجب عكسه أو استرداده قبل إلغاء الفاتورة.`,'error');const reason=prompt('اكتب سبب إلغاء الفاتورة:');if(!reason)return;await api('cancelInvoice',{invoiceId:id,reason});toast('تم إلغاء الفاتورة','success');goTo('invoices')}

function searchPicker(inputEl, resultsEl, searchFn, renderLabel, onPick) {
  let timer;
  inputEl.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = inputEl.value.trim();
      if (!q) { resultsEl.innerHTML = ''; return; }
      const rows = await searchFn(q);
      resultsEl.innerHTML = rows.slice(0, 8).map((r, i) => `<div class="pick-row" data-i="${i}">${renderLabel(r)}</div>`).join('');
      resultsEl.querySelectorAll('.pick-row').forEach(el => el.onclick = () => { onPick(rows[Number(el.dataset.i)]); resultsEl.innerHTML = ''; });
    }, 220);
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

  searchPicker(document.getElementById('f_custq'), document.getElementById('f_custResults'),
    q => api('searchCustomers', { q }), r => `${esc(r.NAME)} — ${esc(r.PHONE || '')}`,
    r => { picked.customer = r; document.getElementById('f_custPicked').textContent = 'المختار: ' + r.NAME; document.getElementById('f_custq').value = ''; });

  searchPicker(document.getElementById('f_itemq'), document.getElementById('f_itemResults'),
    q => api('searchItems', { q }), r => `${esc(r.NAME)} — ${esc(r.CATEGORY)} — ${money(r.SALE_PRICE)}`,
    r => {
      picked.item = r;
      document.getElementById('f_itemPicked').textContent = 'المختار: ' + r.NAME;
      document.getElementById('f_itemq').value = '';
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
 let rows=await api('searchReceipts',{q:''});
 view.innerHTML=`<div class="panel"><div class="panel-head"><h3>سندات القبض</h3></div><div class="toolbar lookup-toolbar"><input class="search-input" id="recSearch" placeholder="السند / العميل / الفاتورة"><select id="recSelect" class="wide-select">${selectOptions(rows,'RECEIPT_ID',r=>`${esc(r.RECEIPT_NO)} — ${esc(r.CUSTOMER_NAME)} — ${money(r.AMOUNT)}`,'اختر سند القبض')}</select><button class="btn btn-teal" id="recShow">عرض</button></div></div><div id="recTableWrap" class="panel"></div>`;
 const draw=list=>{rows=list;recSelect.innerHTML=selectOptions(list,'RECEIPT_ID',r=>`${esc(r.RECEIPT_NO)} — ${esc(r.CUSTOMER_NAME)} — ${money(r.AMOUNT)}`,'اختر سند القبض');recTableWrap.innerHTML=renderTable([{label:'السند',key:'RECEIPT_NO'},{label:'التاريخ',render:r=>prettyDate(r.DATE)},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الفاتورة',key:'INVOICE_NO'},{label:'المبلغ',render:r=>`<span class="num">${money(r.AMOUNT)}</span>`},{label:'الحالة',render:r=>badge(r.STATUS||'ACTIVE',r.STATUS==='REVERSED'?'معكوس':'ساري')},{label:'',render:r=>`<button class="btn btn-sm" data-rshow="${esc(r.RECEIPT_ID)}">عرض</button>`}],list,'لا توجد سندات.');document.querySelectorAll('[data-rshow]').forEach(b=>b.onclick=()=>openReceiptDrawer(b.dataset.rshow,null))};draw(rows);recSearch.oninput=async e=>draw(await api('searchReceipts',{q:e.target.value}));recShow.onclick=()=>{if(!recSelect.value)return toast('اختر السند أولًا.','error');openReceiptDrawer(recSelect.value,null)};btnNewReceipt.onclick=()=>openReceiptDrawer(null,null);
};
async function openReceiptDrawer(receiptId,presetInvoice){
 let invoiceInfo=null,r={AMOUNT:'',PAYMENT_METHOD:'نقدي',REFERENCE_NO:'',NOTES:'',STATUS:'ACTIVE'};if(receiptId){r=await api('getReceiptForEdit',{receiptId});invoiceInfo=r.invoice}else if(presetInvoice)invoiceInfo=await api('getInvoicePaymentInfo',{invoiceId:presetInvoice.INVOICE_ID});const reversed=String(r.STATUS||'ACTIVE')==='REVERSED';
 openDrawer(receiptId?`سند القبض ${r.RECEIPT_NO}`:'سند قبض جديد',`<div class="form-field"><label>الفاتورة *</label><input id="f_invq" placeholder="ابحث بالفاتورة أو العميل" ${invoiceInfo?'style="display:none"':''}><div id="f_invResults" class="pick-results"></div><div id="f_invPicked" class="form-help">${invoiceInfo?`الفاتورة ${esc(invoiceInfo.INVOICE_NO)} — ${esc(invoiceInfo.CUSTOMER_NAME)} — المتاح: <span class="num">${money(invoiceInfo.BALANCE_AVAILABLE)}</span>`:''}</div></div><div class="form-field"><label>المبلغ *</label><input id="f_amount" inputmode="decimal" value="${r.AMOUNT||''}" ${reversed?'disabled':''}></div><div class="form-help" id="f_remainPreview"></div><div class="form-field"><label>طريقة الدفع</label><select id="f_method" ${reversed?'disabled':''}><option ${r.PAYMENT_METHOD==='نقدي'?'selected':''}>نقدي</option><option ${r.PAYMENT_METHOD==='تحويل بنكي'?'selected':''}>تحويل بنكي</option><option ${r.PAYMENT_METHOD==='شبكة'?'selected':''}>شبكة</option><option ${r.PAYMENT_METHOD==='شيك'?'selected':''}>شيك</option></select></div><div class="form-field"><label>المرجع</label><input id="f_ref" value="${esc(r.REFERENCE_NO)}" ${reversed?'disabled':''}></div><div class="form-field"><label>ملاحظات</label><textarea id="f_notes" ${reversed?'disabled':''}>${esc(r.NOTES)}</textarea></div>${reversed?`<div class="alert danger">هذا السند معكوس. ${esc(r.REVERSE_REASON||'')}</div>`:''}<div class="form-actions">${!reversed?`<button class="btn btn-primary" id="f_save">حفظ</button>`:''}${receiptId&&!reversed&&STORE.user.role==='ADMIN'?`<button class="btn btn-danger" id="f_reverse">عكس سند القبض</button>`:''}<button class="btn" id="f_cancel">إغلاق</button></div>${r.PDF_URL?`<a class="btn-link" target="_blank" href="${esc(r.PDF_URL)}">فتح PDF</a>`:''}`);
 if(!invoiceInfo){searchPicker(f_invq,f_invResults,q=>api('searchInvoices',{q}),x=>`${esc(x.INVOICE_NO)} — ${esc(x.CUSTOMER_NAME)} — ${esc(x.ITEM_DESC)}`,async x=>{invoiceInfo=await api('getInvoicePaymentInfo',{invoiceId:x.INVOICE_ID});f_invPicked.innerHTML=`الفاتورة ${esc(invoiceInfo.INVOICE_NO)} — ${esc(invoiceInfo.CUSTOMER_NAME)} — المتاح: <span class="num">${money(invoiceInfo.BALANCE_AVAILABLE)}</span>`;f_invq.value=''})}
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
VIEWS.statement=async function(view){const rows=await api('searchCustomers',{q:''});view.innerHTML=`<div class="panel"><div class="panel-head"><h3>كشف حساب العميل</h3></div><div class="toolbar lookup-toolbar"><input class="search-input" id="stSearch" placeholder="بحث بالاسم / الجوال"><select id="stSelect" class="wide-select">${selectOptions(rows,'CUSTOMER_ID',r=>`${esc(r.NAME)} — ${esc(r.PHONE||r.CUSTOMER_ID)}`,'اختر العميل')}</select><button class="btn btn-teal" id="stShow">عرض</button></div></div><div id="stResult"></div>`;stSearch.oninput=async e=>{const list=await api('searchCustomers',{q:e.target.value});stSelect.innerHTML=selectOptions(list,'CUSTOMER_ID',r=>`${esc(r.NAME)} — ${esc(r.PHONE||r.CUSTOMER_ID)}`,'اختر العميل')};stShow.onclick=()=>{if(!stSelect.value)return toast('اختر العميل ثم اضغط عرض.','error');loadStatementCustomer(stSelect.value)}};
async function loadStatementCustomer(customerId){const sel=document.getElementById('stSelect');if(sel)sel.value=customerId;const [st,c]=await Promise.all([api('getCustomerStatement',{customerId}),api('getCustomerForView',{customerId})]);document.getElementById('stResult').innerHTML=`<div class="page-intro"><div><h3>${esc(c.NAME)}</h3><p>${esc(c.PHONE||'')} — ${esc(c.CITY||'')}</p></div><button class="btn" id="btnStPdf">تصدير PDF</button></div><div class="stat-grid"><div class="stat-card"><div class="label">إجمالي الفواتير</div><div class="value num">${money(st.totals.totalInvoices)}</div></div><div class="stat-card good"><div class="label">إجمالي المحصل</div><div class="value num">${money(st.totals.totalPaid)}</div></div><div class="stat-card"><div class="label">الخصومات</div><div class="value num">${money(st.totals.totalDiscounts)}</div></div><div class="stat-card warn"><div class="label">الرصيد</div><div class="value num">${money(st.totals.outstanding)}</div></div></div><div class="panel"><div class="panel-head"><h3>حركة الحساب</h3></div>${renderTable([{label:'التاريخ',render:x=>prettyDate(x.date)},{label:'النوع',key:'typeLabel'},{label:'المرجع',key:'refNo'},{label:'البيان',key:'description'},{label:'مدين',render:x=>x.debit?`<span class="num">${money(x.debit)}</span>`:''},{label:'دائن',render:x=>x.credit?`<span class="num">${money(x.credit)}</span>`:''},{label:'الرصيد',render:x=>`<span class="num">${money(x.balance)}</span>`}],st.rows,'لا توجد حركات.')}</div>`;btnStPdf.onclick=async()=>{const pdf=await api('createCustomerStatementPdf',{customerId});window.open(pdf.url,'_blank')}}

/* ---------- التقارير ---------- */
VIEWS.reports=async function(view){view.innerHTML=`<div class="panel"><div class="panel-head"><h3>مركز التقارير</h3><span class="muted">تقرير موحد بدل الصفحات المتفرقة</span></div><div class="toolbar"><div class="form-field compact"><label>من</label><input type="date" id="rpFrom" value="${monthStartStr()}"></div><div class="form-field compact"><label>إلى</label><input type="date" id="rpTo" value="${todayStr()}"></div><button class="btn btn-primary" id="rpGo">تحديث التقرير</button></div></div><div id="rpResult"></div>`;rpGo.onclick=runWebReport;await runWebReport()}
async function runWebReport(){const box=document.getElementById('rpResult');box.innerHTML='<div class="panel"><div class="panel-body">جارٍ تحليل البيانات...</div></div>';try{const d=await api('getWebReportData',{fromDate:rpFrom.value,toDate:rpTo.value});box.innerHTML=`<div class="page-intro"><div><h3>الفترة: ${prettyDate(d.fromDate)} — ${prettyDate(d.toDate)}</h3><p>الحسابات تعتمد على المستندات السارية مع خصم الاستردادات وعكس السندات.</p></div></div><div class="stat-grid"><div class="stat-card"><div class="label">عدد الفواتير</div><div class="value num">${d.invoiceCount}</div></div><div class="stat-card accent"><div class="label">المبيعات</div><div class="value num">${money(d.sales)}</div></div><div class="stat-card good"><div class="label">سندات القبض</div><div class="value num">${money(d.receipts)}</div></div><div class="stat-card"><div class="label">الاستردادات</div><div class="value num">${money(d.refunds)}</div></div><div class="stat-card good"><div class="label">صافي التحصيل</div><div class="value num">${money(d.netCollection)}</div></div><div class="stat-card warn"><div class="label">الرصيد الحالي لفواتير الفترة</div><div class="value num">${money(d.currentOutstanding)}</div></div><div class="stat-card"><div class="label">الأقساط المتأخرة</div><div class="value num">${d.overdueCount}</div></div><div class="stat-card"><div class="label">المستحقة قريبًا</div><div class="value num">${d.dueSoonCount}</div></div></div>
 <div class="two-col"><div class="panel"><div class="panel-head"><h3>التحصيل حسب طريقة الدفع</h3></div>${renderTable([{label:'الطريقة',key:'method'},{label:'القبض',render:r=>`<span class="num">${money(r.receipts)}</span>`},{label:'الاسترداد',render:r=>`<span class="num">${money(r.refunds)}</span>`},{label:'الصافي',render:r=>`<span class="num">${money(r.net)}</span>`}],d.byMethod,'لا توجد حركات.')}</div><div class="panel"><div class="panel-head"><h3>المبيعات حسب الفئة</h3></div>${renderTable([{label:'الفئة',key:'category'},{label:'العدد',key:'count'},{label:'المبيعات',render:r=>`<span class="num">${money(r.sales)}</span>`}],d.byCategory,'لا توجد مبيعات.')}</div></div>
 <div class="panel"><div class="panel-head"><h3>الفواتير ضمن الفترة</h3></div>${renderTable([{label:'الفاتورة',key:'INVOICE_NO'},{label:'التاريخ',render:r=>prettyDate(r.DATE)},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الصنف',key:'ITEM_DESC'},{label:'الإجمالي',render:r=>`<span class="num">${money(r.TOTAL)}</span>`},{label:'المحصل الصافي',render:r=>`<span class="num">${money(r.NET_COLLECTED)}</span>`},{label:'المتبقي',render:r=>`<span class="num">${money(r.BALANCE)}</span>`}],d.invoices,'لا توجد فواتير في الفترة.')}</div>
 <div class="panel"><div class="panel-head"><h3>السندات ضمن الفترة</h3></div>${renderTable([{label:'السند',key:'RECEIPT_NO'},{label:'التاريخ',render:r=>prettyDate(r.DATE)},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الفاتورة',key:'INVOICE_NO'},{label:'المبلغ',render:r=>`<span class="num">${money(r.AMOUNT)}</span>`},{label:'الطريقة',key:'PAYMENT_METHOD'}],d.receiptRows,'لا توجد سندات في الفترة.')}</div>
 <div class="panel"><div class="panel-head"><h3>الأقساط المتأخرة والمستحقة قريبًا</h3></div>${renderTable([{label:'الحالة',key:'DUE_LABEL'},{label:'الفاتورة',key:'INVOICE_NO'},{label:'العميل',key:'CUSTOMER_NAME'},{label:'الصنف',key:'ITEM_DESC'},{label:'الاستحقاق',render:r=>prettyDate(r.DUE_DATE)},{label:'المتبقي',render:r=>`<span class="num">${money(r.BALANCE)}</span>`}],d.installments,'لا توجد أقساط مطلوبة.')}</div>`}catch(err){box.innerHTML=`<div class="alert danger">${esc(err.message)}</div>`}}

/* ---------- الإعدادات ---------- */
VIEWS.settings = async function (view) {
  const s = await api('getPublicSettings', {});
  const fields = [
    ['COMPANY_NAME', 'اسم المنشأة'], ['COMPANY_ADDRESS', 'العنوان'], ['COMPANY_PHONE', 'هاتف المنشأة'],
    ['VAT_NUMBER', 'الرقم الضريبي'], ['COMMERCIAL_REG', 'السجل التجاري'], ['TAX_RATE', 'نسبة الضريبة الافتراضية %'],
    ['CURRENCY', 'العملة'], ['DUE_SOON_DAYS', 'عدد أيام "مستحق قريبًا"'], ['ITEM_CATEGORIES', 'فئات الأصناف (مفصولة بفاصلة)']
  ];
  view.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>بيانات المنشأة والإعدادات العامة</h3></div>
      <div class="panel-body">
        ${fields.map(([key, label]) => `<div class="form-field"><label>${label}</label><input data-key="${key}" value="${esc(s[key] || '')}"></div>`).join('')}
        <button class="btn btn-primary" id="btnSaveSettings">حفظ الإعدادات</button>
      </div>
    </div>`;
  document.getElementById('btnSaveSettings').onclick = async (e) => {
    const obj = {};
    document.querySelectorAll('[data-key]').forEach(el => obj[el.dataset.key] = el.value);
    setLoading(e.target, true);
    try { await api('saveSettings', { obj }); toast('تم حفظ الإعدادات', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    setLoading(e.target, false);
  };
};

/* ---------- المستخدمون ---------- */
VIEWS.users = async function (view) {
  document.getElementById('topbarActions').innerHTML = `<button class="btn btn-primary" id="btnNewUser">${icon('plus')} مستخدم جديد</button>`;
  const load = async () => {
    const rows = await api('listUsers', {});
    view.innerHTML = `<div class="panel">${renderTable([
      { label: 'البريد', key: 'EMAIL' }, { label: 'الاسم', key: 'NAME' },
      { label: 'الصلاحية', render: r => r.ROLE === 'ADMIN' ? 'مدير النظام' : 'مبيعات' },
      { label: 'الحالة', render: r => badge(r.ACTIVE ? 'ACTIVE' : 'INACTIVE', r.ACTIVE ? 'مفعّل' : 'معطّل') },
      { label: '', render: r => `<button class="btn btn-sm" data-toggle="${esc(r.EMAIL)}" data-active="${r.ACTIVE ? 1 : 0}">${r.ACTIVE ? 'تعطيل' : 'تفعيل'}</button>` }
    ], rows, 'لا يوجد مستخدمون إضافيون بعد.')}</div>`;
    document.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      try { await api('setUserActive', { email: b.dataset.toggle, active: b.dataset.active === '0' }); load(); }
      catch (err) { toast(err.message, 'error'); }
    });
  };
  document.getElementById('btnNewUser').onclick = () => {
    openDrawer('مستخدم جديد', `
      <div class="form-field"><label>البريد الإلكتروني *</label><input id="f_email" type="email"></div>
      <div class="form-field"><label>الاسم</label><input id="f_uname"></div>
      <div class="form-field"><label>الصلاحية</label>
        <select id="f_role"><option value="SALES">مبيعات</option><option value="ADMIN">مدير النظام</option></select></div>
      <div class="form-field"><label>كلمة المرور المبدئية *</label><input id="f_upass" type="password"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="f_save">إنشاء</button>
        <button class="btn" id="f_cancel">إلغاء</button>
      </div>`);
    document.getElementById('f_cancel').onclick = closeDrawer;
    document.getElementById('f_save').onclick = async (e) => {
      setLoading(e.target, true);
      try {
        await api('createUser', {
          email: document.getElementById('f_email').value, name: document.getElementById('f_uname').value,
          role: document.getElementById('f_role').value, password: document.getElementById('f_upass').value
        });
        toast('تم إنشاء المستخدم', 'success');
        closeDrawer();
        load();
      } catch (err) { toast(err.message, 'error'); }
      setLoading(e.target, false);
    };
  };
  await load();
};

boot();
