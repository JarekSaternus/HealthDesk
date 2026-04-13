#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const fm = require('front-matter');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src', 'content', 'blog');
const IMAGES_DIR = path.join(ROOT, 'src', 'content', 'images', 'blog');
const STUDIO_PATH = path.join(ROOT, 'studio', 'studio.json');
const CUTOFF_DATE = '2026-03-24';
const MODEL_ID = 'gemini-2.5-flash-lite';

const LANG_INFO = {
  pl: { name: 'Polish', nativeScript: 'Polish' },
  en: { name: 'English', nativeScript: 'English' },
  de: { name: 'German', nativeScript: 'German' },
  es: { name: 'Spanish', nativeScript: 'Spanish' },
  fr: { name: 'French', nativeScript: 'French' },
  it: { name: 'Italian', nativeScript: 'Italian' },
  'pt-BR': { name: 'Brazilian Portuguese', nativeScript: 'Brazilian Portuguese' },
  ja: { name: 'Japanese', nativeScript: 'Japanese script' },
  'zh-CN': { name: 'Simplified Chinese', nativeScript: 'Simplified Chinese characters' },
  ko: { name: 'Korean', nativeScript: 'Korean script' },
  tr: { name: 'Turkish', nativeScript: 'Turkish' },
  ru: { name: 'Russian', nativeScript: 'Russian Cyrillic' }
};

const MOJIBAKE_PATTERN = /(?:\u00c3|\u00c4|\u00c5|â€|cannotreliablyprocess|imunabletogenerate)/i;

const SLUG_MIGRATIONS = [
  {
    lang: 'ko',
    oldSlug: 'imunabletogenerateanaccurateslugforthistextasitappearstocontaincorruptedorimprop',
    newSlug: 'healthy-work-habits-for-office-workers',
    keyword: '직장인을 위한 건강한 업무 습관'
  },
  {
    lang: 'ko',
    oldSlug: 'icannotreliablyprocessthecorruptedtextyouprovideditappearstobetextencodingerrors',
    newSlug: 'office-worker-wellness-habits-with-healthdesk',
    keyword: '직장인 건강관리 웰니스 습관'
  },
  {
    lang: 'de',
    oldSlug: 'ergonomischer-arbeitsplatz-r-zckenschmerzen-vorbeugen-tipps',
    newSlug: 'ergonomischer-arbeitsplatz-ruckenschmerzen-vorbeugen',
    keyword: 'ergonomischer Arbeitsplatz Rückenschmerzen vorbeugen'
  },
  {
    lang: 'de',
    oldSlug: 'verspannungen-im-r-zcken-durch-homeoffice-l-osen',
    newSlug: 'homeoffice-verspannungen-losen-5-minuten-ubungen',
    keyword: 'Verspannungen im Rücken durch Homeoffice lösen'
  },
  {
    lang: 'es',
    oldSlug: 'c-omo-mejorar-la-postura-trabajando-desde-casa-columna',
    newSlug: 'postura-en-casa-ejercicios-y-pausas-para-tu-columna',
    keyword: 'cómo mejorar la postura trabajando desde casa'
  },
  {
    lang: 'es',
    oldSlug: 'dolor-lumbar-trabajo-sedentario-remedios-y-prevenci-on',
    newSlug: 'dolor-lumbar-en-trabajo-sedentario-prevencion-con-pausas-activas',
    keyword: 'dolor lumbar trabajo sedentario prevención'
  },
  {
    lang: 'fr',
    oldSlug: 'pourquoi-j-ai-mal-au-dos-apr-es-une-journ-ee-de-t-el-etravail',
    newSlug: 'mal-de-dos-en-teletravail-causes-et-solutions',
    keyword: 'mal de dos en télétravail causes et solutions'
  },
  {
    lang: 'fr',
    oldSlug: 'am-enagement-ergonomique-du-bureau-pour-prot-eger-la-colonne-vert-ebrale',
    newSlug: 'bureau-ergonomique-proteger-sa-colonne-vertebrale',
    keyword: 'aménagement ergonomique du bureau pour protéger la colonne vertébrale'
  },
  {
    lang: 'pt-BR',
    oldSlug: 'como-montar-um-home-office-ergon-dmico-para-proteger-a-coluna',
    newSlug: 'home-office-ergonomico-proteja-sua-coluna',
    keyword: 'home office ergonômico para proteger a coluna'
  },
  {
    lang: 'pt-BR',
    oldSlug: 'quantas-pausas-fazer-trabalhando-sentado-o-dia-inteiro-no-escrit-orio',
    newSlug: 'quantas-pausas-fazer-trabalhando-sentado-guia-pratico',
    keyword: 'quantas pausas fazer trabalhando sentado no escritório'
  },
  {
    lang: 'tr',
    oldSlug: 'evden-cal-n-ss-nrken-bel-sa-ssl-n-ss-nn-n-koruman-nn-pratik-yollar-n',
    newSlug: 'evde-calisirken-bel-agrisini-onlemenin-7-pratik-yolu',
    keyword: 'evde çalışırken bel ağrısını önlemenin pratik yolları'
  },
  {
    lang: 'pl',
    oldSlug: 'b-ol-l-ed-lwiowy-od-siedzenia-przy-komputerze',
    newSlug: 'bol-ledzwiowy-od-siedzenia-przy-komputerze',
    keyword: 'ból lędźwiowy od siedzenia przy komputerze'
  },
  {
    lang: 'pl',
    oldSlug: 'przerwy-od-komputera-a-zdrowie-kr-egos-lupa',
    newSlug: 'przerwy-od-komputera-a-zdrowie-kregoslupa-kompletny-poradnik',
    keyword: 'przerwy od komputera a zdrowie kręgosłupa'
  },
  {
    lang: 'pl',
    oldSlug: 'ile-wody-pi-c-pracuj-ac-w-biurze-ca-ly-dzie-n',
    newSlug: 'ile-wody-pic-w-biurze-poradnik-dla-pracownika',
    keyword: 'ile wody pić pracując w biurze cały dzień'
  }
];

