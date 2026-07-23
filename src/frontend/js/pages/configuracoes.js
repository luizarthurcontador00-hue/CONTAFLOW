'use strict';

/**
 * Configuracoes da loja: dados que aparecem no cupom e nos relatorios, e o
 * markup padrao usado na precificacao.
 */
window.PaginaConfiguracoes = (function () {
  async function render(container) {
    let cfg = {};
    try { cfg = await API.get('/api/config'); } catch (e) { /* usa vazio */ }

    container.innerHTML = `
      <div class="card" style="max-width:640px">
        <h3 style="margin-top:0">Dados da loja</h3>
        <p class="dica">Aparecem no cupom de venda e nos relatórios impressos.</p>
        <form id="form-cfg" class="form-grid">
          <div class="campo col-2"><label>Nome da loja</label><input name="nome_loja" value="${UI.escapar(cfg.nome_loja || '')}" /></div>
          <div class="campo"><label>Telefone</label><input name="loja_telefone" value="${UI.escapar(cfg.loja_telefone || '')}" /></div>
          <div class="campo"><label>CNPJ / CPF</label><input name="loja_cnpj" value="${UI.escapar(cfg.loja_cnpj || '')}" /></div>
          <div class="campo col-2"><label>Endereço</label><input name="loja_endereco" value="${UI.escapar(cfg.loja_endereco || '')}" /></div>
          <div class="campo col-2"><label>Mensagem no rodapé do cupom</label>
            <input name="loja_rodape_cupom" value="${UI.escapar(cfg.loja_rodape_cupom || 'Obrigado pela preferência!')}" /></div>
          <div class="campo"><label>Markup padrão (%)</label>
            <input name="markup_padrao" type="number" step="0.01" min="0" value="${cfg.markup_padrao != null ? cfg.markup_padrao : 100}" />
            <span class="dica">Usado no cálculo de preço quando o produto não tem markup próprio.</span></div>
          <div class="campo col-2" style="border-top:1px solid var(--borda);padding-top:16px">
            <label class="flex gap-12" style="align-items:center">
              <input type="checkbox" name="gerar_codigo_auto" id="cfg-cod-auto" ${String(cfg.gerar_codigo_auto ?? '1') === '1' ? 'checked' : ''} />
              Gerar código de barras automaticamente ao importar produtos
            </label>
            <span class="dica">Ao cadastrar em lote ou importar por NF-e, produtos sem código de barras recebem um EAN-13 interno (para etiquetas e leitura no PDV).</span>
          </div>
          <div class="campo col-2"><button class="btn" type="submit">Salvar configurações</button></div>
        </form>
      </div>`;

    container.querySelector('#form-cfg').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      // Checkbox nao marcado nao entra no FormData: normaliza para '0'/'1'.
      body.gerar_codigo_auto = ev.target.querySelector('#cfg-cod-auto').checked ? '1' : '0';
      try { await API.put('/api/config', body); UI.sucesso('Configurações salvas.'); }
      catch (e) { UI.erro(e.message); }
    });
  }

  return { titulo: 'Configurações', render };
})();
