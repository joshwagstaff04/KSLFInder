const $ = (id) => document.getElementById(id);
const form = $('searchForm');
const resultsEl = $('results');
const statusText = $('statusText');
const searchMeta = $('searchMeta');
const sourceLink = $('sourceLink');
const savedSearches = $('savedSearches');
const savedCount = $('savedCount');
const autoRefresh = $('autoRefresh');
const refreshSeconds = $('refreshSeconds');
const alertsOnly = $('alertsOnly');
const alertsBox = $('alertsBox');
let timer = null;
let latestData = null;

/* ── Tab switching ──────────────────────────────────────────── */
document.querySelectorAll('.tab-bar .tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const target = document.getElementById('tab-' + btn.dataset.tab);
    if (target) target.classList.add('active');
  });
});

/* ══════════════════════════════════════════════════════════════
   CLASSIFIEDS (original)
   ══════════════════════════════════════════════════════════════ */

function paramsFromForm() {
  return {
    keyword: $('keyword').value.trim(),
    category: $('category').value.trim(),
    subcategory: $('subcategory').value.trim(),
    minPrice: $('minPrice').value.trim(),
    maxPrice: $('maxPrice').value.trim(),
    location: $('location').value.trim(),
    sort: $('sort').value,
    perPage: $('perPage').value
  };
}
function setForm(params = {}) {
  $('keyword').value = params.keyword || '';
  $('category').value = params.category || '';
  $('subcategory').value = params.subcategory || '';
  $('minPrice').value = params.minPrice || '';
  $('maxPrice').value = params.maxPrice || '';
  $('location').value = params.location || '';
  $('sort').value = params.sort || '0';
  $('perPage').value = params.perPage || 24;
}

function renderAlerts(items = []) {
  if (!items.length) {
    alertsBox.innerHTML = '<div class="empty">No new listings on the latest pull.</div>';
    return;
  }
  alertsBox.innerHTML = items.map(item => `<div class="saved-item"><strong>New: ${item.title}</strong><div>${item.priceText || 'No price'} · ${item.location || 'Unknown location'} · score ${item.score}</div><button onclick="window.open('${item.url}','_blank')">Open listing</button></div>`).join('');
}

function renderResults(data) {
  latestData = data;
  searchMeta.textContent = `${data.count} listings pulled · ${data.newCount} new since last run.`;
  sourceLink.href = data.url;
  sourceLink.textContent = 'Open KSL search';
  renderAlerts(data.newListings || []);
  const items = alertsOnly.checked ? (data.newListings || []) : data.listings;
  if (!items.length) {
    resultsEl.innerHTML = '<div class="empty">No listings matched.</div>';
    return;
  }
  resultsEl.innerHTML = items.map(item => `
    <article class="result-card">
      <div class="result-top">
        <div>
          <a href="${item.url}" target="_blank" rel="noreferrer"><strong>${item.title}</strong></a>
          <div class="location">${item.location || 'Unknown location'}</div>
        </div>
        <div class="score">Deal score: ${item.score}</div>
      </div>
      <div class="price">${item.priceText || 'No price'}</div>
      <div><a href="${item.url}" target="_blank" rel="noreferrer">Open listing</a></div>
    </article>
  `).join('');
}

async function runSearch(params = paramsFromForm(), silent = false) {
  if (!silent) statusText.textContent = 'Searching...';
  const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v !== '')).toString();
  const res = await fetch(`/api/search?${qs}`);
  const data = await res.json();
  if (!data.ok) {
    statusText.textContent = 'Search failed';
    resultsEl.innerHTML = `<div class="empty">${data.error}</div>`;
    return;
  }
  statusText.textContent = data.newCount > 0 ? `Search complete · ${data.newCount} new deal(s)` : 'Search complete';
  renderResults(data);
}

function updateAutoRefresh() {
  if (timer) clearInterval(timer);
  if (!autoRefresh.checked) return;
  const seconds = Math.max(10, Number(refreshSeconds.value || 60));
  timer = setInterval(() => runSearch(paramsFromForm(), true), seconds * 1000);
}

