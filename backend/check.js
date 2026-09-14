
const API = '';
let token = localStorage.getItem('token');
let currentPage = 1;
let currentFilter = '';

function authHeaders() { return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }; }

/* === TOAST === */
function showToast(msg, type='info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `${type==='success'?'✅':type==='error'?'❌':'ℹ️'} ${msg}<span style="margin-left:10px;cursor:pointer;font-weight:800;opacity:0.7;" onclick="this.parentElement.remove()">&times;</span>`;
  t.style.cursor = 'pointer';
  t.onclick = () => t.remove();
  c.appendChild(t);
  setTimeout(() => { t.classList.add('removing'); setTimeout(() => t.remove(), 300); }, 2500);
}

/* === CONFIRM === */
function showConfirm(title, message, type='danger') {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'confirm-overlay';
    ov.innerHTML = `<div class="confirm-box">
      <div class="confirm-icon">${type==='danger'?'⚠️':'❓'}</div>
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="confirm-actions">
        <button class="btn-cancel" onclick="this.closest('.confirm-overlay').remove()">Batal</button>
        <button class="btn-confirm ${type}" onclick="this.closest('.confirm-overlay').remove();window._confirmResolve(true)">Ya, Lanjut</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    window._confirmResolve = resolve;
  });
}

/* === AUTH === */
function showLogin() { document.getElementById('loginPage').classList.remove('hidden'); document.getElementById('registerPage').classList.add('hidden'); }
function showRegister() { document.getElementById('loginPage').classList.add('hidden'); document.getElementById('registerPage').classList.remove('hidden'); }

async function login() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) { showToast('Email dan password wajib diisi', 'error'); return; }
  try {
    const res = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    token = data.token;
    localStorage.setItem('token', token);
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('userAvatar').textContent = data.user.name.charAt(0).toUpperCase();
    document.getElementById('dashUserName').textContent = data.user.name;
    document.getElementById('dashUserNameAvatar').textContent = data.user.name.charAt(0).toUpperCase();
    showToast('Selamat datang, ' + data.user.name + '!', 'success');
    loadDashboard();
  } catch (e) {
    const el = document.getElementById('loginError');
    el.textContent = e.message; el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  }
}

async function register() {
  const name = document.getElementById('regName').value, email = document.getElementById('regEmail').value, password = document.getElementById('regPassword').value;
  try {
    const res = await fetch(`${API}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    token = data.token; localStorage.setItem('token', token);
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('registerPage').classList.add('hidden');
    document.getElementById('userAvatar').textContent = data.user.name.charAt(0).toUpperCase();
    document.getElementById('dashUserName').textContent = data.user.name;
    document.getElementById('dashUserNameAvatar').textContent = data.user.name.charAt(0).toUpperCase();
    showToast('Akun berhasil dibuat!', 'success');
    loadDashboard();
  } catch (e) {
    const el = document.getElementById('regError');
    el.textContent = e.message; el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  }
}

function logout() { token = null; localStorage.removeItem('token'); document.getElementById('app').classList.add('hidden'); document.getElementById('loginPage').classList.remove('hidden'); }

/* === LOADING HELPER === */
function setLoading(btn, loading) {
  if(loading) { btn.disabled=true; btn._oldText=btn.innerHTML; btn.innerHTML='<span class="spinner"></span>'; }
  else { btn.disabled=false; btn.innerHTML=btn._oldText||btn.innerHTML; }
}

/* === TOGGLE PASSWORD === */
function togglePass(fieldId) {
  const inp = document.getElementById(fieldId);
  const isPass = inp.type === 'password';
  inp.type = isPass ? 'text' : 'password';
  inp.nextElementSibling.textContent = isPass ? '👁️‍🗨️' : '🔒';
}

/* === SHOW SKELETON === */
function showSkeleton(containerId, count) {
  const el = document.getElementById(containerId);
  if (!el) return;
  let html = '';
  for (let i = 0; i < count; i++) html += '<div class="skeleton skeleton-card"></div>';
  el.innerHTML = html;
}

/* === NAVIGATION === */
function switchPage(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll(`[data-page="${page}"]`).forEach(n => n.classList.add('active'));
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
  const el = document.getElementById(`page-${page}`);
  el.style.display = 'block';
  requestAnimationFrame(() => el.classList.add('active'));
  if (page === 'dashboard') loadDashboard();
  if (page === 'pos') loadPOs();
  if (page === 'deliveries') loadDeliveries();
  if (page === 'reports') { switchReportTab(document.querySelector('.report-tab.active'),'all'); }
  if (page === 'profile') loadProfile();
}

function openPage(page) {
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
  const el = document.getElementById(`page-${page}`);
  el.style.display = 'block';
  requestAnimationFrame(() => el.classList.add('active'));
}

/* === DASHBOARD === */
async function loadDashboard() {
  let s = {}, poData = { data: [] }, deliveries = [];

  try {
    const statsRes = await fetch(`${API}/api/po/stats`, { headers: authHeaders() });
    if (statsRes.ok) s = await statsRes.json();
    else console.error('Stats error:', statsRes.status);
  } catch (e) { console.error('Stats fetch error:', e); }

  try {
    const poRes = await fetch(`${API}/api/po?limit=5`, { headers: authHeaders() });
    if (poRes.ok) poData = await poRes.json();
    else console.error('PO list error:', poRes.status);
  } catch (e) { console.error('PO list fetch error:', e); }

  try {
    const delRes = await fetch(`${API}/api/deliveries?limit=100`, { headers: authHeaders() });
    if (delRes.ok) { const dd = await delRes.json(); deliveries = Array.isArray(dd) ? dd : (dd.data || []); }
  } catch (e) { console.error('Deliveries fetch error:', e); }

  document.getElementById('badgeTotalPO').textContent = s.totalPO || 0;
  document.getElementById('badgeTerkirim').textContent = (s.shippedQuantity || 0) + ' pcs';
  document.getElementById('badgeSisa').textContent = Math.max(0, s.remainingKubikasi || 0).toFixed(2);

  document.getElementById('widgetSisa').textContent = Math.max(0, s.remainingKubikasi || 0).toFixed(2) + ' m³';
  document.getElementById('widgetSisaSub').textContent = Math.max(0, s.remainingQuantity || 0) + ' pcs remaining';

  const today = new Date().toDateString();
  const todayDeliveries = deliveries.filter(d => new Date(d.deliveryDate).toDateString() === today);
  let todayKub = 0, todayPcs = 0;
  todayDeliveries.forEach(d => {
    if (d.items) d.items.forEach(i => { todayKub += i.kubikasi || 0; todayPcs += i.quantity || 0; });
  });
  document.getElementById('widgetHariIni').textContent = todayPcs + ' pcs';
  document.getElementById('widgetHariIniSub').textContent = todayKub.toFixed(2) + ' m³ • ' + todayDeliveries.length + ' pengiriman';

  renderRecentPO(poData.data || []);
}

function filterAndGo(status) {
  currentFilter = status;
  document.querySelectorAll('.filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.status === status);
  });
  switchPage('pos');
}

/* === PO LIST === */
function filterPO(el) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  currentFilter = el.dataset.status;
  currentPage = 1;
  loadPOs();
}

async function loadPOs() {
  const search = document.getElementById('searchPO')?.value || '';
  showSkeleton('poList', 4);
  try {
    const res = await fetch(`${API}/api/po?search=${search}&status=${currentFilter}&page=${currentPage}&limit=10`, { headers: authHeaders() });
    const data = await res.json();
    renderPOCards(data.data || [], 'poList', false);
    renderPagination(data.pagination);
  } catch (e) {
    document.getElementById('poList').innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span><p>Gagal memuat data. Coba lagi.</p></div>';
    console.error(e);
  }
}

function renderPOCards(pos, containerId, compact) {
  const container = document.getElementById(containerId);
  if (!pos || pos.length === 0) {
    const hasSearch = (document.getElementById('searchPO')?.value || '').trim().length > 0;
    const hasFilter = currentFilter.trim().length > 0;
    if (hasSearch || hasFilter) {
      container.innerHTML = '<div class="empty-state"><span class="empty-icon">🔍</span><p>Tidak ditemukan PO yang cocok</p></div>';
    } else {
      container.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span><p>Belum ada data</p></div>';
    }
    return;
  }
  container.innerHTML = pos.map((p, i) => {
    const remainingItems = (p.items || []).map(item => {
      const shipped = (p.deliveries || []).reduce((s, d) => s + d.items.reduce((ss, di) => di.poItemId === item.id ? ss + di.quantity : ss, 0), 0);
      const rem = item.quantity - shipped;
      return rem > 0 ? { ...item, remaining: rem, remKub: (item.kubikasi / item.quantity) * rem } : null;
    }).filter(Boolean);
    const totalRemKub = remainingItems.reduce((s, ri) => s + ri.remKub, 0);
    const totalRemQty = remainingItems.reduce((s, ri) => s + ri.remaining, 0);
    return `
    <div class="po-card fade-in" style="animation-delay:${i*0.06}s" onclick="viewPO('${p.id}')">
      <span class="status-badge ${p.status}">${p.status}</span>
      <div class="po-card-top">
        <div>
          <div class="po-card-num">${p.poNumber}</div>
          <div class="po-card-customer">${p.customerName}</div>
        </div>
      </div>
      <div class="po-card-meta">
        <div class="meta">📅 ${new Date(p.orderDate).toLocaleDateString('id-ID')}</div>
        <div class="meta">📦 ${p.totalQuantity} pcs • ${p.totalKubikasi?.toFixed(4)||0} m³</div>
      </div>
      ${remainingItems.length > 0 ? `<div class="po-remaining-items">
        ${remainingItems.map(ri => `<div class="remain-row">
          <span class="remain-name">${ri.productName}</span>
          <span class="remain-size">${ri.thickness}×${ri.width}×${ri.length}cm</span>
          <span class="remain-qty">${ri.remaining} pcs</span>
          <span class="remain-kub">${ri.remKub.toFixed(4)} m³</span>
        </div>`).join('')}
      </div>` : ''}
      <div class="po-card-bottom">
        <span class="kubikasi-badge sisa">Sisa ${totalRemQty} pcs • ${totalRemKub.toFixed(4)} m³</span>
      </div>
    </div>`;
  }).join('');
}