const REGENERATE_TASKS = [
  {
    lang: 'pl',
    slug: 'jak-przypominac-sobie-o-piciu-wody-w-pracy',
    keyword: 'jak przypominać sobie o piciu wody w pracy',
    titleHint: 'Przypominaj sobie o wodzie w pracy - poradnik'
  },
  {
    lang: 'de',
    slug: 'augenubungen-gegen-bildschirmermudung-im-buroalltag',
    keyword: 'Augenübungen gegen Bildschirmermüdung im Büroalltag',
    titleHint: 'Augenübungen gegen Bildschirmermüdung: 5 Übungen fürs Büro'
  },
  {
    lang: 'es',
    slug: 'como-descansar-la-vista-trabajando-frente-a-la-computadora',
    keyword: 'cómo descansar la vista trabajando frente a la computadora',
    titleHint: 'Descansa la vista en el trabajo: guía práctica'
  },
  {
    lang: 'pt-BR',
    slug: 'como-descansar-os-olhos-trabalhando-no-computador-o-dia-todo',
    keyword: 'como descansar os olhos trabalhando no computador o dia todo',
    titleHint: 'Como descansar os olhos trabalhando no computador o dia todo'
  },
  {
    lang: 'ja',
    slug: 'prevent-back-pain-work-from-home-posture',
    keyword: '在宅勤務で腰痛を防ぐための正しい座り方と姿勢のコツ',
    titleHint: '在宅勤務の腰痛を防ぐ正しい座り方と姿勢のコツ'
  },
  {
    lang: 'zh-CN',
    slug: 'how-to-protect-eyes-computer-screen',
    keyword: '长时间对着电脑屏幕如何保护眼睛',
    titleHint: '长时间盯着电脑屏幕如何科学护眼'
  },
  {
    lang: 'ko',
    slug: 'reduce-eye-strain-long-computer-use',
    keyword: '장시간 컴퓨터 사용 시 눈 피로 줄이는 방법',
    titleHint: '장시간 컴퓨터 사용 시 눈 피로를 줄이는 방법'
  },
  {
    lang: 'tr',
    slug: 'monitor-yuksekligi-ve-mesafesi-nasil-dogru-ayarlanir',
    keyword: 'monitör yüksekliği ve mesafesi nasıl doğru ayarlanır',
    titleHint: 'Monitör yüksekliği ve mesafesi nasıl doğru ayarlanır'
  },
  {
    lang: 'ru',
    slug: 'kak-snyat-ustalost-glaz-posle-dolgoy-raboty-za-kompyuterom',
    keyword: 'как снять усталость глаз после долгой работы за компьютером',
    titleHint: 'Как снять усталость глаз после долгой работы за компьютером'
  }
];

function loadStudio() {
  return JSON.parse(fs.readFileSync(STUDIO_PATH, 'utf8'));
}

