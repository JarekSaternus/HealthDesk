// One-shot audit: scheduler vs files vs hero images
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const STUDIO = path.join(__dirname, '..', 'studio.json');
const BLOG_DIR = path.join(ROOT, 'src', 'content', 'blog');
const IMG_DIR = path.join(ROOT, 'src', 'content', 'images', 'blog');

const studio = JSON.parse(fs.readFileSync(STUDIO, 'utf8'));
const cal = studio.content_calendar || {};
const clusters = cal.clusters || [];

// 1) Aggregate scheduler state
const byLang = {};
for (const c of clusters) {
  for (const [lang, kws] of Object.entries(c.keywords || {})) {
    byLang[lang] ||= { total: 0, status: {}, published: [], scheduled: [], draft: [], otherStatuses: [] };
    for (const k of kws) {
      byLang[lang].total++;
      byLang[lang].status[k.status] = (byLang[lang].status[k.status] || 0) + 1;
      if (k.status === 'published') byLang[lang].published.push({ slug: k.slug, keyword: k.keyword, date: k.published_date });
      else if (k.status === 'scheduled') byLang[lang].scheduled.push({ keyword: k.keyword, date: k.scheduled_date });
      else if (k.status === 'draft') byLang[lang].draft.push({ keyword: k.keyword });
      else byLang[lang].otherStatuses.push({ keyword: k.keyword, status: k.status });
    }
  }
}

// 2) Filesystem: actual posts per locale
const fsByLang = {};
for (const lang of fs.readdirSync(BLOG_DIR)) {
  const dir = path.join(BLOG_DIR, lang);
  if (!fs.statSync(dir).isDirectory()) continue;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  fsByLang[lang] = files.map(f => f.replace(/\.md$/, ''));
}

// 3) Hero images on disk
const imageFiles = new Set(fs.readdirSync(IMG_DIR));