function renderPagination(p) {
  if (!p || p.totalPages <= 1) { document.getElementById('poPagination').innerHTML = ''; return; }
  let h = `<button ${p.page<=1?'disabled':''} onclick="currentPage=${p.page-1};loadPOs()">‹</button>`;
  for (let i=1;i<=p.totalPages;i++) h += `<button class="${i===p.page?'active':''}" onclick="currentPage=${i};loadPOs()">${i}</button>`;
  h += `<button ${p.page>=p.totalPages?'disabled':''} onclick="currentPage=${p.page+1};loadPOs()">›</button>`;
  document.getElementById('poPagination').innerHTML = h;
}

function renderRecentPO(pos) {
  const container = document.getElementById('recentPOList');
  if (!pos || !pos.length) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span><p>Belum ada data</p></div>';
    return;
  }
  let html = `<div class="recent-po-table" style="display:none;">
    <table class="data-table"><thead><tr><th>PO Number</th><th>Customer</th><th>Tanggal</th><th>Status</th><th>Qty</th><th>Kubikasi</th><th></th></tr></thead><tbody>`;
  pos.forEach(p => {
    html += `<tr onclick="viewPO('${p.id}')" style="cursor:pointer;">
      <td><strong>${p.poNumber}</strong></td>
      <td>${p.customerName}</td>
      <td>${fmtDateShort(p.orderDate)}</td>
      <td><span class="status-pill ${p.status}">${p.status}</span></td>
      <td>${p.totalQuantity} pcs</td>
      <td>${(p.totalKubikasi||0).toFixed(4)} m³</td>
      <td>→</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  html += `<div class="recent-po-cards">`;
  pos.forEach((p, i) => {
    html += `<div class="po-card status-${p.status} fade-in" style="animation-delay:${i*0.06}s" onclick="viewPO('${p.id}')">
      <div class="po-card-top">
        <div>
          <div class="po-card-num">${p.poNumber}</div>
          <div class="po-card-customer">${p.customerName}</div>
        </div>
        <span class="status-pill ${p.status}">${p.status}</span>
      </div>
      <div class="po-card-meta">
        <div class="meta">📅 ${fmtDateShort(p.orderDate)}</div>
        <div class="meta">📦 ${p.totalQuantity} pcs • ${(p.totalKubikasi||0).toFixed(4)} m³</div>
      </div>
    </div>`;
  });
  html += `</div>`;
  container.innerHTML = html;
}

/* === PO DETAIL === */
async function viewPO(id) {
  try {
    const res = await fetch(`${API}/api/po/${id}`, { headers: authHeaders() });
    const po = await res.json();
    document.getElementById('detailModalTitle').textContent = po.poNumber + ' - ' + po.customerName;
    document.getElementById('page-detail').classList.remove('hidden');
    document.getElementById('detailContent').innerHTML = `
      <div class="detail-header fade-in">
        <h2>${po.poNumber}</h2>
        <p>👤 ${po.customerName}</p>
        <p>📅 ${new Date(po.orderDate).toLocaleDateString('id-ID')}${po.deadline?' • Deadline: '+new Date(po.deadline).toLocaleDateString('id-ID'):''}</p>
        <p>📍 ${po.notes || '-'}</p>
        <div class="detail-stats">
          <div class="detail-stat"><div class="ds-label">Total</div><div class="ds-value">${po.totalKubikasi?.toFixed(4)||0} m³</div></div>
          <div class="detail-stat"><div class="ds-label">Terkirim</div><div class="ds-value">${(po.shippedKubikasi||0).toFixed(4)} m³</div></div>
          <div class="detail-stat"><div class="ds-label">Sisa</div><div class="ds-value">${(po.remainingKubikasi||0).toFixed(4)} m³</div></div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-sm" onclick="editPO('${po.id}')">✏️ Edit</button>
          <button class="btn btn-sm" onclick="openDeliveryModalForPO('${po.id}')">🚚 Kirim</button>
          <button class="btn btn-sm" onclick="printPO('${po.id}')">🖨️ Print</button>
          <select onchange="updatePOStatus('${po.id}',this.value)">
            <option value="diterima" ${po.status==='diterima'?'selected':''}>Diterima</option>
            <option value="diproses" ${po.status==='diproses'?'selected':''}>Diproses</option>
            <option value="dikirim" ${po.status==='dikirim'?'selected':''}>Dikirim</option>
            <option value="selesai" ${po.status==='selesai'?'selected':''}>Selesai</option>
            <option value="dibatalkan" ${po.status==='dibatalkan'?'selected':''}>Dibatalkan</option>
          </select>
          <button class="btn btn-sm btn-danger-solid" onclick="deletePO('${po.id}')">🗑️ Hapus</button>
        </div>
      </div>
      <div class="card slide-up"><div class="card-header"><h3>🪵 Item PO</h3><button class="btn btn-primary btn-sm" onclick="openItemModal('${po.id}')">+ Item</button></div>
        <div class="card-body" style="padding:0;overflow-x:auto;">
          <table class="mobile-table"><thead><tr><th>Produk</th><th>Ukuran</th><th>Qty</th><th>KUB</th><th></th></tr></thead>
          <tbody>${po.items.map(i=>`<tr>
            <td><strong>${i.productName}</strong></td>
            <td style="font-size:11px;color:var(--slate-500);">${i.thickness}×${i.width}×${i.length}cm</td>
            <td><strong>${i.quantity}</strong> ${i.unit}</td>
            <td class="kub-val">${i.kubikasi?.toFixed(4)} m³</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-secondary btn-sm" onclick="openItemModal('${po.id}','${i.id}')" style="padding:4px 8px;font-size:11px;">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteItem('${po.id}','${i.id}')" style="padding:4px 8px;font-size:11px;">Hapus</button>
            </td>
          </tr>`).join('')}</tbody></table>
        </div>
      </div>
      <div class="card slide-up" style="animation-delay:0.1s"><div class="card-header"><h3>🚚 Riwayat Pengiriman</h3></div>
        <div class="card-body" style="padding:0;overflow-x:auto;">
          ${po.deliveries&&po.deliveries.length>0?po.deliveries.map(d=>{
            const proofs = d.proofs || (d.proofUrl ? [{ id: null, url: d.proofUrl }] : []);
            const poNames = (d.deliveryPOs||[]).map(dp => dp.po?.poNumber).filter(Boolean);
            return `
            <div style="padding:14px 18px;border-bottom:1px solid var(--slate-100);">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div><strong>${d.driverName||'Tanpa Sopir'}</strong> <span style="color:var(--slate-500);">• ${d.vehicleNumber||'-'}</span></div>
                <span style="font-size:11px;color:var(--slate-500);font-weight:500;">${new Date(d.deliveryDate).toLocaleDateString('id-ID')}</span>
              </div>
              ${poNames.length > 1 ? `<div style="font-size:10px;font-weight:700;color:var(--teal-600);margin-bottom:6px;">📦 ${poNames.join(' • ')}</div>` : ''}
              <div style="font-size:12px;color:var(--slate-500);margin-bottom:8px;">📍 ${d.deliveryAddress||'-'}</div>
              <div style="margin-bottom:8px;">
                ${d.items.map(di=>`<span class="del-tag"><strong>${di.poItem?.productName||'-'}</strong> ${di.quantity} pcs • ${di.kubikasi?.toFixed(4)} m³</span>`).join('')}
              </div>
              <div style="border-top:1px solid var(--slate-100);padding-top:8px;margin-top:6px;">
                <div style="font-size:10px;font-weight:700;color:var(--slate-500);margin-bottom:4px;">📷 Bukti (${proofs.length})</div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;">
                  ${proofs.map(p => `<button onclick="openProofPreview('${p.url}')" class="proof-btn-view" style="font-size:10px;">📷 Lihat</button>`).join('')}
                  <button class="btn btn-success btn-sm" onclick="openProofModal('${d.id}')" style="font-size:10px;">+ Upload</button>
                </div>
              </div>
              <div class="proof-btn-wrap" style="margin-top:8px;">
                <button class="btn btn-primary btn-sm" onclick="editDeliveryFromDetail('${d.id}','${po.id}')" style="font-size:11px;">✏️ Edit</button>
              </div>
            </div>`;
          }).join(''):'<div class="empty-state"><span class="empty-icon">📭</span><p>Belum ada pengiriman</p></div>'}
        </div>
      </div>
    `;
  } catch (e) { showToast('Gagal memuat detail PO', 'error'); console.error(e); }
}

function closeDetail() {
  document.getElementById('page-detail').classList.add('hidden');
}

/* === PO CRUD === */
function openPOModal(poId) {
  document.getElementById('poModal').classList.remove('hidden');
  document.getElementById('poModalTitle').textContent = poId ? 'Edit PO' : 'Tambah PO Baru';
  document.getElementById('editPOId').value = poId||'';
  document.getElementById('poNumber').value = '';
  document.getElementById('customerName').value = '';
  document.getElementById('orderDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('deadline').value = '';
  document.getElementById('poNotes').value = '';
  document.getElementById('poItems').innerHTML = '';
  if (!poId) addItemRow();
}
function closePOModal() { document.getElementById('poModal').classList.add('hidden'); }

function addItemRow(data) {
  const tbody = document.getElementById('poItems');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td class="item-cell-name"><span class="item-field-label">Nama Produk</span><input type="text" class="item-name" value="${data?.productName||''}" placeholder="Nama"></td>
    <td class="item-cell-num"><span class="item-field-label">Tebal</span><input type="number" class="item-thickness" value="${data?.thickness||''}" step="0.1" oninput="calcRow(this)" placeholder="0"></td>
    <td class="item-cell-num"><span class="item-field-label">Lebar</span><input type="number" class="item-width" value="${data?.width||''}" step="0.1" oninput="calcRow(this)" placeholder="0"></td>
    <td class="item-cell-num"><span class="item-field-label">Pjg</span><input type="number" class="item-length" value="${data?.length||''}" step="0.1" oninput="calcRow(this)" placeholder="0"></td>
    <td class="item-cell-num"><span class="item-field-label">Qty</span><input type="number" class="item-qty" value="${data?.quantity||1}" min="1" oninput="calcRow(this)"></td>
    <td class="kubikasi-cell"><span class="item-field-label">Kubikasi</span>${calcKub(data?.thickness||0,data?.width||0,data?.length||0,data?.quantity||1)}</td>
    <td class="item-cell-actions"><button class="remove-btn" onclick="this.closest('tr').remove();updateTotal()">✕</button></td>`;
  tbody.appendChild(row);
}

function calcKub(t,w,l,q) { return ((t/100)*(w/100)*(l/100)*q).toFixed(6); }
function calcRow(el) {
  const r = el.closest('tr');
  const t=parseFloat(r.querySelector('.item-thickness').value)||0;
  const w=parseFloat(r.querySelector('.item-width').value)||0;
  const l=parseFloat(r.querySelector('.item-length').value)||0;
  const q=parseInt(r.querySelector('.item-qty').value)||1;
  r.querySelector('.kubikasi-cell').textContent = calcKub(t,w,l,q);
  updateTotal();
}
function updateTotal() {
  let total=0;
  document.querySelectorAll('#poItems tr').forEach(r=>{
    const t=parseFloat(r.querySelector('.item-thickness')?.value)||0;
    const w=parseFloat(r.querySelector('.item-width')?.value)||0;
    const l=parseFloat(r.querySelector('.item-length')?.value)||0;
    const q=parseInt(r.querySelector('.item-qty')?.value)||1;
    total+=(t/100)*(w/100)*(l/100)*q;
  });
  document.getElementById('totalKubikasi').textContent=total.toFixed(4)+' m³';
}

async function savePO() {
  const poId = document.getElementById('editPOId').value;
  const poNumber = document.getElementById('poNumber').value.trim();
  const customerName = document.getElementById('customerName').value.trim();
  const items = [];
  document.querySelectorAll('#poItems tr').forEach(r=>{
    items.push({
      productName:r.querySelector('.item-name').value,
      thickness:parseFloat(r.querySelector('.item-thickness').value)||0,
      width:parseFloat(r.querySelector('.item-width').value)||0,
      length:parseFloat(r.querySelector('.item-length').value)||0,
      quantity:parseInt(r.querySelector('.item-qty').value)||1,
    });
  });
  if (!poNumber) { showToast('Nomor PO wajib diisi', 'error'); return; }
  if (!customerName) { showToast('Nama customer wajib diisi', 'error'); return; }
  if (items.length === 0) { showToast('Tambahkan minimal 1 item', 'error'); return; }
  const btn = document.querySelector('#poModal .btn-primary');
  setLoading(btn, true);
  try {
    const res = await fetch(`${API}/api/po${poId?'/'+poId:''}`, { method:poId?'PUT':'POST', headers:authHeaders(), body:JSON.stringify({
      poNumber:document.getElementById('poNumber').value, customerName:document.getElementById('customerName').value,
      orderDate:document.getElementById('orderDate').value, deadline:document.getElementById('deadline').value||null,
      notes:document.getElementById('poNotes').value, items
    })});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    closePOModal();
    await loadPOs();
    await loadDashboard();
    showToast(poId ? 'PO berhasil diupdate!' : 'PO berhasil dibuat!', 'success');
  } catch(e) { showToast('Error: '+e.message, 'error'); }
  finally { setLoading(btn, false); }
}

async function editPO(id) {
  try {
    const res = await fetch(`${API}/api/po/${id}`, { headers:authHeaders() });
    const po = await res.json();
    openPOModal(id);
    document.getElementById('poNumber').value=po.poNumber;
    document.getElementById('customerName').value=po.customerName;
    document.getElementById('orderDate').value=po.orderDate?.split('T')[0]||'';
    document.getElementById('deadline').value=po.deadline?.split('T')[0]||'';
    document.getElementById('poNotes').value=po.notes||'';
    document.getElementById('poItems').innerHTML='';
    po.items.forEach(i=>addItemRow(i));
    updateTotal();
  } catch(e) { showToast('Error: '+e.message, 'error'); }
}

async function deletePO(id) {
  if(!await showConfirm('Hapus PO?', 'Semua data item dan pengiriman akan terhapus permanen.', 'danger')) return;
  try { await fetch(`${API}/api/po/${id}`,{method:'DELETE',headers:authHeaders()}); await loadPOs(); await loadDashboard(); showToast('PO berhasil dihapus', 'success'); } catch(e) { showToast('Error: '+e.message, 'error'); }
}

async function updatePOStatus(id, status) {
  if (!await showConfirm('Ganti Status?', `Yakin ingin mengubah status ke "${status}"?`, 'info')) return;
  try { await fetch(`${API}/api/po/${id}/status`,{method:'PUT',headers:authHeaders(),body:JSON.stringify({status})}); viewPO(id); showToast('Status updated!', 'success'); } catch(e) { showToast('Error: '+e.message, 'error'); }
}

/* === ITEM CRUD === */
let currentDetailPOId = null;

function openItemModal(poId, itemId) {
  document.getElementById('itemModal').classList.remove('hidden');
  document.getElementById('itemPOId').value = poId;
  document.getElementById('itemEditId').value = itemId || '';
  document.getElementById('itemModalTitle').textContent = itemId ? 'Edit Item' : 'Tambah Item';
  document.getElementById('itemProductName').value = '';
  document.getElementById('itemThickness').value = '';
  document.getElementById('itemWidth').value = '';
  document.getElementById('itemLength').value = '';
  document.getElementById('itemQuantity').value = '1';
  document.getElementById('itemNotes').value = '';
  document.getElementById('itemPreviewKub').textContent = '0.000000 m³';
  currentDetailPOId = poId;

  if (itemId) {
    fetch(`${API}/api/po/${poId}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(po => {
        const item = po.items.find(i => i.id === itemId);
        if (item) {
          document.getElementById('itemProductName').value = item.productName;
          document.getElementById('itemThickness').value = item.thickness;
          document.getElementById('itemWidth').value = item.width;
          document.getElementById('itemLength').value = item.length;
          document.getElementById('itemQuantity').value = item.quantity;
          document.getElementById('itemNotes').value = item.notes || '';
          calcItemPreview();
        }
      });
  }
}

function closeItemModal() { document.getElementById('itemModal').classList.add('hidden'); }

function calcItemPreview() {
  const t = parseFloat(document.getElementById('itemThickness').value) || 0;
  const w = parseFloat(document.getElementById('itemWidth').value) || 0;
  const l = parseFloat(document.getElementById('itemLength').value) || 0;
  const q = parseInt(document.getElementById('itemQuantity').value) || 1;
  const kub = (t/100) * (w/100) * (l/100) * q;
  document.getElementById('itemPreviewKub').textContent = kub.toFixed(6) + ' m³';
}

async function saveItem() {
  const poId = document.getElementById('itemPOId').value;
  const itemId = document.getElementById('itemEditId').value;
  const body = {
    productName: document.getElementById('itemProductName').value,
    thickness: parseFloat(document.getElementById('itemThickness').value) || 0,
    width: parseFloat(document.getElementById('itemWidth').value) || 0,
    length: parseFloat(document.getElementById('itemLength').value) || 0,
    quantity: parseInt(document.getElementById('itemQuantity').value) || 1,
    notes: document.getElementById('itemNotes').value,
  };
  if (!body.productName) { showToast('Nama produk wajib diisi', 'error'); return; }
  try {
    const url = itemId ? `${API}/api/po/${poId}/items/${itemId}` : `${API}/api/po/${poId}/items`;
    const method = itemId ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    closeItemModal();
    await viewPO(poId);
    await loadPOs();
    await loadDashboard();
    showToast(itemId ? 'Item berhasil diupdate!' : 'Item berhasil ditambah!', 'success');
  } catch(e) { showToast('Error: '+e.message, 'error'); }
}

async function deleteItem(poId, itemId) {
  if (!await showConfirm('Hapus item?', 'Item ini akan dihapus dari PO.', 'danger')) return;
  try {
    await fetch(`${API}/api/po/${poId}/items/${itemId}`, { method: 'DELETE', headers: authHeaders() });
    await viewPO(poId);
    await loadPOs();
    await loadDashboard();
    showToast('Item berhasil dihapus', 'success');
  } catch(e) { showToast('Error: '+e.message, 'error'); }
}

/* === PROOF UPLOAD === */
let proofImageData = null;

function openProofModal(deliveryId) {
  document.getElementById('proofModal').classList.remove('hidden');
  document.getElementById('proofDeliveryId').value = deliveryId;
  document.getElementById('proofFile').value = '';
  document.getElementById('proofPreview').style.display = 'none';
  document.getElementById('proofPlaceholder').style.display = 'block';
  document.getElementById('proofFileName').textContent = '';
  document.getElementById('proofUploadBtn').disabled = true;
  proofImageData = null;
}

function closeProofModal() { document.getElementById('proofModal').classList.add('hidden'); }

function openProofPreview(url) {
  const proxyUrl = API + '/api/deliveries/proxy-image?url=' + encodeURIComponent(url);
  document.getElementById('proofPreviewImg').src = proxyUrl;
  document.getElementById('proofPreviewModal').classList.remove('hidden');
}
function closeProofPreview() { document.getElementById('proofPreviewModal').classList.add('hidden'); }

function previewProof(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    proofImageData = e.target.result;
    document.getElementById('proofUploadPreviewImg').src = proofImageData;
    document.getElementById('proofPreview').style.display = 'block';
    document.getElementById('proofPlaceholder').style.display = 'none';
    document.getElementById('proofFileName').textContent = file.name + ' (' + (file.size/1024).toFixed(1) + ' KB)';
    document.getElementById('proofUploadBtn').disabled = false;
  };
  reader.readAsDataURL(file);
}

async function uploadProof() {
  if (!proofImageData) return;
  const deliveryId = document.getElementById('proofDeliveryId').value;
  const btn = document.getElementById('proofUploadBtn');
  setLoading(btn, true);
  btn.innerHTML = '<span class="spinner"></span> Uploading...';
  try {
    const res = await fetch(`${API}/api/deliveries/${deliveryId}/proof`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ image: proofImageData }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    closeProofModal();
    if (!document.getElementById('page-detail').classList.contains('hidden')) {
      const poId = document.querySelector('#detailContent [onclick*="viewPO"]')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
      if (poId) viewPO(poId);
    }
    loadPODeliveries();
    showToast('Bukti berhasil diupload!', 'success');
  } catch(e) {
    showToast('Error: ' + e.message, 'error');
    setLoading(btn, false);
  }
}

/* === DELIVERIES === */
async function loadDeliveries() {
  document.getElementById('deliveryPOSelectWrapper').innerHTML = `<div style="margin-bottom:12px;"><select id="deliveryPOSelect" onchange="loadPODeliveries()" style="width:100%;padding:12px 14px;border:1.5px solid #e2e8f0;border-radius:var(--radius-sm);font-size:13px;background:white;outline:none;font-family:inherit;font-weight:600;"><option value="">-- Pilih PO --</option></select></div>`;
  document.getElementById('deliveryList').innerHTML = '<div class="empty-state" style="padding:30px;"><span class="empty-icon">🚚</span><p>Pilih PO untuk melihat riwayat pengiriman</p></div>';
  try {
    const res = await fetch(`${API}/api/po?limit=100`,{headers:authHeaders()});
    const data = await res.json();
    const sel = document.getElementById('deliveryPOSelect');
    (data.data||[]).forEach(p=>{
      const o=document.createElement('option'); o.value=p.id;
      o.textContent=`${p.poNumber} - ${p.customerName} (Sisa: ${(p.remainingKubikasi||0).toFixed(4)} m³)`;
      sel.appendChild(o);
    });
  } catch(e) {
    document.getElementById('deliveryList').innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span><p>Gagal memuat data. Coba lagi.</p></div>';
    console.error(e);
  }
}

async function loadPODeliveries() {
  const poId = document.getElementById('deliveryPOSelect')?.value;
  if(!poId) { document.getElementById('deliveryList').innerHTML=''; return; }
  try {
    const [delRes, poRes] = await Promise.all([
      fetch(`${API}/api/deliveries/po/${poId}`,{headers:authHeaders()}),
      fetch(`${API}/api/po/${poId}`,{headers:authHeaders()})
    ]);
    const deliveries = await delRes.json();
    const po = await poRes.json();

    let html = '';

    const remainingItems = (po.items || []).map(item => {
      const shipped = (po.deliveries || []).reduce((s, d) => s + d.items.reduce((ss, di) => di.poItemId === item.id ? ss + di.quantity : ss, 0), 0);
      const rem = item.quantity - shipped;
      return rem > 0 ? { ...item, remaining: rem, remKub: (item.kubikasi / item.quantity) * rem } : null;
    }).filter(Boolean);

    if (remainingItems.length > 0) {
      html += `<div class="card fade-in"><div class="card-header"><h3 style="font-size:14px;">⏳ Sisa Belum Terkirim</h3></div><div class="card-body" style="padding:0;">
        <table class="mobile-table"><thead><tr><th>Produk</th><th>Ukuran</th><th>Sisa</th><th>KUB</th></tr></thead>
        <tbody>${remainingItems.map(ri => `<tr>
          <td><strong>${ri.productName}</strong></td>
          <td style="font-size:11px;color:var(--slate-500);">${ri.thickness}×${ri.width}×${ri.length}cm</td>
          <td><strong>${ri.remaining}</strong> pcs</td>
          <td class="kub-val">${ri.remKub.toFixed(4)} m³</td>
        </tr>`).join('')}</tbody></table>
      </div></div>`;
    }

    const searchDel = (document.getElementById('searchDelivery')?.value || '').toLowerCase();
    const filteredDel = deliveries.filter(d => !searchDel || (d.driverName||'').toLowerCase().includes(searchDel) || (d.vehicleNumber||'').toLowerCase().includes(searchDel));

    if (deliveries.length === 0) {
      html += '<div class="empty-state" style="padding:30px;"><span class="empty-icon">📭</span><p>Belum ada pengiriman</p></div>';
    } else if (filteredDel.length === 0 && searchDel) {
      html += '<div class="empty-state" style="padding:30px;"><span class="empty-icon">🔍</span><p>Tidak ditemukan pengiriman yang cocok</p></div>';
    } else {
      html += `<div class="section-title" style="margin-top:12px;">🚚 Riwayat Pengiriman</div>`;
      filteredDel.forEach((d, idx) => {
        const poNames = (d.deliveryPOs||[]).map(dp => dp.po?.poNumber).filter(Boolean);
        const proofs = d.proofs || (d.proofUrl ? [{ id: null, url: d.proofUrl }] : []);
        html += `<div class="card fade-in" style="animation-delay:${idx*0.08}s"><div class="card-body" style="padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
            <div>
              <strong style="font-size:15px;">${d.driverName||'Tanpa Sopir'}</strong>
              <div style="font-size:12px;color:var(--slate-500);margin-top:3px;">🚗 ${d.vehicleNumber||'-'}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px;font-weight:700;color:var(--teal-600);">${new Date(d.deliveryDate).toLocaleDateString('id-ID')}</div>
              <div style="font-size:11px;color:var(--slate-500);">${d.items.reduce((s,di)=>s+di.quantity,0)} pcs • ${d.items.reduce((s,di)=>s+di.kubikasi,0).toFixed(4)} m³</div>
            </div>
          </div>
          ${poNames.length > 0 ? `<div style="font-size:11px;font-weight:700;color:var(--teal-600);margin-bottom:6px;">📦 ${poNames.join(' • ')}</div>` : ''}
          <div style="font-size:12px;color:var(--slate-500);margin-bottom:10px;">📍 ${d.deliveryAddress||'-'}</div>
          <div style="border-top:1px solid var(--slate-100);padding-top:10px;">
            ${d.items.map(di=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:12px;">
              <div>
                <strong>${di.poItem?.productName||'-'}</strong>
                <span style="color:var(--slate-500);margin-left:4px;font-size:11px;">${di.poItem?.thickness}×${di.poItem?.width}×${di.poItem?.length}cm</span>
              </div>
              <div>
                <span style="font-weight:700;">${di.quantity} pcs</span>
                <span style="color:var(--teal-600);font-weight:700;margin-left:6px;">${di.kubikasi?.toFixed(6)} m³</span>
              </div>
            </div>`).join('')}
          </div>
          <div style="border-top:1px solid var(--slate-100);padding-top:10px;margin-top:8px;">
            <div style="font-size:11px;font-weight:700;color:var(--slate-500);margin-bottom:6px;">📷 Bukti Kirim (${proofs.length})</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${proofs.map(p => `<button onclick="openProofPreview('${p.url}')" class="proof-btn-view" style="font-size:11px;">📷 Lihat</button>`).join('')}
              <button class="btn btn-success btn-sm" onclick="openProofModal('${d.id}')" style="font-size:11px;">+ Upload</button>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="editDelivery('${d.id}')" style="font-size:12px;">✏️ Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteDelivery('${d.id}')" style="font-size:12px;">🗑️ Hapus</button>
          </div>
        </div></div>`;
      });
    }

    document.getElementById('deliveryList').innerHTML = html;
  } catch(e) { console.error(e); }
}

async function deleteDelivery(id) {
  const delEl = document.querySelector(`[onclick="deleteDelivery('${id}')"]`);
  let info = '';
  if (delEl) {
    const card = delEl.closest('.card');
    if (card) {
      const driver = card.querySelector('strong')?.textContent || '';
      const dateEl = card.querySelectorAll('.card-body > div > div');
      info = `\nPengiriman: ${driver}`;
    }
  }
  if(!await showConfirm('Hapus pengiriman?', 'Data pengiriman akan dihapus permanen.' + info, 'danger')) return;
  try { await fetch(`${API}/api/deliveries/${id}`,{method:'DELETE',headers:authHeaders()}); await loadPODeliveries(); showToast('Pengiriman dihapus', 'success'); } catch(e) { showToast('Error: '+e.message, 'error'); }
}

let editingDeliveryId = null;
let selectedPOIds = [];

function editDeliveryFromDetail(deliveryId, poId) {
  editingDeliveryId = deliveryId;
  editDelivery(deliveryId).then(() => { window._refreshDetailPOId = poId; });
}

async function editDelivery(id) {
  editingDeliveryId = id;
  try {
    const res = await fetch(`${API}/api/deliveries/${id}`, { headers: authHeaders() });
    const d = await res.json();
    await openDeliveryModal();
    document.querySelector('#deliveryModal .modal-header h3').textContent = 'Edit Pengiriman';
    document.getElementById('deliveryDate').value = d.deliveryDate?.split('T')[0] || '';
    document.getElementById('driverName').value = d.driverName || '';
    document.getElementById('vehicleNumber').value = d.vehicleNumber || '';
    document.getElementById('deliveryAddress').value = d.deliveryAddress || '';
    document.getElementById('deliveryNotes').value = d.notes || '';
    const linkedPoIds = d.deliveryPOs?.map(dp => dp.poId) || (d.poId ? [d.poId] : []);
    document.querySelectorAll('.po-checkbox').forEach(cb => { cb.checked = linkedPoIds.includes(cb.value); });
    selectedPOIds = [...linkedPoIds];
    await loadPOForDelivery();
    d.items.forEach(di => { const inp = document.querySelector(`.del-qty[data-po-item-id="${di.poItemId}"]`); if (inp) inp.value = di.quantity; });
  } catch(e) { showToast('Error: '+e.message, 'error'); }
}

async function openDeliveryModal() {
  editingDeliveryId = null; selectedPOIds = [];
  document.getElementById('deliveryModal').classList.remove('hidden');
  document.querySelector('#deliveryModal .modal-header h3').textContent = 'Tambah Pengiriman';
  document.getElementById('deliveryDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('driverName').value=''; document.getElementById('vehicleNumber').value='';
  document.getElementById('deliveryAddress').value=''; document.getElementById('deliveryNotes').value='';
  document.getElementById('deliveryItemsContainer').innerHTML='<div style="text-align:center;padding:20px;color:var(--slate-500);font-size:13px;">Pilih PO terlebih dahulu</div>';
  try {
    const res = await fetch(`${API}/api/po?limit=100`,{headers:authHeaders()});
    const data = await res.json();
    const container = document.getElementById('deliveryPOCheckboxes'); container.innerHTML = '';
    (data.data||[]).filter(p=>p.status!=='dibatalkan').forEach(p=>{
      const div = document.createElement('div'); div.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--slate-100);display:flex;align-items:center;gap:10px;';
      div.innerHTML = `<input type="checkbox" class="po-checkbox" value="${p.id}" onchange="onPOCheckboxChange()" style="width:18px;height:18px;accent-color:var(--teal-600);cursor:pointer;"><label style="font-size:13px;cursor:pointer;flex:1;margin:0;"><strong>${p.poNumber}</strong> - ${p.customerName}<span style="font-size:11px;color:var(--slate-500);display:block;">Sisa: ${(p.remainingKubikasi||0).toFixed(4)} m³ • ${p.remainingQuantity||0} pcs</span></label>`;
      container.appendChild(div);
    });
  } catch(e) { console.error(e); }
}

function onPOCheckboxChange() {
  selectedPOIds = Array.from(document.querySelectorAll('.po-checkbox:checked')).map(cb => cb.value);
  loadPOForDelivery();
}

function openDeliveryModalForPO(poId) {
  openDeliveryModal();
  setTimeout(()=>{ const cb = document.querySelector(`.po-checkbox[value="${poId}"]`); if (cb) { cb.checked = true; onPOCheckboxChange(); } },150);
}

async function loadPOForDelivery() {
  if (selectedPOIds.length === 0) { document.getElementById('deliveryItemsContainer').innerHTML='<div style="text-align:center;padding:20px;color:var(--slate-500);font-size:13px;">Pilih PO terlebih dahulu</div>'; return; }
  try {
    const allItems = [];
    for (const poId of selectedPOIds) {
      const res = await fetch(`${API}/api/po/${poId}`, { headers: authHeaders() });
      const po = await res.json();
      if (!document.getElementById('deliveryAddress').value) document.getElementById('deliveryAddress').value = po.notes || '';
      po.items.forEach(item => {
        const shipped = (po.deliveries || []).reduce((s, d) => s + d.items.reduce((ss, di) => di.poItemId === item.id ? ss + di.quantity : ss, 0), 0);
        const rem = item.quantity - shipped;
        if (rem > 0) allItems.push({ ...item, remaining: rem, remKub: (item.kubikasi / item.quantity) * rem, poNumber: po.poNumber });
      });
    }
    if (allItems.length === 0) { document.getElementById('deliveryItemsContainer').innerHTML='<div style="text-align:center;padding:20px;color:var(--amber-500);font-size:13px;">Semua item sudah terkirim</div>'; return; }
    let h = '<div style="font-size:13px;font-weight:800;margin-bottom:8px;">📦 Item yang Dikirim</div><table class="items-table"><thead><tr><th>PO</th><th>Item</th><th>Sisa</th><th>Kirim</th></tr></thead><tbody>';
    allItems.forEach(i => { h += `<tr><td style="font-size:10px;color:var(--teal-600);font-weight:700;">${i.poNumber}</td><td><strong>${i.productName}</strong><br><span style="font-size:10px;color:var(--slate-500);">${i.thickness}×${i.width}×${i.length}cm</span></td><td>${i.remaining} pcs<br><span style="font-size:10px;color:var(--teal-600);">${i.remKub.toFixed(4)} m³</span></td><td><input type="number" data-po-item-id="${i.id}" max="${i.remaining}" min="1" value="1" class="del-qty" style="width:60px;"></td></tr>`; });
    h += '</tbody></table>';
    document.getElementById('deliveryItemsContainer').innerHTML = h;
  } catch(e) { console.error(e); }
}

function closeDeliveryModal() { document.getElementById('deliveryModal').classList.add('hidden'); }

async function saveDelivery() {
  if (selectedPOIds.length === 0) { showToast('Pilih minimal 1 PO', 'error'); return; }
  const items = []; document.querySelectorAll('.del-qty').forEach(inp => { const q = parseInt(inp.value); if (q > 0) items.push({ poItemId: inp.dataset.poItemId, quantity: q }); });
  if (!items.length) { showToast('Minimal 1 item harus dikirim', 'error'); return; }
  const btn = document.querySelector('#deliveryModal .btn-primary');
  setLoading(btn, true);
  try {
    const isEdit = !!editingDeliveryId;
    const url = isEdit ? `${API}/api/deliveries/${editingDeliveryId}` : `${API}/api/deliveries`;
    const res = await fetch(url, { method: isEdit ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify({
      poIds: selectedPOIds, deliveryDate: document.getElementById('deliveryDate').value,
      driverName: document.getElementById('driverName').value, vehicleNumber: document.getElementById('vehicleNumber').value,
      deliveryAddress: document.getElementById('deliveryAddress').value, notes: document.getElementById('deliveryNotes').value, items
    })});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    editingDeliveryId = null; closeDeliveryModal();
    await loadPOs(); await loadDashboard();
    const activePage = document.querySelector('.page.active');
    if (activePage?.id === 'page-deliveries') await loadPODeliveries();
    if (!document.getElementById('page-detail').classList.contains('hidden') && window._refreshDetailPOId) { await viewPO(window._refreshDetailPOId); window._refreshDetailPOId = null; }
    showToast(isEdit ? 'Pengiriman berhasil diupdate!' : 'Pengiriman berhasil disimpan!', 'success');
  } catch(e) { showToast('Error: '+e.message, 'error'); }
  finally { setLoading(btn, false); }
}

/* === REPORTS === */
let _reportData = {};
let _previewExportFn = null;

function switchReportTab(btn, tab) {
  document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.report-panel').forEach(p => p.style.display = 'none');
  const panels = { all: 'reportPanelAll', unsent: 'reportPanelUnsent', delivery: 'reportPanelDelivery', chart: 'reportPanelChart' };
  document.getElementById(panels[tab]).style.display = 'block';
  if (tab === 'all') loadReportAll();
  if (tab === 'unsent') loadReportUnsent();
  if (tab === 'delivery') loadDeliveryPOList();
  if (tab === 'chart') loadCharts();
}

function filterByPeriod(pos) {
  const period = document.getElementById('reportPeriod')?.value || 'all';
  const now = new Date();
  if (period === 'today') return pos.filter(p => new Date(p.orderDate).toDateString() === now.toDateString());
  if (period === 'week') { const w = new Date(now); w.setDate(w.getDate() - 7); return pos.filter(p => new Date(p.orderDate) >= w); }
  if (period === 'month') { const m = new Date(now); m.setMonth(m.getMonth() - 1); return pos.filter(p => new Date(p.orderDate) >= m); }
  if (period === 'year') { const y = new Date(now); y.setFullYear(y.getFullYear() - 1); return pos.filter(p => new Date(p.orderDate) >= y); }
  if (period === 'custom') {
    const from = document.getElementById('dateFrom')?.value;
    const to = document.getElementById('dateTo')?.value;
    return pos.filter(p => {
      const d = new Date(p.orderDate);
      if (from && d < new Date(from)) return false;
      if (to && d > new Date(to)) return false;
      return true;
    });
  }
  return pos;
}

function fmtDate(d) { if (!d) return '-'; return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtDateShort(d) { if (!d) return '-'; return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtNum(n) { return (n || 0).toFixed(4); }

async function fetchAllPO() {
  const res = await fetch(`${API}/api/po?limit=500`, { headers: authHeaders() });
  const data = await res.json();
  return data.data || [];
}

async function fetchPOItems(poId) {
  const res = await fetch(`${API}/api/po/${poId}`, { headers: authHeaders() });
  const data = await res.json();
  return data.items || [];
}

async function fetchDeliveriesByPO(poId) {
  const res = await fetch(`${API}/api/deliveries/po/${poId}`, { headers: authHeaders() });
  return await res.json();
}

function renderSummaryCards(filtered) {
  const totalKub = filtered.reduce((s, p) => s + (p.totalKubikasi || 0), 0);
  const shippedKub = filtered.reduce((s, p) => s + (p.shippedKubikasi || 0), 0);
  const totalQty = filtered.reduce((s, p) => s + (p.totalQuantity || 0), 0);
  const shippedQty = filtered.reduce((s, p) => s + (p.shippedQuantity || 0), 0);
  const byStatus = { diterima: 0, diproses: 0, dikirim: 0, selesai: 0, dibatalkan: 0 };
  filtered.forEach(p => { if (byStatus[p.status] !== undefined) byStatus[p.status]++; });
  const topCustomers = {};
  filtered.forEach(p => { topCustomers[p.customerName] = (topCustomers[p.customerName] || 0) + (p.totalKubikasi || 0); });
  const topCust = Object.entries(topCustomers).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return `
    <div class="report-card slide-up">
      <h4>📦 Ringkasan PO</h4>
      <div class="report-row"><span class="r-label">Total PO</span><span class="r-value">${filtered.length}</span></div>
      <div class="report-row"><span class="r-label">Total Qty</span><span class="r-value">${totalQty} pcs</span></div>
      <div class="report-row"><span class="r-label">Total Kubikasi</span><span class="r-value teal">${fmtNum(totalKub)} m³</span></div>
      <div class="report-row"><span class="r-label">Terkirim</span><span class="r-value green">${fmtNum(shippedKub)} m³ (${shippedQty} pcs)</span></div>
      <div class="report-row"><span class="r-label">Sisa</span><span class="r-value amber">${fmtNum(totalKub - shippedKub)} m³ (${totalQty - shippedQty} pcs)</span></div>
    </div>
    <div class="report-card slide-up" style="animation-delay:0.1s">
      <h4>📊 Status PO</h4>
      <div class="report-row"><span class="r-label">📥 Diterima</span><span class="r-value">${byStatus.diterima}</span></div>
      <div class="report-row"><span class="r-label">⚙️ Diproses</span><span class="r-value">${byStatus.diproses}</span></div>
      <div class="report-row"><span class="r-label">🚚 Dikirim</span><span class="r-value">${byStatus.dikirim}</span></div>
      <div class="report-row"><span class="r-label">✅ Selesai</span><span class="r-value">${byStatus.selesai}</span></div>
      <div class="report-row"><span class="r-label">❌ Dibatalkan</span><span class="r-value">${byStatus.dibatalkan}</span></div>
    </div>
    <div class="report-card slide-up" style="animation-delay:0.2s">
      <h4>🏆 Top Customer (Kubikasi)</h4>
      ${topCust.length ? topCust.map(([name, kub], i) => `<div class="report-row"><span class="r-label">${i + 1}. ${name}</span><span class="r-value teal">${fmtNum(kub)} m³</span></div>`).join('') : '<div style="padding:16px;text-align:center;color:var(--slate-500);font-size:13px;">Belum ada data</div>'}
    </div>`;
}

/* --- Tab 1: Semua PO --- */
function toggleCustomDates() {
  const period = document.getElementById('reportPeriod')?.value;
  document.getElementById('customDateRange').style.display = period === 'custom' ? 'flex' : 'none';
}
document.getElementById('reportPeriod')?.addEventListener('change', toggleCustomDates);
document.getElementById('dateFrom')?.addEventListener('change', loadReportAll);
document.getElementById('dateTo')?.addEventListener('change', loadReportAll);

async function loadReportAll() {
  try {
    const pos = await fetchAllPO();
    const filtered = filterByPeriod(pos);
    _reportData.allPO = filtered;
    document.getElementById('reportAllContent').innerHTML = renderSummaryCards(filtered);
  } catch (e) { console.error(e); }
}

function previewAllPO() {
  const pos = _reportData.allPO || [];
  if (!pos.length) return showToast('Tidak ada data', 'error');
  _previewExportFn = exportAllPO;
  let html = `<div class="preview-section-title">📋 Data PO Kandang - ${pos.length} PO</div>`;
  html += `<table class="preview-table"><thead><tr><th>No</th><th>PO Number</th><th>Customer</th><th>Tanggal</th><th>Deadline</th><th>Status</th><th>Total Qty</th><th>Kubikasi (m³)</th><th>Terkirim (m³)</th></tr></thead><tbody>`;
  pos.forEach((p, i) => {
    const statusColor = { diterima: '#3b82f6', diproses: '#f59e0b', dikirim: '#8b5cf6', selesai: '#10b981', dibatalkan: '#ef4444' };
    html += `<tr><td>${i + 1}</td><td><b>${p.poNumber}</b></td><td>${p.customerName}</td><td>${fmtDate(p.orderDate)}</td><td>${fmtDate(p.deadline)}</td><td><span style="background:${statusColor[p.status] || '#94a3b8'};color:white;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">${p.status}</span></td><td>${p.totalQuantity} pcs</td><td>${fmtNum(p.totalKubikasi)}</td><td>${fmtNum(p.shippedKubikasi)}</td></tr>`;
  });
  html += `</tbody></table>`;
  html += `<div class="preview-section-title" style="margin-top:20px;">📦 Detail Item per PO</div>`;
  pos.forEach(p => {
    if (p.items && p.items.length) {
      html += `<div class="preview-sub-title">${p.poNumber} - ${p.customerName}</div>`;
      html += `<table class="preview-table"><thead><tr><th>Produk</th><th>Tebal</th><th>Lebar</th><th>Pjg</th><th>Qty</th><th>Kubikasi</th></tr></thead><tbody>`;
      p.items.forEach(it => {
        html += `<tr><td>${it.productName}</td><td>${it.thickness}</td><td>${it.width}</td><td>${it.length}</td><td>${it.quantity} ${it.unit || 'pcs'}</td><td>${fmtNum(it.kubikasi)} m³</td></tr>`;
      });
      html += `</tbody></table>`;
    }
  });
  showPreview('Preview Semua PO', html);
}

async function exportAllPO(format) {
  const pos = _reportData.allPO || [];
  if (!pos.length) return showToast('Tidak ada data', 'error');
  if (format === 'pdf') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');
    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text('LAPORAN PO KANDANG', 14, 15);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`Periode: ${document.getElementById('reportPeriod')?.selectedOptions[0]?.text || 'Semua'} | Total: ${pos.length} PO | Dicetak: ${new Date().toLocaleDateString('id-ID')}`, 14, 22);
    const rows = pos.map((p, i) => [i + 1, p.poNumber, p.customerName, fmtDate(p.orderDate), fmtDate(p.deadline), p.status, p.totalQuantity, fmtNum(p.totalKubikasi), fmtNum(p.shippedKubikasi), fmtNum((p.totalKubikasi || 0) - (p.shippedKubikasi || 0))]);
    doc.autoTable({ startY: 26, head: [['#', 'PO Number', 'Customer', 'Tgl Order', 'Deadline', 'Status', 'Qty', 'Kubikasi', 'Terkirim', 'Sisa']], body: rows, styles: { fontSize: 8 }, headStyles: { fillColor: [16, 185, 129] } });
    pos.forEach(p => {
      if (p.items && p.items.length) {
        doc.addPage();
        doc.setFontSize(12); doc.setFont('helvetica', 'bold');
        doc.text(`Detail: ${p.poNumber} - ${p.customerName}`, 14, 15);
        const itemRows = p.items.map(it => [it.productName, it.thickness, it.width, it.length, it.quantity, fmtNum(it.kubikasi)]);
        doc.autoTable({ startY: 20, head: [['Produk', 'Tebal', 'Lebar', 'Pjg', 'Qty', 'Kubikasi']], body: itemRows, styles: { fontSize: 8 }, headStyles: { fillColor: [16, 185, 129] } });
      }
    });
    doc.save('Laporan_PO_Kandang.pdf');
    showToast('PDF berhasil diunduh!', 'success');
  } else {
    const wb = XLSX.utils.book_new();
    const wsData = [['#', 'PO Number', 'Customer', 'Tgl Order', 'Deadline', 'Status', 'Catatan', 'Total Qty', 'Total Kubikasi', 'Terkirim Kubikasi', 'Sisa Kubikasi']];
    pos.forEach((p, i) => wsData.push([i + 1, p.poNumber, p.customerName, fmtDate(p.orderDate), fmtDate(p.deadline), p.status, p.notes || '', p.totalQuantity, fmtNum(p.totalKubikasi), fmtNum(p.shippedKubikasi), fmtNum((p.totalKubikasi || 0) - (p.shippedKubikasi || 0))]));
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 5 }, { wch: 15 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 25 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Semua PO');
    const itemData = [['PO Number', 'Customer', 'Produk', 'Tebal', 'Lebar', 'Pjg', 'Qty', 'Satuan', 'Kubikasi']];
    pos.forEach(p => {
      if (p.items) p.items.forEach(it => itemData.push([p.poNumber, p.customerName, it.productName, it.thickness, it.width, it.length, it.quantity, it.unit || 'pcs', fmtNum(it.kubikasi)]));
    });
    const ws2 = XLSX.utils.aoa_to_sheet(itemData);
    ws2['!cols'] = [{ wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Detail Item');
    XLSX.writeFile(wb, 'Laporan_PO_Kandang.xlsx');
    showToast('Excel berhasil diunduh!', 'success');
  }
}

/* --- Tab 2: PO Belum Kirim --- */
async function loadReportUnsent() {
  try {
    const pos = await fetchAllPO();
    const unsent = pos.filter(p => p.status !== 'selesai' && p.status !== 'dibatalkan' && (p.shippedKubikasi || 0) < (p.totalKubikasi || 0));
    _reportData.unsentPO = unsent;
    let totalSisaKub = 0, totalSisaQty = 0;
    unsent.forEach(p => { totalSisaKub += (p.totalKubikasi || 0) - (p.shippedKubikasi || 0); totalSisaQty += (p.totalQuantity || 0) - (p.shippedQuantity || 0); });
    let html = `<div class="report-card slide-up">
      <h4>📦 PO Belum Terkirim</h4>
      <div class="report-row"><span class="r-label">Total PO</span><span class="r-value">${unsent.length}</span></div>
      <div class="report-row"><span class="r-label">Sisa Qty</span><span class="r-value amber">${totalSisaQty} pcs</span></div>
      <div class="report-row"><span class="r-label">Sisa Kubikasi</span><span class="r-value teal">${fmtNum(totalSisaKub)} m³</span></div>
    </div>`;
    html += `<div class="report-card slide-up" style="animation-delay:0.1s"><h4>📋 Detail PO Belum Kirim</h4>`;
    if (unsent.length) {
      html += `<table class="preview-table"><thead><tr><th>PO</th><th>Customer</th><th>Deadline</th><th>Total</th><th>Terkirim</th><th>Sisa</th></tr></thead><tbody>`;
      unsent.forEach(p => {
        const sisa = (p.totalKubikasi || 0) - (p.shippedKubikasi || 0);
        html += `<tr><td><b>${p.poNumber}</b></td><td>${p.customerName}</td><td>${fmtDate(p.deadline)}</td><td>${fmtNum(p.totalKubikasi)} m³</td><td>${fmtNum(p.shippedKubikasi)} m³</td><td style="color:${sisa > 0 ? '#dc2626' : '#16a34a'};font-weight:700;">${fmtNum(sisa)} m³</td></tr>`;
      });
      html += `</tbody></table>`;
    } else { html += '<div style="padding:20px;text-align:center;color:var(--slate-500);font-size:13px;">Semua PO sudah terkirim</div>'; }
    html += `</div>`;
    document.getElementById('reportUnsentContent').innerHTML = html;
  } catch (e) { console.error(e); }
}

function previewUnsentPO() {
  const unsent = _reportData.unsentPO || [];
  if (!unsent.length) return showToast('Tidak ada PO belum terkirim', 'success');
  _previewExportFn = exportUnsentPO;
  let html = `<div class="preview-section-title">📦 PO Belum Terkirim - ${unsent.length} PO</div>`;
  html += `<table class="preview-table"><thead><tr><th>#</th><th>PO Number</th><th>Customer</th><th>Deadline</th><th>Total Qty</th><th>Total Kubikasi</th><th>Terkirim</th><th>Sisa Kubikasi</th></tr></thead><tbody>`;
  unsent.forEach((p, i) => {
    const sisa = (p.totalKubikasi || 0) - (p.shippedKubikasi || 0);
    html += `<tr><td>${i + 1}</td><td><b>${p.poNumber}</b></td><td>${p.customerName}</td><td>${fmtDate(p.deadline)}</td><td>${p.totalQuantity} pcs</td><td>${fmtNum(p.totalKubikasi)}</td><td>${fmtNum(p.shippedKubikasi)}</td><td style="color:#dc2626;font-weight:700;">${fmtNum(sisa)}</td></tr>`;
  });
  html += `</tbody></table>`;
  html += `<div class="preview-section-title" style="margin-top:20px;">📦 Detail Item Belum Kirim</div>`;
  unsent.forEach(p => {
    if (p.items && p.items.length) {
      html += `<div class="preview-sub-title">${p.poNumber} - ${p.customerName}</div>`;
      html += `<table class="preview-table"><thead><tr><th>Produk</th><th>Tebal</th><th>Lebar</th><th>Pjg</th><th>Qty</th><th>Kubikasi</th></tr></thead><tbody>`;
      p.items.forEach(it => { html += `<tr><td>${it.productName}</td><td>${it.thickness}</td><td>${it.width}</td><td>${it.length}</td><td>${it.quantity}</td><td>${fmtNum(it.kubikasi)} m³</td></tr>`; });
      html += `</tbody></table>`;
    }
  });
  showPreview('PO Belum Terkirim', html);
}

async function exportUnsentPO(format) {
  const unsent = _reportData.unsentPO || [];
  if (!unsent.length) return showToast('Tidak ada data', 'error');
  if (format === 'pdf') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');
    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text('PO BELUM TERKIRIM - PO KANDANG', 14, 15);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`Total: ${unsent.length} PO | Dicetak: ${new Date().toLocaleDateString('id-ID')}`, 14, 22);
    const rows = unsent.map((p, i) => [i + 1, p.poNumber, p.customerName, fmtDate(p.deadline), p.totalQuantity, fmtNum(p.totalKubikasi), fmtNum(p.shippedKubikasi), fmtNum((p.totalKubikasi || 0) - (p.shippedKubikasi || 0))]);
    doc.autoTable({ startY: 26, head: [['#', 'PO Number', 'Customer', 'Deadline', 'Qty', 'Total Kub', 'Terkirim', 'Sisa Kub']], body: rows, styles: { fontSize: 8 }, headStyles: { fillColor: [245, 158, 11] } });
    unsent.forEach(p => {
      if (p.items && p.items.length) {
        doc.addPage();
        doc.setFontSize(12); doc.setFont('helvetica', 'bold');
        doc.text(`Detail: ${p.poNumber} - ${p.customerName}`, 14, 15);
        doc.autoTable({ startY: 20, head: [['Produk', 'Tebal', 'Lebar', 'Pjg', 'Qty', 'Kubikasi']], body: p.items.map(it => [it.productName, it.thickness, it.width, it.length, it.quantity, fmtNum(it.kubikasi)]), styles: { fontSize: 8 }, headStyles: { fillColor: [245, 158, 11] } });
      }
    });
    doc.save('PO_Belum_Kirim.pdf');
  } else {
    const wb = XLSX.utils.book_new();
    const wsData = [['#', 'PO Number', 'Customer', 'Deadline', 'Status', 'Qty', 'Total Kubikasi', 'Terkirim', 'Sisa Kubikasi']];
    unsent.forEach((p, i) => wsData.push([i + 1, p.poNumber, p.customerName, fmtDate(p.deadline), p.status, p.totalQuantity, fmtNum(p.totalKubikasi), fmtNum(p.shippedKubikasi), fmtNum((p.totalKubikasi || 0) - (p.shippedKubikasi || 0))]));
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 5 }, { wch: 15 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, 'PO Belum Kirim');
    XLSX.writeFile(wb, 'PO_Belum_Kirim.xlsx');
  }
  showToast(`${format.toUpperCase()} berhasil diunduh!`, 'success');
}

