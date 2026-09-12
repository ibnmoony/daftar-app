/* ==========================================================
   دفتر — نظام البيع بالتقسيط (واجهة ويب مستقلة)
   الخادم: Google Apps Script Web App — البيانات: Google Sheet نفسه
   ========================================================== */

const STORE = {
  user: null
};

/* ---------------- عميل الاتصال بالخادم ---------------- */
// نفس الأصل (Same-Origin): الواجهة والخادم على نفس الدومين على Vercel،
// والجلسة تُدار عبر كوكي httpOnly آمن (لا حاجة لتخزين أي توكن يدويًا).
async function api(action, payload) {
  const body = Object.assign({ action }, payload || {});
  let res;
  try {
    res = await fetch('/api/action', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error('تعذّر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مجددًا.');
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
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthStartStr() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }

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
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m14.5 4.5 5 5L8 21H3v-5L14.5 4.5Z"/></svg>',
  expenses: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="7" cy="14.5" r="1.1" fill="currentColor" stroke="none"/></svg>',
  refunds: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 12a8 8 0 1 0 3-6.3"/><path d="M4 3v5h5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>',
  profit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17l6-6 4 4 8-9"/><path d="M15 6h6v6"/></svg>'
};
function icon(name) { return ICONS[name] || ''; }

/* ---------------- تعريف التنقل ---------------- */
const NAV = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: 'dashboard', sub: 'نظرة عامة وإحصائيات' },
  { id: 'customers', label: 'العملاء', icon: 'customers', sub: 'إضافة وتعديل ومتابعة' },
  { id: 'items', label: 'الأصناف', icon: 'items', sub: 'إدارة المنتجات' },
  { id: 'invoices', label: 'الفواتير', icon: 'invoices', sub: 'إنشاء ومتابعة' },
  { id: 'receipts', label: 'سند قبض', icon: 'receipts', sub: 'تسجيل المدفوعات' },
  { id: 'discounts', label: 'الخصومات', icon: 'discounts', sub: 'تطبيق الخصومات' },
  { id: 'expenses', label: 'المصروفات', icon: 'expenses', sub: 'إدارة المصروفات والنفقات' },
  { id: 'refunds', label: 'سند استرداد', icon: 'refunds', sub: 'إدارة المرتجعات' },
  { id: 'statement', label: 'كشف حساب عميل', icon: 'statement', sub: 'عرض معاملات العميل' },
  { id: 'reports', label: 'مركز التقارير', icon: 'reports', sub: 'التقارير والإحصاءات' },
  { id: 'settings', label: 'الإعدادات', icon: 'settings', sub: 'إعدادات المنشأة', adminOnly: true },
  { id: 'users', label: 'المستخدمون', icon: 'users', sub: 'صلاحيات الفريق', adminOnly: true }
];

let currentRoute = 'dashboard';

