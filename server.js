const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3091;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const SAVED_SEARCHES = path.join(DATA_DIR, 'saved-searches.json');
const SEEN_LISTINGS = path.join(DATA_DIR, 'seen-listings.json');
const CONFIG = path.join(ROOT, 'config.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SAVED_SEARCHES)) fs.writeFileSync(SAVED_SEARCHES, JSON.stringify({ searches: [] }, null, 2));
if (!fs.existsSync(SEEN_LISTINGS)) fs.writeFileSync(SEEN_LISTINGS, JSON.stringify({ listings: {} }, null, 2));

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function sendJson(res, status, data) { send(res, status, JSON.stringify(data, null, 2), 'application/json; charset=utf-8'); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function readSaved() { return readJson(SAVED_SEARCHES, { searches: [] }); }
function writeSaved(data) { writeJson(SAVED_SEARCHES, data); }
function readSeen() { return readJson(SEEN_LISTINGS, { listings: {} }); }
function writeSeen(data) { writeJson(SEEN_LISTINGS, data); }

function buildSearchUrl(params) {
  const url = new URL('https://classifieds.ksl.com/v2/search');
  if (params.keyword) url.searchParams.set('keyword', params.keyword);
  if (params.category) url.searchParams.set('category[]', params.category);
  if (params.subcategory) url.searchParams.set('subCategory[]', params.subcategory);
  if (params.maxPrice) url.searchParams.set('priceTo', params.maxPrice);
  if (params.minPrice) url.searchParams.set('priceFrom', params.minPrice);
  if (params.sort) url.searchParams.set('sort', params.sort);
  if (params.location) url.searchParams.set('location', params.location);
  if (params.perPage) url.searchParams.set('size', params.perPage);
  return url.toString();
}

function parsePrice(text = '') {
  const match = text.replace(/,/g, '').match(/\$?([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : null;
}

function dealScore(item, params) {
  let score = 0;
  const title = (item.title || '').toLowerCase();
  const signals = ['must sell', 'obo', 'urgent', 'moving', 'today', 'reduced', 'firm', 'clean title'];
  if (params.maxPrice && item.price && item.price <= Number(params.maxPrice)) score += 20;
  if (item.price && item.price < 500) score += 10;
  for (const signal of signals) if (title.includes(signal)) score += 6;
  if (params.keyword && title.includes(String(params.keyword).toLowerCase())) score += 10;
  if (item.location) score += 2;
  return score;
}

function allowedByConfig(item, params, config) {
  const title = (item.title || '').toLowerCase();
  const blocked = (config.blockedTitleTerms || []).some((term) => title.includes(String(term).toLowerCase()));
  if (blocked) return false;
  if (config.maxPriceHardCap && item.price && item.price > Number(config.maxPriceHardCap)) return false;
  if (config.requiredKeywordStrongMatch && params.keyword) {
    const keyword = String(params.keyword).toLowerCase().trim();
    if (keyword && !title.includes(keyword)) return false;
  }
  return true;
}

function parseListings(html, params, config) {
  const matches = [...html.matchAll(/<a class="group[\s\S]*?aria-label="([^"]+)" href="(https:\/\/classifieds\.ksl\.com\/listing\/[0-9]+)"[\s\S]*?<span class="text-ksl-blue-500[^>]*>([^<]+)(?:<!-- -->, <!-- -->([^<]+))?<\/span>[\s\S]*?aria-label="Price">([^<]+)<\/div>/g)];
  const listings = matches.map((m) => {
    const title = m[1].trim();
    const url = m[2].trim();
    const city = (m[3] || '').trim();
    const state = (m[4] || '').trim();
    const priceText = (m[5] || '').trim();
    const price = parsePrice(priceText);
    return { title, url, location: [city, state].filter(Boolean).join(', '), priceText, price, score: 0 };
  });
  const deduped = [];
  const seen = new Set();
  for (const item of listings) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    item.score = dealScore(item, params);
    if (allowedByConfig(item, params, config)) deduped.push(item);
  }
  deduped.sort((a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity));
  return deduped;
}

async function fetchListings(params) {
  const config = readJson(CONFIG, { blockedTitleTerms: [] });
  const url = buildSearchUrl(params);
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 DariusKSLFinder/1.0' } });
  const html = await response.text();
  const listings = parseListings(html, params, config);
  const seen = readSeen();
  const key = JSON.stringify(params);
  const previous = new Set(seen.listings[key] || []);
  const newListings = listings.filter((item) => !previous.has(item.url));
  seen.listings[key] = listings.map((item) => item.url);
  writeSeen(seen);
  return { url, count: listings.length, newCount: newListings.length, listings, newListings };
}

/* ── KSL Cars helpers ───────────────────────────────────────── */

function buildCarsUrl(params) {
  // cars.ksl.com uses path-segment style: /search/key/value/key/value
  const segments = [];
  const map = {
    keyword: 'keyword', make: 'make', model: 'model',
    yearFrom: 'yearFrom', yearTo: 'yearTo',
    priceFrom: 'priceFrom', priceTo: 'priceTo',
    mileageFrom: 'mileageFrom', mileageTo: 'mileageTo',
    body: 'body', transmission: 'transmission', drive: 'drive',
    fuel: 'fuel', newUsed: 'newUsed', sellerType: 'sellerType',
    titleType: 'titleType', color: 'color',
    numberDoors: 'numberDoors', cylinders: 'cylinders',
    zip: 'zip', miles: 'miles', sort: 'sort', perPage: 'perPage',
    trim: 'trim',
  };
  for (const [param, slug] of Object.entries(map)) {
    if (params[param]) segments.push(`${slug}/${encodeURIComponent(params[param])}`);
  }
  return `https://cars.ksl.com/search/${segments.join('/')}`;
}

function carDealScore(item, params) {
  let score = 0;
  const title = (item.title || '').toLowerCase();
  const signals = ['must sell', 'obo', 'urgent', 'moving', 'today', 'reduced', 'firm', 'clean title', 'one owner', 'low miles'];
  if (params.priceTo && item.price && item.price <= Number(params.priceTo)) score += 20;
  if (item.price && item.price < 5000) score += 10;
  for (const signal of signals) if (title.includes(signal)) score += 6;
  if (params.make && title.includes(String(params.make).toLowerCase())) score += 5;
  if (params.model && title.includes(String(params.model).toLowerCase())) score += 5;
  if (params.keyword && title.includes(String(params.keyword).toLowerCase())) score += 10;
  if (item.location) score += 2;
  return score;
}

function parseCarListings(html, params, config) {
  // car listings follow same aria-label / href pattern but link to cars.ksl.com
  const matches = [...html.matchAll(/<a class="group[\s\S]*?aria-label="([^"]+)"\s+href="(https:\/\/cars\.ksl\.com\/listing\/[0-9]+)"[\s\S]*?aria-label="Price">([^<]+)</g)];
  const listings = matches.map((m) => {
    const title = m[1].trim();
    const url = m[2].trim();
    const priceText = (m[3] || '').trim();
    const price = parsePrice(priceText);
    // try to extract location from nearby markup
    return { title, url, location: '', priceText, price, score: 0 };
  });
  // second pass: pull locations from the city/state spans that follow each listing card
  const locMatches = [...html.matchAll(/href="https:\/\/cars\.ksl\.com\/listing\/([0-9]+)"[\s\S]*?tabindex="0">([^<]*?)(?:<!-- -->, <!-- -->([^<]*?))?<\/span>/g)];
  const locMap = {};
  for (const lm of locMatches) {
    const id = lm[1];
    const city = (lm[2] || '').trim();
    const state = (lm[3] || '').trim();
    locMap[id] = [city, state].filter(Boolean).join(', ');
  }
  for (const item of listings) {
    const id = item.url.split('/').pop();
    if (locMap[id]) item.location = locMap[id];
  }

  const deduped = [];
  const seen = new Set();
  for (const item of listings) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    item.score = carDealScore(item, params);
    if (allowedByConfig(item, params, config)) deduped.push(item);
  }
  deduped.sort((a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity));
  return deduped;
}

async function fetchCarListings(params) {
  const config = readJson(CONFIG, { blockedTitleTerms: [] });
  const url = buildCarsUrl(params);
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  const html = await response.text();
  const listings = parseCarListings(html, params, config);
  const seen = readSeen();
  const key = 'cars:' + JSON.stringify(params);
  const previous = new Set(seen.listings[key] || []);
  const newListings = listings.filter((item) => !previous.has(item.url));
  seen.listings[key] = listings.map((item) => item.url);
  writeSeen(seen);
  return { url, count: listings.length, newCount: newListings.length, listings, newListings };
}

function serveStatic(res, pathname) {
  const target = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT, target);
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.readFile(filePath, (err, content) => {
    if (err) return send(res, 404, 'Not found');
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
    send(res, 200, content, types[ext] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  if (url.pathname === '/api/search' && req.method === 'GET') {
    try {
      const params = Object.fromEntries(url.searchParams.entries());
      const result = await fetchListings(params);
      return sendJson(res, 200, { ok: true, params, ...result });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error.message });
    }
  }

  if (url.pathname === '/api/cars-search' && req.method === 'GET') {
    try {
      const params = Object.fromEntries(url.searchParams.entries());
      const result = await fetchCarListings(params);
      return sendJson(res, 200, { ok: true, params, ...result });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error.message });
    }
  }
  if (url.pathname === '/api/saved-searches' && req.method === 'GET') return sendJson(res, 200, { ok: true, ...readSaved() });
  if (url.pathname === '/api/saved-searches' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const saved = readSaved();
        const entry = { id: `search-${Date.now()}`, type: payload.type || 'classifieds', name: payload.name || 'Untitled search', params: payload.params || {}, createdAt: new Date().toISOString() };
        saved.searches.push(entry);
        writeSaved(saved);
        return sendJson(res, 200, { ok: true, entry, searches: saved.searches });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (url.pathname === '/api/saved-searches' && req.method === 'DELETE') {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const saved = readSaved();
        saved.searches = saved.searches.filter((item) => item.id !== payload.id);
        writeSaved(saved);
        return sendJson(res, 200, { ok: true, searches: saved.searches });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  serveStatic(res, url.pathname);
});

server.listen(PORT, () => console.log(`KSL Finder running at http://localhost:${PORT}`));
