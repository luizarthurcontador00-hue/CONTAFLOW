'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const paths = require('../paths');

function carimbo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Gera um backup do banco usando a API online do SQLite (segura com WAL).
 * destinoDir opcional: pasta escolhida pelo usuario; padrao = pasta de backups.
 * Retorna o caminho do arquivo gerado.
 */
async function fazerBackup(destinoDir) {
  paths.ensureDirs();
  const dir = destinoDir && String(destinoDir).trim() ? destinoDir : paths.backupsDir;
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch (_) { throw new AppError('A pasta de destino do backup nao existe ou nao pode ser criada.'); }
  }
  const destino = path.join(dir, `vendas-backup-${carimbo()}.db`);
  const db = getDb();
  await db.backup(destino);
  const stat = fs.statSync(destino);
  return { arquivo: destino, tamanho: stat.size, data: new Date().toISOString() };
}

/** Lista os backups existentes na pasta padrao (mais recentes primeiro). */
function listarBackups() {
  paths.ensureDirs();
  return fs.readdirSync(paths.backupsDir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const full = path.join(paths.backupsDir, f);
      const st = fs.statSync(full);
      return { nome: f, caminho: full, tamanho: st.size, data: st.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.data) - new Date(a.data));
}

/** Remove backups antigos, mantendo os N mais recentes. */
function limparAntigos(manter = 15) {
  const lista = listarBackups();
  lista.slice(manter).forEach((b) => {
    try { fs.unlinkSync(b.caminho); } catch (_) { /* ignora */ }
  });
}

// -------------------- Configuracao de backup automatico --------------------

function getConfig() {
  const db = getDb();
  const auto = db.prepare("SELECT valor FROM config WHERE chave='backup_automatico'").get();
  const ultimo = db.prepare("SELECT valor FROM config WHERE chave='backup_ultimo'").get();
  return {
    automatico: auto ? auto.valor === '1' : false,
    ultimo: ultimo ? ultimo.valor : null,
    pasta_padrao: paths.backupsDir,
  };
}

function setAutomatico(ligado) {
  const db = getDb();
  db.prepare("INSERT INTO config (chave, valor) VALUES ('backup_automatico', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor")
    .run(ligado ? '1' : '0');
  return getConfig();
}

function registrarUltimo() {
  const db = getDb();
  db.prepare("INSERT INTO config (chave, valor) VALUES ('backup_ultimo', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor")
    .run(new Date().toISOString());
}

/**
 * Rotina de backup automatico: gera um backup se estiver ligado e o ultimo
 * tiver mais de `horas` horas. Mantem os 15 mais recentes. Idempotente e segura
 * para chamar na inicializacao e em intervalos.
 */
async function backupAutomaticoSeNecessario(horas = 24) {
  const cfg = getConfig();
  if (!cfg.automatico) return { pulado: true, motivo: 'desligado' };
  if (cfg.ultimo) {
    const decorrido = (Date.now() - new Date(cfg.ultimo).getTime()) / 36e5;
    if (decorrido < horas) return { pulado: true, motivo: 'recente' };
  }
  const r = await fazerBackup();
  registrarUltimo();
  limparAntigos(15);
  return { ...r, pulado: false };
}

module.exports = {
  fazerBackup,
  listarBackups,
  limparAntigos,
  getConfig,
  setAutomatico,
  registrarUltimo,
  backupAutomaticoSeNecessario,
};