async function loadSavedSearches() {
  const res = await fetch('/api/saved-searches');
  const data = await res.json();
  const allSearches = data.searches || [];
  const searches = allSearches.filter(s => (s.type || 'classifieds') === 'classifieds');
  const carSearches = allSearches.filter(s => s.type === 'cars');
  savedCount.textContent = String(allSearches.length);

  // Classifieds saved searches
  if (!searches.length) {
    savedSearches.innerHTML = '<div class="empty">No saved searches yet.</div>';
  } else {
    savedSearches.innerHTML = searches.map(item => `
      <div class="saved-item">
        <strong>${item.name}</strong>
        <div>${Object.entries(item.params).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(' · ')}</div>
        <div class="actions" style="margin-top:10px;">
          <button data-action="load" data-id="${item.id}">Load search</button>
          <button data-action="delete" data-id="${item.id}">Delete</button>
        </div>
      </div>
    `).join('');
    [...savedSearches.querySelectorAll('button')].forEach(btn => {
      btn.addEventListener('click', async () => {
        const hit = searches.find(s => s.id === btn.dataset.id);
        if (!hit) return;
        if (btn.dataset.action === 'load') {
          setForm(hit.params);
          runSearch(hit.params);
          return;
        }
        if (btn.dataset.action === 'delete') {
          const confirmed = confirm(`Delete saved search: ${hit.name}?`);
          if (!confirmed) return;
          const res = await fetch('/api/saved-searches', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: hit.id })
          });
          const data = await res.json();
          if (!data.ok) {
            statusText.textContent = 'Delete failed';
            return;
          }
          statusText.textContent = 'Saved search deleted';
          loadSavedSearches();
        }
      });
    });
  }

  // Cars saved searches
  renderCarSavedSearches(carSearches);
}

form.addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
$('saveSearchButton').addEventListener('click', async () => {
  const params = paramsFromForm();
  const name = prompt('Name this search:');
  if (!name) return;
  const res = await fetch('/api/saved-searches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, params, type: 'classifieds' }) });
  const data = await res.json();
  if (!data.ok) return (statusText.textContent = 'Save failed');
  statusText.textContent = 'Search saved';
  loadSavedSearches();
});
autoRefresh.addEventListener('change', updateAutoRefresh);
refreshSeconds.addEventListener('change', updateAutoRefresh);
alertsOnly.addEventListener('change', () => latestData && renderResults(latestData));

/* ══════════════════════════════════════════════════════════════
   CARS
   ══════════════════════════════════════════════════════════════ */

const carsForm = $('carsSearchForm');
const carResultsEl = $('carResults');
const carSearchMeta = $('carSearchMeta');
const carSourceLink = $('carSourceLink');
const carSavedSearches = $('carSavedSearches');
const carAutoRefresh = $('carAutoRefresh');
const carRefreshSeconds = $('carRefreshSeconds');
const carAlertsOnly = $('carAlertsOnly');
const carAlertsBox = $('carAlertsBox');
let carTimer = null;
let carLatestData = null;

function carParamsFromForm() {
  return {
    keyword: $('carKeyword').value.trim(),
    make: $('carMake').value.trim(),
    model: $('carModel').value.trim(),
    trim: $('carTrim').value.trim(),
    yearFrom: $('carYearFrom').value.trim(),
    yearTo: $('carYearTo').value.trim(),
    priceFrom: $('carPriceFrom').value.trim(),
    priceTo: $('carPriceTo').value.trim(),
    mileageFrom: $('carMileageFrom').value.trim(),
    mileageTo: $('carMileageTo').value.trim(),
    body: $('carBody').value.trim(),
    transmission: $('carTransmission').value.trim(),
    drive: $('carDrive').value.trim(),
    fuel: $('carFuel').value.trim(),
    newUsed: $('carNewUsed').value.trim(),
    sellerType: $('carSellerType').value.trim(),
    titleType: $('carTitleType').value.trim(),
    color: $('carColor').value.trim(),
    numberDoors: $('carDoors').value.trim(),
    cylinders: $('carCylinders').value.trim(),
    zip: $('carZip').value.trim(),
    miles: $('carMiles').value.trim(),
    sort: $('carSort').value.trim(),
    perPage: $('carPerPage').value.trim(),
  };
}

function setCarForm(params = {}) {
  $('carKeyword').value = params.keyword || '';
  $('carMake').value = params.make || '';
  $('carModel').value = params.model || '';
  $('carTrim').value = params.trim || '';
  $('carYearFrom').value = params.yearFrom || '';
  $('carYearTo').value = params.yearTo || '';
  $('carPriceFrom').value = params.priceFrom || '';
  $('carPriceTo').value = params.priceTo || '';
  $('carMileageFrom').value = params.mileageFrom || '';
  $('carMileageTo').value = params.mileageTo || '';
  $('carBody').value = params.body || '';
  $('carTransmission').value = params.transmission || '';
  $('carDrive').value = params.drive || '';
  $('carFuel').value = params.fuel || '';
  $('carNewUsed').value = params.newUsed || '';
  $('carSellerType').value = params.sellerType || '';
  $('carTitleType').value = params.titleType || '';
  $('carColor').value = params.color || '';
  $('carDoors').value = params.numberDoors || '';
  $('carCylinders').value = params.cylinders || '';
  $('carZip').value = params.zip || '';
  $('carMiles').value = params.miles || '';
  $('carSort').value = params.sort || '';
  $('carPerPage').value = params.perPage || 24;
}

function renderCarAlerts(items = []) {
  if (!items.length) {
    carAlertsBox.innerHTML = '<div class="empty">No new car listings on the latest pull.</div>';
    return;
  }
  carAlertsBox.innerHTML = items.map(item => `<div class="saved-item"><strong>🚗 New: ${item.title}</strong><div>${item.priceText || 'No price'} · ${item.location || 'Unknown location'} · score ${item.score}</div><button onclick="window.open('${item.url}','_blank')">Open listing</button></div>`).join('');
}

function renderCarResults(data) {
  carLatestData = data;
  carSearchMeta.textContent = `${data.count} cars pulled · ${data.newCount} new since last run.`;
  carSourceLink.href = data.url;
  carSourceLink.textContent = 'Open KSL Cars search';
  renderCarAlerts(data.newListings || []);
  const items = carAlertsOnly.checked ? (data.newListings || []) : data.listings;
  if (!items.length) {
    carResultsEl.innerHTML = '<div class="empty">No car listings matched.</div>';
    return;
  }
  carResultsEl.innerHTML = items.map(item => `
    <article class="result-card car-card">
      <div class="result-top">
        <div>
          <a href="${item.url}" target="_blank" rel="noreferrer"><strong>${item.title}</strong></a>
          <div class="location">${item.location || 'Unknown location'}</div>
        </div>
        <div class="score">Deal score: ${item.score}</div>
      </div>
      <div class="price">${item.priceText || 'No price'}</div>
      <div><a href="${item.url}" target="_blank" rel="noreferrer">View on KSL Cars →</a></div>
    </article>
  `).join('');
}

async function runCarSearch(params = carParamsFromForm(), silent = false) {
  if (!silent) statusText.textContent = 'Searching cars...';
  const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v !== '')).toString();
  const res = await fetch(`/api/cars-search?${qs}`);
  const data = await res.json();
  if (!data.ok) {
    statusText.textContent = 'Car search failed';
    carResultsEl.innerHTML = `<div class="empty">${data.error}</div>`;
    return;
  }
  statusText.textContent = data.newCount > 0 ? `Car search complete · ${data.newCount} new listing(s)` : 'Car search complete';
  renderCarResults(data);
}

