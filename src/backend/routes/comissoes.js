'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const svc = require('../services/comissoesService');

const router = express.Router();

router.get('/', asyncHandler((req, res) => res.json(svc.relatorioPeriodo(req.query))));
router.post('/:profissionalId/lancar', asyncHandler((req, res) => res.json(svc.lancarComissao(req.params.profissionalId, req.body || {}))));

module.exports = router;
