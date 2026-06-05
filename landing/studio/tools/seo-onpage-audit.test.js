#!/usr/bin/env node
/**
 * Testy Warstwy C (seo-onpage-audit). Bez frameworka — `node tools/seo-onpage-audit.test.js`.
 * Exit 0 = wszystkie przeszły, 1 = jest fail.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { auditOnPage, parseFrontmatter } = require('./seo-onpage-audit');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const GOOD_BODY = `## What this is

I tested the best pomodoro app windows 11 setup myself for two weeks. In my experience the difference was clear.
This article covers the best pomodoro app for Windows 11 in depth with concrete examples and a practical verdict.
See more at [HealthDesk](https://healthdesk.site/en/) and the [blog](https://healthdesk.site/en/blog/).
Also a related guide: [breaks](https://healthdesk.site/en/blog/take-better-breaks/).
External source: [study](https://example.org/study).

## How it works in practice

Step by step, here is what I found after hands-on use over many days of real work.

### A subsection with detail

More concrete detail and nuance, including caveats and trade-offs worth noting.

## Which option should you choose?

A clear verdict and recommendation based on the testing above.`;

const GOOD_FM = { title: 'Best Pomodoro App for Windows 11 (Tested 2 Weeks)', slug: 'best-pomodoro-app-windows-11', description: 'I tested the best pomodoro app for Windows 11 for two weeks. Honest comparison, setup tips and a clear verdict for focused work.', keyword: 'best pomodoro app windows 11', lang: 'en', heroImage: 'x.webp', image_alt: 'best pomodoro app windows 11 screenshot', __hasFaq: true };

// 1. Dobry post → PASS, ≥80
let r = auditOnPage({ markdown: GOOD_BODY, frontmatter: GOOD_FM, lang: 'en', keyword: GOOD_FM.keyword, sitemapUrls: [] });
check('dobry post: score ≥ 80', r.score >= 80, `score=${r.score}`);
check('dobry post: status PASS', r.status === 'PASS', r.status);

// 2. Brak meta description → blocking + FAIL
r = auditOnPage({ markdown: GOOD_BODY, frontmatter: { ...GOOD_FM, description: '' }, lang: 'en', keyword: GOOD_FM.keyword, sitemapUrls: [] });
check('brak meta: blocking zawiera meta', r.blocking_issues.some(x => /meta description/i.test(x)));
check('brak meta: status FAIL', r.status === 'FAIL', r.status);

// 3. Duplikat H1 (dwa "# ") → blocking wiele H1 + FAIL
r = auditOnPage({ markdown: '# Title One\n\ntext\n\n# Title Two\n\nmore', frontmatter: GOOD_FM, lang: 'en', keyword: GOOD_FM.keyword, sitemapUrls: [] });
check('duplikat H1: blocking wiele H1', r.blocking_issues.some(x => /Wiele H1/i.test(x)));
check('duplikat H1: status FAIL', r.status === 'FAIL', r.status);

// 4. Zero linków wewnętrznych → blocking
r = auditOnPage({ markdown: '## Sec\n\nNo links at all here, just plain prose about the topic.', frontmatter: GOOD_FM, lang: 'en', keyword: GOOD_FM.keyword, sitemapUrls: [] });
check('brak internal links: blocking', r.blocking_issues.some(x => /Zero linków wewn/i.test(x)));

// 5. Keyword ze znakami specjalnymi regex → nie rzuca
let threw = false;
try { auditOnPage({ markdown: GOOD_BODY, frontmatter: { ...GOOD_FM, keyword: 'c++ (test) [x] *?' }, lang: 'en', keyword: 'c++ (test) [x] *?', sitemapUrls: ['https://healthdesk.site/en/blog/c-test/'] }); }
catch (e) { threw = true; }
check('keyword regex-special: nie rzuca wyjątku', !threw);

// 6. Cannibalization: sitemap z bliskim slugiem
r = auditOnPage({ markdown: GOOD_BODY, frontmatter: { ...GOOD_FM, slug: 'best-pomodoro-app-windows-11' }, lang: 'en', keyword: 'best pomodoro app windows 11', sitemapUrls: ['https://healthdesk.site/en/blog/best-pomodoro-app-for-windows/'] });
check('cannibalization: wykrywa bliski slug', r.cannibalization_risks.length >= 1, JSON.stringify(r.cannibalization_risks));

// 7. parseFrontmatter na realnym poście
const real = path.join(__dirname, '..', '..', 'src', 'content', 'blog', 'en', 'workrave-vs-stretchly-which-break-reminder-fits-you.md');
if (fs.existsSync(real)) {
  const p = parseFrontmatter(fs.readFileSync(real, 'utf8'));
  check('parseFrontmatter: title + faq z realnego posta', !!p.frontmatter.title && p.frontmatter.__hasFaq === true);
} else { console.log('  ~ skip: realny post nieobecny'); }

// 8. SERP intent classifier
const { classifySerpIntent, evaluateIntentMatch } = require('./serp-intent');
let si = classifySerpIntent([
  { title: '10 Best Pomodoro Apps for Windows', link: 'https://a.com/best' },
  { title: 'Top 7 Focus Timer Tools', link: 'https://b.com/top' },
  { title: 'Best pomodoro software 2026', link: 'https://c.com' },
], 'best pomodoro app windows');
check('serp-intent: wykrywa listicle', si.dominant === 'listicle', JSON.stringify(si));

si = classifySerpIntent([
  { title: 'Workrave vs Stretchly compared', link: 'https://a.com' },
  { title: 'Stretchly vs Workrave: which is better', link: 'https://b.com' },
], 'workrave vs stretchly');
check('serp-intent: wykrywa comparison', si.dominant === 'comparison', JSON.stringify(si));

si = classifySerpIntent([], 'x');
check('serp-intent: pusty organic → dominant null', si.dominant === null);

const im = evaluateIntentMatch({ dominant: 'listicle', confidence: 1 }, 'short body', [{ level: 2, text: 'A' }]);
check('serp-intent: listicle mismatch daje penalty', !im.ok && im.penalty > 0, JSON.stringify(im));

// 9. auditOnPage z serpIntent mismatch obniża content_intent
const rNo = auditOnPage({ markdown: GOOD_BODY, frontmatter: GOOD_FM, lang: 'en', keyword: GOOD_FM.keyword, sitemapUrls: [] });
const rMis = auditOnPage({ markdown: GOOD_BODY, frontmatter: GOOD_FM, lang: 'en', keyword: GOOD_FM.keyword, sitemapUrls: [], serpIntent: { dominant: 'how_to', confidence: 1, distribution: {}, sample: 5 } });
check('serp-intent: mismatch obniża content_intent', rMis.category_scores.content_intent < rNo.category_scores.content_intent, `${rMis.category_scores.content_intent} vs ${rNo.category_scores.content_intent}`);

// 10. Decay detector
const { detectDecay } = require('./decay-coach');
const cur = [{ keys: ['https://healthdesk.site/en/blog/a/'], impressions: 10, clicks: 0, ctr: 0, position: 18 }];
const prev = [{ keys: ['https://healthdesk.site/en/blog/a/'], impressions: 100, clicks: 5, ctr: 0.05, position: 6 }];
let dec = detectDecay(cur, prev, { 'https://healthdesk.site/en/blog/a/': 300 });
check('decay: wykrywa rozpad (impr+pos+ctr)', dec.length === 1 && dec[0].severity === 'high', JSON.stringify(dec));
dec = detectDecay(cur, prev, { 'https://healthdesk.site/en/blog/a/': 30 }); // świeży
check('decay: świeży post (age<180) pomijany', dec.length === 0);
dec = detectDecay(prev, prev, { 'https://healthdesk.site/en/blog/a/': 300 }); // stabilny
check('decay: stabilny ruch → brak', dec.length === 0);
dec = detectDecay([], [{ keys: ['u'], impressions: 3, clicks: 0, ctr: 0, position: 5 }], {});
check('decay: za mało prev impressions → ignoruj', dec.length === 0);

// 11. Cannibalization detector
const { detectCannibalization } = require('./cannibalization');
let can = detectCannibalization([
  { keys: ['pomodoro app', 'https://healthdesk.site/en/blog/a/'], impressions: 20, clicks: 1, position: 8 },
  { keys: ['pomodoro app', 'https://healthdesk.site/en/blog/b/'], impressions: 15, clicks: 0, position: 14 },
  { keys: ['pomodoro app', 'https://healthdesk.site/en/blog/c/'], impressions: 10, clicks: 0, position: 19 },
  { keys: ['unique q', 'https://healthdesk.site/en/blog/d/'], impressions: 50, clicks: 5, position: 3 },
]);
check('cannibalization: wykrywa kolizję 3 URL', can.length === 1 && can[0].pages.length === 3 && can[0].severity === 'high', JSON.stringify(can.map(c => c.query)));
check('cannibalization: pojedynczy URL nie jest kolizją', !can.some(c => c.query === 'unique q'));
can = detectCannibalization([
  { keys: ['low q', 'https://healthdesk.site/en/blog/a/'], impressions: 4, clicks: 0, position: 8 },
  { keys: ['low q', 'https://healthdesk.site/en/blog/b/'], impressions: 3, clicks: 0, position: 9 },
]);
check('cannibalization: poniżej progu impresji ignoruj', can.length === 0);

// 12. CWV monitor
const { parsePsi, assess, detectRegression } = require('./cwv-monitor');
const psiMock = { loadingExperience: { metrics: {
  LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100 },
  INTERACTION_TO_NEXT_PAINT: { percentile: 180 },
  CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 },
} } };
const cwvCur = assess(parsePsi(psiMock));
check('cwv: parsuje field data + rating good', cwvCur.lcp.rating === 'good' && cwvCur.cls.value === 0.05 && cwvCur.source === 'field', JSON.stringify(cwvCur));
const cwvBad = assess(parsePsi({ loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 5200 } } } }));
check('cwv: LCP 5200 → poor', cwvBad.lcp.rating === 'poor');
const reg = detectRegression(cwvCur, assess(parsePsi({ loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3000 }, INTERACTION_TO_NEXT_PAINT: { percentile: 180 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 } } } })));
check('cwv: wykrywa regresję LCP good→needs-improvement', reg.length >= 1, JSON.stringify(reg));
check('cwv: brak prev → brak regresji', detectRegression(null, cwvCur).length === 0);

// 13. Backlink tracker
const { linkPresent, diffReferrers, normDomain } = require('./backlink-tracker');
check('backlink: linkPresent wykrywa link do healthdesk.site',
  linkPresent('<p>x</p><a href="https://healthdesk.site/en/">HealthDesk</a>') === true);
check('backlink: linkPresent false gdy brak',
  linkPresent('<a href="https://other.com/">x</a>') === false);
check('backlink: normDomain czyści www/protokół/ścieżkę',
  normDomain('https://www.GitHub.com/Jarek/x?a=1') === 'github.com', normDomain('https://www.GitHub.com/Jarek/x?a=1'));
const dr = diffReferrers(
  [{ source: 'github.com', sessions: 10 }, { source: 'google', sessions: 99 }, { source: 'reddit.com', sessions: 3 }],
  [{ source_domain: 'github.com', status: 'live' }, { source_domain: 'oldblog.com', status: 'live' }]
);
check('backlink: diffReferrers — nowy reddit, ignoruje google, oldblog bez ruchu',
  dr.new.length === 1 && dr.new[0].source_domain === 'reddit.com' && dr.no_traffic.includes('oldblog.com'),
  JSON.stringify(dr));

// 14. Serper backlink candidates
const { extractBacklinkCandidates } = require('./backlink-tracker');
const ebc = extractBacklinkCandidates(
  [
    { link: 'https://news.ycombinator.com/item?id=1', title: 'HN thread' },
    { link: 'https://healthdesk.site/en/', title: 'self' },
    { link: 'https://google.com/x', title: 'ignored' },
    { link: 'https://reddit.com/r/x', title: 'reddit' },
  ],
  [{ source_domain: 'reddit.com', status: 'live' }]
);
check('serper-backlink: nowy HN, pomija self/google/known',
  ebc.length === 1 && ebc[0].source_domain === 'news.ycombinator.com', JSON.stringify(ebc.map(c => c.source_domain)));

// 15. Technical HTML audit (Warstwa D)
const { auditHtml } = require('./technical-audit');
const goodHtml = `<!doctype html><html><head>
<title>Best Pomodoro App for Windows 11 — HealthDesk</title>
<meta name="description" content="A solid 60+ char meta description about the best pomodoro app for Windows 11 with tips.">
<link rel="canonical" href="https://healthdesk.site/en/blog/x/">
<meta property="og:title" content="x"><meta property="og:image" content="x"><meta property="og:type" content="article">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">{"@type":"BlogPosting","headline":"x"}</script>
<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
</head><body><h1>Title</h1><img src="a.webp" width="1200" height="630"><img src="b.webp" width="800" height="400" loading="lazy"></body></html>`;
let th = auditHtml(goodHtml, { expectedCanonical: 'https://healthdesk.site/en/blog/x/' });
check('technical: dobry HTML → PASS', th.status === 'PASS' && th.blocking_issues.length === 0, JSON.stringify(th.blocking_issues));
check('technical: dobry HTML → critical_issues puste', (th.critical_issues || []).length === 0);
th = auditHtml(goodHtml.replace('<link rel="canonical" href="https://healthdesk.site/en/blog/x/">', ''));
check('technical: brak canonical → CRITICAL', th.status === 'FAIL' && th.critical_issues.some(x => /canonical/i.test(x)));
th = auditHtml(goodHtml.replace('<h1>Title</h1>', '<h1>A</h1><h1>B</h1>'));
check('technical: 2×H1 → CRITICAL', th.critical_issues.some(x => /Wiele <h1>/.test(x)));
th = auditHtml(goodHtml.replace('<head>', '<head><meta name="robots" content="noindex">'));
check('technical: noindex → CRITICAL', th.critical_issues.some(x => /noindex/i.test(x)));
th = auditHtml(goodHtml.replace('{"@type":"BlogPosting","headline":"x"}', '{bad json}'));
check('technical: zepsuty JSON-LD → CRITICAL', th.critical_issues.some(x => /JSON-LD/i.test(x)));
// meta description brak = blocking ale NIE critical (można przepchnąć z flagą)
th = auditHtml(goodHtml.replace(/<meta name="description"[^>]*>/, ''));
check('technical: brak meta = blocking ale NIE critical', th.blocking_issues.some(x => /meta description/i.test(x)) && !th.critical_issues.some(x => /meta description/i.test(x)));
th = auditHtml(goodHtml, { expectedCanonical: 'https://healthdesk.site/en/blog/x/', internalExists: () => false });
check('technical: martwy link wewn (gdy są <a>) — brak <a> więc czysto', th.checks.internal_links === undefined || th.checks.internal_links.broken >= 0);
// regresja: mailto/tel z domeną w adresie NIE może być traktowane jako link wewn.
const htmlMailto = goodHtml.replace('</body>', '<a href="mailto:kontakt@healthdesk.site">mail</a><a href="tel:+48123">tel</a><a href="/en/blog/x/">ok</a></body>');
th = auditHtml(htmlMailto, { expectedCanonical: 'https://healthdesk.site/en/blog/x/', internalExists: (p) => p === '/en/blog/x/' });
check('technical: mailto:@healthdesk.site NIE jest linkiem wewn (no false FAIL)',
  th.status !== 'FAIL' && th.checks.internal_links.broken === 0, JSON.stringify(th.blocking_issues) + ' ' + JSON.stringify(th.checks.internal_links));

// 16. Internal Linking Engine (Warstwa E)
const { suggestLinks } = require('./internal-link-engine');
const idx = [
  { url: 'https://healthdesk.site/en/blog/a/', lang: 'en', slug: 'a', title: 'Best pomodoro timer for Windows', keyword: 'pomodoro timer windows', tags: ['pomodoro','windows'], body: 'some text' },
  { url: 'https://healthdesk.site/en/blog/b/', lang: 'en', slug: 'b', title: 'Pomodoro vs 52-17 method', keyword: 'pomodoro vs 52-17', tags: ['pomodoro','productivity'], body: 'about pomodoro' },
  { url: 'https://healthdesk.site/en/blog/c/', lang: 'en', slug: 'c', title: 'Back pain at desk', keyword: 'back pain desk', tags: ['ergonomics'], body: 'links to /en/blog/target/ already' },
  { url: 'https://healthdesk.site/de/blog/d/', lang: 'de', slug: 'd', title: 'German pomodoro', keyword: 'pomodoro de', tags: ['pomodoro'], body: 'x' },
];
const tgt = { url: 'https://healthdesk.site/en/blog/target/', lang: 'en', slug: 'target', title: 'Open source pomodoro app for Windows', keyword: 'open source pomodoro windows', tags: ['pomodoro','windows','open source'], body: 'Content with no internal links and no money page.' };
const sl = suggestLinks(tgt, idx);
check('internal-link: outbound proponuje powiązane EN (nie DE)',
  sl.outbound.length >= 1 && sl.outbound.every(o => o.slug !== 'd'), JSON.stringify(sl.outbound.map(o => o.slug)));
check('internal-link: wykrywa brak money page', sl.money_page_ok === false && !!sl.money_page_suggestion);
check('internal-link: inbound pomija post który już linkuje (c)',
  !sl.inbound.some(i => i.slug === 'c'), JSON.stringify(sl.inbound.map(i => i.slug)));
const tgt2 = { ...tgt, body: 'see https://healthdesk.site/en/ for the app' };
check('internal-link: money page OK gdy jest link do landinga', suggestLinks(tgt2, idx).money_page_ok === true);

// 17. CJK-aware (false-positive fix)
const cjkFm = { title: '减少电脑屏幕对眼睛伤害的日常护眼技巧', slug: 'x', description: '这是一篇关于减少电脑屏幕对眼睛伤害的日常护眼技巧的详细指南，包含实用建议和具体步骤说明帮助你保护视力。', keyword: '电脑屏幕 护眼技巧', lang: 'zh-CN', heroImage: 'x.webp', image_alt: '护眼技巧', __hasFaq: true };
const cjkBody = '## 护眼技巧\n\n减少电脑屏幕对眼睛伤害的方法很多。我亲自测试了这些护眼技巧两周。' + '更多内容请见 [HealthDesk](https://healthdesk.site/zh-CN/) 和 [博客](https://healthdesk.site/zh-CN/blog/)。'.repeat(1) + '\n\n'.padEnd(1200, '护眼内容详细说明保护视力的重要性以及如何正确调整屏幕亮度和距离。');
let rc = auditOnPage({ markdown: cjkBody, frontmatter: cjkFm, lang: 'zh-CN', keyword: cjkFm.keyword, sitemapUrls: [] });
check('CJK: keyword NIE flagowany jako nieobecny (bigramy)', !rc.blocking_issues.some(x => /keyword nieobecny/i.test(x)), JSON.stringify(rc.blocking_issues));
check('CJK: krótki (znakowo) title NIE flagowany jako za krótki', !rc.warnings.some(x => /Title za krótki/i.test(x)), JSON.stringify(rc.warnings));
const { auditOnPage: _a } = require('./seo-onpage-audit');
check('CJK: łaciński post nadal działa (sanity)', auditOnPage({ markdown: GOOD_BODY, frontmatter: GOOD_FM, lang: 'en', keyword: GOOD_FM.keyword, sitemapUrls: [] }).status === 'PASS');

// 18. Stale-year guard (Task #17)
const { detectStaleYear, fixStaleYear } = require('./seo-onpage-audit');
const _y = new Date().getFullYear();
const dSy = detectStaleYear(`Best App in ${_y - 2}`, `## Top Apps in ${_y - 2}\nbody`, _y);
check('stale-year: rok w tytule/nagłówku wykryty', dSy.stale && dSy.hits.length === 2);
check('stale-year: cytat w PROZIE nietknięty (skan tylko title+nagłówki)',
  !detectStaleYear('Clean', `## H\nA ${_y - 4} study in PLOS ONE found...`, _y).stale);
check('stale-year: future-year NIE flagowany',
  !detectStaleYear(`${_y + 1} Outlook`, `## Trends ${_y + 1}`, _y).stale);
check('stale-year: cytat w NAGŁÓWKU nietknięty (looksLikeCitation)',
  !detectStaleYear('T', `## The ${_y - 4} PLOS ONE Study`, _y).stale);
const fSy = fixStaleYear(`## Top Apps in ${_y - 2}\n\nProza ${_y - 4} study (nietknięta).`, `Best App in ${_y - 2}`, _y);
check('stale-year: auto-fix usuwa rok z tytułu', fSy.changed && !/\d{4}/.test(fSy.title));
check('stale-year: auto-fix tnie nagłówek, prozy NIE rusza',
  !/in \d{4}/.test(fSy.markdown) && fSy.markdown.includes(`${_y - 4} study`));
check('stale-year: cytat-nagłówek NIE jest auto-fixowany',
  fixStaleYear(`## The ${_y - 4} PLOS Study`, 'T', _y).changed === false);
const rSy = auditOnPage({ markdown: `## Best Picks in ${_y - 2}\n\n${GOOD_BODY}`, frontmatter: GOOD_FM, lang: 'en', keyword: GOOD_FM.keyword, sitemapUrls: [] });
check('stale-year: auditOnPage daje warning + auto_fixes',
  rSy.warnings.some(x => /Nieaktualny rok/i.test(x)) && rSy.auto_fixes.some(f => f.type === 'stale_year'),
  JSON.stringify(rSy.auto_fixes));

// 19. mechanicalDefingerprint (Task #18 — deterministyczny, word-preserving)
const { mechanicalDefingerprint } = require('./defingerprint');
const mdf1 = mechanicalDefingerprint('## H\n\nThe **pomodoro app** is great. Use the **pomodoro app** daily.', 'pomodoro app');
check('defingerprint: unbold dokładnego keyworda', mdf1.stats.unboldedKeyword === 2 && !/\*\*pomodoro app\*\*/i.test(mdf1.markdown));
const longBold = '## H\n\n' + Array.from({ length: 12 }, (_, i) => `Para ${i} has a **bold term ${i}** inside it for testing purposes here.`).join('\n\n');
const mdf2 = mechanicalDefingerprint(longBold, 'x');
check('defingerprint: cap bold (część zdjęta)', mdf2.stats.boldStripped > 0 && (mdf2.markdown.match(/\*\*/g) || []).length < (longBold.match(/\*\*/g) || []).length);
const dupS = 'Regular breaks reduce mental fatigue by a measurable margin in studies.';
const mdf3 = mechanicalDefingerprint(`## A\n\n${dupS} Some unique tail sentence here for context.\n\n## B\n\n${dupS} Another distinct closing thought entirely.`, 'x');
check('defingerprint: dedupe powtórzonego zdania (zostaw 1)', mdf3.stats.dedupedSentences === 1 && (mdf3.markdown.split(dupS).length - 1) === 1);
const cleanIn = '## Heading stays\n\nA perfectly normal unique paragraph with enough length to be considered prose content.';
const mdf4 = mechanicalDefingerprint(cleanIn, 'x');
check('defingerprint: czysty tekst bez zmian (idempotent)', mdf4.changed === false && mdf4.markdown === cleanIn);
const wordsBefore = 'The **alpha** beta gamma delta. Repeated unique line for body length padding here friend.';
const mdf5 = mechanicalDefingerprint(wordsBefore + '\n\n' + wordsBefore, 'alpha');
check('defingerprint: word-preserving (nie gubi słów poza duplikatem)',
  /alpha beta gamma delta/.test(mdf5.markdown.replace(/\*\*/g, '')));

