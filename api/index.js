let app = null;
let bootError = null;
try {
  app = require('../server/app');
} catch (err) {
  bootError = err;
  console.error('[api/index] Startup error:', err);
}

module.exports = (req, res) => {
  if (bootError || !app) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(
      JSON.stringify({
        error: bootError?.message || 'Server failed to initialize.',
      })
    );
  }
  return app(req, res);
};
