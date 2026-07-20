'use strict';

const XLSX = require('xlsx');
const { AppError } = require('../utils/errors');

const COLUNAS_MODELO = [
  'Nome', 'Código de Barras', 'Categoria', 'Fornecedor', 'Unidade',
  'Custo', 'Preço de Venda', 'Markup %', 'Estoque Inicial', 'Estoque Mínimo',
];

const LINHAS_EXEMPLO = [
  ['Refrigerante Cola 2L', '7891234567890', 'Bebidas', 'Distribuidora ABC', 'UN', 4.5, 7.2, '', 24, 6],
  ['Arroz Tipo 1 5kg', '', 'Alimentos', '', 'PC', 18.5, '', 30, 30, 5],
];

/** Gera o arquivo .xlsx modelo para o usuario baixar, preencher e importar. */
function gerarModelo() {
  const ws = XLSX.utils.aoa_to_sheet([COLUNAS_MODELO, ...LINHAS_EXEMPLO]);
  ws['!cols'] = COLUNAS_MODELO.map((c) => ({ wch: Math.max(14, c.length + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Normaliza um cabecalho para comparacao: minusculo, sem acento, so alfanumerico. */
function normalizarCabecalho(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const MAPA_CAMPOS = {
  nome: 'nome', produto: 'nome',
  codigodebarras: 'codigo_barras', codigobarras: 'codigo_barras', ean: 'codigo_barras', codigo: 'codigo_barras',
  categoria: 'categoria',
  fornecedor: 'fornecedor',
  unidade: 'unidade', un: 'unidade',
  custo: 'custo', precocusto: 'custo', valorcusto: 'custo',
  precodevenda: 'preco_venda', preco: 'preco_venda', precovenda: 'preco_venda',
  valordevenda: 'preco_venda', valorvenda: 'preco_venda',
  markup: 'markup', markuppct: 'markup', markuppercentual: 'markup',
  estoqueinicial: 'estoque_atual', estoqueatual: 'estoque_atual', estoque: 'estoque_atual',
  estoqueminimo: 'estoque_minimo', estmin: 'estoque_minimo',
};

/**
 * Le um arquivo de planilha (.xlsx/.xls/.csv) e devolve as linhas mapeadas
 * para o formato do cadastro em lote. Nao persiste nada no banco — apenas
 * interpreta o arquivo para o usuario revisar antes de salvar.
 */
function analisarPlanilha(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    throw new AppError('Nao foi possivel ler o arquivo. Verifique se e uma planilha valida (.xlsx, .xls ou .csv).');
  }

  const nomeAba = wb.SheetNames[0];
  if (!nomeAba) throw new AppError('A planilha esta vazia.');
  const ws = wb.Sheets[nomeAba];
  const linhasBrutas = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!linhasBrutas.length) throw new AppError('A planilha nao tem nenhuma linha de dados.');

  const linhas = linhasBrutas
    .map((bruta) => {
      const linha = {};
      for (const [chaveOriginal, valor] of Object.entries(bruta)) {
        const campo = MAPA_CAMPOS[normalizarCabecalho(chaveOriginal)];
        if (campo) linha[campo] = typeof valor === 'string' ? valor.trim() : valor;
      }
      return linha;
    })
    .filter((l) => l.nome);

  if (!linhas.length) {
    throw new AppError(
      'Nenhuma linha valida encontrada. Confira se a planilha usa as colunas do modelo (ao menos a coluna "Nome" precisa estar preenchida).'
    );
  }
  return linhas;
}

module.exports = { gerarModelo, analisarPlanilha };
