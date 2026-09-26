// Writes one static HTML file per page from index.html + seo/pages.json, so each
// URL ships its own title, description, canonical, structured data and readable
// text before any JavaScript runs. Also refreshes the SEO map inside index.html
// and regenerates sitemap.xml.
//
// Run:  node scripts/build-seo.mjs   (no dependencies)
// Output: index.html (home), <path>.html for every other page. vercel.json has
// cleanUrls on, so /product-stories/x is served from product-stories/x.html.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'seo/pages.json'), 'utf8'));
const SITE = cfg.site;
const P = cfg.person;
// Dates come from seo/pages.json (published / updated), so a rebuild doesn't mark every page as changed.
const updated = (p) => p.updated || p.published;
const slug = (p) => (p === '/' ? 'home' : p.slice(1).replace(/\//g, '__'));
const url = (p) => SITE + p;
const attr = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const byPath = Object.fromEntries(cfg.pages.map((p) => [p.path, p]));
// Share image: og/<slug>.png when scripts/make-og.mjs has drawn one, else the homepage card.
const ogImage = (p) => (fs.existsSync(path.join(ROOT, 'og', slug(p.path) + '.png')) ? `${SITE}/og/${slug(p.path)}.png` : `${SITE}/og-image.png`);

// 1. SEO map used by the app when it changes pages in the browser.
let tpl = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const seoMap = Object.fromEntries(cfg.pages.map((p) => [p.path, { title: p.title, description: p.description }]));
tpl = tpl.replace(/\/\*SEO:start\*\/[\s\S]*?\/\*SEO:end\*\//, `/*SEO:start*/var SEO=${JSON.stringify(seoMap)};/*SEO:end*/`);
// Always build from a clean template: empty crawler slot.
tpl = tpl.replace(/<!--SSR:start-->[\s\S]*?<!--SSR:end-->/, '<!--SSR:start--><!--SSR:end-->');

// 2. Structured data.
const person = {
  '@type': 'Person',
  '@id': `${SITE}/#person`,
  name: P.name,
  jobTitle: P.jobTitle,
  description: P.description,
  url: SITE + '/',
  image: `${SITE}/og-image.png`,
  sameAs: P.sameAs,
  knowsAbout: P.knowsAbout,
  hasCredential: { '@type': 'EducationalOccupationalCredential', name: P.credential, credentialCategory: 'Professional qualification' },
  alumniOf: P.alumniOf.map((name) => ({ '@type': 'Organization', name })),
};
const website = { '@type': 'WebSite', '@id': `${SITE}/#website`, name: 'Hardi Jain, SaaS Product Manager', url: SITE + '/', inLanguage: 'en', publisher: { '@id': `${SITE}/#person` } };

function crumbs(page) {
  const chain = [];
  for (let p = page; p; p = p.parent ? byPath[p.parent] : p.path !== '/' ? byPath['/'] : null) chain.unshift(p);
  return {
    '@type': 'BreadcrumbList',
    itemListElement: chain.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.nav, item: url(p.path) })),
  };
}

function jsonld(page) {
  const graph = [website, person];
  const node = { '@type': page.type, '@id': url(page.path) + '#page', url: url(page.path), name: page.title, description: page.description, isPartOf: { '@id': `${SITE}/#website` }, inLanguage: 'en' };
  if (page.type === 'ProfilePage') node.mainEntity = { '@id': `${SITE}/#person` };
  if (page.type === 'Article') {
    Object.assign(node, { headline: page.title.replace(/ \| Hardi Jain$/, ''), author: { '@id': `${SITE}/#person` }, articleSection: page.section, image: ogImage(page), datePublished: page.published, dateModified: updated(page) });
  }
  graph.push(node);
  if (page.path !== '/') graph.push(crumbs(page));
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 1)}</script>`;
}

// 3. Crawler-readable copy (hidden once the app boots).
const navList = cfg.pages.map((p) => `<li><a href="${p.path}">${p.nav}</a></li>`).join('');
function ssr(page) {
  const f = path.join(ROOT, 'seo/content', slug(page.path) + '.html');
  const body = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
  return `<!--SSR:start--><div id="ssr"><p><a href="/">Hardi Jain</a> · SaaS product manager · B2C, B2B and AI · Chartered Accountant</p>${body ? `<main>${body}</main>` : ''}<nav aria-label="Site"><ul>${navList}</ul></nav></div><!--SSR:end-->`;
}

// 4. Head tags per page.
function render(page) {
  const t = attr(page.title), d = attr(page.description), u = url(page.path);
  const robots = page.noindex ? 'noindex, follow' : 'index, follow, max-snippet:-1, max-image-preview:large';
  let html = tpl;
  if (page.path !== '/') {
    // Inner pages keep the landing view for in-app navigation, but not its H1 or the
    // homepage summary, so each URL has one H1 and no copy of the homepage text.
    html = html
      .replace(/(<div class="blk c-title">\s*)<h1>([\s\S]*?)<\/h1>/, '$1<p class="hero-h">$2</p>')
      .replace(/\n\s*<section class="sr" aria-label="About this portfolio">[\s\S]*?<\/section>/, '');
  }
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${d}">`)
    .replace(/<meta name="robots" content="[^"]*">/, `<meta name="robots" content="${robots}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${u}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${u}">`)
    .replace(/<meta property="og:type" content="[^"]*">/, `<meta property="og:type" content="${page.type === 'Article' ? 'article' : page.type === 'ProfilePage' ? 'profile' : 'website'}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${t}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${d}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${t}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${d}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${ogImage(page)}">`)
    .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${ogImage(page)}">`)
    .replace(/<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${page.path === '/' ? 'Hardi Jain, Product Manager, with a five-dot constellation and a sixth dot not yet joined' : t}">`)
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, jsonld(page))
    .replace(/<!--SSR:start--><!--SSR:end-->/, ssr(page));
}

for (const page of cfg.pages) {
  const out = page.path === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, page.path.slice(1) + '.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, render(page));
  console.log('wrote', path.relative(ROOT, out));
}

// 5. Journey chapters (/journey/*, rewritten to journey.html in vercel.json): noindex, no canonical,
//    no structured data. The app sets the chapter's own title once it loads.
const journey = render({ ...byPath['/map'], noindex: true })
  .replace(/\n<link rel="canonical" href="[^"]*">/, '')
  .replace(/\n<meta property="og:url" content="[^"]*">/, '')
  .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/, '')
  .replace(/<!--SSR:start-->[\s\S]*?<!--SSR:end-->/, `<!--SSR:start--><div id="ssr"><nav aria-label="Site"><ul>${navList}</ul></nav></div><!--SSR:end-->`);
fs.writeFileSync(path.join(ROOT, 'journey.html'), journey);
console.log('wrote journey.html');

// 6. Sitemap: indexable pages only.
const sm = cfg.pages.filter((p) => !p.noindex).map((p) => `  <url>\n    <loc>${url(p.path)}</loc>\n    <lastmod>${updated(p)}</lastmod>\n  </url>`).join('\n');
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sm}\n</urlset>\n`);
console.log('wrote sitemap.xml');
