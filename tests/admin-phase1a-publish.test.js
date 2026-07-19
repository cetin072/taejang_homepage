'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildCandidate,
  validateCandidate,
  publishFixture,
  rollbackFixture
} = require('../scripts/admin-phase1a-publish.js');

const approved = {
  contentId: 'content-1',
  revisionId: 'revision-approved',
  slug: 'notice-approved',
  title: 'Approved title',
  summary: 'Approved summary',
  body: { blocks: [{ type: 'paragraph', text: 'Public body' }] },
  media: [{ url: '/images/approved.jpg', alt: 'Approved image' }],
  approvalStatus: 'approved',
  internalNote: 'must never be public',
  approvedBy: 'profile-reviewer'
};

const draft = {
  contentId: 'content-2',
  revisionId: 'revision-draft',
  slug: 'notice-draft',
  title: 'Draft title',
  body: { blocks: [{ type: 'paragraph', text: 'Draft body' }] },
  approvalStatus: 'draft',
  internalNote: 'must never be public'
};

function approvedVariant(overrides) {
  return {
    ...approved,
    ...overrides,
    approvalStatus: 'approved',
    body: { blocks: [{ type: 'paragraph', text: 'Public body' }] }
  };
}

test('only approved revisions become public and internal fields are excluded', () => {
  const candidate = buildCandidate([approved, draft], '2026-07-19T00:00:00.000Z');
  assert.equal(candidate.entries.length, 1);
  assert.equal(candidate.entries[0].revisionId, 'revision-approved');
  assert.equal('internalNote' in candidate.entries[0], false);
  assert.equal('approvedBy' in candidate.entries[0], false);
  assert.equal(validateCandidate(candidate), true);
});

test('an explicit request for an unapproved revision fails', () => {
  assert.throws(
    () => buildCandidate([approved, draft], '2026-07-19T00:00:00.000Z', ['revision-draft']),
    /Only an approved revision/
  );
});

test('checksum tampering fails validation', () => {
  const candidate = buildCandidate([approved], '2026-07-19T00:00:00.000Z');
  candidate.checksum = 'tampered';
  assert.throws(() => validateCandidate(candidate), /checksum/);
});

test('failed validation leaves the existing public fixture unchanged', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-phase1a-'));
  const sourcePath = path.join(temp, 'source.json');
  const publicPath = path.join(temp, 'public.json');
  const badSource = { revisions: [approvedVariant({ contentId: '' })] };
  await fs.writeFile(sourcePath, JSON.stringify(badSource), 'utf8');
  await fs.writeFile(publicPath, 'existing-public-fixture\n', 'utf8');

  try {
    await assert.rejects(
      publishFixture({ sourcePath, publicPath, generatedAt: '2026-07-19T00:00:00.000Z' }),
      /contentId/
    );
    assert.equal(await fs.readFile(publicPath, 'utf8'), 'existing-public-fixture\n');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('rollback atomically restores a valid previous approved snapshot', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-phase1a-'));
  const snapshotPath = path.join(temp, 'approved-snapshot.json');
  const publicPath = path.join(temp, 'public.json');
  const snapshot = buildCandidate([approved], '2026-07-18T00:00:00.000Z');
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot), 'utf8');
  await fs.writeFile(publicPath, 'newer-public-fixture\n', 'utf8');

  try {
    const restored = await rollbackFixture({ approvedSnapshotPath: snapshotPath, publicPath });
    assert.equal(restored.entries[0].revisionId, 'revision-approved');
    assert.deepEqual(JSON.parse(await fs.readFile(publicPath, 'utf8')), snapshot);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('two approved revisions for one contentId fail publication validation', () => {
  const second = approvedVariant({ revisionId: 'revision-approved-2', slug: 'notice-approved-2' });
  assert.throws(
    () => buildCandidate([approved, second], '2026-07-19T00:00:00.000Z'),
    /contentId is duplicated/
  );
});

test('two content IDs with one slug fail publication validation', () => {
  const second = approvedVariant({ contentId: 'content-2', revisionId: 'revision-approved-2' });
  assert.throws(
    () => buildCandidate([approved, second], '2026-07-19T00:00:00.000Z'),
    /slug is duplicated/
  );
});

test('duplicated requested revision IDs fail before publication', () => {
  assert.throws(
    () => buildCandidate([approved], '2026-07-19T00:00:00.000Z', ['revision-approved', 'revision-approved']),
    /Requested revision ID is duplicated/
  );
});

test('empty contentId or slug fails publication validation', () => {
  assert.throws(
    () => buildCandidate([approvedVariant({ contentId: '' })], '2026-07-19T00:00:00.000Z'),
    /contentId/
  );
  assert.throws(
    () => buildCandidate([approvedVariant({ slug: '' })], '2026-07-19T00:00:00.000Z'),
    /slug/
  );
});

test('an invalid generatedAt value fails before publication', () => {
  assert.throws(
    () => buildCandidate([approved], 'not-a-timestamp'),
    /generatedAt/
  );
});