/* --- Tab 3: Pengiriman --- */
async function loadDeliveryPOList() {
  try {
    const pos = await fetchAllPO();
    const sel = document.getElementById('deliveryReportPo');
    sel.innerHTML = '<option value="">-- Pilih PO --</option>';
    pos.forEach(p => { sel.innerHTML += `<option value="${p.id}">${p.poNumber} - ${p.customerName}</option>`; });
  } catch (e) { console.error(e); }
}

async function loadDeliveryReport() {
  const poId = document.getElementById('deliveryReportPo').value;
  if (!poId) { document.getElementById('reportDeliveryContent').innerHTML = ''; _reportData.deliveries = null; return; }
  try {
    const deliveries = await fetchDeliveriesByPO(poId);
    _reportData.deliveries = deliveries;
    const po = (_reportData.allPO || []).find(p => p.id === poId);
    let html = `<div class="report-card slide-up"><h4>🚚 Pengiriman: ${po ? po.poNumber + ' - ' + po.customerName : ''}</h4>`;
    if (deliveries.length) {
      deliveries.forEach(d => {
        html += `<div style="padding:10px 0;border-bottom:1px solid var(--slate-100);">
          <div style="font-size:13px;font-weight:700;">${fmtDate(d.deliveryDate)} ${d.driverName ? '- ' + d.driverName : ''} ${d.vehicleNumber ? '(' + d.vehicleNumber + ')' : ''}</div>`;
        if (d.items && d.items.length) {
          html += `<div style="font-size:11px;color:var(--slate-600);margin-top:4px;">`;
          d.items.forEach(it => { html += `<span style="display:inline-block;background:var(--teal-50);color:var(--teal-700);padding:2px 8px;border-radius:6px;margin:2px 4px 2px 0;font-size:10px;">${it.poItem?.productName || 'Item'}: ${it.quantity} pcs (${fmtNum(it.kubikasi)} m³)</span>`; });
          html += `</div>`;
        }
        if (d.proofs && d.proofs.length) { html += `<div style="font-size:10px;color:var(--slate-500);margin-top:4px;">📷 ${d.proofs.length} foto bukti</div>`; }
        html += `</div>`;
      });
    } else { html += '<div style="padding:16px;text-align:center;color:var(--slate-500);font-size:13px;">Belum ada pengiriman</div>'; }
    html += `</div>`;
    document.getElementById('reportDeliveryContent').innerHTML = html;
  } catch (e) { console.error(e); }
}