function buildSideNav() {
  const nav = document.getElementById('sideNav');
  nav.innerHTML = '';
  NAV.forEach(item => {
    if (item.adminOnly && (!STORE.user || STORE.user.role !== 'ADMIN')) return;
    const div = document.createElement('div');
    div.className = 'nav-item' + (item.id === currentRoute ? ' active' : '');
    div.innerHTML = icon(item.icon) + `<span class="nav-texts"><span>${item.label}</span><span class="nav-sub">${item.sub || ''}</span></span>`;
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
  refreshBellBadge();
  const view = document.getElementById('view');
  view.innerHTML = '<p style="color:var(--text-mute)">جارٍ التحميل...</p>';
  const renderFn = VIEWS[routeId];
  if (renderFn) renderFn(view).catch(err => view.innerHTML = `<div class="panel"><div class="panel-body">${esc(err.message)}</div></div>`);
}

let _bellCache = null, _bellCacheAt = 0;
async function refreshBellBadge() {
  try {
    // كاش خفيف من طرف الواجهة (30 ثانية) لتفادي تكرار نفس الاستدعاء أثناء التنقل السريع بين الصفحات.
    if (!_bellCache || Date.now() - _bellCacheAt > 30000) {
      _bellCache = await api('getDashboardData', {});
      _bellCacheAt = Date.now();
    }
    const dot = document.getElementById('bellDot');
    if (!dot) return;
    const count = _bellCache.overdueCount || 0;
    if (count > 0) { dot.textContent = count > 99 ? '99+' : count; dot.classList.remove('hidden'); }
    else dot.classList.add('hidden');
  } catch (err) { /* تجاهل بصمت — التنبيه ليس عملية حرجة */ }
}

/* بحث عام سريع في التوب بار: يبحث في العملاء والفواتير معًا ويعرض نتائج قابلة للنقر */
function wireGlobalSearch() {
  const input = document.getElementById('globalSearch');
  if (!input || input._wired) return;
  input._wired = true;
  let timer, box;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (box) { box.remove(); box = null; }
    if (!q) return;
    timer = setTimeout(async () => {
      const [custs, invs] = await Promise.all([api('searchCustomers', { q }), api('searchInvoices', { q })]);
      if (box) box.remove();
      box = document.createElement('div');
      box.className = 'pick-results';
      box.style.position = 'absolute';
      box.style.zIndex = '30';
      box.style.width = input.offsetWidth + 'px';
      const items = [
        ...custs.slice(0, 4).map(c => ({ label: '👤 ' + c.NAME + ' — ' + (c.PHONE || ''), go: () => { goTo('customers'); } })),
        ...invs.slice(0, 4).map(i => ({ label: '🧾 ' + i.INVOICE_NO + ' — ' + i.CUSTOMER_NAME, go: () => { goTo('invoices'); setTimeout(() => openInvoiceDetail(i.INVOICE_ID), 250); } }))
      ];
      if (!items.length) { box.innerHTML = `<div class="pick-row">لا توجد نتائج</div>`; }
      else box.innerHTML = items.map((it, i) => `<div class="pick-row" data-i="${i}">${esc(it.label)}</div>`).join('');
      box.querySelectorAll('.pick-row').forEach((el, i) => el.onclick = () => { items[i] && items[i].go(); box.remove(); box = null; input.value = ''; });
      input.parentElement.appendChild(box);
    }, 250);
  });
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
  ['setupScreen', 'loginScreen', 'appShell'].forEach(s => document.getElementById(s).classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

async function boot() {
  try {
    const setup = await api('checkSetup', {});
    if (setup.needsSetup) { showScreen('setupScreen'); return; }
  } catch (err) {
    toast(err.message, 'error');
    showScreen('loginScreen');
    return;
  }
  try { await api('me', {}); enterApp(); return; }
  catch (err) { showScreen('loginScreen'); }
}

document.getElementById('btnCreateAdmin').onclick = async (e) => {
  const btn = e.target;
  const email = document.getElementById('setupEmail').value.trim();
  const name = document.getElementById('setupName').value.trim();
  const password = document.getElementById('setupPassword').value;
  setLoading(btn, true, 'جارٍ الإنشاء...');
  try {
    STORE.user = await api('createFirstAdmin', { email, name, password });
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
    STORE.user = await api('login', { email, password });
    enterApp();
  } catch (err) { document.getElementById('loginError').textContent = err.message; }
  setLoading(btn, false);
};

document.getElementById('btnLogout').onclick = async () => {
  try { await api('logout', {}); } catch (err) { /* تجاهل */ }
  STORE.user = null;
  showScreen('loginScreen');
};

function enterApp() {
  document.getElementById('userName').textContent = STORE.user.name;
  document.getElementById('userRole').textContent = STORE.user.role === 'ADMIN' ? 'مدير النظام' : 'مبيعات';
  document.getElementById('userInitial').textContent = (STORE.user.name || '?').trim().charAt(0);
  document.getElementById('bellIconSlot').innerHTML = icon('bell');
  document.getElementById('btnBell').onclick = () => goTo('dashboard');
  wireGlobalSearch();
  showScreen('appShell');
  goTo('dashboard');
}

/* ---------------- طباعة (بديل PDF محفوظ على درايف) ---------------- */
function printDoc(title, bodyHtml) {
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
    <title>${esc(title)}</title>
    <style>
      body{font-family:'Tajawal',sans-serif;padding:32px;color:#1D2733;}
      h1{font-size:20px;margin-bottom:4px;}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13.5px;}
      th,td{border:1px solid #DCD3C0;padding:8px 10px;text-align:right;}
      th{background:#F6F1E7;}
      .kv{margin:14px 0;font-size:14px;}
      .kv b{display:inline-block;min-width:110px;}
      @media print{ body{padding:0;} }
    </style></head><body>${bodyHtml}
    <script>window.onload = () => window.print();</script>
    </body></html>`);
  win.document.close();
}

const VIEWS = {};

/* ---------- لوحة التحكم ---------- */
/* ---------- رسم بياني خطي بسيط (SVG) بدون أي مكتبة خارجية ---------- */
function lineChartSVG(series) {
  const w = 560, h = 220, padL = 40, padR = 10, padT = 14, padB = 26;
  const maxVal = Math.max(1, ...series.map(p => Math.max(p.sales, p.collections)));
  const stepX = (w - padL - padR) / Math.max(1, series.length - 1);
  const toXY = (v, i) => [padL + i * stepX, h - padB - (v / maxVal) * (h - padT - padB)];
  const pathOf = key => series.map((p, i) => toXY(p[key], i)).map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
  const areaOf = key => pathOf(key) + ` L${(padL + (series.length - 1) * stepX).toFixed(1)},${h - padB} L${padL},${h - padB} Z`;
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = h - padB - f * (h - padT - padB);
    return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#EEF1F6" stroke-width="1"/>`;
  }).join('');
  const labels = series.map((p, i) => {
    const [x] = toXY(0, i);
    const label = p.date.slice(5).replace('-', '/');
    return `<text x="${x}" y="${h - 6}" font-size="10" fill="#7B8A9A" text-anchor="middle">${label}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">
    ${gridLines}
    <path d="${areaOf('sales')}" fill="#2F6FED" opacity="0.08"/>
    <path d="${pathOf('sales')}" fill="none" stroke="#2F6FED" stroke-width="2.5"/>
    <path d="${pathOf('collections')}" fill="none" stroke="#14B8A6" stroke-width="2.5"/>
    ${series.map((p, i) => { const [x1, y1] = toXY(p.sales, i); const [x2, y2] = toXY(p.collections, i);
      return `<circle cx="${x1}" cy="${y1}" r="3" fill="#2F6FED"/><circle cx="${x2}" cy="${y2}" r="3" fill="#14B8A6"/>`; }).join('')}
    ${labels}
  </svg>`;
}

/* ---------- لوحة التحكم ---------- */
VIEWS.dashboard = async function (view) {
  view.innerHTML = `<p style="color:var(--text-mute);padding:20px 0">جارٍ تحميل البيانات...</p>`;
  const d = await api('getDashboardData', {});
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'صباح الخير' : (hour < 17 ? 'مساء الخير' : 'مساء الخير');

  view.innerHTML = `
    <div class="welcome-banner">
      <div>
        <h2>${greeting}، ${esc(STORE.user.name)} 👋</h2>
        <p>كل شيء تحت السيطرة — إليك ملخص أداء اليوم.</p>
      </div>
      <div class="emoji">📊</div>
    </div>

    <div class="stat-grid">
      <div class="stat-card accent">
        <div class="icon-badge">${icon('profit')}</div>
        <div class="label">الأرباح (تقديري)</div>
        <div class="value num">${money(d.totalProfit)}</div>
      </div>
      <div class="stat-card warn">
        <div class="icon-badge">${icon('expenses')}</div>
        <div class="label">المصروفات</div>
        <div class="value num">${money(d.totalExpenses)}</div>
      </div>
      <div class="stat-card teal">
        <div class="icon-badge">${icon('receipts')}</div>
        <div class="label">إجمالي التحصيل</div>
        <div class="value num">${money(d.totalCollected)}</div>
      </div>
      <div class="stat-card purple">
        <div class="icon-badge">${icon('invoices')}</div>
        <div class="label">الفواتير</div>
        <div class="value num">${d.invoices}</div>
      </div>
      <div class="stat-card good">
        <div class="icon-badge">${icon('customers')}</div>
        <div class="label">عدد العملاء</div>
        <div class="value num">${d.customers}</div>
      </div>
    </div>

    <div class="chart-row">
      <div>
        <div class="panel">
          <div class="panel-head"><h3>مبيعات وتحصيلات آخر 7 أيام</h3>
            <div style="display:flex;gap:14px;font-size:12px;color:var(--text-mute)">
              <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#2F6FED;margin-left:5px"></span>مبيعات</span>
              <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#14B8A6;margin-left:5px"></span>تحصيلات</span>
            </div>
          </div>
          <div class="panel-body">${lineChartSVG(d.series)}</div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>الدفعات القادمة</h3></div>
          ${renderTable([
            { label: 'العميل', key: 'CUSTOMER_NAME' }, { label: 'قسط رقم', key: 'NO' },
            { label: 'تاريخ الاستحقاق', key: 'DUE_DATE' },
            { label: 'القيمة', render: r => `<span class="num">${money(r.BALANCE)}</span>` }
          ], d.upcoming, 'لا توجد دفعات مستحقة قريبًا.')}
        </div>
      </div>

      <div>
        <div class="panel">
          <div class="panel-head"><h3>آخر الفواتير</h3></div>
          ${renderTable([
            { label: 'رقم الفاتورة', key: 'INVOICE_NO' }, { label: 'التاريخ', key: 'DATE' },
            { label: 'العميل', key: 'CUSTOMER_NAME' },
            { label: 'القيمة', render: r => `<span class="num">${money(r.TOTAL)}</span>` },
            { label: 'الحالة', render: r => badge(r.STATUS, r.STATUS_LABEL) }
          ], d.latestInvoices, 'لا توجد فواتير بعد.')}
        </div>

        <div class="cta-banner">
          <div>
            <h3>عملاء أكثر .. فرص أكبر</h3>
            <p>تابع العملاء، احصل على التحصيلات في وقتها، ونمِّ أعمالك.</p>
            <button class="btn btn-primary" style="margin-top:12px" onclick="goTo('customers')">إدارة العملاء الآن</button>
          </div>
          <div class="cta-icon">${icon('target')}</div>
        </div>
      </div>
    </div>

    <div class="stat-grid" style="margin-top:4px">
      <div class="stat-card warn">
        <div class="icon-badge">${icon('reports')}</div>
        <div class="label">أقساط متأخرة</div>
        <div class="value num">${d.overdueCount} <span class="delta down">(${money(d.overdueTotal)})</span></div>
      </div>
      <div class="stat-card amber">
        <div class="icon-badge">${icon('statement')}</div>
        <div class="label">مستحقة قريبًا</div>
        <div class="value num">${d.dueSoonCount} <span class="delta">(${money(d.dueSoonTotal)})</span></div>
      </div>
      <div class="stat-card">
        <div class="icon-badge" style="background:#EEF1F6;color:var(--text-mute)">${icon('receipts')}</div>
        <div class="label">تحصيل اليوم</div>
        <div class="value num">${money(d.todayReceipts)}</div>
      </div>
      <div class="stat-card">
        <div class="icon-badge" style="background:#EEF1F6;color:var(--text-mute)">${icon('invoices')}</div>
        <div class="label">فواتير اليوم</div>
        <div class="value num">${d.todayInvoices}</div>
      </div>
    </div>`;
};

/* ---------- العملاء ---------- */
VIEWS.customers = async function (view) {
  document.getElementById('topbarActions').innerHTML = `<button class="btn btn-primary" id="btnNewCustomer">${icon('plus')} إضافة عميل</button>`;
  view.innerHTML = `
    <div class="panel">
      <div class="toolbar"><input class="search-input" id="custSearch" placeholder="ابحث بالاسم / الهاتف / رقم الهوية..."></div>
      <div id="custTableWrap"></div>
    </div>`;
  const load = async (q) => {
    const rows = await api('searchCustomers', { q: q || '' });
    document.getElementById('custTableWrap').innerHTML = renderTable([
      { label: 'الكود', key: 'CUSTOMER_ID' }, { label: 'الاسم', key: 'NAME' }, { label: 'الهاتف', key: 'PHONE' },
      { label: 'المدينة', key: 'CITY' }, { label: 'الحالة', render: r => badge(r.STATUS, r.STATUS_LABEL) },
      { label: '', render: r => `<button class="btn btn-sm" data-edit="${esc(r.CUSTOMER_ID)}">${icon('edit')} تعديل</button>` }
    ], rows, 'لا يوجد عملاء بعد.');
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openCustomerDrawer(b.dataset.edit));
  };
  document.getElementById('custSearch').addEventListener('input', e => load(e.target.value));
  document.getElementById('btnNewCustomer').onclick = () => openCustomerDrawer(null);
  await load('');
};

async function openCustomerDrawer(customerId) {
  let c = { NAME: '', NATIONAL_ID: '', PHONE: '', ALT_PHONE: '', CITY: '', CREDIT_LIMIT: 0, NOTES: '', STATUS: 'ACTIVE' };
  if (customerId) c = await api('getCustomerForView', { customerId });
  const isAdmin = STORE.user.role === 'ADMIN';
  openDrawer(customerId ? 'تعديل بيانات العميل' : 'إضافة عميل جديد', `
    <div class="form-field"><label>الاسم *</label><input id="f_name" value="${esc(c.NAME)}"></div>
    <div class="form-row">
      <div class="form-field"><label>رقم الهوية</label><input id="f_nid" value="${esc(c.NATIONAL_ID)}"></div>
      <div class="form-field"><label>الهاتف</label><input id="f_phone" value="${esc(c.PHONE)}"></div>
    </div>
    <div class="form-row">
      <div class="form-field"><label>هاتف بديل</label><input id="f_altphone" value="${esc(c.ALT_PHONE)}"></div>
      <div class="form-field"><label>المدينة</label><input id="f_city" value="${esc(c.CITY)}"></div>
    </div>
    <div class="form-field"><label>الحد الائتماني (0 = بدون حد)</label><input id="f_credit" type="number" step="0.01" value="${c.CREDIT_LIMIT || 0}"></div>
    <div class="form-field"><label>ملاحظات</label><textarea id="f_notes">${esc(c.NOTES)}</textarea></div>
    ${customerId && isAdmin ? `<div class="form-field"><label>الحالة</label>
      <select id="f_status"><option value="ACTIVE" ${c.STATUS === 'ACTIVE' ? 'selected' : ''}>نشط</option>
      <option value="INACTIVE" ${c.STATUS === 'INACTIVE' ? 'selected' : ''}>غير نشط</option></select></div>` : ''}
    <div class="form-actions">
      <button class="btn btn-primary" id="f_save">حفظ</button>
      <button class="btn" id="f_cancel">إلغاء</button>
    </div>`);
  document.getElementById('f_cancel').onclick = closeDrawer;
  document.getElementById('f_save').onclick = async (e) => {
    const btn = e.target;
    const data = {
      name: document.getElementById('f_name').value, nationalId: document.getElementById('f_nid').value,
      phone: document.getElementById('f_phone').value, altPhone: document.getElementById('f_altphone').value,
      city: document.getElementById('f_city').value, creditLimit: document.getElementById('f_credit').value,
      notes: document.getElementById('f_notes').value
    };
    setLoading(btn, true);
    try {
      if (customerId) {
        await api('updateCustomer', { customerId, data });
        const statusEl = document.getElementById('f_status');
        if (statusEl && statusEl.value !== c.STATUS) await api('setCustomerStatus', { customerId, active: statusEl.value === 'ACTIVE' });
      } else {
        await api('saveCustomer', { data });
      }
      toast('تم الحفظ بنجاح', 'success');
      closeDrawer();
      goTo('customers');
    } catch (err) { toast(err.message, 'error'); }
    setLoading(btn, false);
  };
}

/* ---------- الأصناف ---------- */
VIEWS.items = async function (view) {
  document.getElementById('topbarActions').innerHTML = `<button class="btn btn-primary" id="btnNewItem">${icon('plus')} إضافة صنف</button>`;
  view.innerHTML = `
    <div class="panel">
      <div class="toolbar"><input class="search-input" id="itemSearch" placeholder="ابحث بالاسم / الفئة / الرقم التسلسلي..."></div>
      <div id="itemTableWrap"></div>
    </div>`;
  const load = async (q) => {
    const rows = await api('searchItems', { q: q || '' });
    document.getElementById('itemTableWrap').innerHTML = renderTable([
      { label: 'الكود', key: 'ITEM_ID' }, { label: 'الفئة', key: 'CATEGORY' }, { label: 'الاسم', key: 'NAME' },
      { label: 'السعر', render: r => `<span class="num">${money(r.SALE_PRICE)}</span>` },
      { label: 'الحالة', render: r => badge(r.STATUS, r.STATUS_LABEL) },
      { label: '', render: r => `<button class="btn btn-sm" data-edit="${esc(r.ITEM_ID)}">${icon('edit')} تعديل</button>` }
    ], rows, 'لا توجد أصناف بعد.');
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openItemDrawer(b.dataset.edit));
  };
  document.getElementById('itemSearch').addEventListener('input', e => load(e.target.value));
  document.getElementById('btnNewItem').onclick = () => openItemDrawer(null);
  await load('');
};

async function openItemDrawer(itemId) {
  const categories = await api('getItemCategories', {});
  let it = { CATEGORY: '', NAME: '', SERIAL_NO: '', SPECS: '', SALE_PRICE: '', COST_PRICE: '', STATUS: 'AVAILABLE' };
  if (itemId) it = await api('getItemForView', { itemId });
  const isAdmin = STORE.user.role === 'ADMIN';
  openDrawer(itemId ? 'تعديل الصنف' : 'إضافة صنف جديد', `
    <div class="form-field"><label>الفئة *</label>
      <input id="f_cat" list="catList" value="${esc(it.CATEGORY)}">
      <datalist id="catList">${categories.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    </div>
    <div class="form-field"><label>اسم الصنف *</label><input id="f_name" value="${esc(it.NAME)}"></div>
    <div class="form-row">
      <div class="form-field"><label>رقم تسلسلي (اختياري)</label><input id="f_serial" value="${esc(it.SERIAL_NO)}"></div>
      <div class="form-field"><label>سعر البيع *</label><input id="f_price" type="number" step="0.01" value="${it.SALE_PRICE || ''}"></div>
    </div>
    <div class="form-field"><label>مواصفات حرة (سنة/لون/موديل/تفاصيل...)</label><textarea id="f_specs">${esc(it.SPECS)}</textarea></div>
    ${isAdmin ? `<div class="form-field"><label>سعر التكلفة (لحساب هامش الربح، لا يظهر للعميل)</label><input id="f_cost" type="number" step="0.01" value="${it.COST_PRICE || ''}"></div>` : ''}
    ${itemId && isAdmin ? `<div class="form-field"><label>الحالة</label>
      <select id="f_status">${['AVAILABLE', 'RESERVED', 'SOLD'].map(s => `<option value="${s}" ${it.STATUS === s ? 'selected' : ''}>${{ AVAILABLE: 'متاح', RESERVED: 'محجوز', SOLD: 'مباع' }[s]}</option>`).join('')}</select></div>` : ''}
    <div class="form-actions">
      <button class="btn btn-primary" id="f_save">حفظ</button>
      <button class="btn" id="f_cancel">إلغاء</button>
    </div>`);
  document.getElementById('f_cancel').onclick = closeDrawer;
  document.getElementById('f_save').onclick = async (e) => {
    const btn = e.target;
    const data = {
      category: document.getElementById('f_cat').value, name: document.getElementById('f_name').value,
      serialNo: document.getElementById('f_serial').value, specs: document.getElementById('f_specs').value,
      salePrice: document.getElementById('f_price').value,
      costPrice: document.getElementById('f_cost') ? document.getElementById('f_cost').value : (it.COST_PRICE || 0)
    };
    setLoading(btn, true);
    try {
      if (itemId) {
        await api('updateItem', { itemId, data });
        const statusEl = document.getElementById('f_status');
        if (statusEl && statusEl.value !== it.STATUS) await api('setItemStatus', { itemId, status: statusEl.value });
      } else {
        await api('saveItem', { data });
      }
      toast('تم الحفظ بنجاح', 'success');
      closeDrawer();
      goTo('items');
    } catch (err) { toast(err.message, 'error'); }
    setLoading(btn, false);
  };
}

/* ---------- الفواتير ---------- */
VIEWS.invoices = async function (view) {
  document.getElementById('topbarActions').innerHTML = `<button class="btn btn-primary" id="btnNewInvoice">${icon('plus')} فاتورة جديدة</button>`;
  view.innerHTML = `
    <div class="panel">
      <div class="toolbar"><input class="search-input" id="invSearch" placeholder="ابحث برقم الفاتورة / اسم العميل / الصنف..."></div>
      <div id="invTableWrap"></div>
    </div>`;
  const load = async (q) => {
    const rows = await api('searchInvoices', { q: q || '' });
    document.getElementById('invTableWrap').innerHTML = renderTable([
      { label: 'رقم الفاتورة', key: 'INVOICE_NO' }, { label: 'التاريخ', key: 'DATE' }, { label: 'العميل', key: 'CUSTOMER_NAME' },
      { label: 'الصنف', key: 'ITEM_DESC' }, { label: 'الإجمالي', render: r => `<span class="num">${money(r.TOTAL)}</span>` },
      { label: 'الحالة', render: r => badge(r.STATUS, r.STATUS_LABEL) },
      { label: '', render: r => `<button class="btn btn-sm" data-view="${esc(r.INVOICE_ID)}">${icon('eye')} عرض</button>` }
    ], rows, 'لا توجد فواتير بعد.');
    document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => openInvoiceDetail(b.dataset.view));
  };
  document.getElementById('invSearch').addEventListener('input', e => load(e.target.value));
  document.getElementById('btnNewInvoice').onclick = openNewInvoiceDrawer;
  await load('');
};

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
      <dt>التاريخ</dt><dd>${esc(inv.DATE)}</dd>
      <dt>الحالة</dt><dd>${badge(inv.STATUS, inv.STATUS_LABEL)}</dd>
      <dt>الإجمالي</dt><dd class="num">${money(inv.TOTAL)}</dd>
      <dt>الدفعة المقدمة</dt><dd class="num">${money(inv.DOWN_PAYMENT)}</dd>
      <dt>الممول</dt><dd class="num">${money(inv.FINANCED)}</dd>
    </div>
    <hr class="divider">
    <h4 style="margin-bottom:10px">جدول الأقساط</h4>
    ${renderTable([
      { label: '#', key: 'NO' }, { label: 'الاستحقاق', key: 'DUE_DATE' },
      { label: 'القيمة', render: r => `<span class="num">${money(r.AMOUNT)}</span>` },
      { label: 'المتبقي', render: r => `<span class="num">${money(r.BALANCE)}</span>` },
      { label: 'الحالة', render: r => badge(r.STATUS, r.STATUS_LABEL) }
    ], installments, 'لا توجد أقساط (فاتورة نقدية بالكامل).')}
    <div class="form-actions">
      ${inv.STATUS !== 'CANCELLED' ? `<button class="btn" id="f_print">طباعة الفاتورة</button>` : ''}
      ${inv.STATUS !== 'CANCELLED' ? `<button class="btn btn-teal" id="f_topay">تسجيل تحصيل</button>` : ''}
      ${inv.STATUS === 'ACTIVE' && isAdmin ? `<button class="btn btn-danger" id="f_cancelInv">إلغاء الفاتورة</button>` : ''}
    </div>
    ${inv.CANCEL_REASON ? `<p class="form-help">سبب الإلغاء: ${esc(inv.CANCEL_REASON)}</p>` : ''}`);

  const printBtn = document.getElementById('f_print');
  if (printBtn) printBtn.onclick = () => printDoc('فاتورة ' + inv.INVOICE_NO, `
    <h1>فاتورة بيع رقم ${esc(inv.INVOICE_NO)}</h1>
    <div class="kv"><b>العميل:</b> ${esc(inv.CUSTOMER_NAME)}</div>
    <div class="kv"><b>الصنف:</b> ${esc(inv.ITEM_DESC)}</div>
    <div class="kv"><b>التاريخ:</b> ${esc(inv.DATE)}</div>
    <div class="kv"><b>الإجمالي:</b> ${money(inv.TOTAL)}</div>
    <div class="kv"><b>الدفعة المقدمة:</b> ${money(inv.DOWN_PAYMENT)}</div>
    <div class="kv"><b>الممول:</b> ${money(inv.FINANCED)}</div>
    <table><thead><tr><th>#</th><th>الاستحقاق</th><th>القيمة</th><th>المتبقي</th><th>الحالة</th></tr></thead>
    <tbody>${installments.map(x => `<tr><td>${x.NO}</td><td>${esc(x.DUE_DATE)}</td><td>${money(x.AMOUNT)}</td><td>${money(x.BALANCE)}</td><td>${esc(x.STATUS_LABEL)}</td></tr>`).join('')}</tbody></table>`);

  const topay = document.getElementById('f_topay');
  if (topay) topay.onclick = () => { closeDrawer(); openReceiptDrawer(null, inv); };

  const cancelBtn = document.getElementById('f_cancelInv');
  if (cancelBtn) cancelBtn.onclick = async () => {
    const reason = prompt('اكتب سبب إلغاء الفاتورة (مطلوب للتدقيق):');
    if (!reason) return;
    try {
      await api('cancelInvoice', { invoiceId, reason });
      toast('تم إلغاء الفاتورة', 'success');
      closeDrawer();
      goTo('invoices');
    } catch (err) { toast(err.message, 'error'); }
  };
}

/* ---------- سندات القبض ---------- */
VIEWS.receipts = async function (view) {
  document.getElementById('topbarActions').innerHTML = `<button class="btn btn-primary" id="btnNewReceipt">${icon('plus')} سند قبض جديد</button>`;
  view.innerHTML = `
    <div class="panel">
      <div class="toolbar"><input class="search-input" id="recSearch" placeholder="ابحث برقم السند / العميل / رقم الفاتورة..."></div>
      <div id="recTableWrap"></div>
    </div>`;
  const load = async (q) => {
    const rows = await api('searchReceipts', { q: q || '' });
    document.getElementById('recTableWrap').innerHTML = renderTable([
      { label: 'رقم السند', key: 'RECEIPT_NO' }, { label: 'التاريخ', key: 'DATE' }, { label: 'العميل', key: 'CUSTOMER_NAME' },
      { label: 'الفاتورة', key: 'INVOICE_NO' }, { label: 'المبلغ', render: r => `<span class="num">${money(r.AMOUNT)}</span>` },
      { label: 'طريقة الدفع', key: 'PAYMENT_METHOD' },
      { label: '', render: r => `<button class="btn btn-sm" data-edit="${esc(r.RECEIPT_ID)}">${icon('edit')} تعديل</button>` }
    ], rows, 'لا توجد سندات قبض بعد.');
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openReceiptDrawer(b.dataset.edit, null));
  };
  document.getElementById('recSearch').addEventListener('input', e => load(e.target.value));
  document.getElementById('btnNewReceipt').onclick = () => openReceiptDrawer(null, null);
  await load('');
};

async function openReceiptDrawer(receiptId, presetInvoice) {
  let invoiceInfo = null, r = { AMOUNT: '', PAYMENT_METHOD: 'نقدي', REFERENCE_NO: '', NOTES: '' };
  if (receiptId) { r = await api('getReceiptForEdit', { receiptId }); invoiceInfo = r.invoice; }
  else if (presetInvoice) invoiceInfo = await api('getInvoicePaymentInfo', { invoiceId: presetInvoice.INVOICE_ID });

  openDrawer(receiptId ? 'تعديل سند القبض ' + r.RECEIPT_NO : 'سند قبض جديد', `
    <div class="form-field"><label>الفاتورة *</label>
      <input id="f_invq" placeholder="اكتب رقم الفاتورة أو اسم العميل..." ${invoiceInfo ? 'style="display:none"' : ''}>
      <div id="f_invResults" class="pick-results"></div>
      <div id="f_invPicked" class="form-help">${invoiceInfo ? `الفاتورة ${esc(invoiceInfo.INVOICE_NO)} — ${esc(invoiceInfo.CUSTOMER_NAME)} — المتاح: <span class="num">${money(invoiceInfo.BALANCE_AVAILABLE)}</span>` : ''}</div>
    </div>
    <div class="form-field"><label>المبلغ *</label><input id="f_amount" type="number" step="0.01" value="${r.AMOUNT || ''}"></div>
    <div class="form-help" id="f_remainPreview"></div>
    <div class="form-field"><label>طريقة الدفع</label>
      <select id="f_method"><option ${r.PAYMENT_METHOD === 'نقدي' ? 'selected' : ''}>نقدي</option>
      <option ${r.PAYMENT_METHOD === 'تحويل بنكي' ? 'selected' : ''}>تحويل بنكي</option>
      <option ${r.PAYMENT_METHOD === 'شبكة' ? 'selected' : ''}>شبكة</option>
      <option ${r.PAYMENT_METHOD === 'شيك' ? 'selected' : ''}>شيك</option></select>
    </div>
    <div class="form-field"><label>مرجع/رقم الحوالة</label><input id="f_ref" value="${esc(r.REFERENCE_NO)}"></div>
    <div class="form-field"><label>ملاحظات</label><textarea id="f_notes">${esc(r.NOTES)}</textarea></div>
    <div class="form-actions">
      <button class="btn btn-primary" id="f_save">حفظ</button>
      <button class="btn" id="f_cancel">إلغاء</button>
      ${receiptId ? `<button class="btn" id="f_print">طباعة السند</button>` : ''}
    </div>`);

  const printBtn = document.getElementById('f_print');
  if (printBtn) printBtn.onclick = () => printDoc('سند قبض ' + r.RECEIPT_NO, `
    <h1>سند قبض رقم ${esc(r.RECEIPT_NO)}</h1>
    <div class="kv"><b>العميل:</b> ${esc(r.CUSTOMER_NAME)}</div>
    <div class="kv"><b>الفاتورة:</b> ${esc(r.INVOICE_NO)}</div>
    <div class="kv"><b>المبلغ:</b> ${money(r.AMOUNT)}</div>
    <div class="kv"><b>طريقة الدفع:</b> ${esc(r.PAYMENT_METHOD)}</div>
    <div class="kv"><b>التاريخ:</b> ${esc(r.DATE)}</div>`);

  if (!invoiceInfo) {
    searchPicker(document.getElementById('f_invq'), document.getElementById('f_invResults'),
      q => api('searchInvoices', { q }), x => `${esc(x.INVOICE_NO)} — ${esc(x.CUSTOMER_NAME)} — ${money(x.TOTAL)}`,
      async x => {
        invoiceInfo = await api('getInvoicePaymentInfo', { invoiceId: x.INVOICE_ID });
        document.getElementById('f_invPicked').innerHTML = `الفاتورة ${esc(invoiceInfo.INVOICE_NO)} — ${esc(invoiceInfo.CUSTOMER_NAME)} — المتاح: <span class="num">${money(invoiceInfo.BALANCE_AVAILABLE)}</span>`;
        document.getElementById('f_invq').value = '';
      });
  }

  document.getElementById('f_amount').addEventListener('input', () => {
    if (!invoiceInfo) return;
    const amt = Number(document.getElementById('f_amount').value || 0);
    document.getElementById('f_remainPreview').textContent = 'المتبقي الجديد على الفاتورة: ' + money(invoiceInfo.BALANCE_AVAILABLE - amt);
  });

  document.getElementById('f_cancel').onclick = closeDrawer;
  document.getElementById('f_save').onclick = async (e) => {
    const btn = e.target;
    if (!invoiceInfo) return toast('اختر الفاتورة أولاً', 'error');
    const data = {
      invoiceId: invoiceInfo.INVOICE_ID, amount: document.getElementById('f_amount').value,
      paymentMethod: document.getElementById('f_method').value, referenceNo: document.getElementById('f_ref').value,
      notes: document.getElementById('f_notes').value
    };
    setLoading(btn, true);
    try {
      if (receiptId) await api('updateReceipt', { receiptId, data });
      else await api('createReceipt', { data });
      toast('تم حفظ السند بنجاح', 'success');
      closeDrawer();
      goTo('receipts');
    } catch (err) { toast(err.message, 'error'); }
    setLoading(btn, false);
  };
}

/* ---------- الخصومات (سجل قراءة فقط — تُنشأ تلقائيًا مع الفاتورة) ---------- */
VIEWS.discounts = async function (view) {
  const rows = await api('getAllDiscounts', {});
  view.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>سجل الخصومات</h3></div>
      ${renderTable([
        { label: 'رقم الخصم', key: 'DISCOUNT_NO' }, { label: 'التاريخ', key: 'DATE' }, { label: 'العميل', key: 'CUSTOMER_NAME' },
        { label: 'الفاتورة', key: 'INVOICE_NO' }, { label: 'القيمة', render: r => `<span class="num">${money(r.AMOUNT)}</span>` },
        { label: 'السبب', key: 'REASON' }
      ], rows, 'لا توجد خصومات مسجلة بعد.')}
    </div>`;
};

