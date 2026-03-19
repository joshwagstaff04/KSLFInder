const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const SAVED_SEARCHES = path.join(DATA_DIR, 'saved-searches.json');
const SEEN_LISTINGS = path.join(DATA_DIR, 'seen-listings.json');
const CONFIG = path.join(ROOT, 'config.json');
const WATCH_STATE = path.join(DATA_DIR, 'watch-state.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

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
  const seen = new Set();
  return listings.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    item.score = dealScore(item, params);
    return allowedByConfig(item, params, config);
  }).sort((a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity));
}

async function fetchListings(params, config) {
  const url = buildSearchUrl(params);
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 DariusKSLWatcher/1.0' } });
  const html = await response.text();
  return { url, listings: parseListings(html, params, config) };
}

function sendTelegram(message, target) {
  return new Promise((resolve) => {
    execFile('openclaw', ['message', 'send', '--channel', 'telegram', '--target', target, '--message', message], { timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return resolve({ ok: false, error: error.message, stderr, stdout });
      resolve({ ok: true, stdout });
    });
  });
}

async function runCycle() {
  const config = readJson(CONFIG, { pollIntervalSeconds: 180, minAlertScore: 20, maxAlertsPerCycle: 3, telegramTarget: '5955220663', blockedTitleTerms: [] });
  const saved = readJson(SAVED_SEARCHES, { searches: [] });
  const seen = readJson(SEEN_LISTINGS, { listings: {} });
  const state = readJson(WATCH_STATE, { cycles: 0, lastRunAt: null, lastAlerts: [] });

  for (const search of saved.searches) {
    try {
      const result = await fetchListings(search.params || {}, config);
      const key = JSON.stringify(search.params || {});
      const prior = new Set(seen.listings[key] || []);
      const fresh = result.listings.filter((item) => !prior.has(item.url));
      seen.listings[key] = result.listings.map((item) => item.url);
      const alerts = fresh.filter((item) => item.score >= config.minAlertScore).slice(0, config.maxAlertsPerCycle);

      for (const item of alerts) {
        const msg = [
          `🔥 New KSL deal match: ${search.name}`,
          `${item.title}`,
          `${item.priceText || 'No price'} · ${item.location || 'Unknown location'}`,
          `Score: ${item.score}`,
          item.url
        ].join('\n');
        await sendTelegram(msg, String(config.telegramTarget));
        state.lastAlerts.push({ at: new Date().toISOString(), search: search.name, url: item.url, title: item.title, score: item.score });
      }
    } catch (error) {
      console.error('watch cycle error', search.name, error.message);
    }
  }

  writeJson(SEEN_LISTINGS, seen);
  state.cycles += 1;
  state.lastRunAt = new Date().toISOString();
  state.lastAlerts = state.lastAlerts.slice(-50);
  writeJson(WATCH_STATE, state);
}

async function main() {
  const config = readJson(CONFIG, { pollIntervalSeconds: 180 });
  console.log(`KSL watcher starting. Interval: ${config.pollIntervalSeconds}s`);
  await runCycle();
  setInterval(runCycle, Math.max(30, Number(config.pollIntervalSeconds || 180)) * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
