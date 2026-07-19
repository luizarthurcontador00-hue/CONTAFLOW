'use strict';

/**
 * Wrapper simples de fetch para o backend local.
 * Como o backend serve o frontend na mesma origem, usamos caminhos relativos.
 */
const API = (function () {
  async function requisicao(metodo, url, corpo) {
    const opcoes = { method: metodo, headers: {} };
    if (corpo !== undefined) {
      if (corpo instanceof FormData) {
        opcoes.body = corpo; // deixa o browser definir o Content-Type
      } else {
        opcoes.headers['Content-Type'] = 'application/json';
        opcoes.body = JSON.stringify(corpo);
      }
    }

    let resposta;
    try {
      resposta = await fetch(url, opcoes);
    } catch (e) {
      throw new Error('Nao foi possivel conectar ao sistema. Reinicie o programa.');
    }

    let dados = null;
    const texto = await resposta.text();
    if (texto) {
      try { dados = JSON.parse(texto); } catch (_) { dados = texto; }
    }

    if (!resposta.ok) {
      const msg = (dados && dados.erro) ? dados.erro : 'Ocorreu um erro na operacao.';
      throw new Error(msg);
    }
    return dados;
  }

  return {
    get: (url) => requisicao('GET', url),
    post: (url, corpo) => requisicao('POST', url, corpo),
    put: (url, corpo) => requisicao('PUT', url, corpo),
    del: (url) => requisicao('DELETE', url),
  };
})();
