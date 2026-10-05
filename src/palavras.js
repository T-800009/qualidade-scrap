// Filtro de palavras impróprias.
// Para acrescentar palavras, edite as listas abaixo (sempre sem acento, minúsculas
// e com letras repetidas reduzidas a uma: "porra" vira "pora", "carralho" vira "caralho").

// Palavra inteira
const EXATAS = [
  'pora', 'poras', 'porinha', 'puta', 'putas', 'puto', 'putos', 'foda', 'fodas', 'fodase',
  'foder', 'fode', 'fodeu', 'fudeu', 'fude', 'fuder', 'fudido', 'fudida', 'fodido', 'fodida',
  'merda', 'merdas', 'bosta', 'bostas', 'caralho', 'caralhos', 'cacete', 'krl', 'crl', 'kct',
  'pqp', 'vsf', 'tnc', 'vtnc', 'fdp', 'pnc', 'tmnc', 'vtmnc', 'bct',
  'buceta', 'boceta', 'xota', 'xoxota', 'xereca', 'piroca', 'punheta', 'boquete', 'siririca',
  'viado', 'viados', 'bicha', 'otario', 'otaria', 'idiota', 'idiotas', 'imbecil', 'babaca', 'corno', 'cornos',
  'vagabundo', 'vagabunda', 'safado', 'safada', 'desgracado', 'desgracada', 'retardado', 'retardada',
  'lazarento', 'lazarenta', 'arombado', 'arombada', 'escroto', 'escrota', 'cuzao', 'cuzinho',
  'filhodaputa', 'filhadaputa', 'vaisefoder', 'vaitomarnocu', 'tomarnocu', 'tomanocu', 'nocu', 'seucu',
  'fuck', 'fucking', 'shit', 'bitch', 'asshole', 'dick', 'motherfucker',
];

// Começo da palavra (pega derivações: merdinha, caralhada, putaria…)
const RADICAIS = [
  'merd', 'bostinh', 'caralh', 'cacet', 'putari', 'putinh', 'arombad', 'bucet', 'bocet', 'piroc',
  'punhet', 'fodid', 'fodend', 'fudend', 'fudid', 'cuza', 'otari', 'imbecil', 'babac', 'desgrac',
  'vagabund', 'escrot', 'viadinh', 'viadag', 'filhodaput', 'filhadaput', 'fuck',
];

const TROCA = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i' };

function tokens(texto) {
  const base = String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[0134578@$!|]/g, (c) => TROCA[c]);
  const partes = base.split(/[^a-z]+/).filter(Boolean).map((t) => t.replace(/(.)\1+/g, '$1'));

  // Junta 3+ letras soltas em sequência: "m e r d a" -> "merda" ("c/u" não conta)
  const juntas = [];
  let soltas = '';
  for (const t of partes) {
    if (t.length === 1) { soltas += t; continue; }
    if (soltas.length > 2) juntas.push(soltas.replace(/(.)\1+/g, '$1'));
    soltas = '';
    juntas.push(t);
  }
  if (soltas.length > 2) juntas.push(soltas.replace(/(.)\1+/g, '$1'));

  // Também confere pares de palavras coladas: "vai se" + "foder" etc.
  // (só palavras de 2+ letras, para "c/u" não virar uma palavra)
  const pal = partes.filter((t) => t.length > 1);
  const pares = [];
  for (let i = 0; i < pal.length - 1; i++) pares.push(pal[i] + pal[i + 1]);
  for (let i = 0; i < pal.length - 2; i++) pares.push(pal[i] + pal[i + 1] + pal[i + 2]);

  return [...partes, ...juntas, ...pares];
}

const EXATAS_SET = new Set(EXATAS);

export function temPalavrao(texto) {
  return tokens(texto).some((t) => EXATAS_SET.has(t) || RADICAIS.some((r) => t.startsWith(r)));
}
