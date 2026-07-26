'use strict';

/**
 * Atendimento via WhatsApp Web: conexao por QR Code, caixa de entrada em
 * 3 colunas (Contato / Aguardando / Em atendimento), conversa com suporte
 * a texto, imagem, video, audio, documento e figurinha, bot configuravel
 * de primeiro atendimento, atribuicao de atendente e criacao de tarefa a
 * partir da conversa. Disponivel para qualquer tipo de negocio (nao
 * depende de perfil/ramo).
 */
window.PaginaAtendimento = (function () {
  let statusAtual = { estado: 'desconectado', qr: null };
  let conversas = [];
  let responsaveis = [];
  let pollStatus = null;
  let pollConversas = null;
  let pollThread = null;
  let conversaAbertaId = null;

  const COLUNAS = [
    { status: 'contato', titulo: '🆕 Entrou em contato' },
    { status: 'aguardando', titulo: '⏳ Aguardando atendimento' },
    { status: 'atendimento', titulo: '💬 Em atendimento' },
  ];
  const ROTULO_ESTADO = {
    desconectado: '⚪ Desconectado', gerando_qr: '🟡 Gerando QR Code…',
    aguardando_leitura: '🟡 Aguardando leitura do QR Code', conectado: '🟢 Conectado', erro: '🔴 Erro na conexão',
  };

  async function render(container) {
    responsaveis = await API.get('/api/agenda/profissionais').catch(() => []);
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="wa-bot-config">🤖 Configurar bot</button>
      </div>
      <div class="card mb-16" id="wa-conexao"></div>
      <div class="patio-kanban" id="wa-kanban"></div>`;

    container.querySelector('#wa-bot-config').addEventListener('click', () => abrirConfigBot());

    await atualizarStatus();
    await listar();

    if (pollStatus) clearInterval(pollStatus);
    pollStatus = setInterval(atualizarStatus, 3000);
    if (pollConversas) clearInterval(pollConversas);
    pollConversas = setInterval(listar, 10000);
  }

  async function atualizarStatus() {
    const alvo = document.getElementById('wa-conexao');
    if (!alvo) { pararPolling(); return; }
    try { statusAtual = await API.get('/api/whatsapp/status'); }
    catch (e) { statusAtual = { estado: 'erro', erro: e.message }; }
    renderConexao();
  }

  function pararPolling() {
    if (pollStatus) clearInterval(pollStatus);
    if (pollConversas) clearInterval(pollConversas);
    if (pollThread) clearInterval(pollThread);
  }

  function renderConexao() {
    const alvo = document.getElementById('wa-conexao');
    if (!alvo) return;
    const e = statusAtual.estado;
    alvo.innerHTML = `
      <div class="flex flex--between" style="align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <strong>${ROTULO_ESTADO[e] || e}</strong>
          ${statusAtual.erro ? `<div class="dica" style="color:var(--perigo)">${UI.escapar(statusAtual.erro)}</div>` : ''}
        </div>
        <div class="flex gap-12">
          ${e === 'desconectado' || e === 'erro' ? '<button class="btn" id="wa-conectar">Conectar WhatsApp</button>' : ''}
          ${e === 'conectado' ? '<button class="btn btn--perigo" id="wa-desconectar">Desconectar</button>' : ''}
        </div>
      </div>
      ${e === 'aguardando_leitura' && statusAtual.qr ? `
        <div class="mt-16" style="text-align:center">
          <img src="${statusAtual.qr}" alt="QR Code do WhatsApp" style="width:220px;height:220px;border:1px solid var(--borda);border-radius:8px">
          <p class="dica mt-16">Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho, e escaneie este código.</p>
        </div>` : ''}
      ${e === 'desconectado' ? '<p class="dica mt-16">Conecte para começar a receber e responder mensagens direto por aqui.</p>' : ''}`;

    const btnC = alvo.querySelector('#wa-conectar');
    if (btnC) btnC.addEventListener('click', async () => {
      btnC.disabled = true; btnC.textContent = 'Conectando…';
      try { statusAtual = await API.post('/api/whatsapp/conectar', {}); renderConexao(); }
      catch (err) { UI.erro(err.message); btnC.disabled = false; btnC.textContent = 'Conectar WhatsApp'; }
    });
    const btnD = alvo.querySelector('#wa-desconectar');
    if (btnD) btnD.addEventListener('click', async () => {
      const ok = await UI.confirmar('Desconectar o WhatsApp? Você vai precisar escanear o QR Code de novo para reconectar.', { titulo: 'Desconectar', textoConfirmar: 'Desconectar', perigo: true });
      if (!ok) return;
      try { statusAtual = await API.post('/api/whatsapp/desconectar', {}); renderConexao(); }
      catch (err) { UI.erro(err.message); }
    });
  }

  async function listar() {
    const alvo = document.getElementById('wa-kanban');
    if (!alvo) { pararPolling(); return; }
    try { conversas = await API.get('/api/whatsapp/conversas'); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    renderKanban();
  }

  function renderKanban() {
    const alvo = document.getElementById('wa-kanban');
    if (!alvo) return;
    alvo.innerHTML = COLUNAS.map((col) => {
      const itens = conversas.filter((c) => c.status === col.status);
      return `<div class="patio-coluna">
        <div class="patio-coluna__titulo">${col.titulo} <span class="badge badge--muted">${itens.length}</span></div>
        <div class="patio-coluna__cards">${itens.length ? itens.map(cardConversa).join('') : '<div class="patio-vazio">Vazio</div>'}</div>
      </div>`;
    }).join('');
    alvo.querySelectorAll('[data-abrir]').forEach((c) => c.addEventListener('click', () => abrirConversa(Number(c.dataset.abrir))));
  }

  const ICONE_TIPO = { texto: '', imagem: '📷 ', video: '🎥 ', audio: '🎤 ', documento: '📄 ', sticker: '🩹 ' };

  function cardConversa(c) {
    const resp = responsaveis.find((r) => r.id === c.atendente_id);
    return `<div class="patio-card" data-abrir="${c.id}">
      <div class="patio-card__num">${c.telefone || ''}${c.nao_lidas > 0 ? ` <span class="badge badge--erro">${c.nao_lidas} nova(s)</span>` : ''}</div>
      <div class="patio-card__cliente">${UI.escapar(c.nome_contato || c.telefone || '—')}</div>
      <div class="patio-card__veiculo">${c.ultima_mensagem_em ? UI.dataHora(c.ultima_mensagem_em) : ''}</div>
      ${c.modo_atual === 'bot' ? '<div class="dica">🤖 bot respondendo</div>' : ''}
      ${resp ? `<div class="patio-card__resp"><span class="cm-cor" style="background:${resp.cor || '#999'}"></span> ${UI.escapar(resp.nome)}</div>` : ''}
    </div>`;
  }

  async function abrirConversa(id) {
    let conversa;
    try { conversa = await API.get(`/api/whatsapp/conversas/${id}`); }
    catch (e) { UI.erro(e.message); return; }
    if (conversa.nao_lidas > 0) { API.post(`/api/whatsapp/conversas/${id}/marcar-lida`, {}).catch(() => {}); }

    conversaAbertaId = id;
    Modal.abrir({
      titulo: `💬 ${conversa.nome_contato || conversa.telefone}`, tamanho: 'modal--grande',
      corpoHTML: `
        <div class="flex gap-12 mb-16" style="flex-wrap:wrap">
          ${COLUNAS.map((col) => `<button class="btn ${conversa.status === col.status ? '' : 'btn--secundario'}" data-mover="${col.status}" ${conversa.status === col.status ? 'disabled' : ''}>${col.titulo}</button>`).join('')}
        </div>
        <div class="flex gap-12 mb-16" style="flex-wrap:wrap;align-items:center">
          <div class="campo" style="min-width:220px;margin:0">
            <label>Atendente</label>
            <select id="wa-atendente"><option value="">— sem atendente —</option>${responsaveis.map((r) => `<option value="${r.id}" ${conversa.atendente_id === r.id ? 'selected' : ''}>${UI.escapar(r.nome)}</option>`).join('')}</select>
          </div>
          <button class="btn btn--secundario" id="wa-ver-cliente">👤 Detalhes do cliente</button>
          <button class="btn btn--secundario" id="wa-criar-tarefa">✅ Criar tarefa</button>
        </div>
        <div id="wa-drawer-cliente" class="card mb-16" style="display:none;background:var(--fundo-app)"></div>
        <div id="wa-thread" style="max-height:340px;overflow-y:auto;border:1px solid var(--borda);border-radius:8px;padding:12px;background:var(--fundo-app)"></div>
        <div class="flex gap-12 mt-16">
          <input id="wa-resposta" class="cresce" placeholder="Digite uma resposta…" />
          <button class="btn" id="wa-enviar">Enviar</button>
        </div>`,
      mostrarConfirmar: false,
      aoAbrir: (el) => {
        renderThread(el, conversa);
        el.querySelectorAll('[data-mover]').forEach((b) => b.addEventListener('click', async () => {
          try { await API.put(`/api/whatsapp/conversas/${id}/status`, { status: b.dataset.mover }); UI.sucesso('Status atualizado.'); el.remove(); conversaAbertaId = null; await listar(); }
          catch (e) { UI.erro(e.message); }
        }));

        el.querySelector('#wa-atendente').addEventListener('change', async (ev) => {
          try { await API.put(`/api/whatsapp/conversas/${id}/atendente`, { atendente_id: ev.target.value || null }); await listar(); }
          catch (e) { UI.erro(e.message); }
        });

        el.querySelector('#wa-ver-cliente').addEventListener('click', () => alternarDrawerCliente(el, conversa));
        el.querySelector('#wa-criar-tarefa').addEventListener('click', () => abrirCriarTarefa(conversa));

        const enviar = async () => {
          const inp = el.querySelector('#wa-resposta');
          const texto = inp.value.trim();
          if (!texto) return;
          const btn = el.querySelector('#wa-enviar');
          btn.disabled = true;
          try {
            const atualizada = await API.post(`/api/whatsapp/conversas/${id}/mensagens`, { texto });
            conversa = atualizada;
            inp.value = '';
            renderThread(el, atualizada);
            await listar();
          } catch (e) { UI.erro(e.message); }
          btn.disabled = false;
        };
        el.querySelector('#wa-enviar').addEventListener('click', enviar);
        el.querySelector('#wa-resposta').addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });

        if (pollThread) clearInterval(pollThread);
        pollThread = setInterval(async () => {
          if (!document.getElementById('wa-thread')) { clearInterval(pollThread); return; }
          try {
            const atualizada = await API.get(`/api/whatsapp/conversas/${id}`);
            conversa = atualizada;
            renderThread(el, atualizada);
          } catch (_) { /* ignora falha de poll */ }
        }, 8000);
      },
    });
  }

  async function alternarDrawerCliente(el, conversa) {
    const drawer = el.querySelector('#wa-drawer-cliente');
    if (!drawer) return;
    if (drawer.style.display !== 'none') { drawer.style.display = 'none'; return; }
    drawer.style.display = 'block';
    drawer.innerHTML = '<p class="dica">Carregando…</p>';
    if (!conversa.cliente_id && !conversa.lead_id) {
      drawer.innerHTML = '<p class="dica">Nenhum cliente ou lead vinculado a esta conversa ainda.</p>';
      return;
    }
    try {
      if (conversa.cliente_id) {
        const c = await API.get(`/api/clientes/${conversa.cliente_id}`);
        drawer.innerHTML = `
          <strong>Cliente cadastrado</strong>
          <div class="mt-16">Nome: ${UI.escapar(c.nome || '—')}</div>
          <div>Telefone: ${UI.escapar(c.telefone || '—')}</div>
          <div>E-mail: ${UI.escapar(c.email || '—')}</div>`;
      } else {
        const l = await API.get(`/api/crm/leads/${conversa.lead_id}`);
        drawer.innerHTML = `
          <strong>Lead no CRM</strong>
          <div class="mt-16">Nome: ${UI.escapar(l.nome || '—')}</div>
          <div>Status do funil: ${UI.escapar(l.status || '—')}</div>
          <div>Origem: ${UI.escapar(l.origem || '—')}</div>`;
      }
    } catch (e) {
      drawer.innerHTML = `<p class="dica">Não foi possível carregar: ${UI.escapar(e.message)}</p>`;
    }
  }

  function abrirCriarTarefa(conversa) {
    Modal.abrir({
      titulo: 'Criar tarefa a partir da conversa', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Título *</label><input id="wat-titulo" value="Atender ${UI.escapar(conversa.nome_contato || conversa.telefone || '')}" /></div>
        <div class="campo mt-16"><label>Descrição</label><textarea id="wat-desc"></textarea></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Responsável</label><select id="wat-resp"><option value="">— sem responsável —</option>${responsaveis.map((r) => `<option value="${r.id}">${UI.escapar(r.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Prazo</label><input id="wat-prazo" type="date" /></div>
        </div>`,
      textoConfirmar: 'Criar tarefa',
      aoConfirmar: async (el) => {
        const dados = {
          titulo: el.querySelector('#wat-titulo').value,
          descricao: el.querySelector('#wat-desc').value,
          responsavel_id: el.querySelector('#wat-resp').value || null,
          prazo: el.querySelector('#wat-prazo').value || null,
          conversa_whatsapp_id: conversa.id,
        };
        try { await API.post('/api/tarefas', dados); UI.sucesso('Tarefa criada.'); }
        catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function renderThread(el, conversa) {
    const thread = el.querySelector('#wa-thread');
    if (!thread) return;
    thread.innerHTML = conversa.mensagens.map(bolhaMensagem).join('') || '<p class="muted">Nenhuma mensagem ainda.</p>';
    thread.scrollTop = thread.scrollHeight;
  }

  const TICK_STATUS = { enviada: '✓', entregue: '✓✓', lida: '✓✓' };

  function bolhaMensagem(m) {
    const minha = m.direcao === 'enviada';
    const url = m.arquivo ? `/uploads/whatsapp/${encodeURIComponent(m.arquivo)}` : null;
    let corpo = '';
    if (m.tipo === 'imagem' && url) corpo = `<img src="${url}" style="max-width:220px;border-radius:8px;display:block">`;
    else if (m.tipo === 'sticker' && url) corpo = `<img src="${url}" style="width:96px;display:block">`;
    else if (m.tipo === 'video' && url) corpo = `<video src="${url}" controls style="max-width:240px;border-radius:8px;display:block"></video>`;
    else if (m.tipo === 'audio' && url) corpo = `<audio src="${url}" controls></audio>`;
    else if (m.tipo === 'documento' && url) corpo = `<a href="${url}" target="_blank" rel="noopener" class="btn btn--secundario">📄 ${UI.escapar(m.arquivo_nome_original || 'Documento')}</a>`;
    if (m.texto) corpo += `<div>${UI.escapar(m.texto)}</div>`;
    if (!corpo) corpo = `<div class="dica">[${UI.escapar(m.tipo)}]</div>`;

    const tick = minha ? (TICK_STATUS[m.status] || '✓') : '';
    const corTick = m.status === 'lida' ? '#53bdeb' : 'inherit';

    return `<div class="flex" style="justify-content:${minha ? 'flex-end' : 'flex-start'};margin-bottom:8px">
      <div style="max-width:75%;padding:8px 12px;border-radius:10px;background:${minha ? 'var(--primaria)' : 'var(--fundo-card)'};color:${minha ? '#fff' : 'var(--texto)'};border:1px solid ${minha ? 'transparent' : 'var(--borda)'}">
        ${corpo}
        <div style="font-size:10.5px;opacity:.75;margin-top:4px;text-align:right">${UI.dataHora(m.criado_em)}${tick ? ` <span style="color:${corTick}">${tick}</span>` : ''}</div>
      </div>
    </div>`;
  }

  // ------------------------------- Bot configuravel -------------------------------

  async function abrirConfigBot() {
    let cfg, regras;
    try {
      [cfg, regras] = await Promise.all([API.get('/api/whatsapp/bot/config'), API.get('/api/whatsapp/bot/regras')]);
    } catch (e) { UI.erro(e.message); return; }

    Modal.abrir({
      titulo: '🤖 Bot de primeiro atendimento', tamanho: 'modal--grande',
      corpoHTML: `
        <div class="campo">
          <label><input type="checkbox" id="bot-ativo" ${cfg.ativo ? 'checked' : ''} /> Bot ativo (responde automaticamente até um atendente assumir a conversa)</label>
        </div>
        <div class="campo mt-16"><label>Mensagem de saudação (1ª mensagem do cliente)</label>
          <textarea id="bot-saudacao" placeholder="Olá! Bem-vindo(a)…">${UI.escapar(cfg.saudacao)}</textarea></div>
        <div class="campo mt-16"><label>Menu de opções</label>
          <textarea id="bot-menu" placeholder="1 - Orçamento&#10;2 - Falar com atendente">${UI.escapar(cfg.menuTexto)}</textarea>
          <p class="dica">Enviado logo após a saudação e reenviado quando o cliente digitar algo que o bot não reconhece.</p></div>
        <hr class="mt-16 mb-16" />
        <div class="flex flex--between" style="align-items:center">
          <strong>Regras de resposta</strong>
          <button class="btn btn--secundario" id="bot-nova-regra" type="button">+ Nova regra</button>
        </div>
        <div id="bot-regras" class="mt-16"></div>`,
      textoConfirmar: 'Salvar configuração',
      aoAbrir: (el) => {
        renderRegrasBot(el, regras);
        el.querySelector('#bot-nova-regra').addEventListener('click', () => formRegraBot(el, regras));
      },
      aoConfirmar: async (el) => {
        try {
          await API.put('/api/whatsapp/bot/config', {
            ativo: el.querySelector('#bot-ativo').checked,
            saudacao: el.querySelector('#bot-saudacao').value,
            menuTexto: el.querySelector('#bot-menu').value,
          });
          UI.sucesso('Configuração do bot salva.');
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function renderRegrasBot(el, regras) {
    const alvo = el.querySelector('#bot-regras');
    if (!alvo) return;
    alvo.innerHTML = regras.length ? regras.map((r) => `
      <div class="flex flex--between" style="align-items:center;border:1px solid var(--borda);border-radius:8px;padding:8px 12px;margin-bottom:8px;${r.ativo ? '' : 'opacity:.55'}">
        <div>
          <strong>${r.gatilho_tipo === 'opcao_menu' ? 'Opção do menu' : 'Palavra-chave'}:</strong> ${UI.escapar(r.gatilho)}
          ${r.transfere_humano ? ' <span class="badge">transfere p/ atendente</span>' : ''}
          <div class="dica">${UI.escapar(r.resposta)}</div>
        </div>
        <div class="flex gap-12">
          <button class="btn btn--secundario" type="button" data-editar-regra="${r.id}">Editar</button>
          <button class="btn btn--perigo" type="button" data-excluir-regra="${r.id}">Excluir</button>
        </div>
      </div>`).join('') : '<p class="dica">Nenhuma regra cadastrada ainda.</p>';

    alvo.querySelectorAll('[data-editar-regra]').forEach((b) => b.addEventListener('click', () => {
      formRegraBot(el, regras, regras.find((r) => r.id === Number(b.dataset.editarRegra)));
    }));
    alvo.querySelectorAll('[data-excluir-regra]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta regra do bot?', { titulo: 'Excluir regra', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try {
        await API.del(`/api/whatsapp/bot/regras/${b.dataset.excluirRegra}`);
        const idx = regras.findIndex((r) => r.id === Number(b.dataset.excluirRegra));
        if (idx >= 0) regras.splice(idx, 1);
        renderRegrasBot(el, regras);
      } catch (e) { UI.erro(e.message); }
    }));
  }

  function formRegraBot(elPai, regras, regra) {
    const ehEdicao = !!regra;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar regra do bot' : 'Nova regra do bot', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Tipo de gatilho</label>
          <select id="rb-tipo">
            <option value="palavra_chave" ${regra && regra.gatilho_tipo === 'palavra_chave' ? 'selected' : ''}>Palavra-chave (uma ou mais, separadas por vírgula)</option>
            <option value="opcao_menu" ${regra && regra.gatilho_tipo === 'opcao_menu' ? 'selected' : ''}>Opção exata do menu (ex: "1")</option>
          </select></div>
        <div class="campo mt-16"><label>Gatilho *</label><input id="rb-gatilho" value="${UI.escapar(regra ? regra.gatilho : '')}" placeholder="ex: orçamento, preço, valor" /></div>
        <div class="campo mt-16"><label>Resposta *</label><textarea id="rb-resposta">${UI.escapar(regra ? regra.resposta : '')}</textarea></div>
        <div class="campo mt-16"><label><input type="checkbox" id="rb-transfere" ${regra && regra.transfere_humano ? 'checked' : ''} /> Transferir para atendente humano após esta resposta</label></div>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const dados = {
          gatilho_tipo: el.querySelector('#rb-tipo').value,
          gatilho: el.querySelector('#rb-gatilho').value,
          resposta: el.querySelector('#rb-resposta').value,
          transfere_humano: el.querySelector('#rb-transfere').checked,
        };
        try {
          const salva = ehEdicao
            ? await API.put(`/api/whatsapp/bot/regras/${regra.id}`, dados)
            : await API.post('/api/whatsapp/bot/regras', dados);
          if (ehEdicao) Object.assign(regra, salva);
          else regras.push(salva);
          renderRegrasBot(elPai, regras);
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { titulo: 'Atendimento', render };
})();
