'use strict';

const multer = require('multer');
const { HttpError } = require('../http-errors');
const { detectKind, unsupportedFileMessage } = require('../files');

function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}

function toHttpError(err, { maxFileBytes, maxFilesPerRequest }) {
  if (!(err instanceof multer.MulterError)) return err;
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new HttpError(413, `Files can be at most ${formatBytes(maxFileBytes)} each.`);
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return new HttpError(400, `Upload at most ${maxFilesPerRequest} files at a time, using the "files" field.`);
    default:
      return new HttpError(400, 'The upload could not be processed.');
  }
}

/**
 * Multipart parsing for syllabus uploads. Files stay in memory (they are parsed and then
 * discarded, never written to disk), so size and count are capped. Unsupported types are
 * rejected with an explanation rather than silently dropped.
 */
function createUploadMiddleware(limits) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: limits.maxFileBytes,
      files: limits.maxFilesPerRequest,
      fields: 5,
      fieldSize: 1024,
      parts: limits.maxFilesPerRequest + 5,
    },
    fileFilter(req, file, cb) {
      if (detectKind(file.originalname)) return cb(null, true);
      cb(new HttpError(415, unsupportedFileMessage(file.originalname)));
    },
  }).array('files', limits.maxFilesPerRequest);

  return (req, res, next) => upload(req, res, (err) => next(err ? toHttpError(err, limits) : undefined));
}

module.exports = { createUploadMiddleware };
