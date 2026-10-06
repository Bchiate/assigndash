'use strict';

const { HttpError } = require('../http-errors');
const { EXTRACTION_INSTRUCTIONS } = require('./prompt');
const { EXTRACTION_JSON_SCHEMA, validateExtraction } = require('./schema');

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

const KIND_LABELS = {
  pdf: 'PDF',
  text: 'text file',
  paste: 'pasted text',
  csv: 'CSV spreadsheet',
  xlsx: 'Excel spreadsheet',
  ics: 'calendar export',
  image: 'image',
};

/**
 * Text extracted on the server goes into one input_text block. PDFs without a text layer
 * (scans) and images are attached as files so the model can read them visually.
 */
function buildUserContent(documents) {
  const sections = documents.map((doc) => {
    const label = `${doc.name} (${KIND_LABELS[doc.kind] || doc.kind}${doc.text ? '' : ', attached'})`;
    return doc.text ? `--- ${label} ---\n${doc.text}` : `--- ${label} ---`;
  });
  const content = [
    { type: 'input_text', text: `Extract the class schedule from these documents.\n\n${sections.join('\n\n')}` },
  ];
  for (const doc of documents) {
    if (!doc.file) continue;
    if (doc.file.mime === 'application/pdf') {
      content.push({ type: 'input_file', filename: doc.name, file_data: `data:application/pdf;base64,${doc.file.base64}` });
    } else {
      content.push({ type: 'input_image', image_url: `data:${doc.file.mime};base64,${doc.file.base64}`, detail: 'high' });
    }
  }
  return content;
}

function buildRequest({ model, documents }) {
  return {
    model,
    instructions: EXTRACTION_INSTRUCTIONS,
    input: [{ role: 'user', content: buildUserContent(documents) }],
    text: {
      format: { type: 'json_schema', name: 'class_schedule', strict: true, schema: EXTRACTION_JSON_SCHEMA },
    },
    temperature: 0.2,
    max_output_tokens: 16384,
    // Syllabi can contain names and other personal details; don't keep them on OpenAI's side.
    store: false,
  };
}

/** Finds the structured output (or a refusal) in a Responses API payload. */
function readOutput(body) {
  for (const item of body.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'refusal') return { refusal: part.refusal || 'refused' };
      if (part.type === 'output_text') return { text: part.text };
    }
  }
  return {};
}

async function errorFromResponse(res, logger) {
  const detail = await res.text().catch(() => '');
  logger.error(`OpenAI request failed with HTTP ${res.status}: ${detail.slice(0, 300)}`);
  if (res.status === 429 && detail.includes('insufficient_quota')) {
    return new HttpError(503, 'The AI service is unavailable right now. Please try again later.');
  }
  if (res.status === 429) return new HttpError(503, 'The AI service is busy. Please try again in a minute.');
  if (res.status === 400 && /context length|too large|too many tokens/i.test(detail)) {
    return new HttpError(413, 'That document is too long to process. Try uploading only the schedule pages.');
  }
  return new HttpError(502, 'The AI service returned an error. Please try again.');
}

function createOpenAIExtractor({ apiKey, model = 'gpt-4.1', fetch = globalThis.fetch, timeoutMs = 120_000, logger = console }) {
  return {
    async extract({ documents }) {
      let res;
      try {
        res = await fetch(RESPONSES_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(buildRequest({ model, documents })),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        logger.error('OpenAI request did not complete:', err.name === 'TimeoutError' ? 'timed out' : err.message);
        throw new HttpError(504, 'The AI service took too long to respond. Please try again.');
      }
      if (!res.ok) throw await errorFromResponse(res, logger);

      const body = await res.json();
      if (body.status === 'incomplete') {
        if (body.incomplete_details?.reason === 'content_filter') {
          throw new HttpError(422, 'The AI declined to process this document.');
        }
        throw new HttpError(413, 'That document produced more items than the AI can return at once. Try uploading fewer pages at a time.');
      }

      const { text, refusal } = readOutput(body);
      if (refusal) throw new HttpError(422, 'The AI declined to process this document.');

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new HttpError(502, 'The AI response was not valid JSON. Please try again.');
      }
      return validateExtraction(json);
    },
  };
}

module.exports = { createOpenAIExtractor, buildRequest, readOutput };
