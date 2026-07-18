/* ================================================================
 * WFDC Stock System — Frontend logic
 * Deploy: GitHub Pages. Set CONFIG.API_URL after GAS deployment.
 * ================================================================ */
var CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyDdQBeo5Sk63UDfIq8sM6IrZZy29veYiD-9cQBwk_ydnPbVectObXlqpf4h7m7OYthDQ/exec'
};

var state = {
  user: null,          // {employeeId,name,department,role}
  master: { items: [], categories: [] },
  cart: {},            // itemId -> qty
  activeTab: null
};

/* ---------------- API ---------------- */
function api(action, payload) {
  payload = payload || {};
  payload.action = action;
  // text/plain avoids CORS preflight on GAS web apps
  return fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(function (r) { return r.json(); });
}

/* ---------------- toast ---------------- */
function toast(msg, isErr) {
  var el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  document.getElementById('toastHost').appendChild(el);
  setTimeout(function () { el.remove(); }, 4200);
}

/* ---------------- auth ---------------- */
function doLogin() {
  var id = document.getElementById('loginId').value.trim();
  var errEl = document.getElementById('loginErr');
  if (!id) { errEl.textContent = 'กรุณากรอกรหัสพนักงาน'; return; }
  errEl.innerHTML = '<span class="loader"></span>';
  api('login', { employeeId: id }).then(function (res) {
    if (!res.success) { errEl.textContent = res.error || 'เข้าสู่ระบบไม่สำเร็จ'; return; }
    state.user = res.employee;
    try { localStorage.setItem('wfdc_stock_user', JSON.stringify(res.employee)); } catch (e) {}
    enterApp();
  }).catch(function () { errEl.textContent = 'เชื่อมต่อไม่ได้ / Connection failed'; });
}

function logout() {
  try { localStorage.removeItem('wfdc_stock_user'); } catch (e) {}
  location.reload();
}

function isAdmin() {
  return state.user && (state.user.role === 'it_admin' || state.user.role === 'warehouse_admin');
}

function enterApp() {
  document.getElementById('viewLogin').classList.add('hidden');
  document.getElementById('viewApp').classList.remove('hidden');
  document.getElementById('uName').textContent = state.user.name;
  document.getElementById('uRole').textContent =
    state.user.role === 'it_admin' ? 'IT ADMIN' :
    state.user.role === 'warehouse_admin' ? 'WAREHOUSE' : 'USER';
  buildTabs();
  loadMaster().then(function () { switchTab(isAdmin() ? 'dashboard' : 'request'); });
}

function loadMaster() {
  return api('getMasterData').then(function (res) {
    if (res.success) state.master = res;
  });
}

/* ---------------- tabs ---------------- */
function buildTabs() {
  var tabs = [];
  if (isAdmin()) tabs.push({ id: 'dashboard', label: 'แดชบอร์ด' });
  tabs.push({ id: 'request', label: 'เบิกของ' });
  tabs.push({ id: 'myhistory', label: 'ประวัติของฉัน' });
  if (isAdmin()) {
    tabs.push({ id: 'approvals', label: 'คำขอเบิก', badge: 'pendingCount' });
    tabs.push({ id: 'stock', label: 'จัดการสต็อก' });
    tabs.push({ id: 'master', label: 'Master Data' });
    tabs.push({ id: 'movements', label: 'ความเคลื่อนไหว' });
    tabs.push({ id: 'settings', label: 'ตั้งค่าแจ้งเตือน' });
  }
  var bar = document.getElementById('tabBar');
  bar.innerHTML = tabs.map(function (t) {
    return '<button class="tab" id="tab-' + t.id + '" onclick="switchTab(\'' + t.id + '\')">' +
      t.label + (t.badge ? '<span class="badge hidden" id="badge-' + t.id + '"></span>' : '') + '</button>';
  }).join('');
}

function switchTab(id) {
  state.activeTab = id;
  document.querySelectorAll('.tab').forEach(function (el) { el.classList.remove('active'); });
  var btn = document.getElementById('tab-' + id);
  if (btn) btn.classList.add('active');
  var host = document.getElementById('tabContent');
  host.innerHTML = '<div class="empty"><span class="loader"></span> กำลังโหลด...</div>';
  var renderers = {
    dashboard: renderDashboard, request: renderRequest, myhistory: renderMyHistory,
    approvals: renderApprovals, stock: renderStock, master: renderMaster,
    movements: renderMovements, settings: renderSettings
  };
  (renderers[id] || function () {})(host);
}

/* ---------------- helpers ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtDate(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}
function pill(status) {
  var map = {
    pending: ['p-pending', 'รออนุมัติ'], approved: ['p-approved', 'อนุมัติแล้ว'],
    issued: ['p-issued', 'จ่ายแล้ว'], rejected: ['p-rejected', 'ปฏิเสธ'],
    IN: ['p-in', 'รับเข้า'], OUT: ['p-out', 'เบิกจ่าย'], ADJUST: ['p-adjust', 'ปรับปรุง']
  };
  var m = map[status] || ['', status];
  return '<span class="pill ' + m[0] + '">' + m[1] + '</span>';
}
function catName(id) {
  var c = state.master.categories.find(function (x) { return x.categoryId === id; });
  return c ? c.categoryName : id;
}
function openModal(html) {
  document.getElementById('modalHost').innerHTML =
    '<div class="modal-bk" onclick="if(event.target===this)closeModal()"><div class="modal">' + html + '</div></div>';
}
function closeModal() { document.getElementById('modalHost').innerHTML = ''; }

/* ================================================================
 * TAB: เบิกของ (cart)
 * ================================================================ */
function renderRequest(host) {
  loadMaster().then(function () {
    var cats = state.master.categories;
    var catOpts = '<option value="">ทุกหมวดหมู่ / All</option>' +
      cats.map(function (c) { return '<option value="' + esc(c.categoryId) + '">' + esc(c.categoryName) + '</option>'; }).join('');
    host.innerHTML =
      '<div class="card">' +
      '<h3>เบิกอุปกรณ์ / Create Requisition</h3>' +
      '<div class="flex mb"><div style="flex:1;min-width:200px"><input id="reqSearch" placeholder="ค้นหาอุปกรณ์ / Search..." oninput="drawItemGrid()"></div>' +
      '<div style="width:220px"><select id="reqCat" onchange="drawItemGrid()">' + catOpts + '</select></div></div>' +
      '<div class="items-grid" id="itemGrid"></div>' +
      '</div>' +
      '<div class="cart-bar" id="cartBar"></div>';
    drawItemGrid();
    drawCartBar();
  });
}

