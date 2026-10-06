const { createApp } = require('./dist/app');

const app = createApp();

if (typeof PhusionPassenger !== 'undefined') {
  PhusionPassenger.configure({ autoInstall: false });
  app.listen('passenger');
} else {
  app.listen(process.env.PORT || 4000);
}

module.exports = app;