/* ---------- المصروفات ---------- */
VIEWS.expenses = async function (view) {
  document.getElementById('topbarActions').innerHTML = `<button class="btn btn-primary" id="btnNewExpense">${icon('plus')} مصروف جديد</button>`;
  view.innerHTML = `
    <div class="panel">
      <div class="toolbar"><input class="search-input" id="expSearch" placeholder="ابحث بالفئة / الوصف / رقم المصروف..."></div>
      <div id="expTableWrap"></div>
    </div>`;
  const load = async (q) => {
    const rows = await api('searchExpenses', { q: q || '' });
    document.getElementById('expTableWrap').innerHTML = renderTable([
      { label: 'رقم المصروف', key: 'EXPENSE_NO' }, { label: 'التاريخ', key: 'DATE' }, { label: 'الفئة', key: 'CATEGORY' },
      { label: 'الوصف', key: 'DESCRIPTION' }, { label: 'القيمة', render: r => `<span class="num">${money(r.AMOUNT)}</span>` },
      { label: 'طريقة الدفع', key: 'PAYMENT_METHOD' },
      { label: '', render: r => STORE.user.role === 'ADMIN' ? `<button class="btn btn-sm btn-danger" data-cancel="${esc(r.EXPENSE_ID)}">إلغاء</button>` : '' }
    ], rows, 'لا توجد مصروفات مسجلة بعد.');
    document.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
      if (!confirm('تأكيد إلغاء هذا المصروف؟')) return;
      try { await api('cancelExpense', { expenseId: b.dataset.cancel }); toast('تم الإلغاء', 'success'); load(q); }
      catch (err) { toast(err.message, 'error'); }
    });
  };
  document.getElementById('expSearch').addEventListener('input', e => load(e.target.value));
  document.getElementById('btnNewExpense').onclick = async () => {
    const categories = await api('getExpenseCategories', {});
    openDrawer('مصروف جديد', `
      <div class="form-field"><label>الفئة *</label>
        <input id="f_cat" list="expCatList" value="">
        <datalist id="expCatList">${categories.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      </div>
      <div class="form-field"><label>الوصف</label><input id="f_desc"></div>
      <div class="form-row">
        <div class="form-field"><label>القيمة *</label><input id="f_amount" type="number" step="0.01"></div>
        <div class="form-field"><label>التاريخ</label><input id="f_date" type="date" value="${todayStr()}"></div>
      </div>
      <div class="form-field"><label>طريقة الدفع</label>
        <select id="f_method"><option>نقدي</option><option>تحويل بنكي</option><option>شبكة</option></select></div>
      <div class="form-field"><label>مرجع (اختياري)</label><input id="f_ref"></div>
      <div class="form-field"><label>ملاحظات</label><textarea id="f_notes"></textarea></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="f_save">حفظ</button>
        <button class="btn" id="f_cancel">إلغاء</button>
      </div>`);
    document.getElementById('f_cancel').onclick = closeDrawer;
    document.getElementById('f_save').onclick = async (e) => {
      setLoading(e.target, true);
      try {
        await api('createExpense', {
          data: {
            category: document.getElementById('f_cat').value, description: document.getElementById('f_desc').value,
            amount: document.getElementById('f_amount').value, date: document.getElementById('f_date').value,
            paymentMethod: document.getElementById('f_method').value, referenceNo: document.getElementById('f_ref').value,
            notes: document.getElementById('f_notes').value
          }
        });
        toast('تم تسجيل المصروف', 'success');
        closeDrawer();
        goTo('expenses');
      } catch (err) { toast(err.message, 'error'); }
      setLoading(e.target, false);
    };
  };
  await load('');
};

