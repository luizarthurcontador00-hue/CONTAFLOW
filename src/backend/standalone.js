'use strict';

/**
 * Sobe apenas o backend (Express + SQLite) sem o Electron.
 * Util para desenvolvimento/testes: `npm run server`.
 */
const { startServer } = require('./server');

const PORT = process.env.PORT || 3000;

startServer(Number(PORT))
  .then(({ url }) => {
    // eslint-disable-next-line no-console
    console.log(`Backend rodando em ${url}`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Falha ao iniciar o backend:', err);
    process.exit(1);
  });
