'use strict';

const express = require('express');

/** Demo mode only: lists and serves the generated sample documents. */
module.exports = function demoRoutes({ samples }) {
  const router = express.Router();

  router.get('/samples', (req, res) => {
    res.json(
      samples.files.map(({ name, label, autoload }) => ({ name, label, autoload, url: `/demo/samples/${name}` })),
    );
  });

  router.get('/samples/:name', (req, res) => {
    const file = samples.files.find((f) => f.name === req.params.name);
    if (!file) return res.status(404).json({ error: 'Not found' });
    res.type(file.contentType);
    res.attachment(file.name);
    res.send(file.body);
  });

  return router;
};
