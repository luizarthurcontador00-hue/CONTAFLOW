'use strict';

const { getDb } = require('./connection');

/**
 * Popula dados iniciais idempotentes: algumas categorias comuns e valores
 * padrao de configuracao. Nao sobrescreve dados existentes.
 */
function seed() {
  const db = getDb();

  const totalCategorias = db.prepare('SELECT COUNT(*) AS c FROM categorias').get().c;
  if (totalCategorias === 0) {
    const insert = db.prepare('INSERT INTO categorias (nome, markup_padrao) VALUES (?, ?)');
    const padrao = [
      ['Geral', 100],
      ['Bebidas', 60],
      ['Alimentos', 40],
      ['Limpeza', 80],
      ['Higiene', 90],
    ];
    const tx = db.transaction(() => padrao.forEach((c) => insert.run(c[0], c[1])));
    tx();
  }

  const configPadrao = {
    markup_padrao: '100',        // % markup global
    nome_loja: 'Minha Loja',
    backup_automatico: '0',       // 0 desligado, 1 ligado
  };
  const upsert = db.prepare(
    'INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO NOTHING'
  );
  const tx = db.transaction(() => {
    Object.entries(configPadrao).forEach(([k, v]) => upsert.run(k, v));
  });
  tx();
}

module.exports = { seed };
