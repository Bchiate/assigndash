'use strict';

/** A problem with an uploaded file, described in words that can be shown to the user. */
class FileReadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileReadError';
  }
}

module.exports = { FileReadError };
