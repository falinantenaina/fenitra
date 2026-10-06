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

const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`API prete sur le port ${port} [passenger=${typeof PhusionPassenger !== 'undefined'}]`);
}).on('error', (error) => {
  console.error(`listen a echoue sur le port ${port} : ${error.message}`);
  process.exit(1);
});
