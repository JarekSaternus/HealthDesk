#!/usr/bin/env node
/**
 * HealthDesk — Google Search Console Indexing Tool
 *
 * Usage:
 *   node gsc-index.js                  # zgłoś nowe/zmienione URL-e z sitemap.xml
 *   node gsc-index.js --all            # zgłoś WSZYSTKIE URL-e z sitemap.xml
 *   node gsc-index.js --url <url>      # zgłoś konkretny URL
 *   node gsc-index.js --status         # pokaż status indeksowania (wymaga zweryfikowanego właściciela)
 *   node gsc-index.js --status --url <url>  # status konkretnego URL-a
 *
 * Wymaga: landing/gsc-key.json (Service Account key)
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const ROOT = __dirname;
const KEY_PATH = path.join(ROOT, 'gsc-key.json');
const CACHE_PATH = path.join(ROOT, '.gsc-cache.json');
const SITEMAP_PATH = path.join(ROOT, 'dist', 'sitemap.xml');
const SITE_URL = 'https://healthdesk.site';

// ─── Args ───
const args = process.argv.slice(2);
const flagAll = args.includes('--all');
const flagStatus = args.includes('--status');
const flagUrlIdx = args.indexOf('--url');
const flagUrl = flagUrlIdx !== -1 ? args[flagUrlIdx + 1] : null;

// ─── Auth ───
async function getAuth() {
  if (!fs.existsSync(KEY_PATH)) {
    console.error('Brak pliku gsc-key.json! Umieść klucz Service Account w landing/gsc-key.json');
    process.exit(1);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/indexing'],
  });
  return auth;
}

async function getSearchConsoleAuth() {
  if (!fs.existsSync(KEY_PATH)) {
    console.error('Brak pliku gsc-key.json!');
    process.exit(1);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  return auth;
}

// ─── Parse sitemap ───
function getUrlsFromSitemap() {
  if (!fs.existsSync(SITEMAP_PATH)) {
    console.error('Brak dist/sitemap.xml! Uruchom najpierw: node build.js');
    process.exit(1);
  }
  const xml = fs.readFileSync(SITEMAP_PATH, 'utf8');
  const urls = [];
  const regex = /<loc>([^<]+)<\/loc>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

// ─── Cache ───
function loadCache() {
  if (fs.existsSync(CACHE_PATH)) {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  }
  return {};
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

// ─── Notify (zgłoś URL do indeksowania) ───
async function notifyUrl(auth, url) {
  const indexing = google.indexing({ version: 'v3', auth });
  try {
    const res = await indexing.urlNotifications.publish({
      requestBody: {
        url,
        type: 'URL_UPDATED',
      },
    });
    return { url, status: 'ok', notifyTime: res.data.urlNotificationMetadata?.latestUpdate?.notifyTime || new Date().toISOString() };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return { url, status: 'error', error: msg };
  }
}

// ─── Inspect URL (sprawdź status) ───
async function inspectUrl(auth, url) {
  const searchconsole = google.searchconsole({ version: 'v1', auth });
  try {
    const res = await searchconsole.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl: url,
        siteUrl: SITE_URL,
      },
    });
    const result = res.data.inspectionResult;
    return {
      url,
      verdict: result?.indexStatusResult?.verdict || 'UNKNOWN',
      coverageState: result?.indexStatusResult?.coverageState || 'UNKNOWN',
      lastCrawlTime: result?.indexStatusResult?.lastCrawlTime || '-',
      crawledAs: result?.indexStatusResult?.crawledAs || '-',
      robotsTxtState: result?.indexStatusResult?.robotsTxtState || '-',
      pageFetchState: result?.indexStatusResult?.pageFetchState || '-',
    };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return { url, verdict: 'ERROR', error: msg };
  }
}

// ─── Main ───
async function main() {
  // Status mode
  if (flagStatus) {
    console.log('Sprawdzanie statusu indeksowania...\n');
    const auth = await getSearchConsoleAuth();
    const urls = flagUrl ? [flagUrl] : getUrlsFromSitemap();

    for (const url of urls) {
      const result = await inspectUrl(auth, url);
      const icon = result.verdict === 'PASS' ? '✅' :
                   result.verdict === 'NEUTRAL' ? '⚠️' :
                   result.verdict === 'ERROR' ? '❌' : '❓';
      console.log(`${icon} ${result.url}`);
      if (result.error) {
        console.log(`   Błąd: ${result.error}`);
      } else {
        console.log(`   Status: ${result.coverageState}`);
        console.log(`   Ostatni crawl: ${result.lastCrawlTime}`);
        console.log(`   Crawled as: ${result.crawledAs}`);
        console.log(`   robots.txt: ${result.robotsTxtState}`);
      }
      console.log();

      // Rate limit — 1 req/s
      if (urls.length > 1) await sleep(1000);
    }
    return;
  }

  // Notify mode
  const auth = await getAuth();
  let urls;

  if (flagUrl) {
    urls = [flagUrl];
  } else {
    const allUrls = getUrlsFromSitemap();
    if (flagAll) {
      urls = allUrls;
    } else {
      // Tylko nowe/zmienione — porównaj z cache
      const cache = loadCache();
      const sitemapXml = fs.readFileSync(SITEMAP_PATH, 'utf8');

      // Wyciągnij lastmod per URL
      const urlLastmod = {};
      const urlBlocks = sitemapXml.split('<url>').slice(1);
      for (const block of urlBlocks) {
        const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
        const modMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/);
        if (locMatch) {
          urlLastmod[locMatch[1]] = modMatch ? modMatch[1] : null;
        }
      }

      urls = allUrls.filter(url => {
        const cached = cache[url];
        if (!cached) return true; // nowy URL
        const lastmod = urlLastmod[url];
        if (lastmod && cached.lastmod !== lastmod) return true; // zmieniony
        return false;
      });

      if (urls.length === 0) {
        console.log('Wszystkie URL-e są już zgłoszone i aktualne. Użyj --all żeby wymusić.');
        return;
      }
    }
  }

  // Parsuj lastmod z sitemap raz
  const sitemapXml = fs.readFileSync(SITEMAP_PATH, 'utf8');
  const urlLastmodMap = {};
  const sitemapBlocks = sitemapXml.split('<url>').slice(1);
  for (const block of sitemapBlocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
    const modMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/);
    if (locMatch) urlLastmodMap[locMatch[1]] = modMatch ? modMatch[1] : null;
  }

  console.log(`Zgłaszanie ${urls.length} URL-ów do indeksowania...\n`);
  const cache = loadCache();
  let ok = 0, errors = 0;

  for (const url of urls) {
    const result = await notifyUrl(auth, url);
    if (result.status === 'ok') {
      console.log(`✅ ${url}`);
      cache[url] = {
        notifiedAt: new Date().toISOString(),
        lastmod: urlLastmodMap[url] || null,
      };
      ok++;
    } else {
      console.log(`❌ ${url}`);
      console.log(`   ${result.error}`);
      errors++;
    }

    // Rate limit
    if (urls.length > 1) await sleep(500);
  }

  saveCache(cache);
  console.log(`\nGotowe: ${ok} zgłoszonych, ${errors} błędów`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Błąd:', err.message);
  process.exit(1);
});
