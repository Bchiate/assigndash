'use strict';

const { HttpError } = require('../http-errors');

/** Parses a route or body id; anything that isn't a positive integer is treated as not found. */
function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Every write is preceded by an ownership check, because the service-role database client
 * bypasses row-level security. Missing and foreign rows both get a 404, so ids belonging to
 * other users can't be probed.
 */
function createOwnershipGuard(store) {
  return async function assertOwner(kind, rawId, userId, message = 'Not found') {
    const id = parseId(rawId);
    if (!id || (await store.ownerOf(kind, id)) !== userId) throw new HttpError(404, message);
    return id;
  };
}

module.exports = { createOwnershipGuard, parseId };
