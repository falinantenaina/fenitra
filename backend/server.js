const fs = require('fs');
const path = require('path');

const distApp = path.join(__dirname, 'dist', 'app.js');

if (!fs.existsSync(distApp)) {
  console.error(
    "[Passenger] dist/app.js introuvable - lancez 'npm run build' dans backend/ puis redemarrez l'application.",
  );
  process.exit(1);
}

const { createApp } = require(distApp);

const app = createApp();

module.exports = app;

const underPassenger = typeof PhusionPassenger !== 'undefined';
const port = Number(process.env.PORT) || 4000;

if (underPassenger) {
  if (typeof PhusionPassenger.configure === 'function') {
    PhusionPassenger.configure({ autoInstall: false });
  }
  app.listen('passenger', () => {
    console.log('API prete [passenger=true]');
  });
} else {
  app.listen(port, () => {
    console.log(`API prete sur le port ${port} [passenger=false]`);
  }).on('error', (error) => {
    console.error(`listen a echoue sur le port ${port} : ${error.message}`);
    process.exit(1);
  });
}