/* ---------- سند استرداد ---------- */
VIEWS.refunds = async function (view) {
  document.getElementById('topbarActions').innerHTML = `<button class="btn btn-primary" id="btnNewRefund">${icon('plus')} سند استرداد جديد</button>`;
  view.innerHTML = `
    <div class="panel">
      <div class="toolbar"><input class="search-input" id="rfSearch" placeholder="ابحث برقم السند / العميل / رقم الفاتورة..."></div>
      <div id="rfTableWrap"></div>
    </div>`;
  const load = async (q) => {
    const rows = await api('searchRefunds', { q: q || '' });
    document.getElementById('rfTableWrap').innerHTML = renderTable([
      { label: 'رقم السند', key: 'REFUND_NO' }, { label: 'التاريخ', key: 'DATE' }, { label: 'العميل', key: 'CUSTOMER_NAME' },
      { label: 'الفاتورة', key: 'INVOICE_NO' }, { label: 'القيمة', render: r => `<span class="num">${money(r.AMOUNT)}</span>` },
      { label: 'السبب', key: 'REASON' }, { label: 'الحالة', render: r => badge(r.STATUS, r.STATUS_LABEL) }
    ], rows, 'لا توجد سندات استرداد بعد.');
  };
  document.getElementById('rfSearch').addEventListener('input', e => load(e.target.value));
  document.getElementById('btnNewRefund').onclick = async () => {
    const invoices = await api('getRefundableInvoices', {});
    let picked = null;
    openDrawer('سند استرداد جديد', `
      <div class="form-field"><label>الفاتورة *</label>
        <select id="f_inv"><option value="">اختر فاتورة قابلة للاسترداد...</option>
          ${invoices.map(i => `<option value="${esc(i.INVOICE_ID)}" data-max="${i.REFUNDABLE}">${esc(i.INVOICE_NO)} — ${esc(i.CUSTOMER_NAME)} — المتاح: ${money(i.REFUNDABLE)}</option>`).join('')}
        </select>
      </div>
      <div class="form-field"><label>المبلغ *</label><input id="f_amount" type="number" step="0.01"></div>
      <div class="form-help" id="f_maxHint"></div>
      <div class="form-field"><label>طريقة الاسترداد</label>
        <select id="f_method"><option>نقدي</option><option>تحويل بنكي</option></select></div>
      <div class="form-field"><label>مرجع (اختياري)</label><input id="f_ref"></div>
      <div class="form-field"><label>سبب الاسترداد *</label><textarea id="f_reason"></textarea></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="f_save">حفظ</button>
        <button class="btn" id="f_cancel">إلغاء</button>
      </div>`);
    document.getElementById('f_inv').addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      document.getElementById('f_maxHint').textContent = opt && opt.dataset.max ? 'الحد الأقصى المتاح للاسترداد: ' + money(opt.dataset.max) : '';
    });
    document.getElementById('f_cancel').onclick = closeDrawer;
    document.getElementById('f_save').onclick = async (e) => {
      const invoiceId = document.getElementById('f_inv').value;
      if (!invoiceId) return toast('اختر الفاتورة أولاً', 'error');
      setLoading(e.target, true);
      try {
        await api('createRefund', {
          data: {
            invoiceId, amount: document.getElementById('f_amount').value,
            paymentMethod: document.getElementById('f_method').value, referenceNo: document.getElementById('f_ref').value,
            reason: document.getElementById('f_reason').value
          }
        });
        toast('تم إنشاء سند الاسترداد', 'success');
        closeDrawer();
        goTo('refunds');
      } catch (err) { toast(err.message, 'error'); }
      setLoading(e.target, false);
    };
  };
  await load('');
};

