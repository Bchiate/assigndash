'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { esc } = require('../public/escape.js');

describe('esc', () => {
  it('escapes the five HTML-significant characters', () => {
    assert.equal(esc(`<a href="x" title='y'>Tom & Jerry</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;');
  });

  it('keeps model output inert in text and attribute positions', () => {
    const title = '"><img src=x onerror=alert(1)>';
    const html = `<input value="${esc(title)}"><span title='${esc(title)}'>${esc(title)}</span>`;
    assert.ok(!html.includes('<img'), html);
    assert.equal(html.match(/"/g).length, 2, 'only the template\'s own quotes remain');
    assert.equal(html.match(/'/g).length, 2);
  });

  it('handles missing values and non-strings', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
    assert.equal(esc(42), '42');
    assert.equal(esc(0), '0');
    assert.equal(esc(false), 'false');
  });

  it('escapes already-escaped text again (no double-decoding)', () => {
    assert.equal(esc('&amp;'), '&amp;amp;');
  });
});
