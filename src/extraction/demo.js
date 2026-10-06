'use strict';

const { HttpError } = require('../http-errors');
const { validateExtraction } = require('./schema');

/**
 * Stand-in for the OpenAI extractor in demo mode. Uploaded files still go through the real
 * parsers (PDF, XLSX, CSV, ICS); the extracted text is then matched against the bundled
 * sample courses and their pre-written results are returned, so no API key is needed.
 */
function createDemoExtractor({ samples, delayMs = 0 }) {
  return {
    async extract({ documents }) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const text = documents.map((doc) => doc.text ?? '').join('\n');
      const courses = samples.coursesIn(text);
      if (courses.length === 0) {
        throw new HttpError(
          422,
          'Demo mode only recognizes the bundled sample files. Use "Load sample files" on the upload screen, or run AssignDash with an OpenAI key to read your own syllabi.',
        );
      }
      return validateExtraction(samples.extractionFor(courses));
    },
  };
}

module.exports = { createDemoExtractor };
