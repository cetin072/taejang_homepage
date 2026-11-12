'use strict';

const assert = require('node:assert/strict');

const publicTelephone = /tel:|["']telephone["']\s*:|(?<!\d)0(?:1[016789]|2|[3-6]\d|70)[\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/i;

function assertNoPublicTelephone(html, message) {
  // Ignore only the museum's fixed catalog route. Link labels and query parameters remain checked.
  const checkedHtml = html.replace(
    /(<a\b[^>]*\bhref="https:\/\/www\.museum\.go\.kr\/MUSEUM\/contents\/)M0502000000(?=\.do\?)/g,
    '$1catalog'
  );
  assert.doesNotMatch(checkedHtml, publicTelephone, message);
}

module.exports = { assertNoPublicTelephone };
