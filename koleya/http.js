// Express-адаптер ядра: /koleya/api/* → core.handleApi, /koleya/ → статика мини-аппа.
// Используется и плагином «Билли», и локальным стендом (scripts/dev-server.js).
'use strict';

const express = require('express');

function mountHttp(app, core) {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));
  router.all('/*', async (req, res) => {
    const initData = req.get('X-Telegram-Init-Data') || req.body?.initData || req.query.initData || '';
    const { initData: _b, ...body } = req.body || {};
    const { initData: _q, ...query } = req.query || {};
    const { status, body: out } = await core.handleApi({
      method: req.method,
      path: req.path,
      query,
      body,
      initData: String(initData),
      webToken: String(req.get('X-Koleya-Web-Token') || ''),
    });
    res.status(status).json(out);
  });
  app.use('/koleya/api', router);

  app.use('/koleya', express.static(core.staticDir, {
    index: 'index.html',
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    },
  }));
  app.get('/koleya', (req, res) => res.redirect(302, '/koleya/'));
}

module.exports = { mountHttp };