function saveStudio(studio) {
  fs.writeFileSync(STUDIO_PATH, JSON.stringify(studio, null, 2), 'utf8');
}

function articlePath(lang, slug) {
  return path.join(BLOG_DIR, lang, `${slug}.md`);
}

function imagePath(slug) {
  return path.join(IMAGES_DIR, `${slug}.webp`);
}

function articleUrl(lang, slug) {
  return `https://healthdesk.site/${lang}/blog/${slug}/`;
}

function hasValidFrontmatter(raw) {
  return raw.startsWith('---\n') && (raw.match(/^---$/gm) || []).length >= 2;
}

function readArticle(lang, slug) {
  const filePath = articlePath(lang, slug);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing article file: ${lang}/${slug}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  if (!hasValidFrontmatter(raw)) {
    return { filePath, raw, attributes: {}, body: '' };
  }

  const parsed = fm(raw);
  return {
    filePath,
    raw,
    attributes: parsed.attributes || {},
    body: parsed.body || ''
  };
}

function normalizeDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const match = String(value).trim().replace(/^"|"$/g, '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function looksBroken(value) {
  return MOJIBAKE_PATTERN.test(String(value || ''));
}

function cleanList(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }
  return [];
}

function cleanFaq(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => ({
      q: String(item?.q || '').trim(),
      a: String(item?.a || '').trim()
    }))
    .filter(item => item.q && item.a);
}

function orderedAttributes(input) {
  const out = {};
  const order = [
    'title',
    'slug',
    'date',
    'description',
    'keyword',
    'tags',
    'lang',
    'heroImage',
    'image_alt',
    'legacy_slugs',
    'siblings',
    'faq'
  ];

  for (const key of order) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    out[key] = value;
  }

  return out;
}

function writeArticle(lang, slug, attributes, body) {
  const filePath = articlePath(lang, slug);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const yamlText = yaml.dump(orderedAttributes(attributes), {
    lineWidth: 1000,
    noRefs: true,
    sortKeys: false,
    quotingType: '"'
  }).trimEnd();
  const articleBody = String(body || '').trimStart();
  fs.writeFileSync(filePath, `---\n${yamlText}\n---\n\n${articleBody}\n`, 'utf8');
}

function findCalendarKeyword(studio, lang, slug) {
  for (const cluster of studio.content_calendar?.clusters || []) {
    for (const [clusterLang, keywords] of Object.entries(cluster.keywords || {})) {
      if (clusterLang !== lang) continue;
      for (const kw of keywords || []) {
        if (kw.slug === slug && kw.published_date && kw.published_date >= CUTOFF_DATE) {
          return kw;
        }
      }
    }
  }
  return null;
}

function eachPublishedKeyword(studio, callback) {
  for (const cluster of studio.content_calendar?.clusters || []) {
    for (const [lang, keywords] of Object.entries(cluster.keywords || {})) {
      for (const kw of keywords || []) {
        if ((kw.status === 'published' || kw.status === 'tracking') && kw.published_date && kw.published_date >= CUTOFF_DATE) {
          callback(kw, lang, cluster);
        }
      }
    }
  }
}

function updateSiblingReferences(oldLang, oldSlug, newSlug) {
  const langs = fs.readdirSync(BLOG_DIR).filter(entry => fs.statSync(path.join(BLOG_DIR, entry)).isDirectory());
  let updated = 0;

  for (const lang of langs) {
    const langDir = path.join(BLOG_DIR, lang);
    for (const file of fs.readdirSync(langDir).filter(name => name.endsWith('.md'))) {
      const fullPath = path.join(langDir, file);
      const raw = fs.readFileSync(fullPath, 'utf8');
      if (!hasValidFrontmatter(raw)) continue;

      const parsed = fm(raw);
      const siblings = { ...(parsed.attributes.siblings || {}) };
      if (siblings[oldLang] !== oldSlug) continue;

      siblings[oldLang] = newSlug;
      writeArticle(lang, parsed.attributes.slug || file.replace(/\.md$/, ''), {
        ...parsed.attributes,
        siblings
      }, parsed.body || '');
      updated++;
    }
  }

  return updated;
}

function updateStudioArticleRecord(studio, oldKey, newKey, attrs, publishedDate) {
  const oldRecord = studio.articles?.[oldKey] || studio.articles?.[newKey] || {};
  const record = {
    ...oldRecord,
    status: oldRecord.status || 'published',
    title: attrs.title,
    keyword: attrs.keyword,
    lang: attrs.lang,
    slug: attrs.slug,
    published_date: publishedDate,
    url: articleUrl(attrs.lang, attrs.slug)
  };

  delete studio.articles[oldKey];
  delete studio.articles[newKey];
  studio.articles[newKey] = record;
}

