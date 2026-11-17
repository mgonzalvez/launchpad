#!/usr/bin/env node
/**
 * add-meta-tags.js — UI improvement plan, Stage 7 (SEO / meta).
 *
 * Inserts a consistent meta block (description, Open Graph, theme-color,
 * canonical URL) into every page's <head>. Idempotent: pages that already
 * carry og:title are skipped.
 *
 * Usage:
 *   node scripts/add-meta-tags.js            # main pages + blog index + posts
 *   node scripts/add-meta-tags.js --posts    # only blog posts
 *   node scripts/add-meta-tags.js --dry-run  # report without writing
 *
 * New blog posts should follow docs/blog-workflow.md, which now includes the
 * meta block in the HTML template; running this script afterwards is a safety
 * net for anything written by hand.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://launchpad.gonzhome.us';
const OG_IMAGE = `${SITE}/uploads/og-launchpad.jpg`;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyPosts = args.includes('--posts');
const force = args.includes('--force');

const descriptions = {
  'index.html': 'Weekly curated digest of paid print-and-play board game crowdfunding campaigns, promos, late pledges and previews.',
  'live.html': 'Every print-and-play crowdfunding campaign live right now on the PnP Launchpad, sorted by end date.',
  'upcoming.html': 'Print-and-play projects with announced launch dates — what is coming to Kickstarter, Gamefound and Itch.io next.',
  'preview.html': 'Print-and-play projects in preview: announced but not yet launched, with dates still to be confirmed.',
  'archive.html': 'Ended print-and-play campaigns, late pledges and pre-orders, sortable by end date, platform or priority.',
  'watchlist.html': 'Your saved PnP Launchpad projects — a private watchlist kept in your own browser.',
  'designer.html': 'Designer profile: every print-and-play project on the PnP Launchpad from this designer.',
  'publisher.html': 'Publisher profile: every print-and-play project on the PnP Launchpad from this publisher.',
  'submit.html': 'Submit a print-and-play crowdfunding project, promo or late pledge for review by the PnP Launchpad team.',
  'blog/index.html': 'The PnP Launchpad blog — weekly roundups, launch alerts and curated print-and-play commentary.',
};

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstParagraph(html) {
  const body = html.match(/<div class="blog-post-body">([\s\S]*?)<\/div>/);
  const source = body ? body[1] : html;
  const paragraphs = source.match(/<p\b[^>]*>([\s\S]*?)<\/p>/g) || [];
  for (const p of paragraphs) {
    const text = stripTags(p);
    if (text.length > 40 && !/^Published:/i.test(text) && !/^Back to Blog/i.test(text)) {
      return text;
    }
  }
  return '';
}

function coverImage(html) {
  const img = html.match(/<img class="blog-cover" src="([^"]+)"/);
  if (!img) return null;
  const src = img[1].split('?')[0];
  if (src.startsWith('http')) return src;
  const name = path.basename(src);
  return src.includes('uploads') ? `${SITE}/uploads/${name}` : `${SITE}/blog/${name}`;
}

function buildBlock(file, html) {
  const isBlog = file.startsWith('blog/');
  const urlPath = isBlog ? `/blog/${path.basename(file)}` : `/${file}`;
  const canonical = isBlog ? `${SITE}${urlPath}` : `${SITE}${urlPath}`;
  const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || 'PnP Launchpad';

  let description = descriptions[file];
  if (!description) {
    const derived = firstParagraph(html);
    if (derived) {
      if (derived.length > 160) {
        const cut = derived.slice(0, 160);
        description = `${cut.slice(0, cut.lastIndexOf(' ')).trim()}…`;
      } else {
        description = derived;
      }
    } else {
      description = 'Curated print-and-play board game projects, crowdfunding campaigns and promos.';
    }
  }

  const image = (isBlog && coverImage(html)) || OG_IMAGE;

  return [
    `    <meta name="description" content="${description.replace(/"/g, '&quot;')}" />`,
    `    <meta property="og:title" content="${title.replace(/"/g, '&quot;')}" />`,
    `    <meta property="og:description" content="${description.replace(/"/g, '&quot;')}" />`,
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:url" content="${canonical}" />`,
    `    <meta property="og:image" content="${image}" />`,
    `    <meta name="theme-color" content="#f4f7fb" media="(prefers-color-scheme: light)" />`,
    `    <meta name="theme-color" content="#090b10" media="(prefers-color-scheme: dark)" />`,
    `    <link rel="canonical" href="${canonical}" />`,
  ].join('\n');
}

function processPage(file) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) return;
  const html = fs.readFileSync(abs, 'utf8');
  if (html.includes('og:title') && !force) {
    console.log(`skip     ${file} (meta already present)`);
    return;
  }
  const viewport = html.match(/\s*<meta name="viewport"[^>]*\/>/);
  if (!viewport) {
    console.log(`skip     ${file} (no viewport meta to anchor to)`);
    return;
  }
  const block = buildBlock(file, html);
  let base = html;
  if (force) {
    // Remove the previously inserted contiguous block (description … canonical).
    base = base.replace(/\n\s*<meta name="description"[\s\S]*?<link rel="canonical"[^>]*\/>/, '');
  } else {
    base = base.replace(/\n\s*<meta name="description"[^>]*\/>/, '');
  }
  const updated = base.replace(viewport[0], `${viewport[0]}\n${block}`);
  if (dryRun) {
    console.log(`would add to ${file}: ${block.split('\n').length - 1} tags`);
    return;
  }
  fs.writeFileSync(abs, updated);
  console.log(`updated  ${file}`);
}

const mainPages = [
  'index.html', 'live.html', 'upcoming.html', 'preview.html', 'archive.html',
  'watchlist.html', 'designer.html', 'publisher.html', 'submit.html', 'blog/index.html',
];

const targets = onlyPosts
  ? fs.readdirSync(path.join(ROOT, 'blog')).filter((f) => f.endsWith('.html') && f !== 'index.html').map((f) => `blog/${f}`)
  : mainPages;

targets.forEach(processPage);