/* ---------- كشف حساب عميل ---------- */
VIEWS.statement = async function (view) {
  view.innerHTML = `
    <div class="panel">
      <div class="panel-body">
        <div class="form-field"><label>ابحث عن العميل</label>
          <input id="stCustq" class="search-input" placeholder="اكتب اسم العميل أو رقم الجوال...">
          <div id="stCustResults" class="pick-results"></div>
        </div>
      </div>
    </div>
    <div id="stResult"></div>`;
  searchPicker(document.getElementById('stCustq'), document.getElementById('stCustResults'),
    q => api('searchCustomers', { q }), r => `${esc(r.NAME)} — ${esc(r.PHONE || '')}`,
    async r => {
      document.getElementById('stCustq').value = r.NAME;
      document.getElementById('stCustResults').innerHTML = '';
      const st = await api('getCustomerStatement', { customerId: r.CUSTOMER_ID });
      document.getElementById('stResult').innerHTML = `
        <div class="stat-grid">
          <div class="stat-card"><div class="label">إجمالي الفواتير</div><div class="value num">${money(st.totals.totalInvoices)}</div></div>
          <div class="stat-card good"><div class="label">إجمالي المحصّل</div><div class="value num">${money(st.totals.totalPaid)}</div></div>
          <div class="stat-card"><div class="label">إجمالي الخصومات</div><div class="value num">${money(st.totals.totalDiscounts)}</div></div>
          <div class="stat-card warn"><div class="label">المتبقي</div><div class="value num">${money(st.totals.outstanding)}</div></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>حركة الحساب</h3>
            <button class="btn btn-sm" id="btnStPdf">طباعة الكشف</button>
          </div>
          ${renderTable([
            { label: 'التاريخ', key: 'date' }, { label: 'النوع', key: 'typeLabel' }, { label: 'المرجع', key: 'refNo' },
            { label: 'البيان', key: 'description' }, { label: 'مدين', render: x => `<span class="num">${x.debit ? money(x.debit) : ''}</span>` },
            { label: 'دائن', render: x => `<span class="num">${x.credit ? money(x.credit) : ''}</span>` },
            { label: 'الرصيد', render: x => `<span class="num">${money(x.balance)}</span>` }
          ], st.rows, 'لا توجد حركات على هذا العميل بعد.')}
        </div>`;
      document.getElementById('btnStPdf').onclick = () => printDoc('كشف حساب ' + r.NAME, `
        <h1>كشف حساب العميل: ${esc(r.NAME)}</h1>
        <div class="kv"><b>إجمالي الفواتير:</b> ${money(st.totals.totalInvoices)}</div>
        <div class="kv"><b>إجمالي المحصّل:</b> ${money(st.totals.totalPaid)}</div>
        <div class="kv"><b>المتبقي:</b> ${money(st.totals.outstanding)}</div>
        <table><thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
        <tbody>${st.rows.map(x => `<tr><td>${esc(x.date)}</td><td>${esc(x.typeLabel)}</td><td>${esc(x.refNo)}</td><td>${esc(x.description)}</td><td>${x.debit ? money(x.debit) : ''}</td><td>${x.credit ? money(x.credit) : ''}</td><td>${money(x.balance)}</td></tr>`).join('')}</tbody></table>`);
    });
};