function updateCarAutoRefresh() {
  if (carTimer) clearInterval(carTimer);
  if (!carAutoRefresh.checked) return;
  const seconds = Math.max(10, Number(carRefreshSeconds.value || 60));
  carTimer = setInterval(() => runCarSearch(carParamsFromForm(), true), seconds * 1000);
}

function renderCarSavedSearches(searches) {
  if (!searches.length) {
    carSavedSearches.innerHTML = '<div class="empty">No saved car searches yet.</div>';
    return;
  }
  carSavedSearches.innerHTML = searches.map(item => `
    <div class="saved-item">
      <strong>🚗 ${item.name}</strong>
      <div>${Object.entries(item.params).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(' · ')}</div>
      <div class="actions" style="margin-top:10px;">
        <button data-action="load" data-id="${item.id}">Load search</button>
        <button data-action="delete" data-id="${item.id}">Delete</button>
      </div>
    </div>
  `).join('');
  [...carSavedSearches.querySelectorAll('button')].forEach(btn => {
    btn.addEventListener('click', async () => {
      const hit = searches.find(s => s.id === btn.dataset.id);
      if (!hit) return;
      if (btn.dataset.action === 'load') {
        setCarForm(hit.params);
        runCarSearch(hit.params);
        return;
      }
      if (btn.dataset.action === 'delete') {
        const confirmed = confirm(`Delete saved car search: ${hit.name}?`);
        if (!confirmed) return;
        const res = await fetch('/api/saved-searches', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: hit.id })
        });
        const data = await res.json();
        if (!data.ok) {
          statusText.textContent = 'Delete failed';
          return;
        }
        statusText.textContent = 'Saved car search deleted';
        loadSavedSearches();
      }
    });
  });
}

carsForm.addEventListener('submit', (e) => { e.preventDefault(); runCarSearch(); });
$('saveCarSearchButton').addEventListener('click', async () => {
  const params = carParamsFromForm();
  const name = prompt('Name this car search:');
  if (!name) return;
  const res = await fetch('/api/saved-searches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, params, type: 'cars' }) });
  const data = await res.json();
  if (!data.ok) return (statusText.textContent = 'Save failed');
  statusText.textContent = 'Car search saved';
  loadSavedSearches();
});
carAutoRefresh.addEventListener('change', updateCarAutoRefresh);
carRefreshSeconds.addEventListener('change', updateCarAutoRefresh);
carAlertsOnly.addEventListener('change', () => carLatestData && renderCarResults(carLatestData));

/* ── Init ───────────────────────────────────────────────────── */
loadSavedSearches();
