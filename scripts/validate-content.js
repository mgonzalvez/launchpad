#!/usr/bin/env node
/**
 * Validates data/content.json for structural integrity.
 * Run: node scripts/validate-content.js
 * Exit code 0 = valid, 1 = errors found.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'content.json');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

const errors = [];
const warnings = [];

// --- Load data ---
let data;
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) {
  console.error(`FATAL: Cannot parse ${DATA_FILE}: ${e.message}`);
  process.exit(1);
}

// --- Required top-level keys ---
for (const key of ['projects', 'designers', 'publishers']) {
  if (!Array.isArray(data[key])) {
    errors.push(`Missing or invalid top-level array: "${key}"`);
  }
}
if (errors.length) {
  errors.forEach(e => console.error(`ERROR: ${e}`));
  process.exit(1);
}

// --- Validate projects ---
const slugs = new Set();
const validPlatforms = ['Kickstarter', 'Gamefound', 'Itch.io', 'Crowdfunding', 'Store', 'Promo', 'Backerkit', 'Indiegogo', 'Patreon', 'Other'];

data.projects.forEach((p, i) => {
  const prefix = `projects[${i}] (${p.slug || '<missing slug>'})`;

  // Slug
  if (!p.slug || typeof p.slug !== 'string') {
    errors.push(`${prefix}: missing or invalid "slug"`);
    return; // skip further checks if no slug
  }

  // Duplicate slug
  if (slugs.has(p.slug)) {
    errors.push(`${prefix}: duplicate slug "${p.slug}"`);
  }
  slugs.add(p.slug);

  // Required fields
  const requiredFields = ['title', 'platform', 'primaryUrl'];
  if (!p.isPreview) requiredFields.push('image');
  for (const field of requiredFields) {
    if (!p[field] || typeof p[field] !== 'string' || !p[field].trim()) {
      errors.push(`${prefix}: missing or empty required field "${field}"`);
    }
  }



  // Platform validation
  if (p.platform && !validPlatforms.includes(p.platform)) {
    warnings.push(`${prefix}: unknown platform "${p.platform}"`);
  }

  // Image validation
  if (p.image) {
    if (p.image.startsWith('/uploads/')) {
      const fileName = p.image.replace('/uploads/', '');
      if (!fs.existsSync(path.join(UPLOADS_DIR, fileName))) {
        errors.push(`${prefix}: image file missing: ${p.image}`);
      }
    } else if (!p.image.startsWith('http')) {
      errors.push(`${prefix}: image "${p.image}" is not a valid URL or /uploads/ path`);
    }
  }

  // Date validation
  if (p.launchDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.launchDate)) {
      errors.push(`${prefix}: invalid launchDate format "${p.launchDate}" (expected YYYY-MM-DD)`);
    }
  }
  if (p.endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.endDate)) {
      errors.push(`${prefix}: invalid endDate format "${p.endDate}" (expected YYYY-MM-DD)`);
    }
    if (p.launchDate && p.endDate && p.endDate < p.launchDate) {
      errors.push(`${prefix}: endDate "${p.endDate}" is before launchDate "${p.launchDate}"`);
    }
  }

  // Designer/publisher validation
  const designerNames = (p.designers || [p.designer]).filter(Boolean);
  if (designerNames.length > 0) {
    const designerSlugs = data.designers.map(d => d.slug);
    for (const name of designerNames) {
      if (!designerSlugs.some(s => s.toLowerCase() === name.toLowerCase())) {
        warnings.push(`${prefix}: designer "${name}" not found in designers array`);
      }
    }
  }

  if (p.publisher) {
    const publisherSlugs = data.publishers.map(pu => pu.slug);
    if (!publisherSlugs.some(s => s.toLowerCase() === p.publisher.toLowerCase())) {
      warnings.push(`${prefix}: publisher "${p.publisher}" not found in publishers array`);
    }
  }

  // Pre-order consistency
  if (p.isPreOrder && !p.preOrderUrl) {
    warnings.push(`${prefix}: isPreOrder is true but no preOrderUrl`);
  }
  if (p.preOrderUrl && !p.isPreOrder) {
    warnings.push(`${prefix}: has preOrderUrl but isPreOrder is not set`);
  }
});

// --- Validate designers ---
const designerSlugs = new Set();
data.designers.forEach((d, i) => {
  const prefix = `designers[${i}] (${d.slug || '<missing slug>'})`;
  if (!d.slug || typeof d.slug !== 'string') {
    errors.push(`${prefix}: missing or invalid "slug"`);
  } else if (designerSlugs.has(d.slug)) {
    errors.push(`${prefix}: duplicate slug "${d.slug}"`);
  } else {
    designerSlugs.add(d.slug);
  }
  if (!d.name || typeof d.name !== 'string') {
    errors.push(`${prefix}: missing or invalid "name"`);
  }
});

// --- Validate publishers ---
const publisherSlugs = new Set();
data.publishers.forEach((p, i) => {
  const prefix = `publishers[${i}] (${p.slug || '<missing slug>'})`;
  if (!p.slug || typeof p.slug !== 'string') {
    errors.push(`${prefix}: missing or invalid "slug"`);
  } else if (publisherSlugs.has(p.slug)) {
    errors.push(`${prefix}: duplicate slug "${p.slug}"`);
  } else {
    publisherSlugs.add(p.slug);
  }
  if (!p.name || typeof p.name !== 'string') {
    errors.push(`${prefix}: missing or invalid "name"`);
  }
});

// --- Report ---
console.log(`\nValidating ${data.projects.length} projects, ${data.designers.length} designers, ${data.publishers.length} publishers...`);

if (errors.length) {
  console.error(`\n❌ ${errors.length} error(s):`);
  errors.forEach(e => console.error(`  - ${e}`));
}

if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} warning(s):`);
  warnings.forEach(w => console.log(`  - ${w}`));
}

if (errors.length === 0) {
  console.log('\n✅ content.json is valid.');
  process.exit(0);
} else {
  console.log(`\n❌ Validation failed. Fix errors before committing.`);
  process.exit(1);
}
