#!/usr/bin/env node
/**
 * HealthDesk Landing Page — Static Site Generator
 * Generates per-language landing pages + blog from Markdown.
 * Usage: node build.js
 */
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const fm = require('front-matter');

// ─── Config ───
const SITE_URL = 'https://healthdesk.site';
const LANGUAGES = ['pl', 'en', 'de', 'es', 'fr', 'pt-BR', 'ja', 'zh-CN', 'ko', 'it', 'tr', 'ru'];
const DEFAULT_LANG = 'en';
const LANG_LABELS = { pl:'PL', en:'EN', de:'DE', es:'ES', fr:'FR', 'pt-BR':'PT', ja:'JA', 'zh-CN':'ZH', ko:'KO', it:'IT', tr:'TR', ru:'RU' };
const OG_LOCALES = { pl:'pl_PL', en:'en_US', de:'de_DE', es:'es_ES', fr:'fr_FR', 'pt-BR':'pt_BR', ja:'ja_JP', 'zh-CN':'zh_CN', ko:'ko_KR', it:'it_IT', tr:'tr_TR', ru:'ru_RU' };
const HTML_LANGS = { 'zh-CN':'zh', 'pt-BR':'pt' };

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(ROOT, 'assets');

// ─── Helpers ───
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      fs.rmSync(p, { recursive: true, force: true });
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadTemplate(name) {
  return fs.readFileSync(path.join(SRC, 'templates', name), 'utf8');
}

// ─── Translation resolver ───
function createResolver(lang, translations) {
  const t = translations[lang] || {};
  const en = translations['en'] || {};
  const pl = translations['pl'] || {};

  return function resolve(key) {
    return t[key] || en[key] || pl[key] || key;
  };
}

// Replace all {{t.key}} and {{variable}} in template
function renderTemplate(template, vars) {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmed = key.trim();
    if (trimmed.startsWith('t.')) {
      const tKey = trimmed.slice(2);
      return vars._resolve ? vars._resolve(tKey) : (vars[trimmed] || match);
    }
    return vars[trimmed] !== undefined ? vars[trimmed] : match;
  });
}

// ─── Hreflang tags ───
function generateHreflangTags(pagePath) {
  let tags = '';
  for (const lang of LANGUAGES) {
    const url = `${SITE_URL}/${lang}${pagePath}`;
    const hrefLang = lang === 'pt-BR' ? 'pt-br' : lang === 'zh-CN' ? 'zh-hans' : lang;
    tags += `  <link rel="alternate" hreflang="${hrefLang}" href="${url}">\n`;
  }
  tags += `  <link rel="alternate" hreflang="x-default" href="${SITE_URL}/${DEFAULT_LANG}${pagePath}">`;
  return tags;
}

// ─── Language links (navbar) ───
function generateLangLinks(lang, pagePath, blogSiblings) {
  // blogSiblings: { en: "workplace-ergonomics", pl: "ergonomia-stanowiska-pracy", ... }
  // If provided, link to sibling slug for languages that have it
  const options = LANGUAGES.map(l => {
    const active = l === lang ? ' lang-active' : '';
    let href;
    if (blogSiblings) {
      if (l === lang) {
        href = `/${l}/blog/${blogSiblings[l] || pagePath.replace(/^\/blog\/|\/$/g, '')}/`;
      } else if (blogSiblings[l]) {
        href = `/${l}/blog/${blogSiblings[l]}/`;
      } else {
        // No sibling — link to blog index for that language
        href = `/${l}/blog/?missing=${encodeURIComponent(blogSiblings[lang] || '')}`;
      }
    } else {
      href = `/${l}${pagePath}`;
    }
    return `<a href="${href}" class="lang-opt${active}">${LANG_LABELS[l]}</a>`;
  }).join('\n            ');
  return `<div class="lang-switch" id="lang-switch">
        <button class="lang-current" id="lang-current"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>${LANG_LABELS[lang]}</span></button>
        <div class="lang-dropdown" id="lang-dropdown">
            ${options}
        </div>
      </div>
      <script>
      (function(){
        var sw=document.getElementById('lang-switch'),btn=document.getElementById('lang-current');
        btn.addEventListener('click',function(e){e.stopPropagation();sw.classList.toggle('open')});
        document.addEventListener('click',function(){sw.classList.remove('open')});
      })();
      </script>`;
}

