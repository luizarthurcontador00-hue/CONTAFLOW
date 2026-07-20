'use strict';

/**
 * Pagina de Backup: backup manual (com escolha de pasta no desktop), ativacao
 * de backup automatico diario e lista dos backups existentes.
 */
window.PaginaBackup = (function () {
  async function render(container) {
    container.innerHTML = `
      <div class="card mb-16">
        <h3 style="margin-top:0">Backup do banco de dados</h3>
        <p class="muted">O backup gera uma cópia do arquivo do banco (com todos os dados: produtos, vendas, financeiro).
          Guarde as cópias em um pen drive ou nuvem para maior segurança.</p>
        <div class="flex gap-12" style="flex-wrap:wrap">
          <button class="btn" id="bk-agora">💾 Fazer backup agora</button>
          <button class="btn btn--secundario" id="bk-abrir">📂 Abrir pasta de backups</button>
          <button class="btn btn--secundario" id="bk-restaurar-arquivo">♻️ Restaurar de um arquivo…</button>
        </div>
      </div>

      <div class="card mb-16">
        <label class="flex gap-12" style="align-items:center">
          <input type="checkbox" id="bk-auto" />
          <span><strong>Backup automático diário</strong><div class="dica">Gera um backup automaticamente uma vez por dia enquanto o programa estiver aberto.</div></span>
        </label>
        <div class="dica mt-16" id="bk-info"></div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Backups existentes</h3>
        <div id="bk-lista">Carregando…</div>
      </div>`;

    container.querySelector('#bk-agora').addEventListener('click', fazerBackup);
    container.querySelector('#bk-abrir').addEventListener('click', abrirPasta);
    container.querySelector('#bk-restaurar-arquivo').addEventListener('click', restaurarDeArquivo);
    container.querySelector('#bk-auto').addEventListener('change', (e) => alternarAuto(e.target.checked));

    await carregarConfig();
    await carregarLista();
  }

  async function carregarConfig() {
    try {
      const cfg = await API.get('/api/backup/config');
      document.getElementById('bk-auto').checked = cfg.automatico;
      document.getElementById('bk-info').innerHTML = `Pasta padrão: <code>${UI.escapar(cfg.pasta_padrao)}</code>`
        + (cfg.ultimo ? `<br>Último backup: ${UI.dataHora(cfg.ultimo)}` : '<br>Nenhum backup automático realizado ainda.');
    } catch (e) { /* silencioso */ }
  }

  async function carregarLista() {
    const alvo = document.getElementById('bk-lista');
    let lista;
    try { lista = await API.get('/api/backup/lista'); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!lista.length) { alvo.innerHTML = '<p class="muted">Nenhum backup gerado ainda.</p>'; return; }
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>Arquivo</th><th>Data</th><th>Tamanho</th><th></th></tr></thead>
      <tbody>${lista.map((b) => `<tr>
        <td>${UI.escapar(b.nome)}</td><td>${UI.dataHora(b.data)}</td><td>${formatarTamanho(b.tamanho)}</td>
        <td style="text-align:right"><button class="btn btn--secundario" data-restaurar="${UI.escapar(b.caminho)}">Restaurar</button></td>
      </tr>`).join('')}</tbody></table>`;
    alvo.querySelectorAll('[data-restaurar]').forEach((btn) => btn.addEventListener('click', () => restaurar(btn.dataset.restaurar)));
  }

  async function restaurarDeArquivo() {
    if (!(window.appDesktop && window.appDesktop.escolherArquivoBackup)) {
      UI.erro('A restauração por arquivo está disponível apenas no aplicativo instalado.');
      return;
    }
    const arquivo = await window.appDesktop.escolherArquivoBackup();
    if (!arquivo) return;
    await restaurar(arquivo);
  }

  async function restaurar(origem) {
    const ok = await UI.confirmar(
      'Restaurar este backup vai SUBSTITUIR todos os dados atuais (produtos, vendas, financeiro) pelos dados do backup. Um backup de segurança do estado atual será feito automaticamente antes. Deseja continuar?',
      { titulo: 'Restaurar backup', textoConfirmar: 'Restaurar' }
    );
    if (!ok) return;
    try {
      await API.post('/api/backup/restaurar', { origem });
      UI.sucesso('Backup restaurado! Recarregando o sistema…');
      setTimeout(() => {
        if (window.appDesktop && window.appDesktop.recarregarJanela) window.appDesktop.recarregarJanela();
        else location.reload();
      }, 1200);
    } catch (e) { UI.erro(e.message); }
  }

  async function fazerBackup() {
    let destino = null;
    // No app desktop, permite escolher a pasta; no navegador, usa a padrao.
    if (window.appDesktop && window.appDesktop.escolherPasta) {
      destino = await window.appDesktop.escolherPasta();
      if (destino === null) return; // cancelou
    }
    try {
      const r = await API.post('/api/backup/gerar', { destino });
      UI.sucesso('Backup gerado com sucesso!');
      document.getElementById('bk-info').innerHTML = `Último backup: <code>${UI.escapar(r.arquivo)}</code>`;
      await carregarLista();
    } catch (e) { UI.erro(e.message); }
  }

  async function abrirPasta() {
    try {
      const cfg = await API.get('/api/backup/config');
      if (window.appDesktop && window.appDesktop.abrirPasta) {
        await window.appDesktop.abrirPasta(cfg.pasta_padrao);
      } else {
        UI.toast('Pasta: ' + cfg.pasta_padrao, 'info');
      }
    } catch (e) { UI.erro(e.message); }
  }

  async function alternarAuto(ligado) {
    try {
      await API.post('/api/backup/automatico', { ligado });
      UI.sucesso(ligado ? 'Backup automático ativado.' : 'Backup automático desativado.');
      await carregarConfig();
    } catch (e) { UI.erro(e.message); }
  }

  function formatarTamanho(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  return { titulo: 'Backup', render };
})();
