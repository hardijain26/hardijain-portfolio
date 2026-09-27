// Draws a 1200x630 share image for every page in seo/pages.json except the
// homepage (which keeps og-image.png) and saves it to og/<slug>.png.
// build-seo.mjs then points each page's og:image at its own file, so a story
// shared on LinkedIn shows that story's title instead of the homepage card.
//
// Run after adding or renaming a page:
//   node scripts/make-og.mjs && node scripts/build-seo.mjs
// Needs Playwright:  npm i -D playwright && npx playwright install chromium

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'seo/pages.json'), 'utf8'));
const OUT = path.join(ROOT, 'og');
fs.mkdirSync(OUT, { recursive: true });
const slug = (p) => (p === '/' ? 'home' : p.slice(1).replace(/\//g, '__'));
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const LABEL = { B2C: 'B2C case study', B2B: 'B2B SaaS case study', Enterprise: 'Enterprise SaaS case study', Automation: 'Automation case study', 'Personal project': 'Personal build' };

function card(page) {
  const title = page.title.replace(/ \| Hardi Jain$/, '');
  const label = LABEL[page.section] || (page.type === 'CollectionPage' ? 'Case studies' : 'Portfolio');
  const size = title.length > 40 ? 70 : 84;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;width:1200px;height:630px;background:#F7F1E3;color:#3B2C24;font-family:Georgia,'Times New Roman',serif;position:relative;overflow:hidden}
  .wrap{position:absolute;inset:72px 84px;display:flex;flex-direction:column}
  .label{font:600 24px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#B84A0B}
  h1{font-weight:700;font-size:${size}px;line-height:1.04;margin:44px 0 0;max-width:800px;text-wrap:balance}
  .foot{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;font:500 26px/1.2 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#6E5C50}
  .foot b{color:#3B2C24;font-weight:700}
  .dots{position:absolute;right:84px;top:66px;width:190px;height:110px}
  </style></head><body>
  <svg class="dots" viewBox="0 0 190 110" aria-hidden="true">
    <polyline points="10,80 50,30 95,62 140,20" fill="none" stroke="#E0580F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="10" cy="80" r="8" fill="#3B2C24"/><circle cx="50" cy="30" r="8" fill="#3B2C24"/>
    <circle cx="95" cy="62" r="8" fill="#3B2C24"/><circle cx="140" cy="20" r="8" fill="#3B2C24"/>
    <circle cx="180" cy="92" r="8" fill="none" stroke="#E0580F" stroke-width="3" stroke-dasharray="4 5"/>
  </svg>
  <div class="wrap">
    <div class="label">${esc(label)}</div>
    <h1>${esc(title)}</h1>
    <div class="foot"><span><b>Hardi Jain</b> · SaaS product manager · Chartered Accountant</span><span>hardijain.com</span></div>
  </div></body></html>`;
}

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const page of cfg.pages) {
  if (page.path === '/') continue;
  await tab.setContent(card(page));
  const file = path.join(OUT, slug(page.path) + '.png');
  await tab.screenshot({ path: file });
  console.log('drew', path.relative(ROOT, file));
}
await browser.close();