function previewDeliveryReport() {
  const deliveries = _reportData.deliveries;
  if (!deliveries || !deliveries.length) return showToast('Pilih PO terlebih dahulu', 'error');
  const poId = document.getElementById('deliveryReportPo').value;
  const po = (_reportData.allPO || []).find(p => p.id === poId);
  _previewExportFn = exportDeliveryReport;
  let html = `<div class="preview-section-title">🚚 Data Pengiriman: ${po ? po.poNumber + ' - ' + po.customerName : ''}</div>`;
  if (deliveries.length) {
    deliveries.forEach((d, i) => {
      html += `<div class="preview-sub-title">Pengiriman #${i + 1} - ${fmtDate(d.deliveryDate)}</div>`;
      html += `<table class="preview-table"><thead><tr><th>Sopir</th><th>Kendaraan</th><th>Alamat</th><th>Catatan</th></tr></thead><tbody>`;
      html += `<tr><td>${d.driverName || '-'}</td><td>${d.vehicleNumber || '-'}</td><td>${d.deliveryAddress || '-'}</td><td>${d.notes || '-'}</td></tr>`;
      html += `</tbody></table>`;
      if (d.items && d.items.length) {
        html += `<table class="preview-table" style="margin-top:6px;"><thead><tr><th>Item</th><th>Qty</th><th>Kubikasi</th></tr></thead><tbody>`;
        d.items.forEach(it => { html += `<tr><td>${it.poItem?.productName || '-'}</td><td>${it.quantity} pcs</td><td>${fmtNum(it.kubikasi)} m³</td></tr>`; });
        html += `</tbody></table>`;
      }
      if (d.proofs && d.proofs.length) { html += `<div style="font-size:11px;color:var(--slate-500);margin-top:4px;">📷 ${d.proofs.length} foto bukti tersedia</div>`; }
    });
  } else { html += '<div style="padding:16px;color:var(--slate-500);font-size:13px;">Belum ada pengiriman</div>'; }
  showPreview('Data Pengiriman PO', html);
}

