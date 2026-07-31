'use strict';

/**
 * Modelos de documento do instituto.
 *
 * Cada instituicao tem o seu texto — o que esta no estatuto, o que o
 * contador pediu, o que a prefeitura aceita. Em vez de fixar a redacao no
 * codigo, o texto fica editavel e os dados entram por marcadores
 * ({{nome_do_voluntario}}), preenchidos na hora de emitir.
 *
 * O banco guarda so o que foi editado: quem nao mexer continua no padrao,
 * e o padrao pode melhorar numa atualizacao sem sobrescrever o texto de
 * ninguem.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

// ------------------------------ Marcadores ------------------------------
// Descritos aqui para a tela poder mostrar a lista de cada modelo — sem
// isso o usuario teria que adivinhar o que pode escrever.

const MARCADORES_COMUNS = [
  ['instituto_nome', 'Nome do instituto'],
  ['instituto_cnpj', 'CNPJ'],
  ['instituto_endereco', 'Endereço'],
  ['instituto_telefone', 'Telefone'],
  ['instituto_cidade', 'Cidade (preenchida em Configurações)'],
  ['data_extenso', 'Data de hoje por extenso (ex.: 31 de julho de 2026)'],
  ['data', 'Data de hoje (31/07/2026)'],
  ['assinante_nome', 'Quem assina pelo instituto'],
  ['assinante_cargo', 'Cargo de quem assina'],
  ['assinatura_instituto', 'Linha de assinatura do instituto (já com nome e cargo)'],
];

const MARCADORES_VOLUNTARIO = [
  ['voluntario_nome', 'Nome do voluntário'],
  ['voluntario_documento', 'CPF/RG do voluntário'],
  ['voluntario_endereco', 'Endereço do voluntário'],
  ['voluntario_telefone', 'Telefone'],
  ['voluntario_email', 'E-mail'],
  ['assinatura_pessoa', 'Linha de assinatura do voluntário (já com o CPF embaixo)'],
];

const MODELOS = {
  termo_voluntariado: {
    titulo: 'Termo de adesão ao serviço voluntário',
    descricao: 'Assinado quando o voluntário entra. É o documento que a Lei 9.608/1998 exige para não haver vínculo empregatício.',
    marcadores: [
      ...MARCADORES_VOLUNTARIO,
      ['atividade', 'Atividade que o voluntário vai exercer (perguntada ao gerar)'],
      ['carga_semanal', 'Dedicação combinada (perguntada ao gerar)'],
      ['inicio', 'Data de início (perguntada ao gerar)'],
      ...MARCADORES_COMUNS,
    ],
    titulo_documento: 'TERMO DE ADESÃO AO SERVIÇO VOLUNTÁRIO',
    padrao: `Pelo presente instrumento particular, de um lado a **{{instituto_nome}}**, entidade de natureza religiosa, sem fins lucrativos, inscrita no CNPJ nº {{instituto_cnpj}}, com sede em {{instituto_endereco}}, doravante denominada **INSTITUIÇÃO**, e, de outro lado, **{{voluntario_nome}}**, inscrito(a) no CPF nº {{voluntario_documento}}, residente e domiciliado(a) em {{voluntario_endereco}}, doravante denominado(a) **VOLUNTÁRIO(A)**.

Resolvem firmar o presente termo de adesão ao serviço voluntário, que se regerá pelas disposições da Lei nº 9.608, de 18 de fevereiro de 1998, e pelas cláusulas e condições seguintes:

**CLÁUSULA 1 – DO OBJETO**

O presente Termo tem por objeto a adesão do(a) VOLUNTÁRIO(A) ao projeto de música da {{instituto_nome}}, iniciativa de caráter religioso, educacional, cultural e social, voltada à promoção do ensino musical, desenvolvimento cultural e evangelização por meio da música, sem qualquer finalidade lucrativa.

**CLÁUSULA 2 – DA NATUREZA VOLUNTÁRIA DO SERVIÇO**

As atividades desenvolvidas pelo(a) VOLUNTÁRIO(A) possuem natureza estritamente voluntária, prestadas de forma espontânea e gratuita, nos termos da Lei nº 9.608/1998.

**Parágrafo único.** A prestação de serviço voluntário não gera vínculo empregatício, nem qualquer obrigação de natureza trabalhista, previdenciária, fiscal ou afim entre o(a) VOLUNTÁRIO(A) e a INSTITUIÇÃO.

**CLÁUSULA 3 – DA AUSÊNCIA DE REMUNERAÇÃO**

O(A) VOLUNTÁRIO(A) declara ciência de que não haverá qualquer tipo de remuneração, salário, contraprestação financeira ou benefício obrigatório em razão das atividades desenvolvidas no âmbito da oficina de música.

**CLÁUSULA 4 – DE EVENTUAIS OFERTAS OU CONTRIBUIÇÕES**

O(A) VOLUNTÁRIO(A) reconhece que, em razão das atividades do projeto, eventuais ofertas, doações, contribuições espontâneas ou ajudas de custo poderão ocorrer, inclusive por iniciativa de terceiros.

Tais valores, quando existentes, não possuem natureza salarial, não caracterizam contraprestação pelo serviço prestado e não estabelecem vínculo empregatício.

O(A) VOLUNTÁRIO(A) declara ciência de que tais valores possuem caráter meramente eventual, espontâneo e não obrigatório, não constituindo compromisso, promessa ou obrigação da INSTITUIÇÃO.

Em razão de sua natureza eventual, não poderá o(a) VOLUNTÁRIO(A) alegar direito à habitualidade, expectativa de recebimento, continuidade ou qualquer espécie de remuneração futura.

**CLÁUSULA 5 – DAS ATIVIDADES**

O(A) VOLUNTÁRIO(A) atuará especialmente como {{atividade}}, com dedicação aproximada de {{carga_semanal}}, a partir de {{inicio}}, podendo colaborar nas atividades relacionadas ao Projeto de Música, incluindo, mas não se limitando a:

I – ensino e orientação musical;
II – participação em ensaios e apresentações;
III – apoio na organização de eventos culturais e religiosos;
IV – colaboração em atividades de evangelização por meio da música;
V – demais atividades compatíveis com os objetivos do projeto.

**CLÁUSULA 6 – DOS PRINCÍPIOS INSTITUCIONAIS**

O(A) VOLUNTÁRIO(A) compromete-se a respeitar os princípios éticos, morais e cristãos que orientam as atividades da INSTITUIÇÃO, bem como zelar pela boa convivência, respeito e cooperação no exercício de suas atividades.

**CLÁUSULA 7 – DA RESCISÃO**

O presente termo poderá ser rescindido a qualquer tempo, por qualquer das partes, mediante simples comunicação prévia, sem que disso decorra qualquer direito a indenização ou compensação financeira.

**CLÁUSULA 8 – DA VIGÊNCIA**

O presente Termo entra em vigor na data de sua assinatura e permanecerá válido enquanto perdurar a participação do(a) VOLUNTÁRIO(A) no Projeto de Música da {{instituto_nome}}.

{{instituto_cidade}}, {{data_extenso}}.

{{assinatura_pessoa}}

{{assinatura_instituto}}`,
  },

  declaracao_voluntariado: {
    titulo: 'Declaração de trabalho voluntário',
    descricao: 'Comprova as horas dedicadas. É o papel que o voluntário costuma precisar para a faculdade ou para o trabalho.',
    marcadores: [
      ...MARCADORES_VOLUNTARIO,
      ['periodo_de', 'Início do período declarado'],
      ['periodo_ate', 'Fim do período declarado'],
      ['horas', 'Total de horas no período'],
      ['aulas', 'Quantidade de aulas dadas'],
      ['atividades', 'Quantidade de atividades de apoio'],
      ['resumo_atividades', 'Frase pronta com o que a pessoa fez'],
      ...MARCADORES_COMUNS,
    ],
    titulo_documento: 'DECLARAÇÃO DE TRABALHO VOLUNTÁRIO',
    padrao: `Declaramos, para os devidos fins, que {{voluntario_nome}}, portador(a) do documento {{voluntario_documento}}, prestou serviço voluntário nesta instituição no período de {{periodo_de}} a {{periodo_ate}}, tendo {{resumo_atividades}}, totalizando **{{horas}} hora(s)** de dedicação.

O trabalho voluntário aqui declarado não gera vínculo empregatício nem obrigação de natureza trabalhista, previdenciária ou afim, nos termos da Lei nº 9.608/1998.

Por ser expressão da verdade, firmamos a presente declaração.

{{data_extenso}}.

{{assinatura_instituto}}`,
  },

  declaracao_matricula: {
    titulo: 'Declaração de matrícula',
    descricao: 'Comprova que o aluno frequenta o instituto. Pedida por escola, posto de saúde e programas sociais.',
    marcadores: [
      ['aluno_nome', 'Nome do aluno'],
      ['aluno_cpf', 'CPF do aluno'],
      ['aluno_nascimento', 'Data de nascimento por extenso'],
      ['responsavel_nome', 'Nome do responsável'],
      ['turmas', 'Lista das turmas em que está matriculado'],
      ...MARCADORES_COMUNS,
    ],
    titulo_documento: 'DECLARAÇÃO DE MATRÍCULA',
    padrao: `Declaramos, para os devidos fins, que {{aluno_nome}}, inscrito(a) no CPF sob o nº {{aluno_cpf}}, nascido(a) em {{aluno_nascimento}}, sob a responsabilidade de {{responsavel_nome}}, encontra-se regularmente matriculado(a) nesta instituição, participando das seguintes atividades:

{{turmas}}

As atividades são oferecidas gratuitamente, sem qualquer custo para o(a) participante ou sua família.

Por ser expressão da verdade, firmamos a presente declaração.

{{data_extenso}}.

{{assinatura_instituto}}`,
  },

  certificado: {
    titulo: 'Certificado de conclusão',
    descricao: 'Entregue ao aluno que concluiu a turma. Sai em paisagem.',
    marcadores: [
      ['aluno_nome', 'Nome do aluno'],
      ['curso', 'Nome do curso'],
      ['turma', 'Nome da turma'],
      ['carga_horaria', 'Carga horária do curso'],
      ['frequencia', 'Frequência do aluno (%)'],
      ['periodo_inicio', 'Início do período por extenso'],
      ['periodo_fim', 'Fim do período por extenso'],
      ['instrutores', 'Instrutor(es) da turma'],
      ...MARCADORES_COMUNS,
    ],
    titulo_documento: 'CERTIFICADO',
    padrao: `<center>Certificamos que</center>

<destaque>{{aluno_nome}}</destaque>

concluiu o curso de **{{curso}}**, turma {{turma}}, com carga horária de **{{carga_horaria}} hora(s)** e frequência de **{{frequencia}}**, realizado no período de {{periodo_inicio}} a {{periodo_fim}}, sob orientação de {{instrutores}}.

{{data_extenso}}.

{{assinatura_instituto}}`,
  },
};

const CHAVES = Object.keys(MODELOS);

function definicao(chave) {
  const d = MODELOS[chave];
  if (!d) throw new AppError('Modelo de documento não encontrado.', 404);
  return d;
}

/** O texto em uso: o editado, se houver; senão o padrão do sistema. */
function obter(chave) {
  const d = definicao(chave);
  const salvo = getDb().prepare('SELECT * FROM modelos_documento WHERE chave = ?').get(chave);
  return {
    chave,
    titulo: d.titulo,
    descricao: d.descricao,
    titulo_documento: d.titulo_documento,
    marcadores: d.marcadores.map(([m, desc]) => ({ marcador: m, descricao: desc })),
    corpo: salvo ? salvo.corpo : d.padrao,
    padrao: d.padrao,
    personalizado: !!salvo,
    atualizado_em: salvo ? salvo.atualizado_em : null,
  };
}

