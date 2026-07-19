'use strict';

const Database = require('better-sqlite3');
const paths = require('../paths');

let db = null;

/**
 * Abre (uma unica vez) a conexao com o banco SQLite local e aplica os
 * pragmas recomendados. Retorna sempre a mesma instancia.
 */
function getDb() {
  if (db) return db;

  paths.ensureDirs();
  db = new Database(paths.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

module.exports = { getDb };
