// Renders each page in seo/pages.json with a headless browser and saves its
// readable text (headings, paragraphs, lists) to seo/content/<slug>.html.
// build-seo.mjs puts that text into the static HTML so crawlers that don't run
// JavaScript (Bing, LinkedIn previews, AI search bots) still read the story.
//
// Run after editing any story:  node scripts/extract-content.mjs && node scripts/build-seo.mjs
// Needs Playwright:             npm i -D playwright && npx playwright install chromium

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'seo/pages.json'), 'utf8'));
const OUT = path.join(ROOT, 'seo/content');
fs.mkdirSync(OUT, { recursive: true });

// Serve the source index.html for every path, like the vercel.json rewrite.
const html = fs.readFileSync(path.join(ROOT, 'index.html'));
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (req.url !== '/' && fs.existsSync(file) && fs.statSync(file).isFile() && !file.endsWith('.html')) {
    res.end(fs.readFileSync(file));
  } else {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const slug = (p) => (p === '/' ? 'home' : p.slice(1).replace(/\//g, '__'));

const browser = await chromium.launch();
for (const page of cfg.pages) {
  if (page.path === '/') continue; // home uses the summary already in index.html
  const tab = await browser.newPage({ reducedMotion: 'reduce' });
  await tab.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await tab.goto(base + page.path);
  await tab.waitForTimeout(1500);
  const body = await tab.evaluate(() => {
    const view = document.querySelector('.view.on');
    if (!view) return '';
    // Closed <details> hide their text from innerText; open them so the principles are captured.
    view.querySelectorAll('details').forEach((d) => { d.open = true; });
    const skip = (el) => el.closest('svg, .sbar, .st-viz, .pc-viz, button, .back, .st-cta, .tags, .more, .pc-go, .hint2');
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // A block's own text can carry a real <a href> (the map's chapter links, say). Keep those
    // links instead of the plain innerText, which silently drops every href it finds.
    const inline = (node) => {
      let s = '';
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) { s += esc(n.textContent); return; }
        if (n.nodeType !== 1) return;
        if (n.getAttribute('aria-hidden') === 'true') return;
        if (n.tagName === 'A' && n.getAttribute('href')) s += `<a href="${n.getAttribute('href')}">${inline(n)}</a>`;
        else s += inline(n);
      });
      return s;
    };
    const out = [];
    let list = false;
    for (const el of view.querySelectorAll('h1, h2, h3, h4, summary, p, li')) {
      if (skip(el)) continue;
      if (el.tagName === 'P' && el.closest('li')) continue;
      const text = el.innerText.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      let tag = el.tagName.toLowerCase();
      if (tag === 'summary') tag = 'h4';
      if (tag === 'li' && !list) { out.push('<ul>'); list = true; }
      if (tag !== 'li' && list) { out.push('</ul>'); list = false; }
      // Card titles on the hub link to their story.
      const card = el.closest('.pc');
      const go = card && tag === 'h4' && card.querySelector('a[data-p]');
      const body = inline(el).replace(/\s+/g, ' ').trim();
      const outTag = tag === 'h4' ? 'h3' : tag;
      out.push(go ? `<h3><a href="${go.getAttribute('href')}">${esc(text)}</a></h3>` : `<${outTag}>${body}</${outTag}>`);
    }
    if (list) out.push('</ul>');
    // Contextual CTAs (Next story, All product stories, Back to: <sibling>) are real
    // <a href> links the app renders, but they sit in .st-cta divs with no h1-4/p/li
    // wrapper, so the loop above never sees them. Capture them explicitly so sibling
    // and cluster links survive into the static, crawlable HTML.
    for (const a of view.querySelectorAll('.st-cta a[href]')) {
      const href = a.getAttribute('href');
      const clone = a.cloneNode(true);
      clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      const text = clone.textContent.replace(/\s+/g, ' ').trim();
      if (href && text) out.push(`<p><a href="${href}">${esc(text)}</a></p>`);
    }
    return out.join('\n');
  });
  fs.writeFileSync(path.join(OUT, slug(page.path) + '.html'), body + '\n');
  console.log('extracted', page.path, body.length, 'chars');
  await tab.close();
}
await browser.close();
server.close();