function getApiKey(studio) {
  return process.env.GEMINI_API_KEY || studio.gemini_api_key || '';
}

async function callClaude(apiKey, systemPrompt, userPrompt, maxTokens = 5000) {
  let lastError = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json'
        }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      return parts.map(part => part.text || '').join('').trim();
    }

    const errorText = await res.text();
    lastError = new Error(`Gemini API error ${res.status}: ${errorText}`);
    if (res.status !== 503 || attempt === 5) break;
    await new Promise(resolve => setTimeout(resolve, attempt * 4000));
  }

  throw lastError;
}

function stripMarkdownFences(text) {
  let value = String(text || '').trim();
  if (value.startsWith('```')) {
    value = value.replace(/^```[a-zA-Z0-9_-]*\s*/, '');
    value = value.replace(/\s*```$/, '');
  }
  return value.trim();
}

async function regenerateArticle(apiKey, task, publishedDate) {
  const info = LANG_INFO[task.lang] || { name: task.lang, nativeScript: task.lang };
  const landingUrl = `https://healthdesk.site/${task.lang}/`;
  const systemPrompt = `You are an expert SEO content writer for HealthDesk. Write only in ${info.name} using ${info.nativeScript}.`;
  const userPrompt = `Create one blog article in ${info.name}.

Topic hint: "${task.keyword}"
Slug hint: "${task.slug}"
Preferred title direction: "${task.titleHint}"

Requirements:
- Return STRICT JSON only.
- Use natural ${info.name}. Do not mix languages except the product name HealthDesk.
- JSON keys: title, description, keyword, tags, image_alt, faq, body_markdown.
- title: 45-65 characters, strong CTR, native language.
- description: 140-160 characters, native language.
- keyword: one primary keyword in native language.
- tags: array of 4 or 5 short tags in native language.
- image_alt: concise image alt text in native language.
- faq: array of exactly 4 objects with q and a in native language.
- body_markdown: 900-1400 words, no frontmatter, no H1, start with a short intro paragraph, use ## and ### headings, add practical tips, mention [HealthDesk](${landingUrl}) once near the end, and close with a concise actionable summary.
- Do not use placeholders, fake citations, or generic filler.

Return ONLY valid JSON.`;

  const raw = await callClaude(apiKey, systemPrompt, userPrompt, 5500);
  const parsed = JSON.parse(stripMarkdownFences(raw));
  return {
    title: String(parsed.title || task.titleHint).trim(),
    description: String(parsed.description || '').trim(),
    keyword: String(parsed.keyword || task.keyword).trim(),
    tags: cleanList(parsed.tags).slice(0, 5),
    image_alt: String(parsed.image_alt || parsed.title || task.titleHint).trim(),
    faq: cleanFaq(parsed.faq).slice(0, 4),
    body_markdown: String(parsed.body_markdown || '').trim(),
    slug: task.slug,
    date: publishedDate,
    lang: task.lang,
    heroImage: `${task.slug}.webp`
  };
}