async function exportDeliveryReport(format) {
  const deliveries = _reportData.deliveries || [];
  const poId = document.getElementById('deliveryReportPo').value;
  const po = (_reportData.allPO || []).find(p => p.id === poId);
  const poLabel = po ? `${po.poNumber}_${po.customerName}` : 'PO';
  if (format === 'pdf') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');
    doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    doc.text(`PENGIRIMAN: ${poLabel}`, 14, 15);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`Dicetak: ${new Date().toLocaleDateString('id-ID')}`, 14, 22);
    let y = 28;
    deliveries.forEach((d, i) => {
      doc.setFontSize(11); doc.setFont('helvetica', 'bold');
      doc.text(`Pengiriman #${i + 1} - ${fmtDate(d.deliveryDate)}`, 14, y); y += 6;
      doc.setFontSize(9); doc.setFont('helvetica', 'normal');
      doc.text(`Sopir: ${d.driverName || '-'} | Kendaraan: ${d.vehicleNumber || '-'} | Alamat: ${d.deliveryAddress || '-'}`, 14, y); y += 5;
      if (d.items && d.items.length) {
        doc.autoTable({ startY: y, head: [['Item', 'Qty', 'Kubikasi']], body: d.items.map(it => [it.poItem?.productName || '-', it.quantity + ' pcs', fmtNum(it.kubikasi) + ' m³']), styles: { fontSize: 8 }, headStyles: { fillColor: [16, 185, 129] } });
        y = doc.lastAutoTable.finalY + 8;
      }
    });
    doc.save(`Pengiriman_${poLabel}.pdf`);
  } else {
    const wb = XLSX.utils.book_new();
    const wsData = [['#', 'Tanggal', 'Sopir', 'Kendaraan', 'Alamat', 'Catatan', 'Item', 'Qty', 'Kubikasi']];
    deliveries.forEach((d, i) => {
      if (d.items && d.items.length) {
        d.items.forEach(it => wsData.push([i + 1, fmtDate(d.deliveryDate), d.driverName || '', d.vehicleNumber || '', d.deliveryAddress || '', d.notes || '', it.poItem?.productName || '', it.quantity, fmtNum(it.kubikasi)]));
      } else {
        wsData.push([i + 1, fmtDate(d.deliveryDate), d.driverName || '', d.vehicleNumber || '', d.deliveryAddress || '', d.notes || '', '', '', '']);
      }
    });
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 25 }, { wch: 20 }, { wch: 20 }, { wch: 8 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Pengiriman');
    XLSX.writeFile(wb, `Pengiriman_${poLabel}.xlsx`);
  }
  showToast(`${format.toUpperCase()} berhasil diunduh!`, 'success');
}

