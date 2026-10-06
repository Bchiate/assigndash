/* global module */
// HTML escaping for every string that comes from users, uploaded files or the model before
// it is placed in an innerHTML template. It covers text content and quoted attribute values.
(function (root) {
  'use strict';

  const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
  }

  if (typeof module === 'object' && module.exports) module.exports = { esc };
  else root.AssignDash = Object.assign(root.AssignDash || {}, { esc });
})(typeof window !== 'undefined' ? window : globalThis);
