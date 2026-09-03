'use strict';

// Phase C public artifact builder. Its input must be the allow-listed rows
// returned by list_promotion_public_export_candidates(), never raw tables.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PUBLIC_FIELDS = Object.freeze([
  'content_id', 'revision_id', 'content_type', 'slug', 'title', 'summary',
  'public_body', 'external_url', 'byline', 'related_organization',
  'hero_image_url', 'public_media', 'requested_publish_date'
]);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const checksum = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const nonEmpty = (value, name) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`); };

function buildCandidate(rows, generatedAt) {
  if (!Array.isArray(rows)) throw new Error('Export rows must be an array.');
  const seenContent = new Set(); const seenRevision = new Set(); const seenSlug = new Set();
  const entries = rows.map(row => {
    const entry = Object.fromEntries(PUBLIC_FIELDS.filter(field => row[field] !== undefined && row[field] !== null).map(field => [field, row[field]]));
    nonEmpty(entry.content_id, 'content_id'); nonEmpty(entry.revision_id, 'revision_id'); nonEmpty(entry.slug, 'slug'); nonEmpty(entry.title, 'title');
    if (seenContent.has(entry.content_id) || seenRevision.has(entry.revision_id) || seenSlug.has(entry.slug)) throw new Error('Public export contains a duplicate content, revision, or slug.');
    if (entry.public_media !== undefined && !Array.isArray(entry.public_media)) throw new Error('public_media must be an array.');
    seenContent.add(entry.content_id); seenRevision.add(entry.revision_id); seenSlug.add(entry.slug); return entry;
  }).sort((a, b) => a.slug.localeCompare(b.slug) || a.content_id.localeCompare(b.content_id));
  const artifact = { schema_version: 1, generated_at: generatedAt, entries };
  return { ...artifact, checksum: checksum(artifact) };
}

function validateCandidate(candidate) {
  if (!candidate || candidate.schema_version !== 1 || !Array.isArray(candidate.entries)) throw new Error('Invalid public artifact schema.');
  const expected = checksum({ schema_version: candidate.schema_version, generated_at: candidate.generated_at, entries: candidate.entries });
  if (candidate.checksum !== expected) throw new Error('Public artifact checksum mismatch.');
  candidate.entries.forEach(entry => Object.keys(entry).forEach(key => { if (!PUBLIC_FIELDS.includes(key)) throw new Error(`Non-public field in artifact: ${key}`); }));
  return true;
}

async function writeCandidate(rows, outputPath, generatedAt = new Date().toISOString()) {
  const candidate = buildCandidate(rows, generatedAt); validateCandidate(candidate);
  const staged = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.staged`);
  await fs.writeFile(staged, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
  await fs.rename(staged, outputPath);
  return candidate;
}

module.exports = { PUBLIC_FIELDS, buildCandidate, validateCandidate, writeCandidate };
