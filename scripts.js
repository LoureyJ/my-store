/* ============ API WRAPPER ============ */
function api(action, payload, adminPassword) {
  return fetch(window.__API_URL__, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: action,
      payload: payload || {},
      adminPassword: adminPassword || ''
    })
  }).then(function (r) {
    if (!r.ok) {
      throw new Error('HTTP ' + r.status);
    }
    return r.json();
  }).catch(function (err) {
    console.error('API error [' + action + ']:', err);
    showToast('Network error — please try again', 'error');
    throw err;
  });
}

function adminApi(action, payload) {
  const pw = sessionStorage.getItem('adminPassword') || '';
  return api(action, payload, pw);
}

/* ============ STATE ============ */
let products = [], settings = {}, allCategories = [];
let cart = JSON.parse(localStorage.getItem('cart') || '[]');
let isAdmin = sessionStorage.getItem('isAdmin') === 'true';
let pdpQuantity = 1, currentPdpImages = [], currentPdpImageIndex = 0, currentPdpProductId = null, currentPdpVariantIndex = 0;
let productImageList = [], productDetails = [], productVariants = [];
let pendingOrderData = null, pendingReceiptUrl = '', selectedPaymentMethodId = null;
let paymentMethodList = [], faqItems = [], _reviewImageUrls = {}, _paymentMethodsCache = [], _loadingCount = 0, currentHomepageTab = '';
const DEFAULT_CURRENCY = '\u20B1', MAX_PRODUCT_IMAGES = 8, MAX_VARIANT_IMAGES = 6;

document.addEventListener('DOMContentLoaded', function () {
  loadSettings(); loadProducts(); renderCart(); updateCartBadge();
  if (isAdmin) showAdminPanel();
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { const h = document.getElementById('confirmModalHost'); if (h) { h.remove(); return; } closeModal(); }
  });
});

/* ============ UTILS ============ */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function getCurrency() { return settings.currency || DEFAULT_CURRENCY; }
function formatPriceParts(v) { const n = parseFloat(v) || 0; const p = n.toFixed(2).split('.'); const d = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return { dollars: d, cents: p[1], full: d + '.' + p[1] }; }
function hashString(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return Math.abs(h); }
function renderStars(r) { let o = ''; for (let i = 1; i <= 5; i++) o += (r >= i - 0.5) ? '\u2605' : '\u2606'; return o; }
function getPrimaryImage(p) { if (p.images && p.images.length) return p.images[0]; if (p.variants && p.variants.length) { for (let i = 0; i < p.variants.length; i++) if (p.variants[i].images && p.variants[i].images.length) return p.variants[i].images[0]; } return p.image || 'https://via.placeholder.com/300'; }
function getProductStock(id) { const p = products.find(function (x) { return x.id === id; }); return p ? (parseInt(p.stock) || 0) : 0; }
function getCartQtyForProduct(id) { return cart.filter(function (i) { return (i.productId || i.id) === id; }).reduce(function (s, i) { return s + i.quantity; }, 0); }

/* ============ THEME ============ */
function shiftHex(hex, percent) {
  try {
    const c = String(hex).replace('#', ''); if (c.length !== 6) return hex;
    const num = parseInt(c, 16), amt = Math.round(2.55 * percent);
    let r = (num >> 16) + amt, g = ((num >> 8) & 0x00ff) + amt, b = (num & 0x0000ff) + amt;
    r = Math.min(255, Math.max(0, r)); g = Math.min(255, Math.max(0, g)); b = Math.min(255, Math.max(0, b));
    let out = ((r << 16) | (g << 8) | b).toString(16); while (out.length < 6) out = '0' + out; return '#' + out;
  } catch (e) { return hex; }
}
function applyTheme() {
  try {
    const root = document.documentElement;
    const brand = settings.themeBrandColor || '#232f3e', accent = settings.themeAccentColor || '#ffd814';
    root.style.setProperty('--amz-dark', brand);
    root.style.setProperty('--amz-dark-2', shiftHex(brand, 8));
    root.style.setProperty('--amz-dark-3', shiftHex(brand, 15));
    root.style.setProperty('--amz-yellow', accent);
    root.style.setProperty('--amz-yellow-hover', shiftHex(accent, -5));
    root.style.setProperty('--amz-orange', accent);
    root.style.setProperty('--amz-orange-hover', shiftHex(accent, -8));
    root.style.setProperty('--amz-buy', shiftHex(accent, -5));
    const ov = parseInt(settings.themeBgOverlay) || 0, bg = settings.themeBgImageUrl;
    if (bg) { document.body.classList.add('theme-has-bg'); const oc = 'rgba(0,0,0,' + (ov / 100) + ')'; document.body.style.backgroundImage = 'linear-gradient(' + oc + ',' + oc + '), url("' + bg + '")'; }
    else { document.body.classList.remove('theme-has-bg'); document.body.style.backgroundImage = ''; }
  } catch (e) {}
}

/* ============ CONFIRM & LOADING ============ */
function showConfirm(o) {
  const ex = document.getElementById('confirmModalHost'); if (ex) ex.remove();
  const h = document.createElement('div'); h.id = 'confirmModalHost';
  h.innerHTML = '<div class="confirm-overlay" onclick="if(event.target===this)dismissConfirm()"><div class="confirm-box" onclick="event.stopPropagation()">' +
    '<div class="confirm-icon ' + (o.iconStyle || 'warn') + '">' + (o.icon || '\u26A0') + '</div>' +
    '<div class="confirm-title">' + esc(o.title || 'Are you sure?') + '</div>' +
    '<div class="confirm-message">' + (o.message || '') + '</div>' +
    '<div class="confirm-actions"><button type="button" class="btn-cancel" id="confirmCancelBtn">' + esc(o.cancelText || 'Cancel') + '</button>' +
    '<button type="button" class="btn-confirm ' + (o.confirmStyle || '') + '" id="confirmOkBtn">' + esc(o.confirmText || 'Confirm') + '</button></div></div></div>';
  document.body.appendChild(h);
  const done = function () { const el = document.getElementById('confirmModalHost'); if (el) el.remove(); };
  document.getElementById('confirmCancelBtn').onclick = function () { if (document.getElementById('confirmOkBtn').dataset.loading === 'true') return; done(); if (o.onCancel) o.onCancel(); };
  document.getElementById('confirmOkBtn').onclick = function () { if (this.dataset.loading === 'true') return; if (o.onConfirm) o.onConfirm(done); };
}
function dismissConfirm() { const el = document.getElementById('confirmModalHost'); if (el) el.remove(); }
function showLoading(t) { _loadingCount++; let el = document.getElementById('globalLoading'); if (!el) { el = document.createElement('div'); el.id = 'globalLoading'; el.className = 'loading-overlay'; document.body.appendChild(el); } el.innerHTML = '<div class="loading-spinner"></div><div class="loading-text">' + esc(t || 'Loading...') + '</div>'; el.style.display = 'flex'; }
function hideLoading() { _loadingCount = Math.max(0, _loadingCount - 1); if (_loadingCount === 0) { const el = document.getElementById('globalLoading'); if (el) el.style.display = 'none'; } }
function showToast(msg, type, opt) { type = type || 'success'; opt = opt || {}; const t = document.getElementById('toasts'); const el = document.createElement('div'); el.className = 'toast ' + type; if (opt.loading) el.innerHTML = '<span class="toast-spinner"></span><span>' + esc(msg) + '</span>'; else el.textContent = msg; t.appendChild(el); setTimeout(function () { el.remove(); }, opt.duration || 3000); }
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

/* ============ SETTINGS ============ */
function loadSettings() {
  api('getSettings').then(function (data) {
    settings = data || {};
    const sname = settings.storeName || 'My Store';
    const ne = document.getElementById('storeName');
    if (ne) { if (sname.toLowerCase() === 'my awesome store' || sname === 'My Store') ne.innerHTML = 'shop<span class="logo-accent">mart</span>'; else { const w = sname.split(' '); if (w.length > 1) { const l = w.pop(); ne.innerHTML = w.join(' ') + ' <span class="logo-accent">' + l + '</span>'; } else ne.textContent = sname; } }
    const ht = document.getElementById('heroTitle'), hg = document.getElementById('heroTagline');
    if (ht) ht.textContent = 'Welcome to ' + sname;
    if (hg) hg.textContent = settings.storeTagline || '';
    const fn = document.getElementById('footerStoreName'); if (fn) fn.textContent = sname;

    const annBar = document.getElementById('announcementBar');
    const annTrack = document.getElementById('announcementTrack');
    if (annBar && annTrack && settings.announcement) {
      const text = '\uD83D\uDCE2 ' + settings.announcement;
      let html = '';
      for (let i = 0; i < 4; i++) html += '<span>' + esc(text) + '</span>';
      annTrack.innerHTML = html;
      annBar.style.display = 'block';
    } else if (annBar) {
      annBar.style.display = 'none';
    }

    document.title = sname; applyTheme(); loadHomepageTabs();
  }).catch(function () {});
}