async function main() {
  const studio = loadStudio();
  const apiKey = getApiKey(studio);
  if (!apiKey) {
    throw new Error('Missing Gemini API key');
  }

  const changedUrls = new Set();
  const summary = [];

  for (const migration of SLUG_MIGRATIONS) {
    const kw = findCalendarKeyword(studio, migration.lang, migration.oldSlug)
      || findCalendarKeyword(studio, migration.lang, migration.newSlug);
    if (!kw) continue;

    const oldPath = articlePath(migration.lang, migration.oldSlug);
    const newPath = articlePath(migration.lang, migration.newSlug);
    const sourceSlug = fs.existsSync(oldPath)
      ? migration.oldSlug
      : (fs.existsSync(newPath) ? migration.newSlug : migration.oldSlug);

    const current = readArticle(migration.lang, sourceSlug);
    const publishedDate = kw.published_date;
    const oldKey = `${migration.lang}/${migration.oldSlug}`;
    const newKey = `${migration.lang}/${migration.newSlug}`;
    const legacySlugs = Array.from(new Set([
      ...cleanList(current.attributes.legacy_slugs),
      migration.oldSlug
    ]));

    const attrs = {
      ...current.attributes,
      slug: migration.newSlug,
      date: publishedDate,
      keyword: migration.keyword || (looksBroken(current.attributes.keyword) ? current.attributes.title : current.attributes.keyword),
      lang: migration.lang,
      heroImage: `${migration.newSlug}.webp`,
      legacy_slugs: legacySlugs
    };

    writeArticle(migration.lang, migration.newSlug, attrs, current.body || '');
    if (sourceSlug === migration.oldSlug && current.filePath !== articlePath(migration.lang, migration.newSlug) && fs.existsSync(current.filePath)) {
      fs.unlinkSync(current.filePath);
    }

    const oldImage = imagePath(migration.oldSlug);
    const newImage = imagePath(migration.newSlug);
    if (fs.existsSync(oldImage) && !fs.existsSync(newImage)) {
      fs.copyFileSync(oldImage, newImage);
    }

    eachPublishedKeyword(studio, (item, lang) => {
      if (lang === migration.lang && (item.slug === migration.oldSlug || item.slug === migration.newSlug)) {
        item.slug = migration.newSlug;
        if (migration.keyword) item.keyword = migration.keyword;
      }
    });

    updateStudioArticleRecord(studio, oldKey, newKey, attrs, publishedDate);
    const siblingUpdates = updateSiblingReferences(migration.lang, migration.oldSlug, migration.newSlug);
    changedUrls.add(articleUrl(migration.lang, migration.newSlug));
    summary.push(`slug ${oldKey} -> ${newKey}${siblingUpdates ? ` (siblings ${siblingUpdates})` : ''}`);
  }

  for (const task of REGENERATE_TASKS) {
    const kw = findCalendarKeyword(studio, task.lang, task.slug);
    if (!kw) continue;

    const publishedDate = kw.published_date;
    const existing = readArticle(task.lang, task.slug);
    const regenerated = await regenerateArticle(apiKey, task, publishedDate);
    const attrs = {
      title: regenerated.title,
      slug: task.slug,
      date: publishedDate,
      description: regenerated.description,
      keyword: regenerated.keyword,
      tags: regenerated.tags,
      lang: task.lang,
      heroImage: `${task.slug}.webp`,
      image_alt: regenerated.image_alt,
      legacy_slugs: cleanList(existing.attributes.legacy_slugs),
      siblings: existing.attributes.siblings || {},
      faq: regenerated.faq
    };

    writeArticle(task.lang, task.slug, attrs, regenerated.body_markdown);
    kw.keyword = regenerated.keyword;

    const studioKey = `${task.lang}/${task.slug}`;
    studio.articles[studioKey] = {
      ...(studio.articles[studioKey] || {}),
      status: studio.articles[studioKey]?.status || 'published',
      title: regenerated.title,
      keyword: regenerated.keyword,
      lang: task.lang,
      slug: task.slug,
      published_date: publishedDate,
      url: articleUrl(task.lang, task.slug)
    };

    changedUrls.add(articleUrl(task.lang, task.slug));
    summary.push(`regenerated ${studioKey}`);
  }

  eachPublishedKeyword(studio, (kw, lang) => {
    const current = readArticle(lang, kw.slug);
    if (!current.body && !hasValidFrontmatter(current.raw)) return;

    const currentDate = normalizeDateOnly(current.attributes.date);
    const finalDate = kw.published_date;
    const updatedKeyword = !looksBroken(current.attributes.keyword) && current.attributes.keyword
      ? current.attributes.keyword
      : kw.keyword;

    const attrs = {
      ...current.attributes,
      slug: kw.slug,
      date: finalDate,
      keyword: updatedKeyword,
      lang
    };

    if (currentDate !== finalDate || current.attributes.keyword !== updatedKeyword) {
      writeArticle(lang, kw.slug, attrs, current.body || '');
      summary.push(`synced metadata ${lang}/${kw.slug}`);
    }

    kw.keyword = updatedKeyword;
    const studioKey = `${lang}/${kw.slug}`;
    studio.articles[studioKey] = {
      ...(studio.articles[studioKey] || {}),
      status: studio.articles[studioKey]?.status || kw.status,
      title: attrs.title || studio.articles[studioKey]?.title || kw.keyword,
      keyword: updatedKeyword,
      lang,
      slug: kw.slug,
      published_date: finalDate,
      url: articleUrl(lang, kw.slug)
    };
  });

  saveStudio(studio);

  console.log(JSON.stringify({
    changed_urls: Array.from(changedUrls),
    summary
  }, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
