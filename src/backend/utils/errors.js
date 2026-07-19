'use strict';

/**
 * Erro de aplicacao com mensagem amigavel para o usuario final.
 * Use `throw new AppError('mensagem clara', 400)` nas rotas/servicos.
 */
class AppError extends Error {
  constructor(mensagem, statusCode = 400) {
    super(mensagem);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.amigavel = true;
  }
}

/**
 * Middleware de tratamento de erros do Express. Garante que o usuario nunca
 * veja um stack trace cru: erros conhecidos viram mensagem clara; erros
 * inesperados viram uma mensagem generica (com log no console para o dev).
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err && err.amigavel) {
    return res.status(err.statusCode || 400).json({ erro: err.message });
  }

  // Erros comuns do SQLite -> mensagens amigaveis
  if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
    return res.status(409).json({
      erro: 'Nao foi possivel salvar: ja existe um registro com esses dados ou ha um vinculo impedindo a operacao.',
    });
  }

  // eslint-disable-next-line no-console
  console.error('[erro inesperado]', err);
  return res.status(500).json({
    erro: 'Ocorreu um erro inesperado. Tente novamente. Se persistir, reinicie o programa.',
  });
}

/**
 * Envolve um handler async para encaminhar erros ao errorHandler.
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { AppError, errorHandler, asyncHandler };