/* --- Tab 4: Diagram --- */
let _charts = {};
function destroyCharts() { Object.values(_charts).forEach(c => c.destroy()); _charts = {}; }

async function loadCharts() {
  try {
    const pos = await fetchAllPO();
    destroyCharts();
    const statusCount = { diterima: 0, diproses: 0, dikirim: 0, selesai: 0, dibatalkan: 0 };
    pos.forEach(p => { if (statusCount[p.status] !== undefined) statusCount[p.status]++; });
    const custKub = {};
    pos.forEach(p => { custKub[p.customerName] = (custKub[p.customerName] || 0) + (p.totalKubikasi || 0); });
    const monthlyPO = {};
    pos.forEach(p => {
      const d = new Date(p.orderDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyPO[key] = (monthlyPO[key] || 0) + 1;
    });
    const monthlyKub = {};
    pos.forEach(p => {
      const d = new Date(p.orderDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyKub[key] = (monthlyKub[key] || 0) + (p.totalKubikasi || 0);
    });
    const shippedKub = pos.reduce((s, p) => s + (p.shippedKubikasi || 0), 0);
    const totalKub = pos.reduce((s, p) => s + (p.totalKubikasi || 0), 0);
    const pendingKub = totalKub - shippedKub;
    const chartColors = ['#3b82f6', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444'];
    const statusLabels = ['Diterima', 'Diproses', 'Dikirim', 'Selesai', 'Dibatalkan'];
    const statusValues = [statusCount.diterima, statusCount.diproses, statusCount.dikirim, statusCount.selesai, statusCount.dibatalkan];
    _charts.status = new Chart(document.getElementById('chartStatus'), {
      type: 'doughnut', data: { labels: statusLabels, datasets: [{ data: statusValues, backgroundColor: chartColors, borderWidth: 3, borderColor: '#fff' }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 11, weight: 'bold' }, padding: 12 } } } }
    });
    const custEntries = Object.entries(custKub).sort((a, b) => b[1] - a[1]).slice(0, 8);
    _charts.customer = new Chart(document.getElementById('chartCustomer'), {
      type: 'bar', data: { labels: custEntries.map(e => e[0]), datasets: [{ label: 'Kubikasi (m³)', data: custEntries.map(e => e[1]), backgroundColor: '#0d9488', borderRadius: 8 }] },
      options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { display: false } } } }
    });
    const monthKeys = Object.keys(monthlyPO).sort().slice(-6);
    _charts.monthly = new Chart(document.getElementById('chartMonthly'), {
      type: 'bar', data: {
        labels: monthKeys.map(k => { const [y, m] = k.split('-'); return new Date(y, m - 1).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }); }),
        datasets: [
          { label: 'PO', data: monthKeys.map(k => monthlyPO[k] || 0), backgroundColor: '#3b82f6', borderRadius: 6 },
          { label: 'Kubikasi (m³)', data: monthKeys.map(k => monthlyKub[k] || 0), backgroundColor: '#10b981', borderRadius: 6, yAxisID: 'y1' }
        ]
      },
      options: { responsive: true, plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } }, scales: { y: { beginAtZero: true, position: 'left' }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } } }
    });
    _charts.flow = new Chart(document.getElementById('chartFlow'), {
      type: 'bar', data: {
        labels: ['Total PO', 'Sudah Kirim', 'Belum Kirim'],
        datasets: [{ data: [totalKub, shippedKub, pendingKub], backgroundColor: ['#0d9488', '#10b981', '#f59e0b'], borderRadius: 8 }]
      },
      options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { display: false } } } }
    });
  } catch (e) { console.error(e); }
}