function drawItemGrid() {
  var q = (document.getElementById('reqSearch').value || '').toLowerCase();
  var cat = document.getElementById('reqCat').value;
  var grid = document.getElementById('itemGrid');
  var items = state.master.items.filter(function (it) {
    if (!it.active) return false;
    if (cat && it.category !== cat) return false;
    if (q && it.itemName.toLowerCase().indexOf(q) < 0 && it.itemId.toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  if (!items.length) { grid.innerHTML = '<div class="empty">ไม่พบอุปกรณ์ / No items</div>'; return; }
  grid.innerHTML = items.map(function (it) {
    var inCart = state.cart[it.itemId] || '';
    var out = it.currentStock <= 0;
    return '<div class="item-card">' +
      '<div class="nm">' + esc(it.itemName) + '</div>' +
      '<div class="meta">' + esc(it.itemId) + ' · ' + esc(catName(it.category)) + '<br>คงเหลือ: ' +
      (out ? '<span class="low-flag">หมด</span>' : '<b style="color:var(--green)">' + it.currentStock + '</b>') +
      ' ' + esc(it.unit) + '</div>' +
      '<div class="row">' +
      '<input type="number" min="1" max="' + it.currentStock + '" value="' + inCart + '" placeholder="จำนวน"' +
      (out ? ' disabled' : '') + ' onchange="setCart(\'' + esc(it.itemId) + '\',this.value)">' +
      '</div></div>';
  }).join('');
}

function setCart(itemId, val) {
  var qty = parseInt(val, 10);
  var it = state.master.items.find(function (x) { return x.itemId === itemId; });
  if (!qty || qty <= 0) { delete state.cart[itemId]; }
  else if (it && qty > it.currentStock) {
    toast('สต็อกไม่พอ: ' + it.itemName + ' (คงเหลือ ' + it.currentStock + ')', true);
    delete state.cart[itemId];
    drawItemGrid();
  } else state.cart[itemId] = qty;
  drawCartBar();
}

function drawCartBar() {
  var bar = document.getElementById('cartBar');
  if (!bar) return;
  var n = Object.keys(state.cart).length;
  if (!n) { bar.innerHTML = '<span style="color:var(--ink-dim);font-size:13.5px">ตะกร้าว่าง — เลือกอุปกรณ์แล้วใส่จำนวน</span>'; return; }
  bar.innerHTML =
    '<span class="cnt">' + n + ' รายการ</span>' +
    '<span class="spacer"></span>' +
    '<button class="btn btn-ghost btn-sm" onclick="reviewCart()">ดูตะกร้า</button>' +
    '<button class="btn btn-primary btn-sm" onclick="reviewCart()">ส่งคำขอเบิก</button>';
}

function reviewCart() {
  var lines = Object.keys(state.cart).map(function (id) {
    var it = state.master.items.find(function (x) { return x.itemId === id; });
    return '<div class="cart-line"><span>' + esc(it.itemName) + '</span>' +
      '<span class="mono">' + state.cart[id] + ' ' + esc(it.unit) +
      ' <button class="btn btn-ghost btn-sm" onclick="setCart(\'' + esc(id) + '\',0);reviewCart()" style="margin-left:8px">✕</button></span></div>';
  }).join('');
  if (!Object.keys(state.cart).length) { closeModal(); drawCartBar(); return; }
  openModal(
    '<h3>ยืนยันคำขอเบิก / Confirm Requisition</h3>' + lines +
    '<div class="mt"><label>หมายเหตุ / Note (optional)</label><input id="reqNote"></div>' +
    '<div class="flex mt"><span class="spacer"></span>' +
    '<button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>' +
    '<button class="btn btn-primary" id="btnSubmitReq" onclick="submitRequest()">ยืนยันส่งคำขอ</button></div>'
  );
}

function submitRequest() {
  var btn = document.getElementById('btnSubmitReq');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span>';
  var items = Object.keys(state.cart).map(function (id) { return { itemId: id, qty: state.cart[id] }; });
  api('createRequest', {
    employeeId: state.user.employeeId,
    note: document.getElementById('reqNote').value,
    items: items
  }).then(function (res) {
    if (!res.success) { toast(res.error, true); btn.disabled = false; btn.textContent = 'ยืนยันส่งคำขอ'; return; }
    state.cart = {};
    closeModal();
    toast('ส่งคำขอสำเร็จ ✓ เลขที่ ' + res.requestId);
    switchTab('myhistory');
  }).catch(function () { toast('เชื่อมต่อไม่ได้', true); btn.disabled = false; });
}

/* ================================================================
 * TAB: ประวัติของฉัน
 * ================================================================ */
var _myHistCache = [];
function renderMyHistory(host) {
  api('getRequests', { employeeId: state.user.employeeId }).then(function (res) {
    if (!res.success) { host.innerHTML = '<div class="empty">' + esc(res.error) + '</div>'; return; }
    _myHistCache = res.requests;
    host.innerHTML =
      '<div class="card"><h3>ประวัติการเบิกของฉัน (ย้อนหลัง 3 เดือน)</h3>' +
      '<div class="section-note">My requisition history — last 3 months</div>' +
      '<div class="filter-bar">' +
      '<div class="fb-field"><label>จากวันที่ / From</label><input type="date" id="mhFrom" onchange="drawMyHistory()"></div>' +
      '<div class="fb-field"><label>ถึงวันที่ / To</label><input type="date" id="mhTo" onchange="drawMyHistory()"></div>' +
      '<div class="fb-field"><label>สถานะ / Status</label><select id="mhStatus" onchange="drawMyHistory()">' +
      '<option value="">ทั้งหมด / All</option>' +
      '<option value="pending">รออนุมัติ</option><option value="approved">อนุมัติแล้ว</option>' +
      '<option value="issued">จ่ายแล้ว</option><option value="rejected">ปฏิเสธ</option></select></div>' +
      '<button class="btn btn-ghost btn-sm" onclick="clearMyHistFilter()">ล้าง / Clear</button>' +
      '</div>' +
      '<div id="mhTable"></div></div>';
    drawMyHistory();
  });
}

function clearMyHistFilter() {
  document.getElementById('mhFrom').value = '';
  document.getElementById('mhTo').value = '';
  document.getElementById('mhStatus').value = '';
  drawMyHistory();
}

function drawMyHistory() {
  var el = document.getElementById('mhTable');
  if (!el) return;
  el.innerHTML = requestTable(filterByDateStatus(_myHistCache, 'mhFrom', 'mhTo', 'mhStatus', 'requestedAt', 'status'), false);
}

/** Generic client-side filter: date range + exact field match */
function filterByDateStatus(rows, fromId, toId, selId, dateField, matchField) {
  var from = document.getElementById(fromId).value;
  var to = document.getElementById(toId).value;
  var sel = document.getElementById(selId).value;
  var fromD = from ? new Date(from + 'T00:00:00') : null;
  var toD = to ? new Date(to + 'T23:59:59') : null;
  return rows.filter(function (r) {
    if (sel && String(r[matchField]) !== sel) return false;
    var d = new Date(r[dateField]);
    if (fromD && d < fromD) return false;
    if (toD && d > toD) return false;
    return true;
  });
}

function requestTable(reqs, adminMode) {
  if (!reqs.length) return '<div class="empty">ไม่มีรายการ / No records</div>';
  return '<div class="tbl-wrap"><table><thead><tr>' +
    '<th>เลขที่</th>' + (adminMode ? '<th>ผู้เบิก</th><th>แผนก</th>' : '') +
    '<th>รายการ</th><th>วันที่ขอ</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
    reqs.map(function (r) {
      var itemsTxt = r.items.map(function (i) { return esc(i.itemName) + ' × ' + i.qty; }).join('<br>');
      return '<tr><td class="mono">' + esc(r.requestId) + '</td>' +
        (adminMode ? '<td>' + esc(r.employeeName) + '<br><span class="mono" style="color:var(--ink-dim)">' + esc(r.employeeId) + '</span></td><td>' + esc(r.department) + '</td>' : '') +
        '<td style="font-size:13px">' + itemsTxt + '</td>' +
        '<td class="mono" style="font-size:12.5px">' + fmtDate(r.requestedAt) + '</td>' +
        '<td>' + pill(r.status) + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" onclick=\'showReqDetail(' + JSON.stringify(r).replace(/'/g, '&#39;') + ')\'>ดู</button></td></tr>';
    }).join('') + '</tbody></table></div>';
}

function showReqDetail(r) {
  var lines = r.items.map(function (i) {
    return '<div class="cart-line"><span>' + esc(i.itemName) + '</span><span class="mono">' + i.qty + ' ' + esc(i.unit) + '</span></div>';
  }).join('');
  openModal(
    '<h3>คำขอ ' + esc(r.requestId) + ' ' + pill(r.status) + '</h3>' + lines +
    '<div class="mt">' +
    '<div class="detail-line"><span>ผู้เบิก</span><span>' + esc(r.employeeName) + ' (' + esc(r.employeeId) + ')</span></div>' +
    '<div class="detail-line"><span>วันที่ขอ</span><span>' + fmtDate(r.requestedAt) + '</span></div>' +
    (r.approvedBy ? '<div class="detail-line"><span>' + (r.status === 'rejected' ? 'ปฏิเสธโดย' : 'อนุมัติโดย') + '</span><span>' + esc(r.approvedBy) + ' · ' + fmtDate(r.approvedAt) + '</span></div>' : '') +
    (r.issuedBy ? '<div class="detail-line"><span>จ่ายของโดย</span><span>' + esc(r.issuedBy) + ' · ' + fmtDate(r.issuedAt) + '</span></div>' : '') +
    (r.rejectReason ? '<div class="detail-line"><span>เหตุผล</span><span style="color:var(--red)">' + esc(r.rejectReason) + '</span></div>' : '') +
    (r.note ? '<div class="detail-line"><span>หมายเหตุ</span><span>' + esc(r.note) + '</span></div>' : '') +
    '</div>' +
    '<div class="flex mt"><span class="spacer"></span><button class="btn btn-ghost" onclick="closeModal()">ปิด</button></div>'
  );
}

/* ---------------- init ---------------- */
(function () {
  try {
    var saved = localStorage.getItem('wfdc_stock_user');
    if (saved) {
      state.user = JSON.parse(saved);
      enterApp();
    }
  } catch (e) {}
})();

/* ================================================================
 * TAB: แดชบอร์ด (admin)
 * ================================================================ */
function renderDashboard(host) {
  api('getDashboard').then(function (res) {
    if (!res.success) { host.innerHTML = '<div class="empty">' + esc(res.error) + '</div>'; return; }
    updatePendingBadge(res.pendingRequests);
    var low = res.lowStock || [];
    var sh = res.stockHealth || { ok: 0, low: 0, out: 0 };
    var total = sh.ok + sh.low + sh.out;
    var pOk = total ? Math.round(sh.ok / total * 100) : 0;
    var pLow = total ? Math.round(sh.low / total * 100) : 0;
    var pOut = total ? Math.max(100 - pOk - pLow, 0) : 0;

    // ---- donut (conic-gradient) ----
    var degOk = total ? sh.ok / total * 360 : 0;
    var degLow = total ? sh.low / total * 360 : 0;
    var donut =
      '<div class="donut-wrap">' +
      '<div class="donut" style="background:conic-gradient(var(--green) 0deg ' + degOk + 'deg,var(--amber) ' + degOk + 'deg ' + (degOk + degLow) + 'deg,var(--red) ' + (degOk + degLow) + 'deg 360deg)">' +
      '<div class="donut-hole"><div class="donut-big">' + pOk + '%</div><div class="donut-sub">สต็อกปกติ</div></div></div>' +
      '<div class="legend">' +
      '<div class="lg"><i style="background:var(--green)"></i>ปกติ / OK <b>' + sh.ok + '</b> (' + pOk + '%)</div>' +
      '<div class="lg"><i style="background:var(--amber)"></i>ใกล้หมด / Low <b>' + sh.low + '</b> (' + pLow + '%)</div>' +
      '<div class="lg"><i style="background:var(--red)"></i>หมด / Out <b>' + sh.out + '</b> (' + pOut + '%)</div>' +
      '</div></div>';

    // ---- top 5 bar chart ----
    var top = res.topItems || [];
    var maxQty = top.length ? top[0].qty : 1;
    var topBars = top.length ? top.map(function (t) {
      var w = Math.max(t.qty / maxQty * 100, 3);
      return '<div class="hbar-row"><div class="hbar-lbl" title="' + esc(t.itemName) + '">' + esc(t.itemName) + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + w + '%"></div></div>' +
        '<div class="hbar-val">' + t.qty + '</div></div>';
    }).join('') : '<div class="empty">ยังไม่มีข้อมูลการเบิก</div>';

    // ---- category usage bars ----
    var cats = res.categoryUsage || [];
    var catTotal = cats.reduce(function (s, c) { return s + c.qty; }, 0) || 1;
    var catColors = ['var(--blue)', 'var(--green)', 'var(--amber)', 'var(--red)', '#8e6bbf', '#4db6ac'];
    var catBars = cats.length ? cats.map(function (c, i) {
      var pct = Math.round(c.qty / catTotal * 100);
      return '<div class="hbar-row"><div class="hbar-lbl" title="' + esc(c.category) + '">' + esc(c.category) + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + Math.max(pct, 3) + '%;background:' + catColors[i % catColors.length] + '"></div></div>' +
        '<div class="hbar-val">' + pct + '%</div></div>';
    }).join('') : '<div class="empty">ยังไม่มีข้อมูล</div>';

    // ---- monthly trend (vertical bars) ----
    var months = res.monthlyUsage || [];
    var maxM = months.reduce(function (m, x) { return Math.max(m, x.qty); }, 1);
    var thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    var trend = months.length ? '<div class="vbars">' + months.map(function (m) {
      var h = Math.max(m.qty / maxM * 100, 4);
      var mi = parseInt(m.month.split('-')[1], 10) - 1;
      return '<div class="vbar-col"><div class="vbar-val">' + m.qty + '</div>' +
        '<div class="vbar-track"><div class="vbar-fill" style="height:' + h + '%"></div></div>' +
        '<div class="vbar-lbl">' + thMonths[mi] + '</div></div>';
    }).join('') + '</div>' : '<div class="empty">ยังไม่มีข้อมูล</div>';

    // ---- reorder table ----
    var reorder = low.length
      ? '<div class="tbl-wrap"><table><thead><tr><th>อุปกรณ์</th><th>หมวดหมู่</th><th style="text-align:right">คงเหลือ</th><th style="text-align:right">ขั้นต่ำ</th><th style="text-align:right">แนะนำสั่งซื้อ</th></tr></thead><tbody>' +
        low.map(function (it) {
          var badge = it.currentStock <= 0
            ? '<span class="pill p-rejected">หมด</span> '
            : '';
          return '<tr><td>' + badge + esc(it.itemName) + '<br><span class="mono" style="color:var(--ink-dim);font-size:11.5px">' + esc(it.itemId) + '</span></td>' +
            '<td style="font-size:13px">' + esc(it.category) + '</td>' +
            '<td class="num-cell low-flag">' + it.currentStock + '</td>' +
            '<td class="num-cell">' + it.minStock + '</td>' +
            '<td class="num-cell" style="color:var(--blue);font-weight:700">+' + it.suggestedOrder + ' ' + esc(it.unit) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="empty">✓ ไม่มีรายการต้องสั่งซื้อ / Nothing to reorder</div>';

    host.innerHTML =
      '<div class="grid4 mb">' +
      '<div class="stat"><div class="lbl">อุปกรณ์ทั้งหมด / Items</div><div class="num">' + res.totalItems + '</div></div>' +
      '<div class="stat ' + (res.pendingRequests ? 's-red' : '') + '"><div class="lbl">รออนุมัติ / Pending</div><div class="num">' + res.pendingRequests + '</div></div>' +
      '<div class="stat s-blue"><div class="lbl">รอจ่ายของ / To Issue</div><div class="num">' + res.approvedAwaitingIssue + '</div></div>' +
      '<div class="stat s-green"><div class="lbl">จ่ายแล้วเดือนนี้ / Issued MTD</div><div class="num">' + res.issuedThisMonth + '</div></div>' +
      '</div>' +
      '<div class="grid2">' +
      '<div class="card"><h3>สุขภาพสต็อก / Stock Health</h3>' + donut + '</div>' +
      '<div class="card"><h3>เบิกเยอะสุด 5 อันดับ (3 เดือน) / Top Requested</h3>' + topBars + '</div>' +
      '</div>' +
      '<div class="grid2">' +
      '<div class="card"><h3>สัดส่วนการเบิกตามหมวดหมู่ / Usage by Category</h3>' + catBars + '</div>' +
      '<div class="card"><h3>แนวโน้มการเบิกรายเดือน / Monthly Trend</h3>' + trend + '</div>' +
      '</div>' +
      '<div class="card"><h3>ต้องสั่งซื้อ / Reorder List (' + low.length + ')</h3>' +
      '<div class="section-note">เรียงตามความเร่งด่วน — แนะนำสั่งซื้อคำนวณจากเติมให้ถึง 2 เท่าของขั้นต่ำ</div>' + reorder + '</div>';
  });
}

function updatePendingBadge(n) {
  var b = document.getElementById('badge-approvals');
  if (!b) return;
  if (n > 0) { b.textContent = n; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
}

/* ================================================================
 * TAB: คำขอเบิก (admin approve/reject/issue)
 * ================================================================ */
function renderApprovals(host) {
  api('getRequests', { all: true }).then(function (res) {
    if (!res.success) { host.innerHTML = '<div class="empty">' + esc(res.error) + '</div>'; return; }
    var reqs = res.requests;
    var pending = reqs.filter(function (r) { return r.status === 'pending'; });
    var approved = reqs.filter(function (r) { return r.status === 'approved'; });
    var done = reqs.filter(function (r) { return r.status === 'issued' || r.status === 'rejected'; });
    updatePendingBadge(pending.length);

    host.innerHTML =
      '<div class="card"><h3>รออนุมัติ / Pending Approval (' + pending.length + ')</h3>' + adminReqTable(pending, 'pending') + '</div>' +
      '<div class="card"><h3>อนุมัติแล้ว รอจ่ายของ / Approved — Awaiting Issue (' + approved.length + ')</h3>' + adminReqTable(approved, 'approved') + '</div>' +
      '<div class="card"><h3>เสร็จสิ้น / Completed (3 เดือนล่าสุด)</h3>' +
      '<div class="flex mb"><span class="spacer"></span><button class="btn btn-ghost btn-sm" onclick="exportRequests()">⬇ Export Excel</button></div>' +
      requestTable(done, true) + '</div>';
  });
}

function adminReqTable(reqs, mode) {
  if (!reqs.length) return '<div class="empty">ไม่มีรายการ</div>';
  return '<div class="tbl-wrap"><table><thead><tr>' +
    '<th>เลขที่</th><th>ผู้เบิก</th><th>รายการ</th><th>วันที่ขอ</th><th>ดำเนินการ</th></tr></thead><tbody>' +
    reqs.map(function (r) {
      var itemsTxt = r.items.map(function (i) { return esc(i.itemName) + ' × ' + i.qty; }).join('<br>');
      var actions = '';
      if (mode === 'pending') {
        actions = '<button class="btn btn-green btn-sm" onclick="actApprove(\'' + r.requestId + '\')">อนุมัติ</button> ' +
          '<button class="btn btn-red btn-sm" onclick="actReject(\'' + r.requestId + '\')">ปฏิเสธ</button>';
      } else if (mode === 'approved') {
        actions = '<button class="btn btn-primary btn-sm" onclick="actIssue(\'' + r.requestId + '\')">จ่ายของ ✓</button>';
      }
      return '<tr><td class="mono">' + esc(r.requestId) + '</td>' +
        '<td>' + esc(r.employeeName) + '<br><span class="mono" style="color:var(--ink-dim);font-size:12px">' + esc(r.employeeId) + ' · ' + esc(r.department) + '</span></td>' +
        '<td style="font-size:13px">' + itemsTxt + '</td>' +
        '<td class="mono" style="font-size:12.5px">' + fmtDate(r.requestedAt) + '</td>' +
        '<td style="white-space:nowrap">' + actions + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function actApprove(reqId) {
  if (!confirm('อนุมัติคำขอ ' + reqId + '?')) return;
  api('approveRequest', { adminId: state.user.employeeId, requestId: reqId }).then(function (res) {
    if (!res.success) return toast(res.error, true);
    toast('อนุมัติแล้ว ✓');
    switchTab('approvals');
  });
}

function actReject(reqId) {
  var reason = prompt('เหตุผลการปฏิเสธ / Reject reason:');
  if (reason === null) return;
  api('rejectRequest', { adminId: state.user.employeeId, requestId: reqId, reason: reason }).then(function (res) {
    if (!res.success) return toast(res.error, true);
    toast('ปฏิเสธคำขอแล้ว');
    switchTab('approvals');
  });
}

function actIssue(reqId) {
  if (!confirm('ยืนยันจ่ายของ + ตัดสต็อก คำขอ ' + reqId + '?')) return;
  api('issueRequest', { adminId: state.user.employeeId, requestId: reqId }).then(function (res) {
    if (!res.success) return toast(res.error, true);
    toast('จ่ายของสำเร็จ ✓ สต็อกถูกตัดแล้ว');
    if (res.lowStock && res.lowStock.length) {
      toast('⚠ มี ' + res.lowStock.length + ' รายการสต็อกต่ำ — ส่งอีเมลแจ้งเตือนแล้ว', true);
    }
    switchTab('approvals');
  });
}

/* ================================================================
 * TAB: จัดการสต็อก (Stock In / Adjust)
 * ================================================================ */
function renderStock(host) {
  loadMaster().then(function () {
    var opts = state.master.items.filter(function (i) { return i.active; })
      .map(function (i) { return '<option value="' + esc(i.itemId) + '">' + esc(i.itemName) + ' (คงเหลือ ' + i.currentStock + ' ' + esc(i.unit) + ')</option>'; }).join('');
    host.innerHTML =
      '<div class="grid2">' +
      '<div class="card"><h3>รับเข้าสต็อก / Stock In</h3>' +
      '<label>อุปกรณ์ / Item</label><select id="siItem">' + opts + '</select>' +
      '<div class="mt"><label>จำนวนรับเข้า / Qty</label><input id="siQty" type="number" min="1"></div>' +
      '<div class="mt"><label>หมายเหตุ (เลขที่ PO ฯลฯ)</label><input id="siNote"></div>' +
      '<button class="btn btn-green mt" onclick="doStockIn()">บันทึกรับเข้า ✓</button></div>' +
      '<div class="card"><h3>ปรับปรุงสต็อก / Adjust (นับสต็อกจริง)</h3>' +
      '<label>อุปกรณ์ / Item</label><select id="adjItem">' + opts + '</select>' +
      '<div class="mt"><label>จำนวนที่นับได้จริง / Actual Count</label><input id="adjQty" type="number" min="0"></div>' +
      '<div class="mt"><label>หมายเหตุ / Note</label><input id="adjNote" placeholder="เช่น นับสต็อกประจำเดือน"></div>' +
      '<button class="btn btn-primary mt" onclick="doAdjust()">บันทึกปรับปรุง</button></div>' +
      '</div>' +
      '<div class="card"><h3>สต็อกคงเหลือทั้งหมด / Current Stock</h3>' +
      '<div class="flex mb"><span class="spacer"></span><button class="btn btn-ghost btn-sm" onclick="exportStock()">⬇ Export Excel</button></div>' +
      stockTable() + '</div>';
  });
}

function stockTable() {
  var items = state.master.items;
  if (!items.length) return '<div class="empty">ยังไม่มีอุปกรณ์</div>';
  return '<div class="tbl-wrap"><table><thead><tr>' +
    '<th>รหัส</th><th>ชื่ออุปกรณ์</th><th>หมวดหมู่</th><th style="text-align:right">คงเหลือ</th><th style="text-align:right">ขั้นต่ำ</th><th>หน่วย</th><th>สถานะ</th></tr></thead><tbody>' +
    items.map(function (it) {
      var lowCls = it.currentStock <= it.minStock ? ' class="low-flag"' : '';
      return '<tr><td class="mono">' + esc(it.itemId) + '</td><td>' + esc(it.itemName) + '</td>' +
        '<td style="font-size:13px">' + esc(catName(it.category)) + '</td>' +
        '<td class="num-cell"><span' + lowCls + '>' + it.currentStock + '</span></td>' +
        '<td class="num-cell">' + it.minStock + '</td><td>' + esc(it.unit) + '</td>' +
        '<td>' + (it.active ? '<span class="pill p-issued">ใช้งาน</span>' : '<span class="pill p-rejected">ปิด</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function doStockIn() {
  var itemId = document.getElementById('siItem').value;
  var qty = document.getElementById('siQty').value;
  if (!qty || qty <= 0) return toast('กรุณากรอกจำนวน', true);
  api('stockIn', { adminId: state.user.employeeId, itemId: itemId, qty: qty, note: document.getElementById('siNote').value })
    .then(function (res) {
      if (!res.success) return toast(res.error, true);
      toast('รับเข้าสำเร็จ ✓ คงเหลือใหม่: ' + res.newStock);
      switchTab('stock');
    });
}

function doAdjust() {
  var itemId = document.getElementById('adjItem').value;
  var qty = document.getElementById('adjQty').value;
  if (qty === '' || qty < 0) return toast('กรุณากรอกจำนวนที่นับได้', true);
  if (!confirm('ปรับสต็อกเป็น ' + qty + '? ระบบจะบันทึกส่วนต่างเป็น ADJUST')) return;
  api('adjustStock', { adminId: state.user.employeeId, itemId: itemId, newQty: qty, note: document.getElementById('adjNote').value })
    .then(function (res) {
      if (!res.success) return toast(res.error, true);
      toast('ปรับปรุงสำเร็จ ✓ (ส่วนต่าง ' + (res.diff > 0 ? '+' : '') + res.diff + ')');
      var it = state.master.items.find(function (x) { return x.itemId === itemId; });
      if (it && Number(qty) <= it.minStock) {
        toast('⚠ สต็อกต่ำกว่าขั้นต่ำ — ส่งอีเมลแจ้งเตือนแล้ว', true);
      }
      switchTab('stock');
    });
}

/* ================================================================
 * TAB: Master Data (items / categories / employees)
 * ================================================================ */
function renderMaster(host) {
  loadMaster().then(function () {
    host.innerHTML =
      '<div class="card"><h3>อุปกรณ์ / Items</h3>' +
      '<div class="flex mb"><button class="btn btn-primary btn-sm" onclick="editItem()">+ เพิ่มอุปกรณ์</button></div>' +
      itemAdminTable() + '</div>' +

      '<div class="card"><h3>หมวดหมู่ / Categories</h3>' +
      '<div class="flex mb"><button class="btn btn-primary btn-sm" onclick="editCategory()">+ เพิ่มหมวดหมู่</button></div>' +
      '<div class="tbl-wrap"><table><thead><tr><th>รหัส</th><th>ชื่อหมวดหมู่</th><th></th></tr></thead><tbody>' +
      state.master.categories.map(function (c) {
        return '<tr><td class="mono">' + esc(c.categoryId) + '</td><td>' + esc(c.categoryName) + '</td>' +
          '<td><button class="btn btn-ghost btn-sm" onclick="editCategory(\'' + esc(c.categoryId) + '\',\'' + esc(c.categoryName) + '\')">แก้ไข</button></td></tr>';
      }).join('') + '</tbody></table></div></div>' +

      '<div class="card"><h3>พนักงาน / Employees</h3>' +
      '<div class="flex mb">' +
      '<button class="btn btn-primary btn-sm" onclick="editEmployee()">+ เพิ่มพนักงาน</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="showImportEmp()">⬆ นำเข้าจาก CSV/Excel</button>' +
      '</div><div id="empTableHost"><div class="empty"><span class="loader"></span></div></div></div>';
    loadEmployeeTable();
  });
}

function itemAdminTable() {
  return '<div class="tbl-wrap"><table><thead><tr>' +
    '<th>รหัส</th><th>ชื่ออุปกรณ์</th><th>หมวดหมู่</th><th>ประเภท</th><th style="text-align:right">คงเหลือ</th><th style="text-align:right">ขั้นต่ำ</th><th></th></tr></thead><tbody>' +
    state.master.items.map(function (it) {
      return '<tr><td class="mono">' + esc(it.itemId) + '</td><td>' + esc(it.itemName) + '</td>' +
        '<td style="font-size:13px">' + esc(catName(it.category)) + '</td>' +
        '<td>' + (it.type === 'asset' ? '<span class="pill p-approved">ยืม-คืน</span>' : '<span class="pill p-pending">ใช้แล้วหมด</span>') + '</td>' +
        '<td class="num-cell">' + it.currentStock + '</td><td class="num-cell">' + it.minStock + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" onclick=\'editItem(' + JSON.stringify(it).replace(/'/g, '&#39;') + ')\'>แก้ไข</button></td></tr>';
    }).join('') + '</tbody></table></div>';
}

function editItem(it) {
  it = it || {};
  var catOpts = state.master.categories.map(function (c) {
    return '<option value="' + esc(c.categoryId) + '"' + (it.category === c.categoryId ? ' selected' : '') + '>' + esc(c.categoryName) + '</option>';
  }).join('');
  openModal(
    '<h3>' + (it.itemId ? 'แก้ไขอุปกรณ์' : 'เพิ่มอุปกรณ์ใหม่') + '</h3>' +
    (it.itemId ? '<input type="hidden" id="fItemId" value="' + esc(it.itemId) + '">' : '<input type="hidden" id="fItemId" value="">') +
    '<label>ชื่ออุปกรณ์ (ไทย / English)</label><input id="fItemName" value="' + esc(it.itemName || '') + '">' +
    '<div class="grid2 mt"><div><label>หมวดหมู่</label><select id="fCategory">' + catOpts + '</select></div>' +
    '<div><label>หน่วยนับ</label><input id="fUnit" value="' + esc(it.unit || '') + '" placeholder="เช่น ด้าม/pc"></div></div>' +
    '<div class="grid2 mt"><div><label>ประเภท</label><select id="fType">' +
    '<option value="consumable"' + (it.type !== 'asset' ? ' selected' : '') + '>ใช้แล้วหมดไป / Consumable</option>' +
    '<option value="asset"' + (it.type === 'asset' ? ' selected' : '') + '>ยืม-คืน / Asset (อนาคต)</option></select></div>' +
    '<div><label>สต็อกขั้นต่ำ / Min Stock</label><input id="fMinStock" type="number" min="0" value="' + (it.minStock || 0) + '"></div></div>' +
    (!it.itemId ? '<div class="mt"><label>สต็อกเริ่มต้น / Initial Stock</label><input id="fInitStock" type="number" min="0" value="0"></div>' : '') +
    (it.itemId ? '<div class="mt"><label>สถานะ</label><select id="fActive"><option value="true"' + (it.active ? ' selected' : '') + '>ใช้งาน</option><option value="false"' + (!it.active ? ' selected' : '') + '>ปิดใช้งาน</option></select></div>' : '') +
    '<div class="flex mt"><span class="spacer"></span>' +
    '<button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>' +
    '<button class="btn btn-primary" onclick="saveItem()">บันทึก</button></div>'
  );
}

function saveItem() {
  var p = {
    adminId: state.user.employeeId,
    itemId: document.getElementById('fItemId').value || undefined,
    itemName: document.getElementById('fItemName').value.trim(),
    category: document.getElementById('fCategory').value,
    unit: document.getElementById('fUnit').value.trim(),
    type: document.getElementById('fType').value,
    minStock: document.getElementById('fMinStock').value
  };
  if (!p.itemName) return toast('กรุณากรอกชื่ออุปกรณ์', true);
  var init = document.getElementById('fInitStock');
  if (init) p.initialStock = init.value;
  var act = document.getElementById('fActive');
  if (act) p.active = act.value === 'true';
  api('saveItem', p).then(function (res) {
    if (!res.success) return toast(res.error, true);
    closeModal(); toast('บันทึกสำเร็จ ✓'); switchTab('master');
  });
}

function editCategory(id, name) {
  openModal(
    '<h3>' + (id ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่') + '</h3>' +
    '<input type="hidden" id="fCatId" value="' + esc(id || '') + '">' +
    '<label>ชื่อหมวดหมู่ (ไทย / English)</label><input id="fCatName" value="' + esc(name || '') + '">' +
    '<div class="flex mt"><span class="spacer"></span>' +
    '<button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>' +
    '<button class="btn btn-primary" onclick="saveCategory()">บันทึก</button></div>'
  );
}

function saveCategory() {
  var p = {
    adminId: state.user.employeeId,
    categoryId: document.getElementById('fCatId').value || undefined,
    categoryName: document.getElementById('fCatName').value.trim()
  };
  if (!p.categoryName) return toast('กรุณากรอกชื่อหมวดหมู่', true);
  api('saveCategory', p).then(function (res) {
    if (!res.success) return toast(res.error, true);
    closeModal(); toast('บันทึกสำเร็จ ✓'); switchTab('master');
  });
}

/* ---- employees ---- */
var _empCache = [];
function loadEmployeeTable() {
  // employees come via login lookups only; fetch via a lightweight trick: reuse getRequests? No — add simple listing via master? 
  // Employees list is admin-only; use importEmployees sheet read through dedicated call:
  api('getEmployees', { adminId: state.user.employeeId }).then(function (res) {
    var hostEl = document.getElementById('empTableHost');
    if (!hostEl) return;
    if (!res.success) { hostEl.innerHTML = '<div class="empty">' + esc(res.error || 'โหลดไม่สำเร็จ') + '</div>'; return; }
    _empCache = res.employees;
    hostEl.innerHTML = '<div class="tbl-wrap"><table><thead><tr>' +
      '<th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>สิทธิ์</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
      res.employees.map(function (e) {
        var roleLbl = e.role === 'it_admin' ? 'IT Admin' : e.role === 'warehouse_admin' ? 'Warehouse' : 'User';
        return '<tr><td class="mono">' + esc(e.employeeId) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.department) + '</td>' +
          '<td><span class="role-tag">' + roleLbl + '</span></td>' +
          '<td>' + (e.active ? '<span class="pill p-issued">ใช้งาน</span>' : '<span class="pill p-rejected">ปิด</span>') + '</td>' +
          '<td><button class="btn btn-ghost btn-sm" onclick=\'editEmployee(' + JSON.stringify(e).replace(/'/g, '&#39;') + ')\'>แก้ไข</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  });
}

function editEmployee(e) {
  e = e || {};
  openModal(
    '<h3>' + (e.employeeId ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน') + '</h3>' +
    '<label>รหัสพนักงาน / Employee ID</label><input id="fEmpId" class="mono" value="' + esc(e.employeeId || '') + '"' + (e.employeeId ? ' readonly style="opacity:.6"' : '') + '>' +
    '<div class="mt"><label>ชื่อ-นามสกุล / Name</label><input id="fEmpName" value="' + esc(e.name || '') + '"></div>' +
    '<div class="grid2 mt"><div><label>แผนก / Department</label><input id="fEmpDept" value="' + esc(e.department || '') + '"></div>' +
    '<div><label>สิทธิ์ / Role</label><select id="fEmpRole">' +
    '<option value="user"' + (!e.role || e.role === 'user' ? ' selected' : '') + '>User (เบิกของ)</option>' +
    '<option value="warehouse_admin"' + (e.role === 'warehouse_admin' ? ' selected' : '') + '>Warehouse Admin</option>' +
    '<option value="it_admin"' + (e.role === 'it_admin' ? ' selected' : '') + '>IT Admin</option></select></div></div>' +
    (e.employeeId ? '<div class="mt"><label>สถานะ</label><select id="fEmpActive"><option value="true"' + (e.active ? ' selected' : '') + '>ใช้งาน</option><option value="false"' + (!e.active ? ' selected' : '') + '>ปิดใช้งาน</option></select></div>' : '') +
    '<div class="flex mt"><span class="spacer"></span>' +
    '<button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>' +
    '<button class="btn btn-primary" onclick="saveEmployee()">บันทึก</button></div>'
  );
}

function saveEmployee() {
  var p = {
    adminId: state.user.employeeId,
    employeeId: document.getElementById('fEmpId').value.trim(),
    name: document.getElementById('fEmpName').value.trim(),
    department: document.getElementById('fEmpDept').value.trim(),
    role: document.getElementById('fEmpRole').value
  };
  if (!p.employeeId || !p.name) return toast('กรุณากรอกรหัสและชื่อ', true);
  var act = document.getElementById('fEmpActive');
  if (act) p.active = act.value === 'true';
  api('saveEmployee', p).then(function (res) {
    if (!res.success) return toast(res.error, true);
    closeModal(); toast('บันทึกสำเร็จ ✓'); loadEmployeeTable();
  });
}

function showImportEmp() {
  openModal(
    '<h3>นำเข้าพนักงานจากไฟล์ / Import Employees</h3>' +
    '<div class="section-note">รองรับ .csv .xlsx — คอลัมน์: EmployeeID, Name, Department (แถวแรกเป็นหัวตาราง)<br>รหัสที่มีอยู่แล้วจะถูกข้าม (skip duplicates)</div>' +
    '<input type="file" id="fImpFile" accept=".csv,.xlsx,.xls">' +
    '<div id="impPreview" class="mt"></div>' +
    '<div class="flex mt"><span class="spacer"></span>' +
    '<button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>' +
    '<button class="btn btn-primary" id="btnImp" onclick="doImportEmp()" disabled>นำเข้า</button></div>'
  );
  document.getElementById('fImpFile').addEventListener('change', previewImport);
}

var _importRows = [];
function previewImport(ev) {
  var file = ev.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    var wb = XLSX.read(e.target.result, { type: 'array' });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    _importRows = rows.slice(1).filter(function (r) { return String(r[0]).trim(); })
      .map(function (r) { return { employeeId: String(r[0]).trim(), name: String(r[1] || '').trim(), department: String(r[2] || '').trim() }; });
    document.getElementById('impPreview').innerHTML =
      '<div style="font-size:13.5px;color:var(--green)">พบ ' + _importRows.length + ' รายการ</div>' +
      '<div class="tbl-wrap" style="max-height:200px;overflow-y:auto"><table><tbody>' +
      _importRows.slice(0, 10).map(function (r) {
        return '<tr><td class="mono">' + esc(r.employeeId) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.department) + '</td></tr>';
      }).join('') + (_importRows.length > 10 ? '<tr><td colspan="3" style="color:var(--ink-dim)">... และอีก ' + (_importRows.length - 10) + ' รายการ</td></tr>' : '') +
      '</tbody></table></div>';
    document.getElementById('btnImp').disabled = !_importRows.length;
  };
  reader.readAsArrayBuffer(file);
}

function doImportEmp() {
  var btn = document.getElementById('btnImp');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span>';
  api('importEmployees', { adminId: state.user.employeeId, employees: _importRows }).then(function (res) {
    if (!res.success) { toast(res.error, true); btn.disabled = false; btn.textContent = 'นำเข้า'; return; }
    closeModal();
    toast('นำเข้าสำเร็จ ✓ เพิ่ม ' + res.added + ' / ข้าม ' + res.skipped + ' รายการ');
    loadEmployeeTable();
  });
}

/* ================================================================
 * TAB: ความเคลื่อนไหว (movements)
 * ================================================================ */
function renderMovements(host) {
  Promise.all([api('getMovements', {}), loadMaster()]).then(function (results) {
    var res = results[0];
    if (!res.success) { host.innerHTML = '<div class="empty">' + esc(res.error) + '</div>'; return; }
    window._movesCache = res.movements;
    // itemId -> category map for category filter
    window._itemCatMap = {};
    state.master.items.forEach(function (it) { window._itemCatMap[it.itemId] = it.category; });
    var catOpts = '<option value="">ทุกหมวดหมู่ / All</option>' +
      state.master.categories.map(function (c) {
        return '<option value="' + esc(c.categoryId) + '">' + esc(c.categoryName) + '</option>';
      }).join('');
    host.innerHTML =
      '<div class="card"><h3>ความเคลื่อนไหวสต็อก (ย้อนหลัง 3 เดือน) / Stock Movements</h3>' +
      '<div class="filter-bar">' +
      '<div class="fb-field"><label>จากวันที่ / From</label><input type="date" id="mvFrom" onchange="drawMovements()"></div>' +
      '<div class="fb-field"><label>ถึงวันที่ / To</label><input type="date" id="mvTo" onchange="drawMovements()"></div>' +
      '<div class="fb-field"><label>ประเภท / Type</label><select id="mvType" onchange="drawMovements()">' +
      '<option value="">ทั้งหมด / All</option>' +
      '<option value="IN">รับเข้า / IN</option><option value="OUT">เบิกจ่าย / OUT</option>' +
      '<option value="ADJUST">ปรับปรุง / ADJUST</option></select></div>' +
      '<div class="fb-field" style="min-width:180px"><label>หมวดหมู่ / Category</label><select id="mvCat" onchange="drawMovements()">' + catOpts + '</select></div>' +
      '<button class="btn btn-ghost btn-sm" onclick="clearMvFilter()">ล้าง / Clear</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-ghost btn-sm" onclick="exportMovements()">⬇ Export Excel</button>' +
      '</div>' +
      '<div id="mvSummary"></div><div id="mvTable"></div></div>';
    drawMovements();
  });
}

function clearMvFilter() {
  ['mvFrom', 'mvTo', 'mvType', 'mvCat'].forEach(function (id) { document.getElementById(id).value = ''; });
  drawMovements();
}

function drawMovements() {
  var el = document.getElementById('mvTable');
  if (!el) return;
  var moves = filterByDateStatus(window._movesCache || [], 'mvFrom', 'mvTo', 'mvType', 'at', 'type');
  var cat = document.getElementById('mvCat').value;
  if (cat) moves = moves.filter(function (m) { return (window._itemCatMap[m.itemId] || '') === cat; });
  window._movesFiltered = moves; // export uses filtered view

  // summary strip: totals per type of the filtered set
  var tIn = 0, tOut = 0, tAdj = 0;
  moves.forEach(function (m) {
    if (m.type === 'IN') tIn += m.qty;
    else if (m.type === 'OUT') tOut += Math.abs(m.qty);
    else tAdj += m.qty;
  });
  document.getElementById('mvSummary').innerHTML =
    '<div class="flex mb" style="gap:16px;font-size:13.5px">' +
    '<span>แสดง <b class="mono">' + moves.length + '</b> รายการ</span>' +
    '<span style="color:var(--green)">รับเข้า <b class="mono">+' + tIn + '</b></span>' +
    '<span style="color:var(--red)">เบิกจ่าย <b class="mono">-' + tOut + '</b></span>' +
    '<span style="color:var(--blue)">ปรับปรุง <b class="mono">' + (tAdj >= 0 ? '+' : '') + tAdj + '</b></span></div>';

  el.innerHTML = moves.length
    ? '<div class="tbl-wrap"><table><thead><tr><th>วันที่</th><th>ประเภท</th><th>อุปกรณ์</th><th style="text-align:right">จำนวน</th><th>อ้างอิง</th><th>โดย</th><th>หมายเหตุ</th></tr></thead><tbody>' +
      moves.map(function (m) {
        return '<tr><td class="mono" style="font-size:12.5px">' + fmtDate(m.at) + '</td>' +
          '<td>' + pill(m.type) + '</td><td>' + esc(m.itemName) + '</td>' +
          '<td class="num-cell" style="color:' + (m.qty >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (m.qty > 0 ? '+' : '') + m.qty + '</td>' +
          '<td class="mono" style="font-size:12px">' + esc(m.ref) + '</td><td class="mono" style="font-size:12px">' + esc(m.by) + '</td>' +
          '<td style="font-size:13px;color:var(--ink-dim)">' + esc(m.note) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
    : '<div class="empty">ไม่มีรายการตามเงื่อนไข / No records match filters</div>';
}

/* ================================================================
 * TAB: ตั้งค่าแจ้งเตือน (alert emails)
 * ================================================================ */
function renderSettings(host) {
  api('getAlertEmails').then(function (res) {
    if (!res.success) { host.innerHTML = '<div class="empty">' + esc(res.error) + '</div>'; return; }
    host.innerHTML =
      '<div class="card"><h3>อีเมลรับแจ้งเตือนสต็อกต่ำ / Low Stock Alert Recipients</h3>' +
      '<div class="section-note">ระบบส่งอีเมลอัตโนมัติเมื่อจ่ายของแล้วสต็อกเหลือ ≤ จุดสั่งซื้อขั้นต่ำ</div>' +
      '<div class="flex mb"><div style="flex:1;max-width:340px"><input id="fAlertEmail" placeholder="name@company.com" onkeydown="if(event.key===\'Enter\')addAlertEmail()"></div>' +
      '<button class="btn btn-primary btn-sm" onclick="addAlertEmail()">+ เพิ่มอีเมล</button></div>' +
      (res.emails.length
        ? '<div class="tbl-wrap"><table><thead><tr><th>อีเมล</th><th>เพิ่มโดย</th><th>วันที่</th><th></th></tr></thead><tbody>' +
          res.emails.map(function (e) {
            return '<tr><td>' + esc(e.email) + '</td><td class="mono" style="font-size:12.5px">' + esc(e.addedBy) + '</td>' +
              '<td class="mono" style="font-size:12.5px">' + fmtDate(e.addedAt) + '</td>' +
              '<td><button class="btn btn-red btn-sm" onclick="removeAlertEmail(\'' + esc(e.email) + '\')">ลบ</button></td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="empty">ยังไม่มีอีเมลผู้รับ — เพิ่มอย่างน้อย 1 อีเมลเพื่อเปิดใช้การแจ้งเตือน</div>') +
      '</div>';
  });
}

function addAlertEmail() {
  var email = document.getElementById('fAlertEmail').value.trim();
  if (!email) return;
  api('addAlertEmail', { adminId: state.user.employeeId, email: email }).then(function (res) {
    if (!res.success) return toast(res.error, true);
    toast('เพิ่มอีเมลแล้ว ✓'); switchTab('settings');
  });
}

function removeAlertEmail(email) {
  if (!confirm('ลบ ' + email + ' ออกจากรายชื่อแจ้งเตือน?')) return;
  api('removeAlertEmail', { adminId: state.user.employeeId, email: email }).then(function (res) {
    if (!res.success) return toast(res.error, true);
    toast('ลบแล้ว'); switchTab('settings');
  });
}

/* ================================================================
 * EXPORT EXCEL — bilingual TH + EN headers
 * ================================================================ */
function dlExcel(rows, sheetName, filename) {
  var ws = XLSX.utils.aoa_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

function exportStock() {
  var rows = [['รหัส / Item ID', 'ชื่ออุปกรณ์ / Item Name', 'หมวดหมู่ / Category', 'ประเภท / Type',
    'คงเหลือ / Current Stock', 'ขั้นต่ำ / Min Stock', 'หน่วย / Unit', 'สถานะ / Status']];
  state.master.items.forEach(function (it) {
    rows.push([it.itemId, it.itemName, catName(it.category),
      it.type === 'asset' ? 'ยืม-คืน / Asset' : 'ใช้แล้วหมด / Consumable',
      it.currentStock, it.minStock, it.unit,
      it.active ? 'ใช้งาน / Active' : 'ปิด / Inactive']);
  });
  dlExcel(rows, 'Stock', 'WFDC_Stock_' + todayStr() + '.xlsx');
}

function exportMovements() {
  var moves = window._movesFiltered || window._movesCache || [];
  var rows = [['วันที่ / Date', 'ประเภท / Type', 'รหัส / Item ID', 'ชื่ออุปกรณ์ / Item Name',
    'จำนวน / Qty', 'อ้างอิง / Ref', 'โดย / By', 'หมายเหตุ / Note']];
  moves.forEach(function (m) {
    var typeTh = m.type === 'IN' ? 'รับเข้า / IN' : m.type === 'OUT' ? 'เบิกจ่าย / OUT' : 'ปรับปรุง / ADJUST';
    rows.push([fmtDate(m.at), typeTh, m.itemId, m.itemName, m.qty, m.ref, m.by, m.note]);
  });
  dlExcel(rows, 'Movements', 'WFDC_Movements_' + todayStr() + '.xlsx');
}

function exportRequests() {
  api('getRequests', { all: true }).then(function (res) {
    if (!res.success) return toast(res.error, true);
    var rows = [['เลขที่ / Request ID', 'รหัสพนักงาน / Employee ID', 'ชื่อ / Name', 'แผนก / Department',
      'อุปกรณ์ / Item', 'จำนวน / Qty', 'หน่วย / Unit', 'สถานะ / Status',
      'วันที่ขอ / Requested', 'อนุมัติโดย / Approved By', 'จ่ายโดย / Issued By', 'เหตุผลปฏิเสธ / Reject Reason']];
    var statusTh = { pending: 'รออนุมัติ / Pending', approved: 'อนุมัติแล้ว / Approved', issued: 'จ่ายแล้ว / Issued', rejected: 'ปฏิเสธ / Rejected' };
    res.requests.forEach(function (r) {
      r.items.forEach(function (i) {
        rows.push([r.requestId, r.employeeId, r.employeeName, r.department,
          i.itemName, i.qty, i.unit, statusTh[r.status] || r.status,
          fmtDate(r.requestedAt), r.approvedBy, r.issuedBy, r.rejectReason]);
      });
    });
    dlExcel(rows, 'Requests', 'WFDC_Requests_' + todayStr() + '.xlsx');
  });
}

function todayStr() {
  var d = new Date();
  return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
}