// 4) Parse heroImage from each markdown
function readHero(lang, slug) {
  try {
    const md = fs.readFileSync(path.join(BLOG_DIR, lang, slug + '.md'), 'utf8');
    const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const m = fmMatch[1].match(/^heroImage:\s*"?([^"\n]+)"?/m);
    return m ? m[1].replace(/^["']|["']$/g, '').trim() : null;
  } catch { return null; }
}

// 5) Cross-reference
console.log('='.repeat(70));
console.log('AUDYT KALENDARZA BLOGA — ' + new Date().toISOString().slice(0, 10));
console.log('='.repeat(70));
console.log(`Klastry: ${clusters.length}`);
console.log(`Interval: co ${cal.interval_days} dni | next_run: ${cal.next_run} | auto: ${cal.auto_enabled}`);
console.log(`Łącznie keywordów: ${Object.values(byLang).reduce((s,l)=>s+l.total,0)}`);
console.log();

// 6) Per-locale comparison
const langs = [...new Set([...Object.keys(byLang), ...Object.keys(fsByLang)])].sort();
console.log('STATUS WG SCHEDULER vs DYSK:');
console.log('lang | total | published | scheduled | draft | other | files | heroOK | heroMissing | orphans');
console.log('-'.repeat(100));

const issues = { heroMissing: [], orphanFiles: [], missingFiles: [], duplicateSlugs: [] };

for (const lang of langs) {
  const sched = byLang[lang] || { total:0, status:{}, published:[], scheduled:[], draft:[], otherStatuses:[] };
  const files = fsByLang[lang] || [];
  const fileSet = new Set(files);
  const publishedSlugs = sched.published.filter(p => p.slug).map(p => p.slug);
  const publishedSet = new Set(publishedSlugs);

  // Hero check for each file on disk
  let heroOK = 0, heroMissing = 0;
  for (const slug of files) {
    const hero = readHero(lang, slug);
    if (!hero) {
      heroMissing++;
      issues.heroMissing.push(`${lang}/${slug} — brak heroImage w frontmatter`);
    } else if (!imageFiles.has(hero)) {
      heroMissing++;
      issues.heroMissing.push(`${lang}/${slug} — heroImage="${hero}" ale brak pliku w images/blog/`);
    } else {
      heroOK++;
    }
  }

  // Orphan files = on disk but not in scheduler "published"
  const orphans = files.filter(f => !publishedSet.has(f));
  for (const o of orphans) issues.orphanFiles.push(`${lang}/${o}`);

  // Missing files = scheduler says published but file absent
  const missing = publishedSlugs.filter(s => !fileSet.has(s));
  for (const m of missing) issues.missingFiles.push(`${lang}/${m}`);

  console.log(
    `${lang.padEnd(5)} | ${String(sched.total).padStart(5)} | ${String(sched.status.published||0).padStart(9)} | ${String(sched.status.scheduled||0).padStart(9)} | ${String(sched.status.draft||0).padStart(5)} | ${String(sched.otherStatuses.length).padStart(5)} | ${String(files.length).padStart(5)} | ${String(heroOK).padStart(6)} | ${String(heroMissing).padStart(11)} | ${String(orphans.length).padStart(7)}`
  );
}

console.log();
console.log('NAJBLIŻSZE 10 ZAPLANOWANYCH (wg scheduled_date):');
const upcoming = [];
for (const lang of langs) {
  for (const s of (byLang[lang]?.scheduled || [])) upcoming.push({ lang, ...s });
}
upcoming.sort((a,b) => (a.date || '9999').localeCompare(b.date || '9999'));
for (const u of upcoming.slice(0, 10)) {
  console.log(`  ${u.date} [${u.lang}] ${u.keyword}`);
}

console.log();
console.log('PROBLEMY:');
console.log(`  Brak hero image / wpisu w frontmatter: ${issues.heroMissing.length}`);
issues.heroMissing.slice(0, 20).forEach(s => console.log(`    - ${s}`));
if (issues.heroMissing.length > 20) console.log(`    ... +${issues.heroMissing.length - 20} więcej`);

console.log(`  Pliki na dysku BEZ wpisu "published" w schedulerze (orphans): ${issues.orphanFiles.length}`);
issues.orphanFiles.slice(0, 20).forEach(s => console.log(`    - ${s}`));
if (issues.orphanFiles.length > 20) console.log(`    ... +${issues.orphanFiles.length - 20} więcej`);

console.log(`  Scheduler mówi "published" ale brak pliku: ${issues.missingFiles.length}`);
issues.missingFiles.slice(0, 20).forEach(s => console.log(`    - ${s}`));

// Orphan images = obrazy bez przypisanego postu
const usedImages = new Set();
for (const lang of langs) {
  for (const slug of (fsByLang[lang] || [])) {
    const hero = readHero(lang, slug);
    if (hero) usedImages.add(hero);
  }
}
const orphanImages = [...imageFiles].filter(f => !usedImages.has(f) && f.endsWith('.webp'));
console.log(`  Obrazy w images/blog/ NIEUŻYWANE przez żaden post: ${orphanImages.length}`);
orphanImages.slice(0, 20).forEach(f => console.log(`    - ${f}`));
if (orphanImages.length > 20) console.log(`    ... +${orphanImages.length - 20} więcej`);

// Aggregate global
const totalPublished = langs.reduce((s,l) => s + (byLang[l]?.status.published || 0), 0);
const totalFiles = langs.reduce((s,l) => s + (fsByLang[l]?.length || 0), 0);
const totalScheduled = langs.reduce((s,l) => s + (byLang[l]?.status.scheduled || 0), 0);
const totalDraft = langs.reduce((s,l) => s + (byLang[l]?.status.draft || 0), 0);
const totalOther = langs.reduce((s,l) => s + (byLang[l]?.otherStatuses.length || 0), 0);

console.log();
console.log('SUMA:');
console.log(`  Posty na dysku:            ${totalFiles}`);
console.log(`  Status "published":        ${totalPublished}`);
console.log(`  Status "scheduled":        ${totalScheduled}`);
console.log(`  Status "draft":            ${totalDraft}`);
console.log(`  Inne statusy:              ${totalOther}`);
console.log(`  Obrazy .webp:              ${[...imageFiles].filter(f=>f.endsWith('.webp')).length}`);
console.log(`  Obrazy używane:            ${usedImages.size}`);
