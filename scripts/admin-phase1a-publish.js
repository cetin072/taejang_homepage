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

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(label + ' must be a non-empty string.');
  }
}

function assertIsoTimestamp(value, label) {
  assertNonEmptyString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || Number.isNaN(Date.parse(value))) {
    throw new Error(label + ' must be a valid ISO-8601 UTC timestamp.');
  }
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

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEntries(left, right) {
  return compareText(String(left.slug), String(right.slug))
    || compareText(String(left.contentId), String(right.contentId))
    || compareText(String(left.revisionId), String(right.revisionId));
}

function buildCandidate(revisions, generatedAt, requestedRevisionIds = null) {
  if (!Array.isArray(revisions)) throw new Error('revisions must be an array.');
  assertIsoTimestamp(generatedAt, 'generatedAt');

  let selected;
  if (requestedRevisionIds === null) {
    selected = revisions.filter((revision) => revision.approvalStatus === 'approved');
  } else {
    if (!Array.isArray(requestedRevisionIds)) {
      throw new Error('requestedRevisionIds must be an array or null.');
    }
    const requestedIds = new Set();
    for (const revisionId of requestedRevisionIds) {
      assertNonEmptyString(revisionId, 'requested revision ID');
      if (requestedIds.has(revisionId)) {
        throw new Error('Requested revision ID is duplicated: ' + revisionId);
      }
      requestedIds.add(revisionId);
    }
    selected = requestedRevisionIds.map((revisionId) => {
      const revision = revisions.find((item) => item.revisionId === revisionId);
      if (!revision) throw new Error('Requested revision was not found: ' + revisionId);
      return revision;
    });
  }

  const entries = selected
    .map((revision) => {
      assertApprovedRevision(revision);
      return toPublicRevision(revision);
    })
    .sort(compareEntries);

  const publication = {
    schemaVersion: 1,
    generatedAt,
    entries
  };
  const candidate = {
    ...publication,
    checksum: checksum(publication)
  };
  validateCandidate(candidate);
  return candidate;
}

function validateCandidate(candidate) {
  if (!candidate || candidate.schemaVersion !== 1 || !Array.isArray(candidate.entries)) {
    throw new Error('Publication has an invalid structure.');
  }
  assertIsoTimestamp(candidate.generatedAt, 'generatedAt');

  const expectedChecksum = checksum({
    schemaVersion: candidate.schemaVersion,
    generatedAt: candidate.generatedAt,
    entries: candidate.entries
  });
  if (candidate.checksum !== expectedChecksum) {
    throw new Error('Publication checksum verification failed.');
  }

  const publicFieldSet = new Set([...PUBLIC_REVISION_FIELDS]);
  const contentIds = new Set();
  const slugs = new Set();
  const revisionIds = new Set();

  for (const entry of candidate.entries) {
    assertNonEmptyString(entry.contentId, 'contentId');
    assertNonEmptyString(entry.revisionId, 'revisionId');
    assertNonEmptyString(entry.slug, 'slug');
    assertNonEmptyString(entry.title, 'title');
    if (!entry.body || typeof entry.body !== 'object' || Array.isArray(entry.body)) {
      throw new Error('body must be a non-array object.');
    }
    if (entry.summary !== undefined) assertNonEmptyString(entry.summary, 'summary');
    if (entry.publishedAt !== undefined) assertIsoTimestamp(entry.publishedAt, 'publishedAt');
    if (entry.media !== undefined && !Array.isArray(entry.media)) {
      throw new Error('media must be an array when present.');
    }
    if (contentIds.has(entry.contentId)) throw new Error('contentId is duplicated: ' + entry.contentId);
    if (slugs.has(entry.slug)) throw new Error('slug is duplicated: ' + entry.slug);
    if (revisionIds.has(entry.revisionId)) throw new Error('revisionId is duplicated: ' + entry.revisionId);
    contentIds.add(entry.contentId);
    slugs.add(entry.slug);
    revisionIds.add(entry.revisionId);

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
