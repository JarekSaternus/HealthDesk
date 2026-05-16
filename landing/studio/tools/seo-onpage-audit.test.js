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

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
