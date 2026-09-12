import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedQaOrigin, qaEnvironment } from '../supabase/functions/qa-account-preview/boundary.mjs';

test('QA account preview accepts only the fixed staging project or explicit local Supabase hosts', () => {
  assert.equal(qaEnvironment('https://jgsxpdflgkqroecfjzxq.supabase.co'), 'staging');
  assert.equal(qaEnvironment('http://kong:8000'), 'local');
  assert.equal(qaEnvironment('http://127.0.0.1:54321'), 'local');
  assert.equal(qaEnvironment('https://production-project.supabase.co'), null);
  assert.equal(qaEnvironment('https://jgsxpdflgkqroecfjzxq.supabase.co.attacker.invalid'), null);
});

test('QA account preview rejects production and unrelated origins', () => {
  assert.equal(
    allowedQaOrigin('https://deploy-preview-168--taejang-homepage.netlify.app', 'staging'),
    'https://deploy-preview-168--taejang-homepage.netlify.app'
  );
  assert.equal(allowedQaOrigin('https://taejang.net', 'staging'), null);
  assert.equal(allowedQaOrigin('https://taejang-homepage.netlify.app', 'staging'), null);
  assert.equal(allowedQaOrigin('http://localhost:3000', 'local'), 'http://localhost:3000');
  assert.equal(allowedQaOrigin('https://deploy-preview-168--taejang-homepage.netlify.app', 'local'), null);
});