/* --- Preview Modal --- */
function showPreview(title, html) {
  document.getElementById('previewTitle').textContent = title;
  document.getElementById('previewBody').innerHTML = html;
  document.getElementById('reportPreviewModal').classList.remove('hidden');
}
function closeReportPreview() { document.getElementById('reportPreviewModal').classList.add('hidden'); }
function exportFromPreview(format) { if (_previewExportFn) _previewExportFn(format); }

/* === PRINT PO === */
async function printPO(id) {
  try {
    const res = await fetch(`${API}/api/po/${id}`, { headers: authHeaders() });
    const po = await res.json();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text('SURAT JALAN - PO KANDANG', 105, 15, { align: 'center' });
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`No: ${po.poNumber}`, 14, 25);
    doc.text(`Customer: ${po.customerName}`, 14, 31);
    doc.text(`Tanggal: ${fmtDate(po.orderDate)}${po.deadline ? ' | Deadline: ' + fmtDate(po.deadline) : ''}`, 14, 37);
    doc.text(`Alamat: ${po.notes || '-'}`, 14, 43);
    doc.line(14, 46, 196, 46);
    const itemRows = po.items.map((it, i) => [i + 1, it.productName, `${it.thickness}×${it.width}×${it.length} cm`, it.quantity, fmtNum(it.kubikasi)]);
    doc.autoTable({ startY: 50, head: [['#', 'Produk', 'Ukuran', 'Qty', 'Kubikasi']], body: itemRows, styles: { fontSize: 9 }, headStyles: { fillColor: [16, 185, 129] } });
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text(`Total Kubikasi: ${fmtNum(po.totalKubikasi)} m³`, 14, finalY);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('Dicetak: ' + new Date().toLocaleDateString('id-ID'), 14, finalY + 8);
    doc.save(`Surat_Jalan_${po.poNumber}.pdf`);
    showToast('Surat jalan berhasil diunduh!', 'success');
  } catch(e) { showToast('Gagal mencetak: ' + e.message, 'error'); }
}

