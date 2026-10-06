const { createApp } = require('./dist/app');

const app = createApp();

if (typeof PhusionPassenger === 'undefined') {
  app.listen(process.env.PORT || 4000);
}

module.exports = app;
