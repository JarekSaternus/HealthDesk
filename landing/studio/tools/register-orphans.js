// Rejestruje 13 orphan files (na dysku ale nie w studio.json published)
// w content_calendar:
//   1. Próba match: czyści mojibake w keyword (CP1250 round-trip), szuka
//      pasującego scheduled/writing w studio.json → zmienia na published.
//   2. Bez matcha: dodaje nowy wpis published do pierwszego klastra w danym lang.
//
// Użycie:
//   node tools/register-orphans.js          # DRY RUN
//   node tools/register-orphans.js --apply

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const STUDIO_JSON = path.join(__dirname, '..', 'studio.json');
const BLOG_DIR = path.join(__dirname, '..', '..', 'src', 'content', 'blog');
const APPLY = process.argv.includes('--apply');

const ORPHANS = [
  'de/dehn-zbungen-am-schreibtisch-f-zr-b-zroangestellte',
  'en/improve-posture-while-working-from-home-complete-guide',
  'es/c-omo-mejorar-la-postura-al-sentarse-frente-al-ordenador',
  'es/configuracion-ergonomica-guia-para-una-espalda-sana',
  'fr/pauses-actives-au-travail-guide-complet-pour-le-dos',
  'it/mal-di-schiena-in-ufficio-cause-e-5-esercizi',
  'ko/healthy-work-habits-healthdesk',
  'ko/why-sitting-all-day-hurts-back',
  'pl/cwiczenia-rozciagajace-dla-pracownikow-biurowych',
  'pl/standing-desk-na-bol-plecow-czy-naprawde-pomaga',
  'pt-BR/postura-correta-na-cadeira-7-dicas-praticas',
  'tr/ofis-calisanlari-icin-gunluk-bel-sirt-egzersiz-rutini',
  'zh-CN/office-health-management-stay-fit-work'
];

function readFrontmatter(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1];
  const get = re => (fm.match(re) || [])[1];
  return {
    title: get(/^title:\s*"?([^"\n]+)"?/m),
    keyword: get(/^keyword:\s*"?([^"\n]+)"?/m),
    date: get(/^date:\s*(\d{4}-\d{2}-\d{2})/m)
  };
}

function looksLikeMojibake(s) {
  return typeof s === 'string' && /[ĂĐăĺěĹŃťĽşżš]/.test(s);
}

function recoverMojibake(s) {
  try {
    const bytes = iconv.encode(s, 'win1250');
    return iconv.decode(bytes, 'utf-8');
  } catch { return s; }
}

function normalizeKw(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const data = JSON.parse(fs.readFileSync(STUDIO_JSON, 'utf8'));
const clusters = (data.content_calendar || {}).clusters || [];

const report = [];

for (const orphan of ORPHANS) {
  const [lang, slug] = orphan.split('/');
  const file = path.join(BLOG_DIR, lang, slug + '.md');
  if (!fs.existsSync(file)) {
    report.push({ orphan, action: 'MISSING_FILE' });
    continue;
  }
  const fm = readFrontmatter(file);
  if (!fm) {
    report.push({ orphan, action: 'NO_FRONTMATTER' });
    continue;
  }

  // Recover mojibake in keyword (if needed)
  let cleanKw = fm.keyword;
  if (looksLikeMojibake(cleanKw)) {
    const recovered = recoverMojibake(cleanKw);
    if (!recovered.includes('?') && !recovered.includes('�')) {
      cleanKw = recovered;
    }
  }

  // Search clusters for matching scheduled/writing entry
  let matched = null;
  for (const c of clusters) {
    const kws = (c.keywords || {})[lang] || [];
    for (const k of kws) {
      // Match by raw keyword or recovered keyword
      const candidates = [k.keyword, recoverMojibake(k.keyword)];
      for (const cand of candidates) {
        if (normalizeKw(cand) === normalizeKw(cleanKw)) {
          matched = { cluster: c, kw: k };
          break;
        }
      }
      if (matched) break;
    }
    if (matched) break;
  }

  if (matched) {
    const r = {
      orphan,
      action: 'UPDATE_TO_PUBLISHED',
      cluster: matched.cluster.id || matched.cluster.name,
      prev_status: matched.kw.status,
      prev_slug: matched.kw.slug,
      new_slug: slug,
      published_date: fm.date,
      keyword_before: matched.kw.keyword,
      keyword_after: cleanKw,
      ref: matched.kw
    };
    report.push(r);
    if (APPLY) {
      matched.kw.status = 'published';
      matched.kw.slug = slug;
      matched.kw.published_date = fm.date;
      matched.kw.keyword = cleanKw;
      delete matched.kw.last_error;
    }
  } else {
    // No match — add new entry to first cluster of this lang
    const targetCluster = clusters.find(c => (c.keywords || {})[lang]) || clusters[0];
    const r = {
      orphan,
      action: 'INSERT_NEW_PUBLISHED',
      cluster: targetCluster.id || targetCluster.name,
      slug,
      published_date: fm.date,
      keyword: cleanKw,
      title: fm.title
    };
    report.push(r);
    if (APPLY) {
      const newEntry = {
        keyword: cleanKw,
        intent: 'informational',
        kd: 'low',
        serp_verified: false,
        serp_score: 0,
        status: 'published',
        scheduled_date: fm.date,
        slug,
        published_date: fm.date,
        gsc_position: null,
        gsc_clicks: 0,
        gsc_impressions: 0,
        gsc_last_check: null,
        notes: 'Inserted by audit (orphan file rescue) ' + new Date().toISOString().slice(0, 10)
      };
      targetCluster.keywords = targetCluster.keywords || {};
      targetCluster.keywords[lang] = targetCluster.keywords[lang] || [];
      targetCluster.keywords[lang].push(newEntry);
    }
  }
}

console.log('=== ORPHAN REGISTRATION REPORT ===\n');
const byAction = {};
for (const r of report) byAction[r.action] = (byAction[r.action] || 0) + 1;
console.log('Akcje:', byAction);
console.log();
for (const r of report) {
  console.log(`[${r.action}] ${r.orphan}`);
  if (r.action === 'UPDATE_TO_PUBLISHED') {
    console.log(`  cluster: ${r.cluster} | prev_status: ${r.prev_status} → published`);
    if (r.keyword_before !== r.keyword_after) {
      console.log(`  keyword: "${r.keyword_before}" → "${r.keyword_after}"`);
    }
    console.log(`  slug: ${r.prev_slug || '<null>'} → ${r.new_slug}`);
    console.log(`  published_date: ${r.published_date}`);
  } else if (r.action === 'INSERT_NEW_PUBLISHED') {
    console.log(`  cluster: ${r.cluster}`);
    console.log(`  keyword: "${r.keyword}"`);
    console.log(`  title: "${r.title}"`);
    console.log(`  date: ${r.published_date}`);
  }
}

if (!APPLY) {
  console.log('\n[DRY RUN] Uruchom z --apply żeby zapisać zmiany.');
  process.exit(0);
}

const backupPath = STUDIO_JSON + '.bak.orphans-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
fs.copyFileSync(STUDIO_JSON, backupPath);
console.log(`\nBackup: ${backupPath}`);
fs.writeFileSync(STUDIO_JSON, JSON.stringify(data, null, 2), 'utf8');
console.log('Zapisano.');
