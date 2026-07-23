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
          <div class="campo col-2"><label>Tipo de atividade</label>
            <select name="perfil_negocio">
              <option value="comercio" ${cfg.perfil_negocio === 'comercio' ? 'selected' : ''}>Comércio (produtos, estoque)</option>
              <option value="servico" ${cfg.perfil_negocio === 'servico' ? 'selected' : ''}>Serviço (prestação de serviços)</option>
              <option value="ambos" ${(cfg.perfil_negocio || 'ambos') === 'ambos' ? 'selected' : ''}>Comércio e Serviço</option>
            </select>
            <span class="dica">Define quais módulos aparecem no menu. Recarrega o menu ao salvar.</span></div>
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
      </div>

      <div class="card mt-16" style="max-width:640px">
        <h3 style="margin-top:0">🎨 Aparência</h3>
        <p class="dica">Deixe o sistema com a cara da sua loja: logo, cor e tamanho da fonte.</p>
        <form id="form-aparencia" class="form-grid">
          <div class="campo col-2"><label>Logo da loja</label>
            <div class="flex gap-12" style="align-items:center">
              <div class="cfg-logo-preview" id="ap-logo-prev">${cfg.loja_logo ? `<img src="${cfg.loja_logo}">` : '🏪'}</div>
              <div>
                <input type="file" id="ap-logo-file" accept="image/*" />
                <div class="mt-16"><label class="dica"><input type="checkbox" id="ap-logo-remover"> Remover logo</label></div>
                <div class="dica">Aparece no menu lateral e nos impressos. Prefira PNG quadrado.</div>
              </div>
            </div>
          </div>
          <div class="campo"><label>Cor principal</label>
            <input type="color" id="ap-cor" value="${UI.escapar(cfg.cor_primaria || '#2563eb')}" style="width:80px;height:40px;padding:2px" />
            <span class="dica">Cor dos botões e destaques.</span></div>
          <div class="campo"><label>Tamanho da fonte</label>
            <select id="ap-fonte">
              ${[['pequeno', 'Pequeno'], ['normal', 'Normal'], ['grande', 'Grande'], ['maior', 'Maior']].map(([v, t]) => `<option value="${v}" ${(cfg.fonte_escala || 'normal') === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select></div>
          <div class="campo col-2 flex gap-12">
            <button class="btn" type="submit">Salvar aparência</button>
            <button class="btn btn--secundario" type="button" id="ap-restaurar">Restaurar padrão</button>
          </div>
        </form>
      </div>`;

    container.querySelector('#form-cfg').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      // Checkbox nao marcado nao entra no FormData: normaliza para '0'/'1'.
      body.gerar_codigo_auto = ev.target.querySelector('#cfg-cod-auto').checked ? '1' : '0';
      try {
        await API.put('/api/config', body);
        UI.sucesso('Configurações salvas.');
        if (window.__recarregarPerfil) await window.__recarregarPerfil();
      } catch (e) { UI.erro(e.message); }
    });

    // ------------------------------ Aparência ------------------------------
    let logoNovo = null; // dataURL do logo escolhido nesta sessão
    const fileInput = container.querySelector('#ap-logo-file');
    fileInput.addEventListener('change', () => {
      const arq = fileInput.files[0];
      if (!arq) return;
      if (arq.size > 2 * 1024 * 1024) { UI.erro('Imagem muito grande (máx. 2 MB).'); fileInput.value = ''; return; }
      const reader = new FileReader();
      reader.onload = () => {
        logoNovo = reader.result;
        container.querySelector('#ap-logo-prev').innerHTML = `<img src="${logoNovo}">`;
        container.querySelector('#ap-logo-remover').checked = false;
      };
      reader.readAsDataURL(arq);
    });

    container.querySelector('#form-aparencia').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const remover = container.querySelector('#ap-logo-remover').checked;
      const body = {
        cor_primaria: container.querySelector('#ap-cor').value,
        fonte_escala: container.querySelector('#ap-fonte').value,
      };
      if (remover) body.loja_logo = '';
      else if (logoNovo) body.loja_logo = logoNovo;
      try {
        await API.put('/api/config', body);
        UI.sucesso('Aparência salva.');
        if (window.__recarregarPerfil) await window.__recarregarPerfil();
      } catch (e) { UI.erro(e.message); }
    });

    container.querySelector('#ap-restaurar').addEventListener('click', async () => {
      try {
        await API.put('/api/config', { cor_primaria: '#2563eb', fonte_escala: 'normal', loja_logo: '' });
        UI.sucesso('Aparência restaurada.');
        if (window.__recarregarPerfil) await window.__recarregarPerfil();
        render(container);
      } catch (e) { UI.erro(e.message); }
    });
  }

  return { titulo: 'Configurações', render };
})();