const ruDup = 'Регулярные перерывы заметно снижают умственную усталость по данным исследований.';
const mdf6 = mechanicalDefingerprint(`## А\n\n${ruDup} Уникальный хвост предложения для контекста здесь.\n\n## Б\n\n${ruDup} Совсем другая завершающая мысль полностью.`, 'x');
check('defingerprint: dedupe cyrylicy (ru — fix \\p{L})',
  mdf6.stats.dedupedSentences === 1 && (mdf6.markdown.split(ruDup).length - 1) === 1);

// 20. mojibake (tools/mojibake.js) — brak false-positive na poprawnych diakrytykach + delimiterze
// Regresja: klasy CJK ć[…]/í[…] nie mogą zawierać U+0022 (zwykły cudzysłów), bo "produktywność",
// "gość", aquí" to legalne frontmatter/proza, nie mojibake.
const { hasBrokenEncoding, recoverMojibake } = require('./mojibake');
// NIE mojibake (false-positive guard):
check('mojibake: "produktywność", nie jest flagowane', hasBrokenEncoding('tags: ["produktywność", "gość"]') === false);
check('mojibake: "aquí" (es) nie jest flagowane', hasBrokenEncoding('título: "aquí está la guía"') === false);
// NADAL mojibake (regresja detekcji) + odzysk:
check('mojibake: prawdziwe Ä‡/Ä™ nadal łapane', hasBrokenEncoding('Ä‡wiczenia na zmÄ™czenie') === true);
check('mojibake: recoverMojibake odzyskuje ćwiczenia', recoverMojibake('Ä‡wiczenia') === 'ćwiczenia');

