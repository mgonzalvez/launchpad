#!/usr/bin/env node
/**
 * Add a new project to data/content.json safely.
 * Usage:
 *   node scripts/add-project.js \
 *     --title "Project Name" \
 *     --designer "Designer Name" \
 *     --publisher "Publisher Name" \
 *     --platform Kickstarter \
 *     --launchDate 2026-06-01 \
 *     --endDate 2026-07-01 \
 *     --image /uploads/project-name.jpg \
 *     --summary "Short description" \
 *     --primaryUrl https://kickstarter.com/... \
 *     --promoDetails "Optional promo details"
 *
 * All fields except --summary and --promoDetails are required.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'content.json');

// --- Parse args ---
const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i++;
    } else {
      opts[key] = true;
    }
  }
}

// --- Required fields ---
const required = ['title', 'designer', 'publisher', 'platform', 'launchDate', 'endDate', 'image', 'primaryUrl'];
const missing = required.filter(f => !opts[f]);
if (missing.length) {
  console.error(`Missing required fields: ${missing.join(', ')}`);
  console.error('\nUsage: node scripts/add-project.js --title "..." --designer "..." --publisher "..." --platform Kickstarter --launchDate YYYY-MM-DD --endDate YYYY-MM-DD --image /uploads/file.jpg --primaryUrl https://...');
  process.exit(1);
}

// --- Load data ---
let data;
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) {
  console.error(`Cannot read ${DATA_FILE}: ${e.message}`);
  process.exit(1);
}

// --- Generate slug ---
const slug = opts.title.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

// --- Check for duplicate slug ---
if (data.projects.some(p => p.slug === slug)) {
  console.error(`ERROR: A project with slug "${slug}" already exists.`);
  process.exit(1);
}

// --- Validate image ---
if (opts.image.startsWith('/uploads/')) {
  const fileName = opts.image.replace('/uploads/', '');
  if (!fs.existsSync(path.join(ROOT, 'uploads', fileName))) {
    console.error(`ERROR: Image file not found: ${opts.image}`);
    process.exit(1);
  }
} else if (!opts.image.startsWith('http')) {
  console.error(`ERROR: Image must be a URL (http...) or /uploads/ path.`);
  process.exit(1);
}

// --- Validate dates ---
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
if (!dateRegex.test(opts.launchDate)) {
  console.error(`ERROR: launchDate must be YYYY-MM-DD format.`);
  process.exit(1);
}
if (!dateRegex.test(opts.endDate)) {
  console.error(`ERROR: endDate must be YYYY-MM-DD format.`);
  process.exit(1);
}
if (opts.endDate < opts.launchDate) {
  console.error(`ERROR: endDate cannot be before launchDate.`);
  process.exit(1);
}

// --- Validate platform ---
const validPlatforms = ['Kickstarter', 'Indiegogo', 'Store', 'Patreon', 'Other'];
if (!validPlatforms.includes(opts.platform)) {
  console.error(`ERROR: Unknown platform "${opts.platform}". Valid: ${validPlatforms.join(', ')}`);
  process.exit(1);
}

// --- Build project entry ---
const project = {
  slug,
  title: opts.title,
  summary: opts.summary || '',
  image: opts.image,
  platform: opts.platform,
  launchDate: opts.launchDate,
  endDate: opts.endDate,
  primaryUrl: opts.primaryUrl,
  designer: opts.designer,
  publisher: opts.publisher,
  promoDetails: opts.promoDetails || ''
};

// --- Add to array (newest first) ---
data.projects.unshift(project);

// --- Write back ---
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n');

console.log(`✅ Added "${opts.title}" (slug: ${slug}) to content.json`);
console.log(`   Position: 1 of ${data.projects.length} projects`);
console.log(`   Run 'node scripts/validate-content.js' to verify.`);
