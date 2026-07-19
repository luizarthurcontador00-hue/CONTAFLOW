'use strict';

const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const paths = require('../paths');
const { AppError } = require('../utils/errors');

paths.ensureDirs();

const EXT_PERMITIDAS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, paths.produtosImgDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const nome = crypto.randomBytes(8).toString('hex') + '_' + Date.now() + ext;
    cb(null, nome);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!EXT_PERMITIDAS.includes(ext)) {
    return cb(new AppError('Formato de imagem nao suportado. Use JPG, PNG, WEBP ou GIF.'));
  }
  cb(null, true);
}

const uploadFoto = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ----------------------- Upload de XML de NF-e -----------------------
const storageXml = multer.diskStorage({
  destination: (req, file, cb) => cb(null, paths.notasDir),
  filename: (req, file, cb) => {
    const nome = crypto.randomBytes(8).toString('hex') + '_' + Date.now() + '.xml';
    cb(null, nome);
  },
});

function xmlFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const okTipo = /xml/i.test(file.mimetype) || ext === '.xml';
  if (!okTipo) return cb(new AppError('Envie um arquivo XML de NF-e.'));
  cb(null, true);
}

const uploadXml = multer({
  storage: storageXml,
  fileFilter: xmlFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

module.exports = { uploadFoto, uploadXml };