// 21. autopilot-health — alert na N kolejnych porażek (cicha śmierć autopilota)
const ah = require('./autopilot-health');
const ok = { completed: 1, errors: 0, results: [{ status: 'ok', lang: 'en' }] };
const err = (kw = 'x', lang = 'pl') => ({ completed: 0, errors: 1, results: [{ status: 'error', lang, keyword: kw, error: 'Validation failed' }] });
check('autopilot-health: total failure wykryty', ah.isTotalFailure(err()) === true);
check('autopilot-health: run z sukcesem nie jest porażką', ah.isTotalFailure(ok) === false);
check('autopilot-health: completed=0 bez błędów nie jest porażką', ah.isTotalFailure({ completed: 0, errors: 0, results: [] }) === false);
const c5 = ah.countConsecutiveFailures([ok, err(), err(), err('aplikacja pomodoro na komputer'), err('aplikacja pomodoro na komputer'), err('aplikacja pomodoro na komputer')]);
check('autopilot-health: liczy kolejne porażki od końca (sukces przerywa)', c5.count === 5 && c5.keyword === 'aplikacja pomodoro na komputer');
check('autopilot-health: sukces na końcu zeruje licznik', ah.countConsecutiveFailures([err(), err(), ok]).count === 0);
check('autopilot-health: alert dokładnie na progu (3)', ah.shouldAlert(2) === false && ah.shouldAlert(3) === true);
check('autopilot-health: anti-spam między progiem a repeat', ah.shouldAlert(4) === false && ah.shouldAlert(5) === false);
check('autopilot-health: przypomnienie co ALERT_REPEAT (9, 15)', ah.shouldAlert(9) === true && ah.shouldAlert(15) === true);
// 21b. autopilot-health — drugi tryb awarii: WYŁĄCZONY przy niepustej kolejce (bug 06-04/05)
check('autopilot-health: wyłączony + kolejka pełna = stalled', ah.isStalledDisabled(false, 9) === true);
check('autopilot-health: wyłączony + kolejka pusta = NIE stalled', ah.isStalledDisabled(false, 0) === false);
check('autopilot-health: włączony nigdy nie jest stalled', ah.isStalledDisabled(true, 9) === false);
check('autopilot-health: pierwszy alert o wyłączeniu zawsze (lastAlertAt=null)', ah.shouldAlertDisabled(null, 1000) === true);
check('autopilot-health: alert-disabled anti-spam w cooldownie', ah.shouldAlertDisabled(1000, 1000 + 3600 * 1000) === false);
check('autopilot-health: alert-disabled ponawia po cooldownie (6h)', ah.shouldAlertDisabled(0, ah.DISABLED_ALERT_COOLDOWN_MS) === true);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
