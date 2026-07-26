'use strict';

/**
 * Atendimento via WhatsApp Web: conexao por QR Code, caixa de entrada em
 * 3 colunas (Contato / Aguardando / Em atendimento) e conversa com suporte
 * a texto, imagem, video, audio, documento e figurinha. Disponivel para
 * qualquer tipo de negocio (nao depende de perfil/ramo).
 */
window.PaginaAtendimento = (function () {
  let statusAtual = { estado: 'desconectado', qr: null };
  let conversas = [];
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
    container.innerHTML = `
      <div class="card mb-16" id="wa-conexao"></div>
      <div class="patio-kanban" id="wa-kanban"></div>`;

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
    return `<div class="patio-card" data-abrir="${c.id}">
      <div class="patio-card__num">${c.telefone || ''}${c.nao_lidas > 0 ? ` <span class="badge badge--erro">${c.nao_lidas} nova(s)</span>` : ''}</div>
      <div class="patio-card__cliente">${UI.escapar(c.nome_contato || c.telefone || '—')}</div>
      <div class="patio-card__veiculo">${c.ultima_mensagem_em ? UI.dataHora(c.ultima_mensagem_em) : ''}</div>
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
        <div class="flex gap-12 mb-16">
          ${COLUNAS.map((col) => `<button class="btn ${conversa.status === col.status ? '' : 'btn--secundario'}" data-mover="${col.status}" ${conversa.status === col.status ? 'disabled' : ''}>${col.titulo}</button>`).join('')}
        </div>
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
        const enviar = async () => {
          const inp = el.querySelector('#wa-resposta');
          const texto = inp.value.trim();
          if (!texto) return;
          const btn = el.querySelector('#wa-enviar');
          btn.disabled = true;
          try {
            const atualizada = await API.post(`/api/whatsapp/conversas/${id}/mensagens`, { texto });
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
            renderThread(el, atualizada);
          } catch (_) { /* ignora falha de poll */ }
        }, 8000);
      },
    });
  }

  function renderThread(el, conversa) {
    const thread = el.querySelector('#wa-thread');
    if (!thread) return;
    thread.innerHTML = conversa.mensagens.map(bolhaMensagem).join('') || '<p class="muted">Nenhuma mensagem ainda.</p>';
    thread.scrollTop = thread.scrollHeight;
  }

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

    return `<div class="flex" style="justify-content:${minha ? 'flex-end' : 'flex-start'};margin-bottom:8px">
      <div style="max-width:75%;padding:8px 12px;border-radius:10px;background:${minha ? 'var(--primaria)' : 'var(--fundo-card)'};color:${minha ? '#fff' : 'var(--texto)'};border:1px solid ${minha ? 'transparent' : 'var(--borda)'}">
        ${corpo}
        <div style="font-size:10.5px;opacity:.75;margin-top:4px;text-align:right">${UI.dataHora(m.criado_em)}</div>
      </div>
    </div>`;
  }

  return { titulo: 'Atendimento', render };
})();
