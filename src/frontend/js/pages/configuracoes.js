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
          <div class="campo col-2" id="cfg-ramo-wrap" style="display:${(cfg.perfil_negocio === 'servico' || (cfg.perfil_negocio || 'ambos') === 'ambos') ? '' : 'none'}">
            <label>Ramo de serviço</label>
            <select name="ramo_servico">
              <option value="salao" ${(cfg.ramo_servico || 'salao') === 'salao' ? 'selected' : ''}>💇 Salão / Barbearia / Estética</option>
              <option value="oficina" ${cfg.ramo_servico === 'oficina' ? 'selected' : ''}>🔧 Oficina / Assistência técnica</option>
              <option value="agencia_viagem" ${cfg.ramo_servico === 'agencia_viagem' ? 'selected' : ''}>✈️ Agência de viagem</option>
              <option value="professor" ${cfg.ramo_servico === 'professor' ? 'selected' : ''}>🎓 Professor particular / Aulas</option>
              <option value="geral" ${cfg.ramo_servico === 'geral' ? 'selected' : ''}>💼 Outros serviços</option>
            </select>
            <span class="dica">Refina o que aparece no menu — ex.: "Ordens & Orçamentos" (Pátio/OS) fica escondido para Salão.</span>
          </div>
          <div class="campo col-2"><label>Nome da loja</label><input name="nome_loja" value="${UI.escapar(cfg.nome_loja || '')}" /></div>
          <div class="campo"><label>Telefone</label><input name="loja_telefone" value="${UI.escapar(cfg.loja_telefone || '')}" /></div>
          <div class="campo"><label>CNPJ / CPF</label><input name="loja_cnpj" value="${UI.escapar(cfg.loja_cnpj || '')}" /></div>
          <div class="campo col-2"><label>Endereço</label><input name="loja_endereco" value="${UI.escapar(cfg.loja_endereco || '')}" /></div>
          <div class="campo col-2"><label>Mensagem no rodapé do cupom</label>
            <input name="loja_rodape_cupom" value="${UI.escapar(cfg.loja_rodape_cupom || 'Obrigado pela preferência!')}" /></div>
          <div class="campo"><label>Markup padrão (%)</label>
            <input name="markup_padrao" type="number" step="0.01" min="0" value="${cfg.markup_padrao != null ? cfg.markup_padrao : 100}" />
            <span class="dica">Usado no cálculo de preço quando o produto não tem markup próprio.</span></div>
          <div class="campo"><label>Meta mensal de faturamento (R$)</label>
            <input name="meta_mensal_faturamento" type="number" step="0.01" min="0" value="${cfg.meta_mensal_faturamento || ''}" placeholder="Ex.: 30000" />
            <span class="dica">Acompanhe o progresso na Central de Gestão (tela inicial).</span></div>
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
        <h3 style="margin-top:0">💠 Recebimento via PIX</h3>
        <p class="dica">Usado para gerar a cobrança com QR Code PIX em Financeiro → A Receber. O sistema não guarda dinheiro nem se conecta a banco nenhum — ele só monta o QR a partir da sua chave.</p>
        <form id="form-pix" class="form-grid">
          <div class="campo col-2"><label>Chave PIX</label>
            <input name="pix_chave" value="${UI.escapar(cfg.pix_chave || '')}" placeholder="CPF/CNPJ, e-mail, celular ou chave aleatória" /></div>
          <div class="campo"><label>Nome do recebedor</label>
            <input name="pix_nome_recebedor" maxlength="25" value="${UI.escapar(cfg.pix_nome_recebedor || '')}" placeholder="Como aparece no banco (máx. 25 caracteres)" /></div>
          <div class="campo"><label>Cidade</label>
            <input name="pix_cidade" maxlength="15" value="${UI.escapar(cfg.pix_cidade || '')}" placeholder="Máx. 15 caracteres" /></div>
          <div class="campo col-2"><button class="btn" type="submit">Salvar chave PIX</button></div>
        </form>
      </div>

      <div class="card mt-16" style="max-width:640px">
        <div class="flex flex--between" style="align-items:center">
          <h3 style="margin:0">🧾 Módulo Fiscal</h3>
          <span id="fis-status" class="badge badge--muted">verificando…</span>
        </div>
        <p class="dica">Emissão de NFC-e/NF-e/NFS-e via um gateway externo (hoje, Focus NFe). O sistema não guarda seu certificado digital — isso fica no painel do próprio gateway. Aqui você só conecta com o token de acesso.</p>
        <form id="form-fiscal" class="form-grid">
          <div class="campo"><label>Regime tributário</label>
            <select name="fiscal_regime_tributario">
              <option value="">— selecione —</option>
              <option value="simples_nacional" ${cfg.fiscal_regime_tributario === 'simples_nacional' ? 'selected' : ''}>Simples Nacional</option>
              <option value="lucro_presumido" ${cfg.fiscal_regime_tributario === 'lucro_presumido' ? 'selected' : ''}>Lucro Presumido</option>
              <option value="lucro_real" ${cfg.fiscal_regime_tributario === 'lucro_real' ? 'selected' : ''}>Lucro Real</option>
              <option value="mei" ${cfg.fiscal_regime_tributario === 'mei' ? 'selected' : ''}>MEI</option>
            </select></div>
          <div class="campo"><label>Ambiente</label>
            <select name="fiscal_ambiente">
              <option value="homologacao" ${(cfg.fiscal_ambiente || 'homologacao') === 'homologacao' ? 'selected' : ''}>Homologação (testes, não vale fiscalmente)</option>
              <option value="producao" ${cfg.fiscal_ambiente === 'producao' ? 'selected' : ''}>Produção (notas reais)</option>
            </select></div>
          <div class="campo"><label>Inscrição estadual</label><input name="fiscal_inscricao_estadual" value="${UI.escapar(cfg.fiscal_inscricao_estadual || '')}" placeholder="Necessária para NFC-e/NF-e" /></div>
          <div class="campo"><label>Inscrição municipal</label><input name="fiscal_inscricao_municipal" value="${UI.escapar(cfg.fiscal_inscricao_municipal || '')}" placeholder="Necessária para NFS-e" /></div>
          <div class="campo col-2"><label>Gateway de emissão</label>
            <select name="fiscal_gateway">
              <option value="focusnfe" ${(cfg.fiscal_gateway || 'focusnfe') === 'focusnfe' ? 'selected' : ''}>Focus NFe</option>
            </select>
            <span class="dica">Por enquanto o sistema só integra com o Focus NFe (focusnfe.com.br). Crie uma conta lá, cadastre o CNPJ e envie o certificado digital pelo painel deles.</span></div>
          <div class="campo col-2"><label>Token de acesso (Focus NFe)</label><input name="fiscal_token" type="password" value="${UI.escapar(cfg.fiscal_token || '')}" placeholder="Copie do painel do Focus NFe" /></div>
          <div class="campo col-2"><button class="btn" type="submit">Salvar módulo fiscal</button></div>
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
          <div class="campo"><label>Tema</label>
            <select id="ap-tema">
              <option value="claro" ${(cfg.tema || 'claro') === 'claro' ? 'selected' : ''}>☀️ Claro</option>
              <option value="escuro" ${cfg.tema === 'escuro' ? 'selected' : ''}>🌙 Escuro</option>
            </select></div>
          <div class="campo col-2 flex gap-12">
            <button class="btn" type="submit">Salvar aparência</button>
            <button class="btn btn--secundario" type="button" id="ap-restaurar">Restaurar padrão</button>
          </div>
        </form>
      </div>

      <div class="card mt-16" style="max-width:640px">
        <div class="flex flex--between" style="align-items:center">
          <h3 style="margin:0">📅 Google Agenda</h3>
          <span id="ga-status" class="badge badge--muted">verificando…</span>
        </div>
        <p class="dica">Envia automaticamente para o Google Agenda tudo que for criado, editado ou cancelado na Agenda do sistema — assim os compromissos também aparecem no celular, com o lembrete do próprio Google. É uma via só: o que for criado direto no Google não volta para o sistema.</p>

        <div id="ga-cred-wrap">
          <form id="form-ga-cred" class="form-grid">
            <div class="campo col-2"><label>Client ID (Google Cloud Console)</label>
              <input name="client_id" placeholder="xxxxxxxxxxxx.apps.googleusercontent.com" /></div>
            <div class="campo col-2"><label>Client Secret</label>
              <input name="client_secret" type="password" placeholder="Gerado junto com o Client ID" /></div>
            <div class="campo col-2"><button class="btn btn--secundario" type="submit">Salvar credenciais</button></div>
          </form>
          <p class="dica">Credenciais criadas uma única vez, gratuitamente, no Google Cloud Console (console.cloud.google.com): habilite a "Google Calendar API" e crie um "ID do cliente OAuth" do tipo "App para computador". Fale com seu contador ou suporte técnico se tiver dúvida nesse passo.</p>
        </div>

        <div class="flex gap-12 mt-16" style="align-items:center;flex-wrap:wrap">
          <button class="btn" id="ga-conectar" type="button">Conectar conta Google</button>
          <button class="btn btn--secundario" id="ga-desconectar" type="button" style="display:none">Desconectar</button>
          <label class="flex gap-12" id="ga-ativo-wrap" style="align-items:center;display:none">
            <input type="checkbox" id="ga-ativo" /> Sincronizar automaticamente
          </label>
        </div>
        <p class="dica" id="ga-erro" style="display:none;color:#dc2626"></p>
      </div>`;

    container.querySelector('select[name="perfil_negocio"]').addEventListener('change', (e) => {
      const wrap = container.querySelector('#cfg-ramo-wrap');
      wrap.style.display = (e.target.value === 'servico' || e.target.value === 'ambos') ? '' : 'none';
    });

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

    // ------------------------------ PIX ------------------------------
    container.querySelector('#form-pix').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      try {
        await API.put('/api/config', body);
        UI.sucesso('Chave PIX salva.');
      } catch (e) { UI.erro(e.message); }
    });

    // --------------------------- Módulo Fiscal ---------------------------
    container.querySelector('#form-fiscal').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      try {
        await API.put('/api/config', body);
        UI.sucesso('Módulo fiscal salvo.');
        atualizarStatusFiscal();
      } catch (e) { UI.erro(e.message); }
    });
    async function atualizarStatusFiscal() {
      const badge = container.querySelector('#fis-status');
      if (!badge) return;
      try {
        const r = await API.get('/api/fiscal/status');
        badge.textContent = r.configurado ? '✅ Configurado' : '⚠️ Não configurado';
        badge.className = 'badge ' + (r.configurado ? 'badge--ok' : 'badge--muted');
      } catch (e) { badge.textContent = '—'; }
    }
    atualizarStatusFiscal();

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
        tema: container.querySelector('#ap-tema').value,
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
        await API.put('/api/config', { cor_primaria: '#2563eb', fonte_escala: 'normal', tema: 'claro', loja_logo: '' });
        UI.sucesso('Aparência restaurada.');
        if (window.__recarregarPerfil) await window.__recarregarPerfil();
        render(container);
      } catch (e) { UI.erro(e.message); }
    });

    // ------------------------ Google Agenda ------------------------
    async function atualizarStatusGoogle() {
      const badge = container.querySelector('#ga-status');
      const erroEl = container.querySelector('#ga-erro');
      if (!badge) return;
      let st;
      try { st = await API.get('/api/google-agenda/status'); } catch (e) { badge.textContent = '—'; return; }

      badge.textContent = st.conectado ? `✅ ${st.email || 'Conectado'}` : (st.configurado ? '⚠️ Não conectado' : '⚪ Não configurado');
      badge.className = 'badge ' + (st.conectado ? 'badge--ok' : 'badge--muted');

      container.querySelector('#ga-desconectar').style.display = st.conectado ? '' : 'none';
      container.querySelector('#ga-ativo-wrap').style.display = st.conectado ? '' : 'none';
      container.querySelector('#ga-ativo').checked = !!st.ativo;
      container.querySelector('#ga-conectar').textContent = st.conectado ? 'Reconectar conta Google' : 'Conectar conta Google';

      if (st.ultimoErro) {
        erroEl.style.display = '';
        erroEl.textContent = st.ultimoErro;
      } else {
        erroEl.style.display = 'none';
      }
    }

    container.querySelector('#form-ga-cred').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      try {
        await API.post('/api/google-agenda/credenciais', body);
        UI.sucesso('Credenciais salvas.');
        await atualizarStatusGoogle();
      } catch (e) { UI.erro(e.message); }
    });

    container.querySelector('#ga-conectar').addEventListener('click', async () => {
      const btn = container.querySelector('#ga-conectar');
      btn.disabled = true;
      const textoOriginal = btn.textContent;
      btn.textContent = 'Aguardando login no navegador…';
      try {
        await API.post('/api/google-agenda/conectar');
        UI.sucesso('Conta Google conectada!');
      } catch (e) {
        UI.erro(e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
        await atualizarStatusGoogle();
      }
    });

    container.querySelector('#ga-desconectar').addEventListener('click', async () => {
      const ok = await UI.confirmar('Desconectar a conta Google? A sincronização será desligada.');
      if (!ok) return;
      try {
        await API.post('/api/google-agenda/desconectar');
        UI.sucesso('Conta Google desconectada.');
        await atualizarStatusGoogle();
      } catch (e) { UI.erro(e.message); }
    });

    container.querySelector('#ga-ativo').addEventListener('change', async (ev) => {
      try {
        await API.post('/api/google-agenda/ativo', { ativo: ev.target.checked });
        UI.sucesso(ev.target.checked ? 'Sincronização automática ativada.' : 'Sincronização automática desativada.');
      } catch (e) {
        UI.erro(e.message);
        ev.target.checked = !ev.target.checked;
      }
    });

    atualizarStatusGoogle();
  }

  return { titulo: 'Configurações', render };
})();