/* === FILTER DELIVERIES === */
function filterDeliveries() {
  const search = (document.getElementById('searchDelivery')?.value || '').toLowerCase();
  document.querySelectorAll('#deliveryList .card').forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(search) ? '' : 'none';
  });
}

/* === LOAD PROFILE === */
function loadProfile() {
  fetch(`${API}/api/auth/me`, { headers: authHeaders() })
    .then(r => r.json())
    .then(d => {
      if (d.user) {
        document.getElementById('profileAvatar').textContent = d.user.name.charAt(0).toUpperCase();
        document.getElementById('profileName').textContent = d.user.name;
        document.getElementById('profileEmail').textContent = d.user.email;
      }
    })
    .catch(() => {});
}

/* === DELIVERY EMPTY STATES === */

/* === INIT === */
if (token) {
  fetch(`${API}/api/auth/me`,{headers:authHeaders()})
    .then(r=>r.json())
    .then(d=>{
      if(d.user) {
        document.getElementById('userAvatar').textContent=d.user.name.charAt(0).toUpperCase();
        document.getElementById('dashUserName').textContent=d.user.name;
        document.getElementById('dashUserNameAvatar').textContent=d.user.name.charAt(0).toUpperCase();
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('loginPage').classList.add('hidden');
        loadDashboard();
      }
    })
    .catch(()=>{ localStorage.removeItem('token'); });
}

