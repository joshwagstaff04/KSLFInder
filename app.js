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
  const searches = data.searches || [];
  savedCount.textContent = String(searches.length);
  if (!searches.length) {
    savedSearches.innerHTML = '<div class="empty">No saved searches yet.</div>';
    return;
  }
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

form.addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
$('saveSearchButton').addEventListener('click', async () => {
  const params = paramsFromForm();
  const name = prompt('Name this search:');
  if (!name) return;
  const res = await fetch('/api/saved-searches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, params }) });
  const data = await res.json();
  if (!data.ok) return (statusText.textContent = 'Save failed');
  statusText.textContent = 'Search saved';
  loadSavedSearches();
});
autoRefresh.addEventListener('change', updateAutoRefresh);
refreshSeconds.addEventListener('change', updateAutoRefresh);
alertsOnly.addEventListener('change', () => latestData && renderResults(latestData));
loadSavedSearches();
