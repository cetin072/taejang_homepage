'use strict';

/**
 * Phase 1A fixture publisher. This is a local, non-operational prototype:
 * it does not call GitHub, Netlify, Supabase, or the public website.
 */
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PUBLIC_REVISION_FIELDS = Object.freeze([
  'contentId',
  'revisionId',
  'slug',
  'title',
  'summary',
  'body',
  'publishedAt',
  'media'
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function checksum(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function toPublicRevision(revision) {
  const output = {};
  for (const field of PUBLIC_REVISION_FIELDS) {
    if (revision[field] !== undefined) output[field] = revision[field];
  }
  return output;
}

function assertApprovedRevision(revision) {
  if (!revision || revision.approvalStatus !== 'approved' || !revision.revisionId) {
    throw new Error('Only an approved revision with a revisionId may be published.');
  }
}

function buildCandidate(revisions, generatedAt) {
  if (!Array.isArray(revisions)) throw new Error('revisions must be an array.');

  const entries = revisions
    .filter((revision) => revision.approvalStatus === 'approved')
    .map((revision) => {
      assertApprovedRevision(revision);
      return toPublicRevision(revision);
    })
    .sort((left, right) => String(left.slug).localeCompare(String(right.slug)));

  const publication = {
    schemaVersion: 1,
    generatedAt,
    entries
  };

  return {
    ...publication,
    checksum: checksum(publication)
  };
}

function validateCandidate(candidate) {
  if (!candidate || candidate.schemaVersion !== 1 || !Array.isArray(candidate.entries)) {
    throw new Error('Publication has an invalid structure.');
  }

  const expectedChecksum = checksum({
    schemaVersion: candidate.schemaVersion,
    generatedAt: candidate.generatedAt,
    entries: candidate.entries
  });
  if (candidate.checksum !== expectedChecksum) {
    throw new Error('Publication checksum verification failed.');
  }

  const publicFieldSet = new Set([...PUBLIC_REVISION_FIELDS]);
  for (const entry of candidate.entries) {
    if (!entry.revisionId || !entry.contentId || !entry.slug) {
      throw new Error('Published entries require contentId, revisionId, and slug.');
    }
    for (const key of Object.keys(entry)) {
      if (!publicFieldSet.has(key)) {
        throw new Error('Non-public field found in publication: ' + key);
      }
    }
  }
  return true;
}

async function publishFixture({ sourcePath, publicPath, generatedAt }) {
  const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const candidate = buildCandidate(source.revisions, generatedAt);
  validateCandidate(candidate);

  const directory = path.dirname(publicPath);
  const stagedPath = path.join(directory, '.' + path.basename(publicPath) + '.staged');
  await fs.writeFile(stagedPath, JSON.stringify(candidate, null, 2) + '\n', 'utf8');
  await fs.rename(stagedPath, publicPath);
  return candidate;
}

async function rollbackFixture({ approvedSnapshotPath, publicPath }) {
  const snapshot = JSON.parse(await fs.readFile(approvedSnapshotPath, 'utf8'));
  validateCandidate(snapshot);

  const directory = path.dirname(publicPath);
  const stagedPath = path.join(directory, '.' + path.basename(publicPath) + '.rollback-staged');
  await fs.writeFile(stagedPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  await fs.rename(stagedPath, publicPath);
  return snapshot;
}

module.exports = {
  buildCandidate,
  validateCandidate,
  publishFixture,
  rollbackFixture
};
