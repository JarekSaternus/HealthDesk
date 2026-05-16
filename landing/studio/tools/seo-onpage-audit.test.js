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

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