function listar() {
  return CHAVES.map(obter);
}

/**
 * Salva o texto do instituto. Guarda apenas se for diferente do padrao —
 * assim quem "editou de volta" para o original volta a acompanhar as
 * melhorias do sistema.
 */
function salvar(chave, corpo) {
  const d = definicao(chave);
  const texto = String(corpo == null ? '' : corpo).trim();
  if (!texto) throw new AppError('O modelo não pode ficar vazio. Use "Restaurar padrão" se quiser voltar ao texto original.');

  const db = getDb();
  if (texto === d.padrao.trim()) {
    db.prepare('DELETE FROM modelos_documento WHERE chave = ?').run(chave);
    return obter(chave);
  }
  db.prepare(`
    INSERT INTO modelos_documento (chave, corpo) VALUES (?, ?)
    ON CONFLICT(chave) DO UPDATE SET corpo = excluded.corpo, atualizado_em = datetime('now','localtime')
  `).run(chave, texto);
  // Marcador escrito errado nao impede salvar (pode ser texto proposital),
  // mas volta como aviso para a tela mostrar antes de alguem emitir.
  return { ...obter(chave), avisos: marcadoresDesconhecidos(chave, texto) };
}

function restaurarPadrao(chave) {
  definicao(chave);
  getDb().prepare('DELETE FROM modelos_documento WHERE chave = ?').run(chave);
  return obter(chave);
}

/**
 * Marcador que ficou sem valor vira "—" em vez de aparecer cru no PDF: um
 * documento com "{{aluno_cpf}}" impresso e pior do que um tracinho.
 */
function preencher(corpo, dados) {
  return String(corpo || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, chave) => {
    const v = dados[chave.toLowerCase()];
    return v == null || v === '' ? '—' : String(v);
  });
}

/** Quais marcadores do texto não existem — a tela avisa antes de emitir. */
function marcadoresDesconhecidos(chave, corpo) {
  const validos = new Set(definicao(chave).marcadores.map(([m]) => m));
  const usados = String(corpo || '').match(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi) || [];
  return [...new Set(usados
    .map((u) => u.replace(/[{}\s]/g, '').toLowerCase())
    .filter((u) => !validos.has(u)))];
}

module.exports = { listar, obter, salvar, restaurarPadrao, preencher, marcadoresDesconhecidos, MODELOS, CHAVES };