/* ============ PRODUCTS ============ */
function loadProducts() {
  api('getProducts').then(function (d) { products = d || []; renderProducts(); }).catch(function () {});
}
function productCardHtml(p) {
  const cur = getCurrency(), pn = parseFloat(p.price) || 0, disc = parseFloat(p.discount) || 0;
  const fp = formatPriceParts(disc > 0 ? pn * (1 - disc / 100) : pn), op = formatPriceParts(pn);
  const seed = hashString(p.id || p.name || ''), rr = Math.round((3.5 + (seed % 15) / 10) * 2) / 2;
  const rc = 50 + (seed % 4950), oos = (parseInt(p.stock) || 0) <= 0;
  const sid = String(p.id).replace(/'/g, ''), img = getPrimaryImage(p);
  return '<div class="amz-card">' + (disc > 0 ? '<span class="amz-deal-badge">-' + disc + '%</span>' : '') +
    '<div class="amz-card-img-wrap" style="cursor:pointer;" onclick="showProductDetail(\'' + sid + '\')"><img src="' + img + '" alt="' + esc(p.name) + '" loading="lazy"></div>' +
    '<h3 class="amz-card-title" style="cursor:pointer;" onclick="showProductDetail(\'' + sid + '\')">' + esc(p.name) + '</h3>' +
    '<div class="amz-rating"><span class="amz-stars">' + renderStars(rr) + '</span><span class="amz-rating-count">' + rc.toLocaleString() + '</span></div>' +
    '<div class="amz-price-row"><span class="amz-price">' + cur + fp.dollars + '<sup>' + fp.cents + '</sup></span>' + (disc > 0 ? '<span class="amz-price-strike">' + cur + op.full + '</span>' : '') + '</div>' +
    '<p class="amz-delivery"><strong>FREE delivery</strong> <span class="amz-prime">prime</span></p>' +
    '<button class="amz-add-btn" onclick="addToCart(\'' + sid + '\')" ' + (oos ? 'disabled' : '') + '>' + (oos ? 'Out of stock' : 'Add to Cart') + '</button></div>';
}
function renderProducts() {
  const cs = document.getElementById('homepageContentSection');
  if (cs && cs.style.display !== 'none') {
    cs.style.display = 'none';
    document.querySelectorAll('.homepage-tab-subnav').forEach(function (b) { b.classList.remove('active-tab'); });
    currentHomepageTab = '';
  }
  const g = document.getElementById('productGrid'); if (!g) return; hideProductDetail();
  const si = document.getElementById('searchInput'), sc = document.getElementById('searchCategory');
  const st = (si ? si.value : '').toLowerCase().trim(), cf = sc ? sc.value : 'all';
  let f = products.filter(function (p) { return p.active; });
  if (st) f = f.filter(function (p) { return (p.name || '').toLowerCase().indexOf(st) > -1 || (p.description || '').toLowerCase().indexOf(st) > -1 || (p.category || '').toLowerCase().indexOf(st) > -1; });
  if (cf !== 'all') f = f.filter(function (p) { return p.category === cf; });
  const st2 = document.getElementById('sectionTitle');
  if (st2) { st2.style.display = ''; if (st) st2.textContent = 'Results for "' + st + '"'; else if (cf !== 'all') st2.textContent = cf; else st2.textContent = 'Featured products'; }
  if (f.length === 0) { g.innerHTML = '<p class="amz-no-products">No products found.</p>'; return; }
  g.style.display = '';
  g.innerHTML = f.map(productCardHtml).join(''); populateCategoryDropdowns();
}
function renderDealsOnly() {
  const g = document.getElementById('productGrid'); if (!g) return; hideProductDetail();
  const d = products.filter(function (p) { return p.active && parseFloat(p.discount) > 0; });
  const st = document.getElementById('sectionTitle'); if (st) { st.style.display = ''; st.textContent = "Today's Deals"; }
  if (d.length === 0) { g.innerHTML = '<p class="amz-no-products">No deals right now.</p>'; return; }
  g.style.display = '';
  g.innerHTML = d.map(productCardHtml).join('');
}
function populateCategoryDropdowns() {
  const subnav = document.getElementById('subnavCategories');
  if (!subnav) return;
  if (subnav.dataset.categoriesPopulated === 'true') return;
  const categories = [];
  products.filter(function (p) { return p.active; }).forEach(function (p) {
    if (p.category && categories.indexOf(p.category) === -1) categories.push(p.category);
  });
  categories.sort();
  const searchCat = document.getElementById('searchCategory');
  if (searchCat && searchCat.options.length <= 1) {
    categories.forEach(function (c) {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      searchCat.appendChild(opt);
    });
  }
  categories.forEach(function (c) {
    const btn = document.createElement('button');
    btn.className = 'amz-subnav-item'; btn.textContent = c;
    btn.onclick = function () { filterCategory(c); };
    subnav.appendChild(btn);
  });
  const dealBtn = document.createElement('button');
  dealBtn.className = 'amz-subnav-item'; dealBtn.textContent = "Today's Deals";
  dealBtn.style.color = '#ffd814';
  dealBtn.onclick = function () { filterCategory('deals'); };
  subnav.appendChild(dealBtn);
  subnav.dataset.categoriesPopulated = 'true';
}
function filterCategory(cat) {
  const cs = document.getElementById('homepageContentSection');
  if (cs) cs.style.display = 'none';
  document.querySelectorAll('.homepage-tab-subnav').forEach(function (b) { b.classList.remove('active-tab'); });
  currentHomepageTab = '';
  const sc = document.getElementById('searchCategory');
  if (!sc) return;
  if (cat === 'deals') { sc.value = 'all'; renderDealsOnly(); window.scrollTo({ top: 260, behavior: 'smooth' }); return; }
  sc.value = cat; renderProducts(); window.scrollTo({ top: 260, behavior: 'smooth' });
}

/* ============ PDP ============ */
function showProductDetail(pid) {
  const p = products.find(function (x) { return x.id === pid; }); if (!p) return;
  pdpQuantity = 1; currentPdpProductId = pid; currentPdpVariantIndex = 0; currentPdpImageIndex = 0;
  if (p.variants && p.variants.length > 0) currentPdpImages = (p.variants[0].images || []).slice();
  if (currentPdpImages.length === 0) currentPdpImages = (p.images && p.images.length) ? p.images.slice() : (p.image ? [p.image] : ['https://via.placeholder.com/500']);
  const g = document.getElementById('productGrid'), d = document.getElementById('productDetailView'), st = document.getElementById('sectionTitle');
  if (g) g.style.display = 'none'; if (st) st.style.display = 'none';
  if (d) { d.style.display = 'block'; d.innerHTML = buildPdpHtml(p); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function hideProductDetail() {
  const g = document.getElementById('productGrid'), d = document.getElementById('productDetailView'), st = document.getElementById('sectionTitle');
  if (g) g.style.display = ''; if (st) st.style.display = ''; if (d) { d.style.display = 'none'; d.innerHTML = ''; }
  currentPdpProductId = null; currentPdpVariantIndex = 0; currentPdpImageIndex = 0;
}
function switchPdpImageByIndex(i) {
  if (i < 0 || i >= currentPdpImages.length) return;
  currentPdpImageIndex = i; const m = document.getElementById('pdpMainImage'); if (m) m.src = currentPdpImages[i];
  document.querySelectorAll('.pdp-thumb').forEach(function (t, idx) { t.classList.toggle('active', idx === i); });
  const c = document.getElementById('pdpImageCounter'); if (c) c.textContent = (i + 1) + ' / ' + currentPdpImages.length;
}
function pdpNextImage() { if (currentPdpImages.length < 2) return; switchPdpImageByIndex((currentPdpImageIndex + 1) % currentPdpImages.length); }
function pdpPrevImage() { if (currentPdpImages.length < 2) return; switchPdpImageByIndex((currentPdpImageIndex - 1 + currentPdpImages.length) % currentPdpImages.length); }
function switchPdpVariant(idx) {
  if (!currentPdpProductId) return;
  const p = products.find(function (x) { return x.id === currentPdpProductId; });
  if (!p || !p.variants || idx < 0 || idx >= p.variants.length) return;
  currentPdpVariantIndex = idx; const v = p.variants[idx];
  currentPdpImages = (v.images || []).slice(); if (currentPdpImages.length === 0) currentPdpImages = ['https://via.placeholder.com/500'];
  currentPdpImageIndex = 0;
  const m = document.getElementById('pdpMainImage'); if (m) m.src = currentPdpImages[0];
  const l = document.getElementById('pdpVariantName'); if (l) l.textContent = v.name;
  const c = document.getElementById('pdpImageCounter'); if (c) c.textContent = currentPdpImages.length > 1 ? '1 / ' + currentPdpImages.length : '';
  const tc = document.getElementById('pdpThumbsContainer');
  if (tc) { if (currentPdpImages.length > 1) tc.innerHTML = '<div class="pdp-thumbs">' + currentPdpImages.map(function (u, i) { return '<button type="button" class="pdp-thumb' + (i === 0 ? ' active' : '') + '" onclick="switchPdpImageByIndex(' + i + ')"><img src="' + u + '"></button>'; }).join('') + '</div>'; else tc.innerHTML = ''; }
  document.querySelectorAll('.pdp-variant-btn').forEach(function (b, i) { b.classList.toggle('active', i === idx); });
  const pb = document.getElementById('pdpNavPrev'), nb = document.getElementById('pdpNavNext');
  if (pb) pb.disabled = currentPdpImages.length <= 1; if (nb) nb.disabled = currentPdpImages.length <= 1;
  pdpQuantity = 1; const q = document.getElementById('pdpQtyValue'); if (q) q.textContent = '1';
}
function buildPdpHtml(p) {
  const cur = getCurrency(), pn = parseFloat(p.price) || 0, disc = parseFloat(p.discount) || 0;
  const fp = formatPriceParts(disc > 0 ? pn * (1 - disc / 100) : pn), op = formatPriceParts(pn);
  const seed = hashString(p.id || p.name || ''), rr = Math.round((3.5 + (seed % 15) / 10) * 2) / 2;
  const rc = 50 + (seed % 4950), stock = parseInt(p.stock) || 0;
  const icq = getCartQtyForProduct(p.id), av = Math.max(0, stock - icq);
  const oos = stock <= 0, nma = !oos && av <= 0, low = stock > 0 && stock <= 5;
  const sid = String(p.id).replace(/'/g, ''), sc = String(p.category || '').replace(/'/g, '');
  let sl = ''; if (oos) sl = '<span class="pdp-stock-out">Out of Stock</span>'; else if (low) sl = '<span class="pdp-stock-low">Only ' + stock + ' left</span>'; else sl = '<span class="pdp-stock-in">In Stock</span>';
  const dis = oos || nma; let bt = 'Add to Cart'; if (oos) bt = 'Out of stock'; else if (nma) bt = 'All stock in cart';
  const mi = currentPdpImages[0] || 'https://via.placeholder.com/500', hm = currentPdpImages.length > 1;
  const nd = hm ? '' : ' disabled', ct = hm ? '1 / ' + currentPdpImages.length : '';
  let th = ''; if (hm) th = '<div class="pdp-thumbs">' + currentPdpImages.map(function (u, i) { return '<button type="button" class="pdp-thumb' + (i === 0 ? ' active' : '') + '" onclick="switchPdpImageByIndex(' + i + ')"><img src="' + u + '"></button>'; }).join('') + '</div>';
  let vh = '';
  if (p.variants && p.variants.length > 0) {
    const av2 = p.variants[currentPdpVariantIndex] || p.variants[0];
    const btns = p.variants.map(function (v, i) { const t = (v.images && v.images[0]) || ''; const ia = i === currentPdpVariantIndex; return '<button type="button" class="pdp-variant-btn' + (ia ? ' active' : '') + '" onclick="switchPdpVariant(' + i + ')">' + (t ? '<img class="pdp-variant-thumb" src="' + t + '">' : '') + '<span>' + esc(v.name) + '</span></button>'; }).join('');
    vh = '<div class="pdp-variants"><div class="pdp-variants-label">Color: <strong id="pdpVariantName">' + esc(av2.name) + '</strong></div><div class="pdp-variant-list">' + btns + '</div></div>';
  }
  let dh = '';
  if (p.details && p.details.length > 0) { const rows = p.details.map(function (d) { return '<tr><td>' + esc(d.key || '') + '</td><td>' + esc(d.value || '') + '</td></tr>'; }).join(''); dh = '<details class="pdp-details" open><summary>Item details</summary><table class="pdp-details-table"><tbody>' + rows + '</tbody></table></details>'; }
  return '<button class="pdp-back-btn" onclick="hideProductDetail()">&larr; Back</button><div class="pdp-wrap"><div class="pdp-breadcrumb"><a onclick="hideProductDetail()">Home</a> &rsaquo; <a onclick="hideProductDetail();filterCategory(\'' + sc + '\')">' + esc(p.category) + '</a> &rsaquo; <span>' + esc(p.name) + '</span></div>' +
    '<div class="pdp-grid"><div class="pdp-image-col"><div class="pdp-image-main"><button type="button" class="pdp-nav-btn pdp-nav-prev" id="pdpNavPrev" onclick="pdpPrevImage()"' + nd + '>&lsaquo;</button><img id="pdpMainImage" src="' + mi + '"><button type="button" class="pdp-nav-btn pdp-nav-next" id="pdpNavNext" onclick="pdpNextImage()"' + nd + '>&rsaquo;</button>' + (hm ? '<div class="pdp-image-counter" id="pdpImageCounter">' + ct + '</div>' : '') + '</div><div id="pdpThumbsContainer" style="width:100%;">' + th + '</div></div>' +
    '<div class="pdp-info-col"><h1 class="pdp-title">' + esc(p.name) + '</h1><div class="pdp-rating-row"><span class="amz-stars" style="font-size:1.1rem;">' + renderStars(rr) + '</span><span>' + rr.toFixed(1) + '</span><span style="color:var(--amz-link);">' + rc.toLocaleString() + ' ratings</span></div>' +
    '<div class="pdp-price-block">' + (disc > 0 ? '<span class="pdp-deal-tag">-' + disc + '%</span>' : '') + '<span class="pdp-price">' + cur + fp.dollars + '<sup>' + fp.cents + '</sup></span>' + (disc > 0 ? '<span class="pdp-strike">' + cur + op.full + '</span>' : '') + '</div>' +
    '<div class="pdp-meta"><span>Category: <strong>' + esc(p.category) + '</strong></span></div><div class="pdp-meta"><span>Availability: ' + sl + '</span></div>' + vh +
    '<p class="pdp-desc">' + esc(p.description || 'No description.') + '</p>' +
    '<div class="pdp-actions"><div class="pdp-qty"><button type="button" onclick="changePdpQty(-1)">-</button><span id="pdpQtyValue">1</span><button type="button" onclick="changePdpQty(1)">+</button></div>' +
    '<button class="pdp-add-btn" ' + (dis ? 'disabled' : '') + ' onclick="addPdpToCart(\'' + sid + '\')">' + bt + '</button></div></div></div>' + dh + '</div>';
}
function changePdpQty(d) {
  if (!currentPdpProductId) return;
  const p = products.find(function (x) { return x.id === currentPdpProductId; }); if (!p) return;
  const stock = parseInt(p.stock) || 0, ai = getCartQtyForProduct(currentPdpProductId), ma = Math.max(0, stock - ai);
  let n = pdpQuantity + d; if (n < 1) n = 1;
  if (n > ma) { n = ma; showToast(ma === 0 ? 'All stock already in cart' : 'Only ' + ma + ' more can be added', 'warning'); }
  if (n > 99) n = 99; if (n < 1) n = 1; pdpQuantity = n;
  const e = document.getElementById('pdpQtyValue'); if (e) e.textContent = pdpQuantity;
}
function addPdpToCart(pid) {
  const p = products.find(function (x) { return x.id === pid; }); if (!p) return;
  const stock = parseInt(p.stock) || 0, ai = getCartQtyForProduct(pid), ma = Math.max(0, stock - ai);
  if (ma <= 0) { showToast('No more stock', 'warning'); return; }
  if (pdpQuantity > ma) { showToast('Only ' + ma + ' more', 'warning'); pdpQuantity = ma; }
  const vn = (p.variants && p.variants.length) ? ' (' + p.variants[currentPdpVariantIndex].name + ')' : '';
  const cid = p.id + ((p.variants && p.variants.length) ? '::' + currentPdpVariantIndex : '');
  const ex = cart.find(function (i) { return i.id === cid; });
  const dp = p.discount > 0 ? p.price * (1 - p.discount / 100) : p.price;
  const img = currentPdpImages[0] || getPrimaryImage(p);
  if (ex) ex.quantity += pdpQuantity;
  else cart.push({ id: cid, productId: p.id, variantIndex: (p.variants && p.variants.length) ? currentPdpVariantIndex : null, name: p.name + vn, price: dp, originalPrice: p.price, discount: p.discount, quantity: pdpQuantity, image: img });
  saveCart(); renderCart(); updateCartBadge(); showToast('Added ' + pdpQuantity + ' to cart');
  pdpQuantity = 1; const e = document.getElementById('pdpQtyValue'); if (e) e.textContent = '1';
  const rem = Math.max(0, stock - getCartQtyForProduct(pid)), btn = document.querySelector('.pdp-add-btn');
  if (btn && rem <= 0) { btn.disabled = true; btn.textContent = 'All stock in cart'; }
}

/* ============ CART ============ */
function addToCart(pid) {
  const p = products.find(function (x) { return x.id === pid; }); if (!p) return;
  const stock = parseInt(p.stock) || 0, ai = getCartQtyForProduct(pid);
  if (stock <= 0) { showToast('Out of stock', 'error'); return; }
  if (ai + 1 > stock) { showToast('Only ' + stock + ' in stock', 'warning'); return; }
  const ex = cart.find(function (i) { return i.id === pid; }), img = getPrimaryImage(p);
  if (ex) ex.quantity += 1;
  else { const dp = p.discount > 0 ? p.price * (1 - p.discount / 100) : p.price; cart.push({ id: p.id, productId: p.id, variantIndex: null, name: p.name, price: dp, originalPrice: p.price, discount: p.discount, quantity: 1, image: img }); }
  saveCart(); renderCart(); updateCartBadge(); showToast('Added to cart');
}
function removeFromCart(cid) { cart = cart.filter(function (i) { return i.id !== cid; }); saveCart(); renderCart(); updateCartBadge(); }
function updateQuantity(cid, d) {
  const i = cart.find(function (x) { return x.id === cid; }); if (!i) return;
  if (d > 0) { const pid = i.productId || i.id, s = getProductStock(pid), t = getCartQtyForProduct(pid); if (t + d > s) { showToast('Only ' + s + ' in stock', 'warning'); return; } }
  i.quantity += d; if (i.quantity <= 0) { removeFromCart(cid); return; }
  saveCart(); renderCart(); updateCartBadge();
}
function saveCart() { localStorage.setItem('cart', JSON.stringify(cart)); }
function renderCart() {
  const ci = document.getElementById('cartItems'), ct = document.getElementById('cartTotal'); const cur = getCurrency();
  if (!ci) return;
  if (cart.length === 0) { ci.innerHTML = '<p class="amz-empty-cart">Your cart is empty<br><small>Add items to get started.</small></p>'; ct.textContent = cur + '0.00'; return; }
  let tot = 0;
  ci.innerHTML = cart.map(function (i) {
    const it = i.price * i.quantity; tot += it; const sid = String(i.id).replace(/'/g, '');
    return '<div class="amz-cart-item"><img src="' + (i.image || 'https://via.placeholder.com/70') + '"><div class="amz-cart-item-info"><h4>' + esc(i.name) + '</h4><div class="price">' + cur + formatPriceParts(i.price).full + '</div><div class="amz-qty"><button onclick="updateQuantity(\'' + sid + '\',-1)">-</button><span>' + i.quantity + '</span><button onclick="updateQuantity(\'' + sid + '\',1)">+</button></div></div><button class="amz-cart-item-remove" onclick="removeFromCart(\'' + sid + '\')">Delete</button></div>';
  }).join('');
  ct.textContent = cur + formatPriceParts(tot).full;
}
function updateCartBadge() { const b = document.getElementById('cartBadge'); if (b) b.textContent = cart.reduce(function (s, i) { return s + i.quantity; }, 0); }
function toggleCart() { document.getElementById('cartSidebar').classList.toggle('open'); document.getElementById('overlay').classList.toggle('active'); }
function closeCart() { document.getElementById('cartSidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('active'); }

/* ============ CHECKOUT ============ */
function checkout() { if (cart.length === 0) { showToast('Your cart is empty', 'warning'); return; } showCheckoutModal(); }
function showCheckoutModal() {
  document.getElementById('modalRoot').innerHTML = '<div class="modal-overlay active"><div class="modal"><h2>Step 1 of 2 &mdash; Your Details</h2><form onsubmit="submitCheckoutInfo(event)"><div class="form-group"><label>Full Name</label><input type="text" id="customerName" required></div><div class="form-group"><label>Email</label><input type="email" id="customerEmail" required></div><div class="form-group"><label>Phone</label><input type="tel" id="customerPhone" required></div><div class="form-group"><label>Address</label><textarea id="customerAddress" rows="3" required></textarea></div><div class="modal-actions"><button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button><button type="submit" class="btn-primary">Continue to Payment</button></div></form></div></div>';
}
function submitCheckoutInfo(e) {
  e.preventDefault();
  pendingOrderData = { customerName: document.getElementById('customerName').value.trim(), email: document.getElementById('customerEmail').value.trim(), phone: document.getElementById('customerPhone').value.trim(), address: document.getElementById('customerAddress').value.trim(), items: cart.slice(), total: cart.reduce(function (s, i) { return s + i.price * i.quantity; }, 0) };
  pendingReceiptUrl = ''; showGcashPaymentModal();
}
function showGcashPaymentModal() {
  api('getPaymentMethods').then(function (m) {
    if (!m || m.length === 0) { showToast('No payment methods configured', 'error'); return; }
    _paymentMethodsCache = m; selectedPaymentMethodId = m[0].id;
    renderPaymentMethodModal(m, getCurrency(), formatPriceParts(pendingOrderData.total).full);
  }).catch(function () {});
}
function renderPaymentMethodModal(methods, cur, tot) {
  const opts = methods.map(function (m) { return '<label class="payment-method-option' + (m.id === selectedPaymentMethodId ? ' active' : '') + '" data-pm-id="' + esc(m.id) + '"><input type="radio" name="pm" value="' + esc(m.id) + '" ' + (m.id === selectedPaymentMethodId ? 'checked' : '') + ' onchange="selectPaymentMethod(\'' + esc(m.id).replace(/'/g, "\\'") + '\')"><div class="label"><strong>' + esc(m.name || 'Payment') + '</strong>' + (m.number ? '<small>' + esc(m.number) + '</small>' : '') + '</div></label>'; }).join('');
  document.getElementById('modalRoot').innerHTML = '<div class="modal-overlay active"><div class="modal"><h2>Step 2 of 2 &mdash; Payment</h2><p style="font-size:0.85rem;color:var(--amz-text-2);margin-bottom:12px;">Choose a payment method:</p><div class="payment-method-pick" id="paymentMethodPick">' + opts + '</div><div id="paymentMethodDetails">' + buildPaymentDetailsHtml() + '</div><div class="form-group" style="margin-top:16px;"><label>Upload Payment Receipt</label><div class="upload-zone" id="receiptUploadZone" ondragover="event.preventDefault();this.classList.add(\'dragover\')" ondragleave="this.classList.remove(\'dragover\')" ondrop="handleReceiptDrop(event)" onclick="if(event.target.tagName!==\'BUTTON\')document.getElementById(\'receiptFile\').click()"><input type="file" id="receiptFile" accept="image/*" style="display:none" onchange="handleReceiptFile(event)"><div id="receiptPlaceholder"><div class="upload-icon">&#128179;</div><div class="upload-text"><strong>Click to browse</strong> or drag &amp; drop your receipt<br><small>JPG, PNG &middot; Max 5 MB</small></div></div><img id="receiptPreview" style="display:none"><button type="button" id="receiptRemoveBtn" class="upload-remove-btn" style="display:none" onclick="removeReceipt(event)">Remove</button></div><p class="gcash-receipt-required" id="receiptStatus">Receipt is required to place the order.</p></div><div class="modal-actions"><button type="button" class="btn-secondary" onclick="cancelPayment()">Back</button><button type="button" class="btn-primary" id="placeOrderBtn" disabled onclick="submitPaymentAndPlaceOrder()">I have paid &mdash; Place Order</button></div></div></div>';
  if (pendingReceiptUrl) {
    const pv = document.getElementById('receiptPreview'), ph = document.getElementById('receiptPlaceholder'), rm = document.getElementById('receiptRemoveBtn'), st = document.getElementById('receiptStatus');
    if (pv) { pv.src = pendingReceiptUrl; pv.style.display = 'block'; } if (ph) ph.style.display = 'none'; if (rm) rm.style.display = 'inline-block';
    if (st) { st.textContent = '\u2713 Receipt uploaded.'; st.style.color = 'var(--amz-green)'; st.style.fontWeight = '600'; }
    const b = document.getElementById('placeOrderBtn'); if (b) b.disabled = false;
  }
}
function buildPaymentDetailsHtml() {
  const m = _paymentMethodsCache.find(function (x) { return x.id === selectedPaymentMethodId; }); if (!m) return '';
  const cur = getCurrency(), tot = formatPriceParts(pendingOrderData.total).full;
  const qr = m.qrUrl ? '<div class="gcash-qr-wrap"><img src="' + m.qrUrl + '"></div>' : '<div style="background:rgba(255,255,255,0.15);padding:20px;border-radius:8px;margin-bottom:12px;font-size:0.82rem;">No QR code — send to the number above.</div>';
  return '<div class="gcash-box"><div class="gcash-logo">' + esc(m.name) + '</div><div class="gcash-number-label">Send payment to</div><div class="gcash-number">' + esc(m.number || '—') + '</div>' + qr + '<div class="gcash-amount">Amount: <strong>' + cur + tot + '</strong></div></div><div class="gcash-instructions"><strong>How to pay:</strong><br>1. Open your ' + esc(m.name) + ' app and pay using the QR or number above.<br>2. Send the exact amount.<br>3. Screenshot the receipt and upload it below.<br>4. Click <strong>I have paid</strong> to place your order.</div>';
}
function selectPaymentMethod(id) { selectedPaymentMethodId = id; document.querySelectorAll('.payment-method-option').forEach(function (el) { el.classList.toggle('active', el.dataset.pmId === id); const r = el.querySelector('input[type="radio"]'); if (r) r.checked = (el.dataset.pmId === id); }); const d = document.getElementById('paymentMethodDetails'); if (d) d.innerHTML = buildPaymentDetailsHtml(); }
function cancelPayment() { pendingOrderData = null; pendingReceiptUrl = ''; selectedPaymentMethodId = null; closeModal(); }
function handleReceiptDrop(e) { e.preventDefault(); const z = document.getElementById('receiptUploadZone'); if (z) z.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) uploadReceiptFile(f); }
function handleReceiptFile(e) { const f = e.target.files[0]; if (f) uploadReceiptFile(f); }
function uploadReceiptFile(file) {
  if (!file.type || file.type.indexOf('image/') !== 0) { showToast('Please upload an image', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { showToast('Max 5 MB', 'error'); return; }
  const ph = document.getElementById('receiptPlaceholder'); if (ph) ph.innerHTML = '<div class="upload-progress">Uploading...</div>';
  const st = document.getElementById('receiptStatus'); if (st) st.textContent = 'Uploading...';
  const r = new FileReader();
  r.onload = function (ev) {
    const b = ev.target.result.split(',')[1];
    api('uploadImage', { base64Data: b, fileName: 'receipt_' + Date.now() + '_' + file.name, mimeType: file.type }).then(function (res) {
      if (res && res.success) {
        pendingReceiptUrl = res.url; const pv = document.getElementById('receiptPreview');
        if (pv) { pv.src = res.url; pv.style.display = 'block'; } if (ph) ph.style.display = 'none';
        const rm = document.getElementById('receiptRemoveBtn'); if (rm) rm.style.display = 'inline-block';
        if (st) { st.textContent = '\u2713 Receipt uploaded.'; st.style.color = 'var(--amz-green)'; st.style.fontWeight = '600'; }
        const b2 = document.getElementById('placeOrderBtn'); if (b2) b2.disabled = false;
      } else {
        showToast('Upload failed: ' + ((res && res.message) || 'unknown'), 'error');
        if (ph) ph.style.display = 'block';
        if (st) st.textContent = 'Receipt is required.';
      }
    }).catch(function () {
      if (ph) ph.style.display = 'block';
      if (st) st.textContent = 'Receipt is required.';
    });
  }; r.readAsDataURL(file);
}
function removeReceipt(e) {
  if (e) e.stopPropagation(); pendingReceiptUrl = '';
  const pv = document.getElementById('receiptPreview'); if (pv) { pv.src = ''; pv.style.display = 'none'; }
  const rm = document.getElementById('receiptRemoveBtn'); if (rm) rm.style.display = 'none';
  const ph = document.getElementById('receiptPlaceholder');
  if (ph) { ph.style.display = 'block'; ph.innerHTML = '<div class="upload-icon">&#128179;</div><div class="upload-text"><strong>Click to browse</strong> or drag &amp; drop your receipt<br><small>JPG, PNG &middot; Max 5 MB</small></div>'; }
  const st = document.getElementById('receiptStatus'); if (st) { st.textContent = 'Receipt is required.'; st.style.color = ''; st.style.fontWeight = ''; }
  const b = document.getElementById('placeOrderBtn'); if (b) b.disabled = true;
}
function submitPaymentAndPlaceOrder() {
  if (!pendingOrderData || !pendingReceiptUrl) { showToast('Please upload your receipt first', 'warning'); return; }
  if (!selectedPaymentMethodId) { showToast('Please choose a payment method', 'warning'); return; }
  const m = _paymentMethodsCache.find(function (x) { return x.id === selectedPaymentMethodId; });
  const btn = document.getElementById('placeOrderBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Placing order...'; }
  const order = Object.assign({}, pendingOrderData, { receiptUrl: pendingReceiptUrl, paymentMethod: m ? m.name : '' });
  api('placeOrder', order).then(function (res) {
    if (res && res.success) {
      cart = []; saveCart(); renderCart(); updateCartBadge();
      const tc = res.trackingCode || ''; pendingOrderData = null; pendingReceiptUrl = ''; selectedPaymentMethodId = null; _paymentMethodsCache = [];
      showOrderSuccessModal(res.orderId, tc); loadProducts();
    } else {
      showToast('Failed: ' + ((res && res.message) || 'Unknown'), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'I have paid — Place Order'; }
    }
  }).catch(function () {
    if (btn) { btn.disabled = false; btn.textContent = 'I have paid — Place Order'; }
  });
}
function showOrderSuccessModal(oid, tc) {
  document.getElementById('modalRoot').innerHTML = '<div class="modal-overlay active"><div class="modal"><h2 style="text-align:center;color:var(--amz-green);">\u2713 Order Placed!</h2><p style="text-align:center;color:var(--amz-text-2);margin-bottom:18px;">Save your tracking code below to monitor your order.</p><div class="track-code-box"><div class="label">Your Tracking Code</div><div class="code" id="successTrackingCode">' + esc(tc) + '</div><button type="button" class="btn-secondary" style="background:white;color:#232f3e;margin-top:8px;" onclick="copyTrackingCode(\'' + esc(tc) + '\')">Copy Code</button></div><p style="font-size:0.82rem;color:var(--amz-text-2);text-align:center;">Order ID: <strong>' + esc(oid) + '</strong></p><div class="modal-actions"><button type="button" class="btn-secondary" onclick="closeModal()">Close</button><button type="button" class="btn-primary" onclick="closeModal();showTrackOrderModal(\'' + esc(tc) + '\')">Track Order</button></div></div></div>';
}
function copyTrackingCode(c) { try { navigator.clipboard.writeText(c).then(function () { showToast('Copied'); }, function () { showToast('Copy failed', 'warning'); }); } catch (e) { showToast('Copy failed', 'warning'); } }

/* ============ TRACKING ============ */
function showTrackOrderModal(pc) {
  document.getElementById('modalRoot').innerHTML = '<div class="modal-overlay active"><div class="modal"><h2>Track Your Order</h2><form onsubmit="submitTrackingLookup(event)"><div class="form-group"><label>Enter your tracking code</label><input type="text" id="trackingInput" placeholder="TRK-XXXXXXXX" value="' + esc(pc || '') + '" required style="text-transform:uppercase;font-family:\'Courier New\',monospace;letter-spacing:1px;"></div><div class="modal-actions"><button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button><button type="submit" class="btn-primary">Track</button></div></form><div id="trackingResult"></div></div></div>';
  if (pc) setTimeout(function () { submitTrackingLookup({ preventDefault: function () {} }); }, 100);
}
function submitTrackingLookup(e) {
  if (e && e.preventDefault) e.preventDefault();
  const inp = document.getElementById('trackingInput'), code = (inp ? inp.value : '').trim().toUpperCase(), rd = document.getElementById('trackingResult');
  if (!code) { if (rd) rd.innerHTML = '<p style="color:var(--amz-red);margin-top:14px;">Please enter a tracking code.</p>'; return; }
  if (rd) rd.innerHTML = '<p style="text-align:center;color:var(--amz-text-2);margin-top:14px;">Looking up...</p>';
  api('getOrderByTracking', { code: code }).then(function (res) {
    if (!rd) return;
    if (!res || !res.success) { rd.innerHTML = '<p style="color:var(--amz-red);margin-top:14px;">' + esc((res && res.message) || 'Not found') + '</p>'; return; }
    const o = res.order, cur = getCurrency(); let items = [];
    try { items = JSON.parse(o.items); } catch (e) { items = []; }
    let ds = '—'; try { const d = new Date(o.date); if (!isNaN(d.getTime())) ds = d.toLocaleString(); } catch (e) {}
    const sm = { 'Pending': '#f59e0b', 'Awaiting verification': '#3b82f6', 'Confirmed': '#10b981', 'Done': '#10b981', 'Cancelled': '#ef4444' };
    const ps = o.paymentStatus || 'Awaiting payment', pcl = sm[ps] || '#6b7280';
    const ir = items.map(function (i) { return '<tr><td>' + esc(i.name) + '</td><td>' + i.quantity + '</td><td>' + cur + formatPriceParts(i.price).full + '</td></tr>'; }).join('');
    rd.innerHTML = '<div class="track-result"><div class="track-code-box"><div class="label">Order</div><div class="code">' + esc(o.orderId) + '</div></div><div class="track-row"><span>Tracking Code</span><span>' + esc(o.trackingCode) + '</span></div><div class="track-row"><span>Placed On</span><span>' + ds + '</span></div><div class="track-row"><span>Customer</span><span>' + esc(o.customerName) + '</span></div><div class="track-row"><span>Status</span><span style="color:' + pcl + ';">' + esc(o.status || 'Pending') + '</span></div><div class="track-row"><span>Payment</span><span style="color:' + pcl + ';">' + esc(ps) + '</span></div><div class="track-row"><span>Total</span><span>' + cur + formatPriceParts(o.total).full + '</span></div><h3 style="margin-top:16px;">Items</h3><table class="track-items-table"><thead><tr><th>Product</th><th>Qty</th><th>Price</th></tr></thead><tbody>' + ir + '</tbody></table></div>';
  }).catch(function () { if (rd) rd.innerHTML = '<p style="color:var(--amz-red);margin-top:14px;">Network error</p>'; });
}

/* ============ HOMEPAGE TABS ============ */
function loadHomepageTabs() {
  api('getStaticContent').then(function (c) { renderHomepageTabs(c || {}); }).catch(function () {});
  loadFeaturedReviews();
}
function renderHomepageTabs(c) {
  const aboutEl = document.getElementById('aboutUsContent');
  if (aboutEl) aboutEl.textContent = c.aboutUs || '';

  const faqEl = document.getElementById('faqContent');
  if (faqEl) {
    if (!c.faqItems || c.faqItems.length === 0) faqEl.innerHTML = '<p style="color:var(--amz-text-2);font-style:italic;">No FAQ yet.</p>';
    else faqEl.innerHTML = c.faqItems.map(function (f) { return '<div class="homepage-faq-item"><div class="homepage-faq-q"><span>' + esc(f.q || '') + '</span></div><div class="homepage-faq-a">' + esc(f.a || '') + '</div></div>'; }).join('');
  }

  const contactEl = document.getElementById('contactUsContent');
  if (contactEl) {
    if (c.contactUsMode === 'link' && c.contactUsUrl) contactEl.innerHTML = (c.contactUs ? '<span class="link-label">' + esc(c.contactUs) + '</span>' : '') + '<a href="' + esc(c.contactUsUrl) + '" target="_blank" rel="noopener" class="big-link">\uD83D\uDD17 ' + esc(c.contactUs || c.contactUsUrl) + '</a>';
    else contactEl.textContent = c.contactUs || '';
  }

  const subnav = document.getElementById('subnavCategories');
  if (!subnav) return;
  subnav.querySelectorAll('.homepage-tab-subnav, .subnav-sep').forEach(function (el) { el.remove(); });

  const sep = document.createElement('span');
  sep.className = 'subnav-sep';
  sep.textContent = '\u2502';
  subnav.appendChild(sep);

  const tabs = [
    { id: 'about', label: 'About Us' },
    { id: 'faq', label: 'FAQ' },
    { id: 'review', label: 'Customer Review' },
    { id: 'contact', label: 'Contact Us' }
  ];

  tabs.forEach(function (t) {
    const btn = document.createElement('button');
    btn.className = 'amz-subnav-item homepage-tab-subnav' + (currentHomepageTab === t.id ? ' active-tab' : '');
    btn.textContent = t.label;
    btn.dataset.tab = t.id;
    btn.onclick = function () { switchHomepageTab(t.id); };
    subnav.appendChild(btn);
  });
}
function switchHomepageTab(tab) {
  currentHomepageTab = tab;
  document.querySelectorAll('.homepage-tab-subnav').forEach(function (b) { b.classList.toggle('active-tab', b.dataset.tab === tab); });
  document.querySelectorAll('.homepage-tab-panel').forEach(function (p) { p.classList.remove('active'); });
  const panel = document.getElementById('hpanel-' + tab);
  if (panel) panel.classList.add('active');
  const cs = document.getElementById('homepageContentSection');
  if (cs) cs.style.display = 'block';
  const grid = document.getElementById('productGrid');
  const st = document.getElementById('sectionTitle');
  const pv = document.getElementById('productDetailView');
  if (grid) grid.style.display = 'none';
  if (st) st.style.display = 'none';
  if (pv) { pv.style.display = 'none'; pv.innerHTML = ''; }
  if (tab === 'review') loadFeaturedReviews();
  window.scrollTo({ top: 260, behavior: 'smooth' });
}

/* ============ REVIEWS ============ */
function lookupForReview() {
  const inp = document.getElementById('reviewTrackingInput'), rd = document.getElementById('reviewLookupResult');
  const code = (inp ? inp.value : '').trim().toUpperCase();
  if (!code) { showToast('Please enter your tracking code', 'warning'); return; }
  if (rd) rd.innerHTML = '<p style="color:var(--amz-text-2);">Looking up...</p>';
  api('getOrderProductsForReview', { code: code }).then(function (res) {
    if (!rd) return;
    if (!res || !res.success) { rd.innerHTML = '<p style="color:var(--amz-red);">' + esc((res && res.message) || 'Not found') + '</p>'; return; }
    if (!res.products || res.products.length === 0) { rd.innerHTML = '<p style="color:var(--amz-text-2);">No products in this order.</p>'; return; }
    rd.innerHTML = '<h4 style="margin:14px 0 10px;">Order ' + esc(res.orderId) + '</h4>' + res.products.map(function (p) {
      const st = p.hasReviewed ? '<span class="review-product-status done">Reviewed</span>' : '<span class="review-product-status pending">Not yet reviewed</span>';
      const sp = String(p.productId).replace(/'/g, ''), stc = esc(res.trackingCode || '').replace(/'/g, "\\'"), so = esc(res.orderId || '').replace(/'/g, "\\'"), spn = esc(p.productName || '').replace(/'/g, "\\'"), scn = esc(res.customerName || '').replace(/'/g, "\\'");
      return '<div class="review-product-card"><img src="' + esc(p.image || 'https://via.placeholder.com/70') + '"><div class="review-product-info"><h4>' + esc(p.productName) + '</h4><div class="meta">Qty: ' + p.quantity + '</div></div>' + st + (p.hasReviewed ? '' : '<div id="reviewForm_' + sp + '"></div><button type="button" class="btn-primary" style="width:100%;margin-top:10px;" onclick="showReviewForm(\'' + sp + '\',\'' + stc + '\',\'' + so + '\',\'' + spn + '\',\'' + scn + '\')">Write a Review</button>') + '</div>';
    }).join('');
  }).catch(function () { if (rd) rd.innerHTML = '<p style="color:var(--amz-red);">Network error</p>'; });
}
function showReviewForm(pid, tc, oid, pn, cn) {
  _reviewImageUrls[pid] = '';
  const h = document.getElementById('reviewForm_' + pid); if (!h) return;
  h.innerHTML = '<div class="review-form"><div class="form-group"><label style="font-size:0.85rem;font-weight:600;">Your rating</label><div class="star-picker" id="starPicker_' + pid + '">' + [1, 2, 3, 4, 5].map(function (n) { return '<span data-rating="' + n + '" onclick="setReviewRating(\'' + pid + '\',' + n + ')" onmouseover="hoverStar(\'' + pid + '\',' + n + ')" onmouseout="resetStarHover(\'' + pid + '\')">\u2605</span>'; }).join('') + '</div><input type="hidden" id="reviewRating_' + pid + '" value="5"></div><div class="form-group"><label style="font-size:0.85rem;font-weight:600;">Your review (optional)</label><textarea id="reviewComment_' + pid + '" placeholder="Tell others..."></textarea></div><div class="form-group"><label style="font-size:0.85rem;font-weight:600;">Add a photo (optional)</label><div class="review-image-zone"><div id="reviewImageThumb_' + pid + '"></div><button type="button" class="review-image-upload-btn" onclick="document.getElementById(\'reviewImageFile_' + pid + '\').click()"><span>&#128247;</span><span>Add image</span></button><input type="file" id="reviewImageFile_' + pid + '" accept="image/*" style="display:none" onchange="handleReviewImageFile(event,\'' + pid + '\')"></div></div><div class="review-submit-actions"><button type="button" class="btn-secondary" onclick="cancelReviewForm(\'' + pid + '\')">Cancel</button><button type="button" class="btn-primary" onclick="submitReviewForm(\'' + pid + '\',\'' + tc + '\',\'' + oid + '\',\'' + pn + '\',\'' + cn + '\')">Submit Review</button></div></div>';
  setReviewRating(pid, 5);
}
function hoverStar(pid, n) { document.querySelectorAll('#starPicker_' + pid + ' span').forEach(function (s, i) { s.classList.toggle('filled', i < n); }); }
function resetStarHover(pid) { const c = parseInt(document.getElementById('reviewRating_' + pid).value) || 5; document.querySelectorAll('#starPicker_' + pid + ' span').forEach(function (s, i) { s.classList.toggle('filled', i < c); }); }
function setReviewRating(pid, n) { const e = document.getElementById('reviewRating_' + pid); if (e) e.value = n; document.querySelectorAll('#starPicker_' + pid + ' span').forEach(function (s, i) { s.classList.toggle('filled', i < n); }); }
function handleReviewImageFile(e, pid) {
  const f = e.target.files[0]; if (!f) return;
  if (!f.type || f.type.indexOf('image/') !== 0) { showToast('Please upload an image', 'error'); return; }
  if (f.size > 5 * 1024 * 1024) { showToast('Max 5 MB', 'error'); return; }
  const t = document.getElementById('reviewImageThumb_' + pid); if (t) t.innerHTML = '<div style="padding:10px;font-size:0.8rem;color:var(--amz-text-2);">Uploading...</div>';
  const r = new FileReader();
  r.onload = function (ev) {
    const b = ev.target.result.split(',')[1];
    api('uploadImage', { base64Data: b, fileName: f.name, mimeType: f.type }).then(function (res) {
      if (res && res.success) { _reviewImageUrls[pid] = res.url; if (t) t.innerHTML = '<div class="review-image-thumb"><img src="' + res.url + '"><button type="button" class="remove-btn" onclick="removeReviewImage(\'' + pid + '\')">&times;</button></div>'; }
      else { if (t) t.innerHTML = ''; showToast('Upload failed', 'error'); }
    }).catch(function () { if (t) t.innerHTML = ''; });
  }; r.readAsDataURL(f);
}
function removeReviewImage(pid) { _reviewImageUrls[pid] = ''; const t = document.getElementById('reviewImageThumb_' + pid); if (t) t.innerHTML = ''; }
function cancelReviewForm(pid) { const h = document.getElementById('reviewForm_' + pid); if (h) h.innerHTML = ''; _reviewImageUrls[pid] = ''; }
function submitReviewForm(pid, tc, oid, pn, cn) {
  const rating = parseInt(document.getElementById('reviewRating_' + pid).value) || 5;
  const comment = document.getElementById('reviewComment_' + pid).value.trim();
  const imageUrl = _reviewImageUrls[pid] || '';
  showLoading('Submitting review...');
  api('submitReview', { productId: pid, trackingCode: tc, orderId: oid, productName: pn, customerName: cn, rating: rating, comment: comment, imageUrl: imageUrl }).then(function (res) {
    hideLoading();
    if (res && res.success) { showToast('Thanks for your review!'); cancelReviewForm(pid); lookupForReview(); loadFeaturedReviews(); }
    else showToast((res && res.message) || 'Failed', 'error');
  }).catch(function () { hideLoading(); });
}
function loadFeaturedReviews() {
  const c = document.getElementById('featuredReviewsList'); if (!c) return;
  api('getFeaturedReviews', { limit: 8 }).then(function (list) {
    if (!list || list.length === 0) { c.innerHTML = '<p style="color:var(--amz-text-2);font-style:italic;">No reviews yet.</p>'; return; }
    c.innerHTML = list.map(function (r) {
      const st = renderStars(parseInt(r.rating) || 5); let ds = '';
      try { const d = new Date(r.date); if (!isNaN(d.getTime())) ds = d.toLocaleDateString(); } catch (e) {}
      return '<div class="featured-review-card"><div class="header"><div class="product-name">' + esc(r.productName || 'Product') + '</div><div class="stars">' + st + '</div></div><div class="meta">' + esc(r.customerName || 'Anonymous') + (ds ? ' &middot; ' + ds : '') + '</div>' + (r.comment ? '<div class="comment">' + esc(r.comment) + '</div>' : '') + (r.imageUrl ? '<img class="review-img" src="' + r.imageUrl + '">' : '') + '</div>';
    }).join('');
  }).catch(function () {});
}

/* ============ ADMIN AUTH ============ */
function showAdminLogin() {
  if (isAdmin) { showAdminPanel(); return; }
  document.getElementById('modalRoot').innerHTML = '<div class="modal-overlay active"><div class="modal"><h2>Admin Login</h2><form onsubmit="loginAdmin(event)"><div class="form-group"><label>Password</label><input type="password" id="adminPassword" required></div><div class="modal-actions"><button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button><button type="submit" class="btn-primary">Login</button></div></form></div></div>';
}
function loginAdmin(e) {
  e.preventDefault();
  const p = document.getElementById('adminPassword').value;
  api('checkAdminPassword', { password: p }).then(function (res) {
    if (res && res.success) {
      isAdmin = true;
      sessionStorage.setItem('isAdmin', 'true');
      sessionStorage.setItem('adminPassword', p);
      closeModal();
      showAdminPanel();
    } else {
      showToast('Invalid password', 'error');
    }
  }).catch(function () {});
}
function showAdminPanel() { document.getElementById('storeSection').style.display = 'none'; document.getElementById('adminSection').style.display = 'block'; loadAdminData(); }
function logoutAdmin() { isAdmin = false; sessionStorage.removeItem('isAdmin'); sessionStorage.removeItem('adminPassword'); document.getElementById('adminSection').style.display = 'none'; document.getElementById('storeSection').style.display = 'block'; }
function previewStoreView() { document.getElementById('adminSection').style.display = 'none'; document.getElementById('storeSection').style.display = 'block'; loadSettings(); loadProducts(); renderCart(); updateCartBadge(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

/* ============ ADMIN DATA ============ */
function loadAdminData() {
  api('getProducts').then(function (d) { products = d || []; renderAdminProducts(); renderDashboardStats(); }).catch(function () {});
  adminApi('getOrders').then(function (o) { renderAdminOrders(o || []); }).catch(function () {});
  api('getSettings').then(function (d) { settings = d || {}; populateSettingsForm(); applyTheme(); }).catch(function () {});
  api('getCategories').then(function (c) { allCategories = c || []; populateBulkDiscountCategories(); }).catch(function () {});
  loadSalesAnalytics();
}
function renderDashboardStats() {
  const a = products.filter(function (p) { return p.active; }).length, o = products.filter(function (p) { return p.stock <= 0; }).length, d = products.filter(function (p) { return p.discount > 0; }).length;
  const t1 = document.getElementById('statTotal'); if (t1) t1.textContent = products.length;
  const t2 = document.getElementById('statActive'); if (t2) t2.textContent = a;
  const t3 = document.getElementById('statOutOfStock'); if (t3) t3.textContent = o;
  const t4 = document.getElementById('statDiscounted'); if (t4) t4.textContent = d;
}
function renderAdminProducts() {
  const tb = document.getElementById('adminProductTableBody'); if (!tb) return; const cur = getCurrency();
  tb.innerHTML = products.map(function (p) {
    const sid = String(p.id).replace(/'/g, ''), img = getPrimaryImage(p);
    const ic = ((p.images && p.images.length) || 0) + ((p.variants && p.variants.length) ? p.variants.reduce(function (s, v) { return s + (v.images.length || 0); }, 0) : 0);
    const cb = ic > 1 ? ' <span style="background:#ffd814;color:#111;padding:1px 6px;border-radius:8px;font-size:0.7rem;font-weight:700;">' + ic + '</span>' : '';
    const vb = (p.variants && p.variants.length) ? ' <span style="background:#007185;color:white;padding:1px 6px;border-radius:8px;font-size:0.7rem;font-weight:700;">' + p.variants.length + ' colors</span>' : '';
    return '<tr><td><img src="' + img + '" width="40" height="40" style="object-fit:cover;border-radius:4px;"></td><td>' + esc(p.name) + cb + vb + '</td><td>' + esc(p.category) + '</td><td>' + cur + formatPriceParts(p.price).full + '</td><td>' + p.discount + '%</td><td>' + p.stock + '</td><td><span class="badge ' + (p.active ? 'badge-success' : 'badge-danger') + '">' + (p.active ? 'Active' : 'Inactive') + '</span></td><td class="actions"><button class="btn-icon" onclick="editProduct(\'' + sid + '\')">Edit</button><button class="btn-icon" onclick="toggleProduct(\'' + sid + '\',' + p.active + ')">' + (p.active ? 'Off' : 'On') + '</button><button class="btn-icon" onclick="deleteProductConfirm(\'' + sid + '\')">Del</button></td></tr>';
  }).join('');
}
function renderAdminOrders(orders) {
  const tb = document.getElementById('adminOrderTableBody'); if (!tb) return; const cur = getCurrency();
  if (!orders || orders.length === 0) { tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#565959;">No orders yet</td></tr>'; return; }
  orders.sort(function (a, b) { return (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0); });
  tb.innerHTML = orders.map(function (o) {
    const sid = String(o.orderId).replace(/'/g, ''); let ds = '—';
    try { const d = new Date(o.date); if (!isNaN(d.getTime())) ds = d.toLocaleString(); } catch (e) {}
    const st = String(o.status || 'Pending'), id = st.toLowerCase() === 'done';
    const tc = id ? 'done' : 'pending', tl = id ? '\u2713 Done' : '\u23F1 Pending', ns = id ? 'Pending' : 'Done';
    return '<tr><td>' + esc(String(o.orderId || '')) + '</td><td>' + esc(o.customerName || '') + '</td><td>' + esc(o.email || '') + '</td><td>' + cur + formatPriceParts(o.total).full + '</td><td>' + ds + '</td><td><button class="status-toggle-btn ' + tc + '" onclick="toggleOrderStatus(\'' + sid + '\',\'' + ns + '\',this)">' + tl + '</button></td><td><span style="font-family:\'Courier New\',monospace;font-weight:700;font-size:0.78rem;">' + esc(o.trackingCode || '—') + '</span></td><td><button class="btn-icon" onclick="viewOrder(\'' + sid + '\')">View</button></td></tr>';
  }).join('');
}
function toggleOrderStatus(oid, ns, btn) {
  const id = ns === 'Done';
  showConfirm({
    title: id ? 'Mark as Done?' : 'Revert to Pending?',
    message: id ? 'This order will be marked as completed and counted in sales analytics.' : 'This order will be moved back to Pending.',
    confirmText: id ? 'Yes, mark as Done' : 'Yes, revert', confirmStyle: id ? 'primary' : 'danger',
    icon: id ? '\u2713' : '\u21BA', iconStyle: id ? 'info' : 'warn',
    onConfirm: function (done) {
      showLoading('Updating...');
      adminApi('updateOrderStatus', { orderId: oid, status: ns }).then(function (res) {
        hideLoading(); done();
        if (res && res.success) { showToast('Marked as ' + ns); loadAdminData(); }
        else showToast((res && res.message) || 'Failed', 'error');
      }).catch(function () { hideLoading(); done(); });
    }
  });
}
function viewOrder(oid) {
  adminApi('getOrders').then(function (orders) {
    const o = (orders || []).find(function (x) { return x.orderId === oid; }); if (!o) return;
    let items = []; try { items = JSON.parse(o.items); } catch (e) {}
    const cur = getCurrency();
    const rows = items.map(function (i) { return '<tr><td>' + esc(i.name) + '</td><td>' + i.quantity + '</td><td>' + cur + formatPriceParts(i.price).full + '</td><td>' + cur + formatPriceParts(i.price * i.quantity).full + '</td></tr>'; }).join('');
    let ds = '—'; try { const d = new Date(o.date); if (!isNaN(d.getTime())) ds = d.toLocaleString(); } catch (e) {}
    const rc = o.receiptUrl ? '<div style="margin-top:12px;"><strong>Payment Receipt</strong><br><a href="' + o.receiptUrl + '" target="_blank"><img src="' + o.receiptUrl + '" style="max-width:200px;border-radius:6px;border:1px solid #ddd;margin-top:6px;"></a></div>' : '<p style="margin-top:12px;color:#999;">No receipt</p>';
    document.getElementById('modalRoot').innerHTML = '<div class="modal-overlay active"><div class="modal modal-lg"><h2>Order ' + esc(String(o.orderId)) + '</h2><p><strong>Tracking:</strong> <span style="font-family:\'Courier New\',monospace;">' + esc(o.trackingCode || '—') + '</span></p><p><strong>Date:</strong> ' + ds + '</p><p><strong>Customer:</strong> ' + esc(o.customerName) + '</p><p><strong>Email:</strong> ' + esc(o.email) + '</p><p><strong>Phone:</strong> ' + esc(o.phone) + '</p><p><strong>Address:</strong> ' + esc(o.address) + '</p><p><strong>Payment Method:</strong> ' + esc(o.paymentMethod || '—') + '</p><p><strong>Payment Status:</strong> ' + esc(o.paymentStatus || '—') + '</p><h3 style="margin:16px 0 8px;">Items</h3><table class="table"><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>' + rows + '</tbody></table><p style="margin-top:12px;font-size:1.1rem;"><strong>Total:</strong> ' + cur + formatPriceParts(o.total).full + '</p>' + rc + '<div class="modal-actions"><button class="btn-secondary" onclick="closeModal()">Close</button></div></div></div>';
  }).catch(function () {});
}

/* ============ PRODUCT CRUD ============ */
function showProductForm(product) {
  const ie = !!product, p = product || {};
  productImageList = (p.images && p.images.length) ? p.images.slice() : (p.image ? [p.image] : []);
  productDetails = (p.details && p.details.length) ? p.details.map(function (d) { return { key: d.key || '', value: d.value || '' }; }) : [];
  productVariants = (p.variants && p.variants.length) ? p.variants.map(function (v) { return { name: v.name || '', images: (v.images || []).slice() }; }) : [];
  const cc = String(p.category || '').trim(); let cl = allCategories.slice();
  if (cc && cl.indexOf(cc) === -1) { cl.push(cc); cl.sort(); }
  const co = cl.map(function (c) { return '<option value="' + esc(c) + '"' + (c === cc ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  document.getElementById('modalRoot').innerHTML = '<div class="modal-overlay active"><div class="modal modal-lg"><h2>' + (ie ? 'Edit Product' : 'Add Product') + '</h2><form onsubmit="saveProductForm(event,\'' + (p.id || '') + '\')"><div class="form-row"><div class="form-group"><label>Name</label><input type="text" id="prodName" value="' + esc(p.name || '') + '" required></div><div class="form-group"><label>Category</label><select id="prodCategory" onchange="onCategoryChange(this)" required><option value="">-- Select --</option>' + co + '<option value="__new__">+ Add new category...</option></select><input type="text" id="prodCategoryNew" placeholder="New category name" style="display:none;margin-top:8px;"></div></div><div class="form-group"><label>Description</label><textarea id="prodDesc" rows="4">' + esc(p.description || '') + '</textarea></div><div class="form-group"><label>Product Images (up to ' + MAX_PRODUCT_IMAGES + ')</label><div class="upload-zone" id="productUploadZone" ondragover="event.preventDefault();this.classList.add(\'dragover\')" ondragleave="this.classList.remove(\'dragover\')" ondrop="handleProductDrop(event)" onclick="handleProductZoneClick(event)"><input type="file" id="prodImageFile" accept="image/*" multiple style="display:none" onchange="handleProductFiles(event)"><div id="productUploadPlaceholder"><div class="upload-icon">&#128247;</div><div class="upload-text"><strong>Click to browse</strong> or drag &amp; drop<br><small>JPG, PNG, WEBP</small></div></div></div><div id="productImageThumbs" class="image-thumbs"></div></div><div class="form-group"><label>Or add image by URL</label><div style="display:flex;gap:8px;"><input type="url" id="prodImageUrl" placeholder="https://..." style="flex:1;"><button type="button" class="btn-secondary" onclick="addProductImageFromUrl()">Add</button></div></div><div class="form-row"><div class="form-group"><label>Price</label><input type="number" step="0.01" id="prodPrice" value="' + (p.price || '') + '" required></div><div class="form-group"><label>Discount (%)</label><input type="number" step="1" min="0" max="100" id="prodDiscount" value="' + (p.discount || 0) + '"></div></div><div class="form-row"><div class="form-group"><label>Stock</label><input type="number" id="prodStock" value="' + (p.stock || 0) + '"></div><div class="form-group" style="display:flex;align-items:flex-end;"><label style="margin:0;"><input type="checkbox" id="prodActive" ' + (ie && !p.active ? '' : 'checked') + '> Active</label></div></div><div class="settings-section"><h3>Item details</h3><div id="prodDetailsList"></div><button type="button" class="add-row-btn" onclick="addDetailRow()">+ Add detail</button></div><div class="settings-section"><h3>Color variants</h3><div id="prodVariantsList"></div><button type="button" class="add-row-btn" onclick="addVariant()">+ Add color variant</button></div><div class="modal-actions"><button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button><button type="submit" class="btn-primary">' + (ie ? 'Update' : 'Add') + ' Product</button></div></form></div></div>';
  renderProductImageThumbs(); renderDetailsList(); renderVariantsList();
}
function renderProductImageThumbs() {
  const c = document.getElementById('productImageThumbs'); if (!c) return;
  if (productImageList.length === 0) { c.innerHTML = ''; return; }
  c.innerHTML = productImageList.map(function (u, i) {
    const ip = i === 0;
    return '<div class="image-thumb' + (ip ? ' primary' : '') + '"><img src="' + u + '">' + (ip ? '<span class="primary-badge">MAIN</span>' : '') + '<button type="button" class="remove-btn" onclick="removeProductImageAt(' + i + ')">&times;</button></div>';
  }).join('');
}
function removeProductImageAt(i) { if (i < 0 || i >= productImageList.length) return; productImageList.splice(i, 1); renderProductImageThumbs(); }
function addProductImageFromUrl() { const inp = document.getElementById('prodImageUrl'); if (!inp) return; const u = inp.value.trim(); if (!u) return; if (productImageList.length >= MAX_PRODUCT_IMAGES) { showToast('Max ' + MAX_PRODUCT_IMAGES, 'warning'); return; } productImageList.push(u); inp.value = ''; renderProductImageThumbs(); }
function renderDetailsList() {
  const c = document.getElementById('prodDetailsList'); if (!c) return;
  if (productDetails.length === 0) { c.innerHTML = ''; return; }
  c.innerHTML = productDetails.map(function (d, i) { return '<div class="detail-row"><input type="text" placeholder="Key" value="' + esc(d.key || '') + '" oninput="updateDetail(' + i + ',\'key\',this.value)"><input type="text" placeholder="Value" value="' + esc(d.value || '') + '" oninput="updateDetail(' + i + ',\'value\',this.value)"><button type="button" class="remove-detail" onclick="removeDetailRow(' + i + ')">&times;</button></div>'; }).join('');
}
function addDetailRow() { productDetails.push({ key: '', value: '' }); renderDetailsList(); }
function updateDetail(i, f, v) { if (productDetails[i]) productDetails[i][f] = v; }
function removeDetailRow(i) { productDetails.splice(i, 1); renderDetailsList(); }
function renderVariantsList() {
  const c = document.getElementById('prodVariantsList'); if (!c) return;
  if (productVariants.length === 0) { c.innerHTML = '<p style="color:var(--amz-text-2);font-size:0.85rem;margin-bottom:10px;">No variants.</p>'; return; }
  c.innerHTML = productVariants.map(function (v, vi) {
    const th = (v.images || []).map(function (u, ii) { return '<div class="image-thumb"><img src="' + u + '"><button type="button" class="remove-btn" onclick="removeVariantImage(' + vi + ',' + ii + ')">&times;</button></div>'; }).join('');
    return '<div class="variant-card"><div class="variant-header"><input type="text" class="variant-name-input" placeholder="Color name" value="' + esc(v.name || '') + '" oninput="updateVariantName(' + vi + ',this.value)"><button type="button" class="btn-icon" onclick="removeVariant(' + vi + ')">Remove</button></div><div class="upload-zone variant-upload" ondragover="event.preventDefault();this.classList.add(\'dragover\')" ondragleave="this.classList.remove(\'dragover\')" ondrop="handleVariantDrop(event,' + vi + ')" onclick="handleVariantZoneClick(event,' + vi + ')"><input type="file" id="variantFile_' + vi + '" accept="image/*" multiple style="display:none" onchange="handleVariantFiles(event,' + vi + ')"><div class="upload-text" style="font-size:0.8rem;"><strong>Click or drop</strong> images<br><small>Up to ' + MAX_VARIANT_IMAGES + '</small></div></div><div class="image-thumbs" id="variantThumbs_' + vi + '">' + th + '</div></div>';
  }).join('');
}
function renderVariantThumbs(vi) { const c = document.getElementById('variantThumbs_' + vi); if (!c) return; const v = productVariants[vi]; if (!v) { c.innerHTML = ''; return; } c.innerHTML = (v.images || []).map(function (u, ii) { return '<div class="image-thumb"><img src="' + u + '"><button type="button" class="remove-btn" onclick="removeVariantImage(' + vi + ',' + ii + ')">&times;</button></div>'; }).join(''); }
function addVariant() { productVariants.push({ name: '', images: [] }); renderVariantsList(); }
function removeVariant(i) { productVariants.splice(i, 1); renderVariantsList(); }
function updateVariantName(i, v) { if (productVariants[i]) productVariants[i].name = v; }
function removeVariantImage(vi, ii) { if (!productVariants[vi]) return; productVariants[vi].images.splice(ii, 1); renderVariantThumbs(vi); }
function handleVariantZoneClick(e, vi) { if (e.target && e.target.tagName === 'BUTTON') return; const i = document.getElementById('variantFile_' + vi); if (i) i.click(); }
function handleVariantDrop(e, vi) { e.preventDefault(); const z = e.currentTarget; if (z) z.classList.remove('dragover'); const f = e.dataTransfer.files; if (f && f.length) uploadVariantImages(vi, f); }
function handleVariantFiles(e, vi) { const f = e.target.files; if (f && f.length) uploadVariantImages(vi, f); e.target.value = ''; }
function uploadVariantImages(vi, files) {
  const arr = Array.prototype.slice.call(files); if (!productVariants[vi]) return;
  const v = productVariants[vi], rem = MAX_VARIANT_IMAGES - (v.images.length || 0);
  if (rem <= 0) { showToast('Max ' + MAX_VARIANT_IMAGES, 'warning'); return; }
  const tu = arr.slice(0, rem); let d = 0, f = 0;
  tu.forEach(function (file) { uploadImageFile(file, function (u) { v.images.push(u); d++; renderVariantThumbs(vi); if (d + f === tu.length) showToast('Uploaded ' + d); }, function () { f++; if (d + f === tu.length) showToast('Uploaded ' + d); }); });
}
function onCategoryChange(s) { const n = document.getElementById('prodCategoryNew'); if (!n) return; if (s.value === '__new__') { n.style.display = 'block'; n.required = true; setTimeout(function () { n.focus(); }, 60); } else { n.style.display = 'none'; n.required = false; n.value = ''; } }
function handleProductZoneClick(e) { if (e.target && e.target.tagName === 'BUTTON') return; const i = document.getElementById('prodImageFile'); if (i) i.click(); }
function saveProductForm(e, id) {
  e.preventDefault();
  let cat = document.getElementById('prodCategory').value;
  const inc = (cat === '__new__');
  if (inc) { cat = document.getElementById('prodCategoryNew').value.trim(); if (!cat) { showToast('Enter category name', 'warning'); return; } }
  if (!cat) { showToast('Select a category', 'warning'); return; }
  const cd = productDetails.map(function (d) { return { key: String(d.key || '').trim(), value: String(d.value || '').trim() }; }).filter(function (d) { return d.key || d.value; });
  const cv = productVariants.map(function (v) { return { name: String(v.name || '').trim(), images: (v.images || []).filter(function (u) { return u; }) }; }).filter(function (v) { return v.name; });
  const prod = { id: id || null, name: document.getElementById('prodName').value, category: cat, description: document.getElementById('prodDesc').value, price: parseFloat(document.getElementById('prodPrice').value), discount: parseFloat(document.getElementById('prodDiscount').value) || 0, stock: parseInt(document.getElementById('prodStock').value) || 0, image: productImageList[0] || '', images: productImageList.slice(), details: cd, variants: cv, active: document.getElementById('prodActive').checked };
  const commit = function () { adminApi('saveProduct', prod).then(function (res) { if (res && res.success) { showToast(res.message); closeModal(); loadAdminData(); } else showToast((res && res.message) || 'Failed', 'error'); }).catch(function () {}); };
  if (inc) adminApi('addCategory', { name: cat }).then(function () { commit(); }).catch(function () { commit(); });
  else commit();
}
function editProduct(id) { const p = products.find(function (x) { return x.id === id; }); if (p) showProductForm(p); }
function toggleProduct(id, cur) { adminApi('toggleProductActive', { id: id, active: !cur }).then(function (res) { if (res && res.success) { showToast('Updated'); loadAdminData(); } }).catch(function () {}); }
function deleteProductConfirm(id) {
  const p = products.find(function (x) { return x.id === id; });
  showConfirm({ title: 'Delete product?', message: 'Permanently delete "' + esc(p ? p.name : 'this product') + '"?', confirmText: 'Delete', confirmStyle: 'danger', icon: '\u26A0', iconStyle: 'danger',
    onConfirm: function (done) {
      showLoading('Deleting...');
      adminApi('deleteProduct', { id: id }).then(function (res) { hideLoading(); done(); if (res && res.success) { showToast(res.message); loadAdminData(); } else showToast((res && res.message) || 'Failed', 'error'); }).catch(function () { hideLoading(); done(); });
    }
  });
}
function populateBulkDiscountCategories() { const s = document.getElementById('bulkDiscountCategory'); if (!s) return; s.innerHTML = '<option value="">Select Category</option>' + allCategories.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join(''); }
function applyBulkDiscount() {
  const c = document.getElementById('bulkDiscountCategory').value, d = parseFloat(document.getElementById('bulkDiscountPercent').value);
  if (!c || isNaN(d)) { showToast('Select category and discount', 'warning'); return; }
  showLoading('Applying discount...');
  adminApi('applyDiscountByCategory', { category: c, discount: d }).then(function (res) { hideLoading(); if (res && res.success) { showToast(res.message); loadAdminData(); } }).catch(function () { hideLoading(); });
}

/* ============ SALES ============ */
function loadSalesAnalytics() { adminApi('getSalesAnalytics').then(function (d) { renderSalesAnalytics(d); }).catch(function () {}); }
function renderSalesAnalytics(d) {
  const cur = getCurrency();
  if (!d || !d.success) { ['salesTotalRevenue', 'salesDoneOrders', 'salesPendingOrders', 'salesAvgOrder'].forEach(function (id) { const e = document.getElementById(id); if (e) e.textContent = '—'; }); return; }
  const t1 = document.getElementById('salesTotalRevenue'); if (t1) t1.textContent = cur + formatPriceParts(d.totalRevenue).full;
  const t2 = document.getElementById('salesDoneOrders'); if (t2) t2.textContent = d.doneOrders;
  const t3 = document.getElementById('salesPendingOrders'); if (t3) t3.textContent = d.pendingOrders;
  const t4 = document.getElementById('salesAvgOrder'); if (t4) t4.textContent = cur + formatPriceParts(d.avgOrderValue).full;
  renderBarChart('dailyChart', d.dailySales, 'revenue', 'label');
  renderBarChart('monthlyChart', d.monthlySales, 'revenue', 'label');
  renderTopProducts(d.topProducts);
}
function renderBarChart(cid, arr, vk, lk) {
  const c = document.getElementById(cid); if (!c) return;
  if (!arr || arr.length === 0) { c.innerHTML = '<p class="bar-chart-empty">No data yet</p>'; return; }
  const mx = Math.max.apply(null, arr.map(function (d) { return d[vk] || 0; })), cur = getCurrency();
  c.innerHTML = arr.map(function (d) {
    const v = d[vk] || 0, hv = v > 0, pct = hv ? Math.max(6, (v / mx) * 100) : 0;
    return '<div class="bar-col' + (hv ? ' has-value' : ' no-value') + '">' + (hv ? '<div class="bar-value">' + cur + formatPriceParts(v).full + '</div>' : '') + '<div class="bar" style="height:' + pct + '%;"></div><div class="bar-label">' + esc(d[lk] || '') + '</div></div>';
  }).join('');
}
function renderTopProducts(list) {
  const c = document.getElementById('topProductsList'); if (!c) return;
  if (!list || list.length === 0) { c.innerHTML = '<p class="bar-chart-empty">No product sales yet</p>'; return; }
  const cur = getCurrency();
  c.innerHTML = list.map(function (p, i) {
    let rc = ''; if (i === 0) rc = ' gold'; else if (i === 1) rc = ' silver'; else if (i === 2) rc = ' bronze';
    return '<div class="top-product-row"><div class="top-product-rank' + rc + '">' + (i + 1) + '</div><div class="top-product-name">' + esc(p.name) + '</div><span class="top-product-qty">' + p.quantity + ' sold</span><span class="top-product-rev">' + cur + formatPriceParts(p.revenue).full + '</span></div>';
  }).join('');
}

/* ============ SETTINGS FORM ============ */
function populateSettingsForm() {
  const sv = function (id, v) { const e = document.getElementById(id); if (e) e.value = v; };
  const st = function (id, v) { const e = document.getElementById(id); if (e) e.textContent = v; };
  sv('settingsStoreName', settings.storeName || '');
  sv('settingsTagline', settings.storeTagline || '');
  sv('settingsAnnouncement', settings.announcement || '');
  sv('settingsCurrency', settings.currency || DEFAULT_CURRENCY);
  sv('settingsSupportEmail', settings.supportEmail || '');
  sv('settingsAdminPassword', settings.adminPassword || '');
  sv('settingsAboutUs', settings.aboutUsContent || '');
  const brand = settings.themeBrandColor || '#232f3e', accent = settings.themeAccentColor || '#ffd814';
  sv('settingsBrandColor', brand); st('brandColorValue', brand.toUpperCase());
  sv('settingsAccentColor', accent); st('accentColorValue', accent.toUpperCase());
  const ov = parseInt(settings.themeBgOverlay) || 0;
  sv('settingsBgOverlay', ov); st('bgOverlayValue', ov + '%');
  const pv = document.getElementById('themeUploadPreview'), ph = document.getElementById('themeUploadPlaceholder'), rm = document.getElementById('themeRemoveImage');
  if (pv && ph && rm) { if (settings.themeBgImageUrl) { pv.src = settings.themeBgImageUrl; pv.style.display = 'block'; ph.style.display = 'none'; rm.style.display = 'inline-block'; } else { pv.src = ''; pv.style.display = 'none'; ph.style.display = 'block'; rm.style.display = 'none'; } }
  api('getPaymentMethods').then(function (m) {
    paymentMethodList = Array.isArray(m) ? m.map(function (x) { return { id: x.id || ('pm_' + Math.random().toString(36).slice(2, 9)), name: x.name || '', number: x.number || '', qrUrl: x.qrUrl || '' }; }) : [];
    renderPaymentMethodsList();
  }).catch(function () {});
  api('getStaticContent').then(function (c) {
    sv('settingsAboutUs', c.aboutUs || ''); sv('settingsContactUs', c.contactUs || ''); sv('settingsContactUsUrl', c.contactUsUrl || '');
    const radios = document.getElementsByName('contactUsMode'), mode = c.contactUsMode || 'plain';
    for (let i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === mode);
    onContactUsModeChange();
    faqItems = Array.isArray(c.faqItems) ? c.faqItems.slice() : [];
    renderFaqItemsList();
  }).catch(function () {});
}
function onContactUsModeChange() {
  const radios = document.getElementsByName('contactUsMode'); let mode = 'plain';
  for (let i = 0; i < radios.length; i++) if (radios[i].checked) mode = radios[i].value;
  const lf = document.getElementById('contactUsLinkFields'); if (lf) lf.style.display = (mode === 'link') ? 'block' : 'none';
}
function saveSettingsForm(e) {
  e.preventDefault();
  const ns = {
    storeName: document.getElementById('settingsStoreName').value,
    storeTagline: document.getElementById('settingsTagline').value,
    announcement: document.getElementById('settingsAnnouncement').value,
    currency: document.getElementById('settingsCurrency').value || DEFAULT_CURRENCY,
    supportEmail: document.getElementById('settingsSupportEmail').value,
    adminPassword: document.getElementById('settingsAdminPassword').value,
    themeBrandColor: document.getElementById('settingsBrandColor').value,
    themeAccentColor: document.getElementById('settingsAccentColor').value,
    themeBgOverlay: document.getElementById('settingsBgOverlay').value,
    themeBgImageUrl: settings.themeBgImageUrl || ''
  };
  const radios = document.getElementsByName('contactUsMode'); let mode = 'plain';
  for (let i = 0; i < radios.length; i++) if (radios[i].checked) mode = radios[i].value;
  const sc = { aboutUs: document.getElementById('settingsAboutUs').value, contactUsMode: mode, contactUs: document.getElementById('settingsContactUs').value, contactUsUrl: document.getElementById('settingsContactUsUrl').value, faqItems: faqItems.slice() };
  showLoading('Saving...');
  adminApi('saveSettings', { settings: ns }).then(function (r1) {
    if (!r1 || !r1.success) { hideLoading(); showToast('Save failed', 'error'); return; }
    adminApi('saveStaticContent', { content: sc }).then(function (r2) {
      if (!r2 || !r2.success) { hideLoading(); showToast('FAQ save failed', 'error'); return; }
      adminApi('savePaymentMethods', { methods: paymentMethodList }).then(function (r3) {
        hideLoading();
        if (r3 && r3.success) { settings = Object.assign({}, settings, ns); applyTheme(); loadHomepageTabs(); showToast('Settings saved'); }
        else showToast('Payment methods save failed', 'error');
      }).catch(function () { hideLoading(); });
    }).catch(function () { hideLoading(); });
  }).catch(function () { hideLoading(); });
}
function switchAdminTab(t) {
  document.querySelectorAll('.admin-tab').forEach(function (x) { x.classList.remove('active'); });
  document.querySelectorAll('.admin-tab-content').forEach(function (c) { c.classList.remove('active'); });
  const b = document.querySelector('.admin-tab[data-tab="' + t + '"]'); if (b) b.classList.add('active');
  const p = document.getElementById('tab-' + t); if (p) p.classList.add('active');
  if (t === 'sales') loadSalesAnalytics();
}

/* ============ PAYMENT METHODS EDITOR ============ */
function renderPaymentMethodsList() {
  const h = document.getElementById('paymentMethodsList'); if (!h) return;
  if (paymentMethodList.length === 0) { h.innerHTML = '<p style="color:var(--amz-text-2);font-size:0.85rem;margin-bottom:10px;">No payment methods.</p>'; return; }
  h.innerHTML = paymentMethodList.map(function (m, i) {
    const hq = !!m.qrUrl;
    return '<div class="payment-method-card"><div class="payment-method-header"><input type="text" placeholder="Name (e.g. GCash)" value="' + esc(m.name || '') + '" oninput="updatePaymentMethod(' + i + ',\'name\',this.value)"><button type="button" class="btn-icon" onclick="removePaymentMethod(' + i + ')" style="color:var(--amz-red);">Remove</button></div><div class="payment-method-body"><div><label style="display:block;font-size:0.8rem;font-weight:600;margin-bottom:4px;">Account number / handle</label><input type="text" placeholder="0917-123-4567" value="' + esc(m.number || '') + '" oninput="updatePaymentMethod(' + i + ',\'number\',this.value)" style="width:100%;padding:9px 12px;border:1px solid var(--amz-border);border-radius:4px;"></div><div><label style="display:block;font-size:0.8rem;font-weight:600;margin-bottom:4px;">QR Code</label><div class="upload-zone variant-upload" id="pmQrZone_' + i + '" ondragover="event.preventDefault();this.classList.add(\'dragover\')" ondragleave="this.classList.remove(\'dragover\')" ondrop="handlePaymentQrDrop(event,' + i + ')" onclick="if(event.target.tagName!==\'BUTTON\')document.getElementById(\'pmQrFile_' + i + '\').click()"><input type="file" id="pmQrFile_' + i + '" accept="image/*" style="display:none" onchange="handlePaymentQrFile(event,' + i + ')">' + (hq ? '<img src="' + m.qrUrl + '" style="max-height:120px;"><button type="button" class="upload-remove-btn" onclick="removePaymentQr(event,' + i + ')">Remove</button>' : '<div class="upload-text" style="font-size:0.78rem;"><strong>Click or drop</strong> QR<br><small>Optional</small></div>') + '</div></div></div></div>';
  }).join('');
}
function addPaymentMethod() { paymentMethodList.push({ id: 'pm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name: '', number: '', qrUrl: '' }); renderPaymentMethodsList(); }
function removePaymentMethod(i) { paymentMethodList.splice(i, 1); renderPaymentMethodsList(); }
function updatePaymentMethod(i, f, v) { if (paymentMethodList[i]) paymentMethodList[i][f] = v; }
function handlePaymentQrDrop(e, i) { e.preventDefault(); const z = document.getElementById('pmQrZone_' + i); if (z) z.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) uploadPaymentQrFile(i, f); }
function handlePaymentQrFile(e, i) { const f = e.target.files[0]; if (f) uploadPaymentQrFile(i, f); }
function uploadPaymentQrFile(i, file) {
  if (!file.type || file.type.indexOf('image/') !== 0) { showToast('Please upload an image', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { showToast('Max 5 MB', 'error'); return; }
  const r = new FileReader();
  r.onload = function (e) {
    const b = e.target.result.split(',')[1];
    showToast('Uploading...');
    api('uploadImage', { base64Data: b, fileName: file.name, mimeType: file.type }).then(function (res) {
      if (res && res.success) { paymentMethodList[i].qrUrl = res.url; renderPaymentMethodsList(); showToast('QR uploaded — save to keep'); }
      else showToast('Failed', 'error');
    }).catch(function () {});
  };
  r.readAsDataURL(file);
}
function removePaymentQr(e, i) { if (e) e.stopPropagation(); paymentMethodList[i].qrUrl = ''; renderPaymentMethodsList(); }

/* ============ FAQ EDITOR ============ */
function renderFaqItemsList() {
  const h = document.getElementById('faqItemsList'); if (!h) return;
  if (faqItems.length === 0) { h.innerHTML = '<p style="color:var(--amz-text-2);font-size:0.85rem;margin-bottom:10px;">No FAQ yet.</p>'; return; }
  h.innerHTML = faqItems.map(function (f, i) { return '<div class="faq-edit-row"><div class="faq-edit-header"><strong>FAQ #' + (i + 1) + '</strong><button type="button" class="btn-icon" style="color:var(--amz-red);" onclick="removeFaqItem(' + i + ')">Remove</button></div><input type="text" placeholder="Question" value="' + esc(f.q || '') + '" oninput="updateFaqItem(' + i + ',\'q\',this.value)"><textarea placeholder="Answer" oninput="updateFaqItem(' + i + ',\'a\',this.value)">' + esc(f.a || '') + '</textarea></div>'; }).join('');
}
function addFaqItem() { faqItems.push({ q: '', a: '' }); renderFaqItemsList(); }
function removeFaqItem(i) { faqItems.splice(i, 1); renderFaqItemsList(); }
function updateFaqItem(i, f, v) { if (faqItems[i]) faqItems[i][f] = v; }

/* ============ IMAGE UPLOAD ============ */
function uploadImageFile(file, onOk, onErr) {
  if (!file) { if (onErr) onErr(); return; }
  if (!file.type || file.type.indexOf('image/') !== 0) { showToast('Please upload an image', 'error'); if (onErr) onErr(); return; }
  if (file.size > 5 * 1024 * 1024) { showToast('Max 5 MB', 'error'); if (onErr) onErr(); return; }
  const r = new FileReader();
  r.onload = function (e) {
    const b = e.target.result.split(',')[1];
    api('uploadImage', { base64Data: b, fileName: file.name, mimeType: file.type }).then(function (res) {
      if (res && res.success) onOk(res.url);
      else { showToast('Upload failed: ' + ((res && res.message) || 'unknown'), 'error'); if (onErr) onErr(); }
    }).catch(function () { if (onErr) onErr(); });
  };
  r.readAsDataURL(file);
}
function handleProductDrop(e) { e.preventDefault(); const z = document.getElementById('productUploadZone'); if (z) z.classList.remove('dragover'); const f = e.dataTransfer.files; if (f && f.length) uploadMultipleProductImages(f); }
function handleProductFiles(e) { const f = e.target.files; if (f && f.length) uploadMultipleProductImages(f); e.target.value = ''; }
function uploadMultipleProductImages(files) {
  const arr = Array.prototype.slice.call(files); if (arr.length === 0) return;
  const rem = MAX_PRODUCT_IMAGES - productImageList.length;
  if (rem <= 0) { showToast('Max ' + MAX_PRODUCT_IMAGES, 'warning'); return; }
  const tu = arr.slice(0, rem); if (arr.length > rem) showToast('Only adding ' + rem, 'warning');
  showToast('Uploading ' + tu.length + '...');
  let c = 0, f = 0;
  const done = function () { if (c + f === tu.length) showToast('Uploaded ' + c + (f ? ' (' + f + ' failed)' : ''), f ? 'warning' : 'success'); };
  tu.forEach(function (file) { uploadImageFile(file, function (u) { productImageList.push(u); c++; renderProductImageThumbs(); done(); }, function () { f++; done(); }); });
}
function handleThemeDrop(e) { e.preventDefault(); const z = document.getElementById('themeUploadZone'); if (z) z.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) uploadThemeImage(f); }
function handleThemeFile(e) { const f = e.target.files[0]; if (f) uploadThemeImage(f); }
function uploadThemeImage(file) {
  const ph = document.getElementById('themeUploadPlaceholder'); if (ph) ph.innerHTML = '<div class="upload-progress">Uploading...</div>';
  uploadImageFile(file, function (u) {
    settings.themeBgImageUrl = u; const pv = document.getElementById('themeUploadPreview');
    if (pv) { pv.src = u; pv.style.display = 'block'; } if (ph) ph.style.display = 'none';
    const rm = document.getElementById('themeRemoveImage'); if (rm) rm.style.display = 'inline-block';
    applyTheme();
  });
}
function removeThemeImage(e) {
  if (e) e.stopPropagation(); settings.themeBgImageUrl = '';
  const pv = document.getElementById('themeUploadPreview'); if (pv) { pv.src = ''; pv.style.display = 'none'; }
  const rm = document.getElementById('themeRemoveImage'); if (rm) rm.style.display = 'none';
  const ph = document.getElementById('themeUploadPlaceholder');
  if (ph) { ph.style.display = 'block'; ph.innerHTML = '<div class="upload-icon">&#128444;</div><div class="upload-text"><strong>Click to browse</strong> or drag &amp; drop an image here<br><small>1920&times;1080 &middot; Max 5 MB</small></div>'; }
  applyTheme();
}