// ─── JSON-LD Schema ───
function generateLandingSchema(lang, resolve) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'HealthDesk',
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Windows, macOS, Linux',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description: stripHtml(resolve('hero.subtitle')),
    url: `${SITE_URL}/${lang}/`,
    downloadUrl: 'https://github.com/JarekSaternus/HealthDesk/releases/latest',
    softwareVersion: '2.0.24',
    author: { '@type': 'Organization', name: 'HealthDesk' }
  };
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

function generateBlogPostSchema(meta, lang, articleHtml) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: meta.title,
    datePublished: meta.date,
    description: meta.description || '',
    author: { '@type': 'Organization', name: 'HealthDesk' },
    publisher: { '@type': 'Organization', name: 'HealthDesk', logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo-color.svg` } },
    mainEntityOfPage: `${SITE_URL}/${lang}/blog/${meta.slug}/`,
    inLanguage: lang
  };
  if (meta.image) {
    schema.image = {
      '@type': 'ImageObject',
      url: `${SITE_URL}${meta.image}`,
      width: 1200,
      height: 630
    };
  }
  // Speakable — key sections for voice assistants and LLMs
  schema.speakable = {
    '@type': 'SpeakableSpecification',
    cssSelector: ['.blog-content h2', '.blog-content p:first-of-type', '.blog-content h3']
  };
  if (meta.keyword) schema.keywords = meta.keyword;
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

// ─── Blog Article FAQ Schema (auto-extract from headings + frontmatter faq field) ───
function generateBlogFAQSchema(post) {
  const questions = [];

  // 1. Manual FAQ from frontmatter (priority)
  if (post.faq && Array.isArray(post.faq)) {
    for (const item of post.faq) {
      if (item.q && item.a) {
        questions.push({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a }
        });
      }
    }
  }

  // 2. Auto-extract from H2/H3 headings that end with "?"
  if (post.body) {
    const lines = post.body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const headingMatch = lines[i].match(/^#{2,3}\s+(.+\?)\s*$/);
      if (!headingMatch) continue;
      const question = headingMatch[1].trim();
      // Skip if already in manual FAQ
      if (questions.some(q => q.name === question)) continue;
      // Collect answer: paragraphs until next heading or end
      const answerParts = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^#{1,3}\s+/.test(lines[j])) break;
        const line = lines[j].trim();
        if (line && !line.startsWith('|') && !line.startsWith('---') && !line.startsWith('![')) {
          // Strip markdown formatting for clean text
          answerParts.push(line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1'));
        }
        if (answerParts.length >= 3) break; // First 3 lines of answer
      }
      if (answerParts.length > 0) {
        questions.push({
          '@type': 'Question',
          name: question,
          acceptedAnswer: { '@type': 'Answer', text: answerParts.join(' ') }
        });
      }
    }
  }

  if (questions.length === 0) return '';
  const schema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: questions };
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

// ─── FAQPage Schema ───
function generateFAQSchema(lang, resolve) {
  const questions = [];
  for (let i = 1; i <= 7; i++) {
    const q = resolve(`faq.q${i}`);
    const a = resolve(`faq.a${i}`);
    if (q && q !== `faq.q${i}` && a && a !== `faq.a${i}`) {
      questions.push({
        '@type': 'Question',
        name: stripHtml(q),
        acceptedAnswer: { '@type': 'Answer', text: stripHtml(a) }
      });
    }
  }
  if (questions.length === 0) return '';
  const schema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: questions };
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

// ─── Blog Index CollectionPage Schema ───
function generateBlogIndexSchema(lang, posts) {
  const items = (posts || []).map(p => ({
    '@type': 'BlogPosting',
    headline: p.title,
    url: `${SITE_URL}/${lang}/blog/${p.slug}/`,
    datePublished: p.date
  }));
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Blog — HealthDesk',
    url: `${SITE_URL}/${lang}/blog/`,
    hasPart: items
  };
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

// ─── BreadcrumbList Schema for blog posts ───
function generateBreadcrumbSchema(lang, post) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'HealthDesk', item: `${SITE_URL}/${lang}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/${lang}/blog/` },
      { '@type': 'ListItem', position: 3, name: post.title, item: `${SITE_URL}/${lang}/blog/${post.slug}/` }
    ]
  };
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

// ─── Load translations ───
function loadTranslations() {
  const translations = {};
  for (const lang of LANGUAGES) {
    const filePath = path.join(SRC, 'i18n', `${lang}.json`);
    if (fs.existsSync(filePath)) {
      translations[lang] = loadJson(filePath);
    } else {
      console.warn(`Warning: No translation file for ${lang}`);
      translations[lang] = {};
    }
  }
  return translations;
}

// ─── Load blog posts ───
function loadBlogPosts() {
  const postsDir = path.join(SRC, 'content', 'blog');
  const posts = {};

  for (const lang of LANGUAGES) {
    const langDir = path.join(postsDir, lang);
    posts[lang] = [];
    if (!fs.existsSync(langDir)) continue;

    for (const file of fs.readdirSync(langDir).filter(f => f.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(langDir, file), 'utf8');
      const parsed = fm(content);
      const html = marked(parsed.body);
      // Check if hero image exists
      const slug = parsed.attributes.slug || file.replace('.md', '');
      const heroImg = path.join(SRC, 'content', 'images', 'blog', `${slug}.webp`);
      posts[lang].push({
        ...parsed.attributes,
        html,
        body: parsed.body,
        file,
        image: fs.existsSync(heroImg) ? `/images/blog/${slug}.webp` : null,
        image_alt: parsed.attributes.image_alt || parsed.attributes.title
      });
    }

    // Sort by date descending
    posts[lang].sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  return posts;
}

// ─── Build ───
function build() {
  console.log('Building HealthDesk landing page...\n');

  // 1. Clean dist
  cleanDir(DIST);

  // 2. Copy assets
  console.log('Copying assets...');
  copyDir(ASSETS, DIST);

  // 2b. Copy blog images
  const blogImagesDir = path.join(SRC, 'content', 'images', 'blog');
  const distImagesDir = path.join(DIST, 'images', 'blog');
  if (fs.existsSync(blogImagesDir)) {
    console.log('Copying blog images...');
    ensureDir(distImagesDir);
    for (const f of fs.readdirSync(blogImagesDir)) {
      fs.copyFileSync(path.join(blogImagesDir, f), path.join(distImagesDir, f));
    }
  }

  // 3. Load data
  const translations = loadTranslations();
  const baseTemplate = loadTemplate('base.html');
  const landingTemplate = loadTemplate('landing.html');
  const blogPostTemplate = loadTemplate('blog-post.html');
  const blogIndexTemplate = loadTemplate('blog-index.html');
  const blogPosts = loadBlogPosts();

  // Extra translation keys for build
  for (const lang of LANGUAGES) {
    const t = translations[lang];
    const en = translations['en'];

    // Plain text versions (strip HTML)
    t['hero.title_plain'] = stripHtml(t['hero.title'] || en['hero.title'] || '');
    t['hero.subtitle_plain'] = stripHtml(t['hero.subtitle'] || en['hero.subtitle'] || '');

    // Download count fallback
    const dlTexts = { pl:'Pobrano 500+ razy', en:'Downloaded 500+ times', de:'500+ Downloads', es:'Descargado 500+ veces', fr:'Téléchargé 500+ fois', 'pt-BR':'Baixado 500+ vezes', ja:'500+回ダウンロード', 'zh-CN':'已下载 500+ 次', ko:'500+회 다운로드', it:'Scaricato 500+ volte', tr:'500+ kez indirildi', ru:'Скачано 500+ раз' };
    t['hero.downloads_fallback'] = dlTexts[lang] || dlTexts.en;

    // Download count prefix/suffix for JS
    const dlPrefixes = { pl:'Pobrano ', en:'Downloaded ', de:'', es:'Descargado ', fr:'Téléchargé ', 'pt-BR':'Baixado ', ja:'', 'zh-CN':'已下载 ', ko:'', it:'Scaricato ', tr:'', ru:'Скачано ' };
    const dlSuffixes = { pl:' razy', en:' times', de:' Downloads', es:' veces', fr:' fois', 'pt-BR':' vezes', ja:'回ダウンロード', 'zh-CN':' 次', ko:'회 다운로드', it:' volte', tr:' kez indirildi', ru:' раз' };
    t['hero.downloads_prefix'] = dlPrefixes[lang] || dlPrefixes.en;
    t['hero.downloads_suffix'] = dlSuffixes[lang] || dlSuffixes.en;

    // Version label
    const vLabels = { pl:'Wersja', en:'Version', de:'Version', es:'Versión', fr:'Version', 'pt-BR':'Versão', ja:'バージョン', 'zh-CN':'版本', ko:'버전', it:'Versione', tr:'Sürüm', ru:'Версия' };
    t['cta.version_label'] = vLabels[lang] || vLabels.en;
    t['cta.version_fallback'] = (vLabels[lang] || vLabels.en) + ' 2.0.24';

    // Breathing cycle
    const cycleTexts = { pl:'Cykl ', en:'Cycle ', de:'Zyklus ', es:'Ciclo ', fr:'Cycle ', 'pt-BR':'Ciclo ', ja:'サイクル ', 'zh-CN':'循环 ', ko:'사이클 ', it:'Ciclo ', tr:'Döngü ', ru:'Цикл ' };
    t['breathing.cycle_prefix'] = cycleTexts[lang] || cycleTexts.en;
    t['breathing.cycle_initial'] = (cycleTexts[lang] || cycleTexts.en) + '1 / 5';

    // Blog subtitle
    const blogSubtitles = { pl:'Artykuły o zdrowiu przy komputerze', en:'Articles about healthy computer work', de:'Artikel über gesundes Arbeiten am Computer', es:'Artículos sobre el trabajo saludable', fr:'Articles sur le travail sain', 'pt-BR':'Artigos sobre trabalho saudável', ja:'健康的なコンピュータ作業についての記事', 'zh-CN':'关于健康电脑工作的文章', ko:'건강한 컴퓨터 작업에 대한 기사', it:'Articoli sul lavoro sano al computer', tr:'Sağlıklı bilgisayar çalışması hakkında makaleler', ru:'Статьи о здоровой работе за компьютером' };
    t['blog.subtitle'] = blogSubtitles[lang] || blogSubtitles.en;

    // Translated keywords
    const keywords = {
      pl: 'przerwy w pracy, zdrowie przy komputerze, ćwiczenia oczu, nawodnienie, tracker aktywności, pomodoro, ergonomia, Windows, macOS, Linux',
      en: 'work breaks, computer health, eye exercises, hydration, activity tracker, pomodoro, ergonomics, Windows, macOS, Linux',
      de: 'Arbeitspausen, Gesundheit am Computer, Augenübungen, Flüssigkeitszufuhr, Aktivitätstracker, Pomodoro, Ergonomie, Windows, macOS, Linux',
      es: 'pausas en el trabajo, salud informática, ejercicios oculares, hidratación, seguimiento de actividad, pomodoro, ergonomía, Windows, macOS, Linux',
      fr: 'pauses au travail, santé informatique, exercices oculaires, hydratation, suivi d\'activité, pomodoro, ergonomie, Windows, macOS, Linux',
      'pt-BR': 'pausas no trabalho, saúde no computador, exercícios oculares, hidratação, rastreador de atividades, pomodoro, ergonomia, Windows, macOS, Linux',
      ja: '仕事の休憩, パソコンの健康, 目の体操, 水分補給, アクティビティトラッカー, ポモドーロ, 人間工学, Windows, macOS, Linux',
      'zh-CN': '工作休息, 电脑健康, 眼保健操, 补水提醒, 活动追踪, 番茄工作法, 人体工学, Windows, macOS, Linux',
      ko: '업무 휴식, 컴퓨터 건강, 눈 운동, 수분 섭취, 활동 추적기, 뽀모도로, 인체공학, Windows, macOS, Linux',
      it: 'pause lavorative, salute al computer, esercizi per gli occhi, idratazione, tracker attività, pomodoro, ergonomia, Windows, macOS, Linux',
      tr: 'iş molaları, bilgisayar sağlığı, göz egzersizleri, su içme hatırlatıcı, aktivite takibi, pomodoro, ergonomi, Windows, macOS, Linux',
      ru: 'перерывы в работе, здоровье за компьютером, упражнения для глаз, гидратация, трекер активности, помодоро, эргономика, Windows, macOS, Linux'
    };
    t['meta.keywords'] = keywords[lang] || keywords.en;

    // Blog missing article notice
    const blogNotTranslated = { pl:'Ten artykuł nie jest jeszcze dostępny w tym języku. Przeglądaj dostępne artykuły poniżej.', en:'This article is not yet available in this language. Browse available articles below.', de:'Dieser Artikel ist in dieser Sprache noch nicht verfügbar. Durchsuchen Sie die verfügbaren Artikel unten.', es:'Este artículo aún no está disponible en este idioma. Consulte los artículos disponibles a continuación.', fr:'Cet article n\'est pas encore disponible dans cette langue. Parcourez les articles disponibles ci-dessous.', 'pt-BR':'Este artigo ainda não está disponível neste idioma. Veja os artigos disponíveis abaixo.', ja:'この記事はまだこの言語では利用できません。以下の記事をご覧ください。', 'zh-CN':'本文暂无此语言版本。请浏览以下可用文章。', ko:'이 기사는 아직 이 언어로 제공되지 않습니다. 아래에서 사용 가능한 기사를 찾아보세요.', it:'Questo articolo non è ancora disponibile in questa lingua. Sfoglia gli articoli disponibili qui sotto.', tr:'Bu makale henüz bu dilde mevcut değil. Aşağıdaki mevcut makalelere göz atın.', ru:'Эта статья пока недоступна на этом языке. Просмотрите доступные статьи ниже.' };
    t['blog.not_translated'] = blogNotTranslated[lang] || blogNotTranslated.en;
  }

  // 4. Generate per-language pages
  let sitemapUrls = [];

  for (const lang of LANGUAGES) {
    console.log(`Generating ${lang}...`);
    const langDir = path.join(DIST, lang);
    ensureDir(langDir);

    const resolve = createResolver(lang, translations);
    const htmlLang = HTML_LANGS[lang] || lang;

    // Check if blog has posts for this lang
    const hasBlog = blogPosts[lang] && blogPosts[lang].length > 0;

    // ── Landing page ──
    const landingVars = {
      _resolve: resolve,
      lang,
      lang_links: generateLangLinks(lang, '/'),
      blog_link: hasBlog ? `<li><a href="/${lang}/blog/">Blog</a></li>` : ''
    };
    const landingContent = renderTemplate(landingTemplate, landingVars);

    const landingPageVars = {
      _resolve: resolve,
      html_lang: htmlLang,
      page_title: `HealthDesk — ${resolve('hero.title_plain')}`,
      page_description: resolve('hero.subtitle_plain'),
      meta_keywords: resolve('meta.keywords'),
      canonical_url: `${SITE_URL}/${lang}/`,
      og_locale: OG_LOCALES[lang] || 'en_US',
      og_image: `${SITE_URL}/og-image.png`,
      og_image_alt: `HealthDesk — ${resolve('hero.title_plain')}`,
      hreflang_tags: generateHreflangTags('/'),
      schema_jsonld: generateLandingSchema(lang, resolve) + '\n' + generateFAQSchema(lang, resolve),
      content: landingContent
    };
    const landingHtml = renderTemplate(baseTemplate, landingPageVars);
    fs.writeFileSync(path.join(langDir, 'index.html'), landingHtml, 'utf8');
    sitemapUrls.push({ url: `${SITE_URL}/${lang}/`, lang, pagePath: '/', lastmod: new Date().toISOString().slice(0, 10) });

    // ── Blog index ──
    if (hasBlog) {
      const blogDir = path.join(langDir, 'blog');
      ensureDir(blogDir);

      const postsHtml = blogPosts[lang].map(post => `
        <a href="/${lang}/blog/${post.slug}/" class="blog-card">
          <h2>${post.title}</h2>
          <p class="blog-card-desc">${post.description || ''}</p>
          <time datetime="${post.date}">${formatDate(post.date, lang)}</time>
        </a>
      `).join('\n');

      const blogIndexVars = {
        _resolve: resolve,
        lang,
        lang_links: generateLangLinks(lang, '/blog/'),
        blog_posts: postsHtml
      };
      const blogIndexContent = renderTemplate(blogIndexTemplate, blogIndexVars);

      const blogIndexPageVars = {
        _resolve: resolve,
        html_lang: htmlLang,
        page_title: `Blog — HealthDesk`,
        page_description: resolve('blog.subtitle'),
        meta_keywords: resolve('meta.keywords'),
        canonical_url: `${SITE_URL}/${lang}/blog/`,
        og_locale: OG_LOCALES[lang] || 'en_US',
        og_image: `${SITE_URL}/og-image.png`,
        og_image_alt: `Blog — HealthDesk`,
        hreflang_tags: generateHreflangTags('/blog/'),
        schema_jsonld: generateBlogIndexSchema(lang, blogPosts[lang]),
        content: blogIndexContent
      };
      const blogIndexHtml = renderTemplate(baseTemplate, blogIndexPageVars);
      fs.writeFileSync(path.join(blogDir, 'index.html'), blogIndexHtml, 'utf8');
      sitemapUrls.push({ url: `${SITE_URL}/${lang}/blog/`, lang, pagePath: '/blog/', lastmod: new Date().toISOString().slice(0, 10) });

      // ── Blog posts ──
      for (const post of blogPosts[lang]) {
        const postDir = path.join(blogDir, post.slug);
        ensureDir(postDir);

        // Build full siblings map (current lang + siblings from frontmatter)
        const allSiblings = { [lang]: post.slug };
        if (post.siblings) {
          Object.entries(post.siblings).forEach(([l, slug]) => { allSiblings[l] = slug; });
        }

        // Tags
        const tagsHtml = (post.tags || []).map(tag =>
          `<span class="blog-tag">${tag}</span>`
        ).join(' ');

        const heroImageHtml = post.image
          ? `<img src="${post.image}" alt="${post.image_alt}" class="blog-hero-image" width="1200" height="630" loading="eager">`
          : '';

        // Generate visible FAQ section from frontmatter
        const faqLabel = lang === 'pl' ? 'Najczęściej zadawane pytania' : 'Frequently Asked Questions';
        const visibleFaqHtml = (post.faq && Array.isArray(post.faq) && post.faq.length > 0)
          ? `<section class="blog-faq"><h2>${faqLabel}</h2><div class="faq-list">${post.faq.map(item =>
              `<details class="faq-item"><summary>${item.q}</summary><p>${item.a}</p></details>`
            ).join('')}</div></section>`
          : '';

        const postVars = {
          _resolve: resolve,
          lang,
          lang_links: generateLangLinks(lang, `/blog/${post.slug}/`, allSiblings),
          article_title: post.title,
          article_date: post.date,
          article_date_formatted: formatDate(post.date, lang),
          article_html: post.html + visibleFaqHtml,
          article_tags: tagsHtml,
          article_hero_image: heroImageHtml
        };
        const postContent = renderTemplate(blogPostTemplate, postVars);

        const postPageVars = {
          _resolve: resolve,
          html_lang: htmlLang,
          page_title: `${post.title} — HealthDesk`,
          page_description: post.description || resolve('hero.subtitle_plain'),
          meta_keywords: (post.tags || []).join(', ') || resolve('meta.keywords'),
          canonical_url: `${SITE_URL}/${lang}/blog/${post.slug}/`,
          og_locale: OG_LOCALES[lang] || 'en_US',
          og_image: post.image ? `${SITE_URL}${post.image}` : `${SITE_URL}/og-image.png`,
          og_image_alt: post.image_alt || post.title,
          hreflang_tags: post.siblings ? generateBlogHreflangTags(post, lang) : '',
          schema_jsonld: generateBlogPostSchema(post, lang, post.html) + '\n' + generateBreadcrumbSchema(lang, post) + '\n' + generateBlogFAQSchema(post),
          content: postContent
        };
        const postHtml = renderTemplate(baseTemplate, postPageVars);
        fs.writeFileSync(path.join(postDir, 'index.html'), postHtml, 'utf8');
        // Build sibling URLs for sitemap hreflang
        const sitemapSiblings = {};
        if (post.siblings) {
          for (const [sLang, sSlug] of Object.entries(post.siblings)) {
            sitemapSiblings[sLang] = `${SITE_URL}/${sLang}/blog/${sSlug}/`;
          }
        }
        sitemapSiblings[lang] = `${SITE_URL}/${lang}/blog/${post.slug}/`;

        sitemapUrls.push({
          url: `${SITE_URL}/${lang}/blog/${post.slug}/`,
          lang,
          pagePath: `/blog/${post.slug}/`,
          lastmod: post.date instanceof Date ? post.date.toISOString().slice(0, 10) : String(post.date).slice(0, 10),
          siblings: Object.keys(sitemapSiblings).length > 1 ? sitemapSiblings : null
        });
      }
    }
  }

  // 5. Root redirect
  console.log('Generating root files...');
  fs.writeFileSync(path.join(DIST, 'index.html'), `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0;url=/${DEFAULT_LANG}/">
  <title>HealthDesk</title>
</head>
<body>
  <p>Redirecting to <a href="/${DEFAULT_LANG}/">HealthDesk</a>...</p>
</body>
</html>`, 'utf8');

  // 6. .htaccess
  generateHtaccess();

  // 7. Sitemap
  generateSitemap(sitemapUrls);

  // 8. robots.txt
  fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, 'utf8');

  console.log(`\nDone! Generated ${LANGUAGES.length} languages in dist/`);
  console.log(`Total pages: ${sitemapUrls.length}`);
}

// ─── Blog hreflang with siblings ───
function generateBlogHreflangTags(post, currentLang) {
  let tags = '';
  const allLangs = { [currentLang]: post.slug, ...(post.siblings || {}) };
  for (const [lang, slug] of Object.entries(allLangs)) {
    const url = `${SITE_URL}/${lang}/blog/${slug}/`;
    const hrefLang = lang === 'pt-BR' ? 'pt-br' : lang === 'zh-CN' ? 'zh-hans' : lang;
    tags += `  <link rel="alternate" hreflang="${hrefLang}" href="${url}">\n`;
  }
  return tags;
}

// ─── Date formatting ───
function formatDate(dateStr, lang) {
  const d = new Date(dateStr);
  const locales = { pl:'pl-PL', en:'en-US', de:'de-DE', es:'es-ES', fr:'fr-FR', 'pt-BR':'pt-BR', ja:'ja-JP', 'zh-CN':'zh-CN', ko:'ko-KR', it:'it-IT', tr:'tr-TR', ru:'ru-RU' };
  try {
    return d.toLocaleDateString(locales[lang] || 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ─── .htaccess ───
function generateHtaccess() {
  const langRules = LANGUAGES
    .filter(l => l !== DEFAULT_LANG)
    .map(lang => {
      const prefix = lang.substring(0, 2);
      return `RewriteCond %{REQUEST_URI} ^/$\nRewriteCond %{HTTP:Accept-Language} ^${prefix} [NC]\nRewriteRule ^$ /${lang}/ [R=302,L]`;
    })
    .join('\n\n');

  const htaccess = `RewriteEngine On

# Redirect root to language based on Accept-Language
${langRules}

# Default → ${DEFAULT_LANG}
RewriteCond %{REQUEST_URI} ^/$
RewriteRule ^$ /${DEFAULT_LANG}/ [R=302,L]

# Old URLs redirects
Redirect 301 /privacy.html /pl/privacy/

# Error pages
ErrorDocument 404 /${DEFAULT_LANG}/

# Caching
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html "access plus 1 hour"
  ExpiresByType text/css "access plus 1 month"
  ExpiresByType image/svg+xml "access plus 1 month"
  ExpiresByType image/png "access plus 1 month"
</IfModule>

# Compression
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript text/xml image/svg+xml
</IfModule>
`;
  fs.writeFileSync(path.join(DIST, '.htaccess'), htaccess, 'utf8');
}

// ─── Sitemap ───
function generateSitemap(urls) {
  // Group URLs by pagePath for hreflang in sitemap
  const grouped = {};
  for (const u of urls) {
    if (!grouped[u.pagePath]) grouped[u.pagePath] = [];
    grouped[u.pagePath].push(u);
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
`;

  for (const u of urls) {
    xml += `  <url>\n    <loc>${u.url}</loc>\n`;
    if (u.lastmod) {
      xml += `    <lastmod>${u.lastmod}</lastmod>\n`;
    }

    // Blog posts with siblings get their own hreflang links
    if (u.siblings) {
      for (const [sLang, sUrl] of Object.entries(u.siblings)) {
        const hrefLang = sLang === 'pt-BR' ? 'pt-br' : sLang === 'zh-CN' ? 'zh-hans' : sLang;
        xml += `    <xhtml:link rel="alternate" hreflang="${hrefLang}" href="${sUrl}"/>\n`;
      }
    } else {
      // Landing/blog-index pages: group by pagePath
      const siblings = grouped[u.pagePath] || [];
      if (siblings.length > 1) {
        for (const s of siblings) {
          const hrefLang = s.lang === 'pt-BR' ? 'pt-br' : s.lang === 'zh-CN' ? 'zh-hans' : s.lang;
          xml += `    <xhtml:link rel="alternate" hreflang="${hrefLang}" href="${s.url}"/>\n`;
        }
      }
    }
    xml += `  </url>\n`;
  }

  xml += '</urlset>\n';
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), xml, 'utf8');
}

// ─── Run ───
build();