/* ---------- التقارير ---------- */
VIEWS.reports = async function (view) {
  view.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <div class="form-field" style="margin:0"><label>من</label><input type="date" id="rpFrom" value="${monthStartStr()}"></div>
        <div class="form-field" style="margin:0"><label>إلى</label><input type="date" id="rpTo" value="${todayStr()}"></div>
        <button class="btn btn-primary" id="rpGo" style="align-self:flex-end">عرض التقرير</button>
      </div>
    </div>
    <div id="rpResult"></div>`;
  const run = async () => {
    const fromDate = document.getElementById('rpFrom').value, toDate = document.getElementById('rpTo').value;
    const [period, byCat] = await Promise.all([
      api('reportDataForPeriod', { fromDate, toDate }), api('salesByCategoryReport', { fromDate, toDate })
    ]);
    document.getElementById('rpResult').innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="label">عدد الفواتير بالفترة</div><div class="value num">${period.invoiceCount}</div></div>
        <div class="stat-card accent"><div class="label">إجمالي المبيعات</div><div class="value num">${money(period.invoiceTotal)}</div></div>
        <div class="stat-card good"><div class="label">إجمالي التحصيل</div><div class="value num">${money(period.totalCollection)}</div></div>
        <div class="stat-card warn"><div class="label">المتبقي على فواتير الفترة</div><div class="value num">${money(period.remaining)}</div></div>
        <div class="stat-card"><div class="label">دفعات مقدمة ضمن الفواتير</div><div class="value num">${money(period.invoiceEmbeddedCollection)}</div></div>
        <div class="stat-card"><div class="label">تحصيل بسندات قبض</div><div class="value num">${money(period.ordinaryReceiptCollection)}</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>المبيعات حسب الفئة</h3></div>
        ${renderTable([
          { label: 'الفئة', key: 'category' }, { label: 'عدد الفواتير', key: 'count' },
          { label: 'المبيعات', render: r => `<span class="num">${money(r.sales)}</span>` },
          { label: 'التكلفة', render: r => `<span class="num">${money(r.cost)}</span>` },
          { label: 'هامش الربح التقديري', render: r => `<span class="num">${money(r.profit)}</span>` }
        ], byCat, 'لا توجد مبيعات ضمن هذه الفترة.')}
      </div>`;
  };
  document.getElementById('rpGo').onclick = run;
  await run();
};

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
