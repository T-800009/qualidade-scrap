import APP_HTML from './app.html';
import LOGIN_HTML from './login.html';
import { temPalavrao } from './palavras.js';

// Marca: etiqueta de inspeção branca com o check vermelho, na faixa azul-marinho
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1a365d"/><path fill="#fff" fill-rule="evenodd" d="M24 10h16l10 10v31a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3V20zm8 5.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/><path d="m22.5 37.5 6.8 6.8 12.7-13" fill="none" stroke="#c8102e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const MSG_PALAVRAO = 'Esse texto tem palavras impróprias. Reescreva de forma profissional.';

// Muda a cada publicação: abra /versao no navegador para conferir o que está no ar
const VERSAO = '2026-10-07 · PCP + visual novo';
// A página leva a versão (rodapé e aviso de versão nova)
const APP_PAGINA = APP_HTML.replaceAll('__VERSAO__', VERSAO);
const SESSAO_HORAS = 12;
const MAX_FALHAS = 10;          // a fábrica sai por um IP só: limite folgado para um erro não travar todo mundo
const BLOQUEIO_MS = 5 * 60 * 1000;
const COOKIE = 'qs_sess';
const enc = new TextEncoder();

// Tabelas criadas automaticamente (não precisa rodar SQL no painel)
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bom (
     projeto TEXT NOT NULL, material TEXT NOT NULL, descricao TEXT, unidade TEXT, classe TEXT,
     updated_at TEXT NOT NULL, PRIMARY KEY (projeto, material))`,
  `CREATE INDEX IF NOT EXISTS idx_bom_material ON bom(material)`,
  `CREATE TABLE IF NOT EXISTS scrap (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     created_at TEXT NOT NULL,
     posto INTEGER NOT NULL CHECK (posto BETWEEN 1 AND 10),
     material TEXT NOT NULL, projeto TEXT NOT NULL, descricao_material TEXT,
     quantidade REAL NOT NULL CHECK (quantidade > 0), unidade TEXT,
     defeito TEXT NOT NULL, descricao_problema TEXT NOT NULL, registrado_por TEXT,
     fora_bom INTEGER NOT NULL DEFAULT 0, matricula TEXT, excluido_em TEXT, excluido_por TEXT,
     editado_em TEXT, editado_por TEXT, classe TEXT,
     status TEXT NOT NULL DEFAULT 'analise', parecer TEXT, analisado_por TEXT, analisado_em TEXT,
     material_anterior TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_scrap_data ON scrap(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_scrap_posto ON scrap(posto, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_scrap_projeto ON scrap(projeto, created_at)`,
  `CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT)`,
  `CREATE TABLE IF NOT EXISTS foto (
     id INTEGER PRIMARY KEY AUTOINCREMENT, scrap_id INTEGER NOT NULL, criado_em TEXT NOT NULL,
     tipo TEXT NOT NULL, partes INTEGER NOT NULL, enviado_por TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_foto_scrap ON foto(scrap_id, id)`,
  `CREATE TABLE IF NOT EXISTS foto_parte (
     foto_id INTEGER NOT NULL, n INTEGER NOT NULL, dados TEXT NOT NULL, PRIMARY KEY (foto_id, n))`,
  // Relatório de avarias da Qualidade: um formulário por peça (código + fotos). As fotos ficam na
  // tabela foto com avaria_id (e scrap_id = 0). "chave" é o código sem hífen/ponto, para ligar com os
  // registros de scrap do mesmo material.
  `CREATE TABLE IF NOT EXISTS avaria (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     created_at TEXT NOT NULL,
     material TEXT NOT NULL, chave TEXT NOT NULL, projeto TEXT, descricao_material TEXT,
     unidade TEXT, classe TEXT, fora_bom INTEGER NOT NULL DEFAULT 0,
     quantidade REAL NOT NULL DEFAULT 1, defeito TEXT, observacao TEXT,
     situacao TEXT NOT NULL DEFAULT 'analise',
     registrado_por TEXT, matricula TEXT, editado_em TEXT, editado_por TEXT,
     excluido_em TEXT, excluido_por TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_avaria_data ON avaria(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_avaria_chave ON avaria(chave, created_at)`,
  `CREATE TABLE IF NOT EXISTS projeto_extra (projeto TEXT PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
     ip TEXT PRIMARY KEY, falhas INTEGER NOT NULL DEFAULT 0, bloqueado_ate INTEGER NOT NULL DEFAULT 0)`,
];
// Relatório de Avarias FO.QA.A.049 (um por ocorrência): número RA-0000-ano por ano, os campos do
// formulário em "dados" (JSON) e quando o e-mail foi preparado
const MIGRACOES_AVARIA = [
  'ALTER TABLE avaria ADD COLUMN ano INTEGER',
  'ALTER TABLE avaria ADD COLUMN numero INTEGER',
  'ALTER TABLE avaria ADD COLUMN dados TEXT',
  'ALTER TABLE avaria ADD COLUMN email_em TEXT',
  'ALTER TABLE avaria ADD COLUMN email_por TEXT',
];
// Colunas adicionadas depois da primeira versão (ignora se já existem)
const MIGRACOES = [
  'ALTER TABLE scrap ADD COLUMN matricula TEXT',
  'ALTER TABLE scrap ADD COLUMN excluido_em TEXT',
  'ALTER TABLE scrap ADD COLUMN excluido_por TEXT',
  'ALTER TABLE scrap ADD COLUMN editado_em TEXT',
  'ALTER TABLE scrap ADD COLUMN editado_por TEXT',
  'ALTER TABLE scrap ADD COLUMN classe TEXT',
  "ALTER TABLE scrap ADD COLUMN status TEXT NOT NULL DEFAULT 'analise'",
  'ALTER TABLE scrap ADD COLUMN parecer TEXT',
  'ALTER TABLE scrap ADD COLUMN analisado_por TEXT',
  'ALTER TABLE scrap ADD COLUMN analisado_em TEXT',
  'ALTER TABLE scrap ADD COLUMN material_anterior TEXT',
  // PCP: baixa do scrap feita e peça arrumada (quem marcou e quando)
  'ALTER TABLE scrap ADD COLUMN scrap_feito_em TEXT',
  'ALTER TABLE scrap ADD COLUMN scrap_feito_por TEXT',
  'ALTER TABLE scrap ADD COLUMN arrumado_em TEXT',
  'ALTER TABLE scrap ADD COLUMN arrumado_por TEXT',
];
let schemaOk = null;
function garantirSchema(env) {
  if (!schemaOk) {
    schemaOk = (async () => {
      await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
      const cols = (await env.DB.prepare('PRAGMA table_info(scrap)').all()).results.map((c) => c.name);
      for (const m of MIGRACOES) {
        const col = m.split(' ')[5];
        if (!cols.includes(col)) await env.DB.prepare(m).run();
      }
      const colsBom = (await env.DB.prepare('PRAGMA table_info(bom)').all()).results.map((c) => c.name);
      if (!colsBom.includes('classe')) await env.DB.prepare('ALTER TABLE bom ADD COLUMN classe TEXT').run();
      const colsFoto = (await env.DB.prepare('PRAGMA table_info(foto)').all()).results.map((c) => c.name);
      if (!colsFoto.includes('enviado_por')) await env.DB.prepare('ALTER TABLE foto ADD COLUMN enviado_por TEXT').run();
      // Fotos do relatório de avarias (avaria_id) e miniatura que o relatório mostra e imprime
      if (!colsFoto.includes('avaria_id')) await env.DB.prepare('ALTER TABLE foto ADD COLUMN avaria_id INTEGER').run();
      if (!colsFoto.includes('mini')) await env.DB.prepare('ALTER TABLE foto ADD COLUMN mini TEXT').run();
      // Foto do relatório de avarias: 'nc' (evidência da avaria) ou 'ok' (padrão aceitável)
      if (!colsFoto.includes('categoria')) await env.DB.prepare('ALTER TABLE foto ADD COLUMN categoria TEXT').run();
      const colsAv = (await env.DB.prepare('PRAGMA table_info(avaria)').all()).results.map((c) => c.name);
      const faltam = MIGRACOES_AVARIA.filter((m) => !colsAv.includes(m.split(' ')[5]));
      if (faltam.length) await env.DB.batch(faltam.map((m) => env.DB.prepare(m)));
      // Depois das colunas novas: índices e lista de projetos fora da BOM (uma vez só)
      await env.DB.batch([
        'CREATE INDEX IF NOT EXISTS idx_scrap_matricula ON scrap(matricula, created_at)',
        'CREATE INDEX IF NOT EXISTS idx_scrap_status ON scrap(status, created_at)',
        'CREATE INDEX IF NOT EXISTS idx_foto_avaria ON foto(avaria_id, id)',
        // número RA não se repete entre os relatórios ativos do ano
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_avaria_ra ON avaria(ano, numero) WHERE excluido_em IS NULL',
      ].map((s) => env.DB.prepare(s)));
      const limpo = await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'migr_unidade'").first();
      if (!limpo) {
        await env.DB.batch([
          env.DB.prepare("UPDATE bom SET unidade = '' WHERE unidade <> '' AND unidade NOT GLOB '[A-Za-z]*'"),
          env.DB.prepare("UPDATE scrap SET unidade = '' WHERE unidade <> '' AND unidade NOT GLOB '[A-Za-z]*'"),
          env.DB.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('migr_unidade', '1')"),
          env.DB.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('bom_versao', ?)").bind('u' + Date.now()),
        ]);
      }
      const feito = await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'migr_projeto_extra'").first();
      if (!feito) {
        await env.DB.batch([
          env.DB.prepare('INSERT OR IGNORE INTO projeto_extra (projeto) SELECT DISTINCT projeto FROM scrap'),
          env.DB.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('migr_projeto_extra', '1')"),
        ]);
      }
    })().catch((e) => { schemaOk = null; throw e; });
  }
  return schemaOk;
}

export default {
  async fetch(req, env) {
    try {
      if (!env.DB) return json({ erro: 'Banco D1 (binding DB) não configurado no Worker' }, 500);
      await garantirSchema(env);
      return await rotear(req, env);
    } catch (e) {
      console.error(e);
      return json({ erro: 'Erro interno: ' + e.message }, 500);
    }
  },
};

async function rotear(req, env) {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;

  if (p === '/favicon.svg' || p === '/favicon.ico') {
    return new Response(LOGO_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
  }
  if (p === '/versao') return json({ versao: VERSAO });
  if (p === '/login' && m === 'GET') return html(LOGIN_HTML);
  if (p === '/login' && m === 'POST') return login(req, env);
  if (p === '/logout') return logout(url);

  const role = await lerSessao(req, env);
  if (!role) {
    if (p.startsWith('/api/')) return json({ erro: 'Sessão expirada' }, 401);
    return Response.redirect(url.origin + '/login', 302);
  }

  if (p === '/' && m === 'GET') return html(APP_PAGINA);
  if (p === '/api/me') return json({ role });
  if (p === '/api/material' && m === 'GET') return buscarMaterial(url, env);
  if (p === '/api/projetos' && m === 'GET') return listarNomesProjetos(env);
  if (p === '/api/scrap' && m === 'POST') return criarScrap(req, env);
  if (p === '/api/scrap' && m === 'GET') return listarScrap(url, env);
  if (p === '/api/stats' && m === 'GET') return estatisticas(url, env);
  if (p === '/api/operador' && m === 'GET') return buscarOperador(url, env);
  if (p === '/api/validar-nome' && m === 'POST') {
    const { nome = '' } = await req.json().catch(() => ({}));
    return temPalavrao(nome) ? json({ erro: 'Esse nome tem palavras impróprias.', campo: 'nome' }, 422) : json({ ok: true });
  }

  const podeFoto = role === 'admin' || role === 'qualidade';
  const mFoto = p.match(/^\/api\/foto\/(\d+)$/);
  if (mFoto && m === 'GET') return servirFoto(env, Number(mFoto[1]), url.searchParams.has('mini'));
  if (mFoto && m === 'DELETE') {
    if (!podeFoto) return json({ erro: 'Só a Qualidade pode remover fotos.' }, 403);
    return removerFoto(env, Number(mFoto[1]));
  }
  const mAddFoto = p.match(/^\/api\/scrap\/(\d+)\/fotos$/);
  if (mAddFoto && m === 'POST') {
    if (!podeFoto) return json({ erro: 'Só a Qualidade pode adicionar fotos.' }, 403);
    return adicionarFotos(req, env, Number(mAddFoto[1]));
  }

  // Relatório de avarias (FO.QA.A.049): todos veem; a Qualidade (e o admin) monta, edita, exclui e envia
  if (p === '/api/avaria' && m === 'GET') return listarAvarias(url, env);
  if (p === '/api/avaria/material' && m === 'GET') return avariasDoMaterial(url, env);
  if (p === '/api/avaria/proximo' && m === 'GET') return proximoRA(url, env);
  if (p === '/api/avaria/config' && m === 'GET') return configEmail(env);
  if (p === '/api/avaria/config' && m === 'PUT') {
    if (!podeFoto) return json({ erro: 'Só a Qualidade pode mudar os destinatários.' }, 403);
    return salvarConfigEmail(req, env);
  }
  const mAv = p.match(/^\/api\/avaria(?:\/(\d+)(?:\/(fotos|fotos-ok|email))?)?$/);
  if (mAv && m !== 'GET') {
    if (!podeFoto) return json({ erro: 'Só a Qualidade pode mexer no relatório de avarias.' }, 403);
    const id = Number(mAv[1]), sub = mAv[2];
    if (!id && m === 'POST') return criarAvaria(req, env);
    if (id && sub === 'fotos' && m === 'POST') return fotosAvaria(req, env, id);
    if (id && sub === 'fotos-ok' && m === 'POST') return copiarFotosOk(req, env, id);
    if (id && sub === 'email' && m === 'POST') return marcarEmail(req, env, id);
    if (id && !sub && m === 'PATCH') return editarAvaria(req, env, id);
    if (id && !sub && m === 'DELETE') return excluirAvaria(req, env, id);
  }

  if (p === '/api/analise/contagem' && m === 'GET') {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM scrap WHERE status = 'analise' AND excluido_em IS NULL").first();
    return json({ pendentes: r.n });
  }
  const mAnalise = p.match(/^\/api\/scrap\/(\d+)\/analise$/);
  if (mAnalise && m === 'POST') {
    if (!podeFoto) return json({ erro: 'Só a Qualidade pode dar o parecer.' }, 403);
    return analisarScrap(req, env, Number(mAnalise[1]));
  }

  // PCP: marcar (ou desmarcar) "scrap feito" e "arrumado" em um ou vários registros
  if (p === '/api/scrap/pcp' && m === 'POST') {
    if (!podeFoto) return json({ erro: 'Só a Qualidade e o administrador marcam o que o PCP já resolveu.' }, 403);
    return marcarPcp(req, env);
  }

  const mScrap = p.match(/^\/api\/scrap\/(\d+)$/);
  if (mScrap && (m === 'DELETE' || m === 'PATCH')) {
    if (role !== 'admin') return json({ erro: 'Só o administrador pode apagar ou editar registros.' }, 403);
    return m === 'DELETE' ? excluirScrap(env, Number(mScrap[1])) : editarScrap(req, env, Number(mScrap[1]));
  }

  if (p.startsWith('/api/bom')) {
    if (role !== 'admin') return json({ erro: 'Apenas admin' }, 403);
    if (p === '/api/bom/projetos' && m === 'GET') return listarProjetosBom(env);
    if (p === '/api/bom/import' && m === 'POST') return importarBom(req, env);
    if (p === '/api/bom/itens' && m === 'GET') return listarItensBom(url, env);
    if (p === '/api/bom/classe' && m === 'POST') return definirClasseBom(req, env);
    if (p === '/api/bom/item' && m === 'POST') return salvarItemBom(req, env);
    if (p === '/api/bom/item' && m === 'DELETE') return excluirItemBom(url, env);
    const mProj = p.match(/^\/api\/bom\/projeto\/(.+)$/);
    if (mProj && m === 'DELETE') {
      const proj = decodeURIComponent(mProj[1]).toUpperCase();
      const r = await env.DB.prepare('DELETE FROM bom WHERE projeto = ?').bind(proj).run();
      await novaVersaoBom(env);
      return json({ ok: true, removidos: r.meta?.changes ?? 0 });
    }
  }

  return json({ erro: 'Não encontrado' }, 404);
}

/* ---------------- utilidades ---------------- */

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function html(body) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const normCodigo = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
const texto = (s, max) => String(s ?? '').trim().slice(0, max);
const semCuringa = (s) => s.replace(/[%_]/g, '');
// Unidade de medida válida começa com letra (PC, UN, M, KG, M2…). Número solto ("1") é descartado:
// era isso que fazia "1 PC" aparecer como "1 1" quando a coluna errada da BOM virava unidade.
const normUn = (s) => {
  const u = String(s ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return /^[A-Z][A-Z0-9]*$/.test(u) ? u : '';
};
// Chave de busca sem hífen/ponto/espaço: "16340846-00" = "1634084600"
// Classe da peça na BOM (coluna CLASSIFICAÇÃO): A, B, C…
const normClasse = (s) => String(s ?? '').trim().toUpperCase().replace(/^CLASSE\s*/, '').slice(0, 10);
const chaveCodigo = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* ---------------- autenticação ---------------- */

async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

function iguais(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function senhaConfere(digitada, correta) {
  if (!digitada || !correta) return false;
  return iguais(await sha256(digitada), await sha256(correta));
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function assinar(env, msg) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg))));
}

async function lerSessao(req, env) {
  if (!env.SESSION_SECRET) return null;
  const c = req.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return null;
  const [role, exp, sig] = m[1].split('.');
  if (!['admin', 'qualidade', 'operador'].includes(role) || !exp || !sig) return null;
  if (Date.now() > Number(exp)) return null;
  const esperado = await assinar(env, role + '.' + exp);
  return iguais(enc.encode(sig), enc.encode(esperado)) ? role : null;
}

async function login(req, env) {
  if (!env.QUALIDADE_PASSWORD || !env.SESSION_SECRET) {
    return json({ erro: 'Secrets QUALIDADE_PASSWORD / SESSION_SECRET não configurados' }, 500);
  }
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const agora = Date.now();
  const reg = await env.DB.prepare('SELECT falhas, bloqueado_ate FROM login_attempts WHERE ip = ?').bind(ip).first();
  if (reg && reg.bloqueado_ate > agora) {
    const min = Math.ceil((reg.bloqueado_ate - agora) / 60000);
    return json({ erro: `Muitas tentativas. Aguarde ${min} min.` }, 429);
  }

  const { senha = '' } = await req.json().catch(() => ({}));
  let role = null;
  if (await senhaConfere(String(senha), env.ADMIN_PASSWORD)) role = 'admin';
  else if (await senhaConfere(String(senha), env.INSPECAO_PASSWORD)) role = 'qualidade';
  else if (await senhaConfere(String(senha), env.QUALIDADE_PASSWORD)) role = 'operador';

  if (!role) {
    const falhas = (reg?.falhas || 0) + 1;
    const bloq = falhas >= MAX_FALHAS ? agora + BLOQUEIO_MS : 0;
    await env.DB.prepare(
      'INSERT INTO login_attempts (ip, falhas, bloqueado_ate) VALUES (?1, ?2, ?3) ' +
      'ON CONFLICT(ip) DO UPDATE SET falhas = ?2, bloqueado_ate = ?3'
    ).bind(ip, bloq ? 0 : falhas, bloq).run();
    return json({
      erro: bloq ? 'Muitas tentativas. Aguarde 5 minutos.' : `Senha incorreta. ${MAX_FALHAS - falhas} tentativa(s) restante(s).`,
    }, 401);
  }

  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  const exp = agora + SESSAO_HORAS * 3600 * 1000;
  const token = `${role}.${exp}.${await assinar(env, role + '.' + exp)}`;
  return json({ ok: true, role }, 200, {
    'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSAO_HORAS * 3600}`,
  });
}

function logout(url) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.origin + '/login',
      'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    },
  });
}

/* ---------------- material / BOM ---------------- */

/*
 * BOM em memória.
 * O plano grátis do D1 conta cada linha lida. Buscar "parte do código" direto no banco
 * leria a BOM inteira a cada tecla; por isso a BOM é carregada uma vez por instância do
 * Worker e as buscas rodam na memória. Uma "versão" guardada na tabela meta avisa
 * quando alguém importou ou excluiu BOM, e aí a memória é recarregada.
 */
const CHECAR_VERSAO_MS = 30 * 1000;
let BOM = null;
let carregandoBom = null;

async function novaVersaoBom(env) {
  BOM = null;
  await env.DB.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('bom_versao', ?)")
    .bind(Date.now() + '-' + Math.random().toString(36).slice(2, 8)).run();
}

async function bomIndex(env, conferirAgora = false) {
  const agora = Date.now();
  if (BOM && !conferirAgora && agora - BOM.checado < CHECAR_VERSAO_MS) return BOM;
  const v = (await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'bom_versao'").first())?.valor || '0';
  if (BOM && BOM.versao === v) { BOM.checado = agora; return BOM; }
  if (!carregandoBom) {
    carregandoBom = (async () => {
      const rows = (await env.DB.prepare('SELECT projeto, material, descricao, unidade, classe, updated_at FROM bom').all()).results;
      return montarIndice(rows, v);
    })().finally(() => { carregandoBom = null; });
  }
  BOM = await carregandoBom;
  return BOM;
}

// Edição feita na tela de BOMs: aplica a mudança nas linhas que já estão na memória desta
// instância (sem reler a BOM inteira a cada clique) e muda a versão para as outras instâncias.
async function bomEditada(env, alterar) {
  const atual = (await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'bom_versao'").first())?.valor || '0';
  const v = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  await env.DB.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('bom_versao', ?)").bind(v).run();
  BOM = BOM && BOM.versao === atual && !carregandoBom ? montarIndice(alterar(BOM.rows), v) : null;
}

function montarIndice(rows, v) {
  const porMaterial = new Map();
  const projetos = new Map();
  for (const r of rows) {
    let m = porMaterial.get(r.material);
    if (!m) { m = { material: r.material, descricao: '', busca: '', linhas: [] }; porMaterial.set(r.material, m); }
    m.linhas.push({ projeto: r.projeto, material: r.material, descricao: r.descricao || '', unidade: normUn(r.unidade), classe: r.classe || '', propria: r.classe || '' });
    if (!m.descricao && r.descricao) { m.descricao = r.descricao; m.busca = r.descricao.toUpperCase(); }
    const pj = projetos.get(r.projeto) || { projeto: r.projeto, itens: 0, comClasse: 0, atualizado: '' };
    pj.itens++;
    if (r.updated_at > pj.atualizado) pj.atualizado = r.updated_at;
    projetos.set(r.projeto, pj);
  }
  const porChave = new Map();
  // A classe (A/B/C) é do material. Se uma BOM não informa, usa a das outras BOMs do mesmo
  // código (com ou sem hífen), desde que todas concordem.
  const grupos = new Map();
  for (const m of porMaterial.values()) {
    m.linhas.sort((a, b) => a.projeto.localeCompare(b.projeto));
    m.chave = chaveCodigo(m.material);
    if (!grupos.has(m.chave)) grupos.set(m.chave, []);
    grupos.get(m.chave).push(m);
    if (!porChave.has(m.chave)) porChave.set(m.chave, m);
  }
  const unica = (lista) => { const u = [...new Set(lista.filter(Boolean))]; return u.length === 1 ? u[0] : ''; };
  for (const ms of grupos.values()) {
    const doGrupo = unica(ms.flatMap((m) => m.linhas.map((l) => l.classe)));
    for (const m of ms) {
      const proprias = m.linhas.map((l) => l.classe).filter(Boolean);
      m.classe = proprias.length ? unica(proprias) : doGrupo;
      for (const l of m.linhas) if (!l.classe) l.classe = m.classe;
    }
  }
  for (const m of porMaterial.values()) for (const l of m.linhas) if (l.classe) projetos.get(l.projeto).comClasse++;
  return {
    versao: v, checado: Date.now(), rows, porMaterial, porChave,
    materiais: [...porMaterial.values()].sort((a, b) => a.material.localeCompare(b.material)),
    projetos: [...projetos.values()].sort((a, b) => a.projeto.localeCompare(b.projeto)),
  };
}

async function buscarMaterial(url, env) {
  const bruto = texto(url.searchParams.get('q'), 80);
  const codigo = normCodigo(bruto);
  if (!codigo) return json({ exato: [], sugestoes: [] });

  const idx = await bomIndex(env);
  const chave = chaveCodigo(codigo);
  const achado = idx.porMaterial.get(codigo) || (chave ? idx.porChave.get(chave) : null);
  const exato = achado ? achado.linhas : [];

  let sugestoes = [];
  if (!exato.length && bruto.length >= 3) {
    const termo = bruto.toUpperCase();
    const comeca = [], contem = [];
    for (const m of idx.materiais) {
      if (chave && m.chave.startsWith(chave)) comeca.push(m);
      else if ((chave && m.chave.includes(chave)) || m.busca.includes(termo)) contem.push(m);
      if (comeca.length >= 15) break;
    }
    sugestoes = [...comeca, ...contem].slice(0, 15).map((m) => ({
      material: m.material, descricao: m.descricao, projetos: m.linhas.map((l) => l.projeto).join(','),
    }));
  }
  return json({ exato, sugestoes }, 200, { 'Cache-Control': 'private, max-age=60' });
}

async function listarNomesProjetos(env) {
  const idx = await bomIndex(env);
  const extra = (await env.DB.prepare('SELECT projeto FROM projeto_extra').all()).results.map((x) => x.projeto);
  const todos = [...new Set([...idx.projetos.map((p) => p.projeto), ...extra])].sort();
  return json({ projetos: todos });
}

// Registros sem classe ganham a classe da BOM: primeiro a do mesmo projeto, senão a do material
async function completarClasses(env) {
  const idx = await bomIndex(env);
  const sem = (await env.DB.prepare(
    "SELECT id, material, projeto FROM scrap WHERE (classe IS NULL OR classe = '') AND excluido_em IS NULL"
  ).all()).results;
  const updates = [];
  for (const r of sem) {
    const m = idx.porMaterial.get(r.material) || idx.porChave.get(chaveCodigo(r.material));
    if (!m) continue;
    const doProjeto = m.linhas.find((l) => l.projeto === r.projeto && l.classe);
    const cls = normClasse(doProjeto ? doProjeto.classe : m.classe);
    if (cls) updates.push(env.DB.prepare('UPDATE scrap SET classe = ? WHERE id = ?').bind(cls, r.id));
  }
  for (let i = 0; i < updates.length; i += 100) await env.DB.batch(updates.slice(i, i + 100));
  return updates.length;
}

async function listarProjetosBom(env) {
  const idx = await bomIndex(env);
  return json({ projetos: idx.projetos });
}

async function importarBom(req, env) {
  const b = await req.json().catch(() => null);
  const rows = Array.isArray(b?.rows) ? b.rows : null;
  if (!rows || !rows.length) return json({ erro: 'Nenhuma linha enviada' }, 400);
  if (rows.length > 2000) return json({ erro: 'Máximo de 2000 linhas por envio' }, 400);

  const agora = new Date().toISOString();
  const stmt = env.DB.prepare(
    `INSERT INTO bom (projeto, material, descricao, unidade, updated_at, classe) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(projeto, material) DO UPDATE SET
       classe     = COALESCE(NULLIF(excluded.classe, ''), bom.classe),
       descricao  = COALESCE(NULLIF(excluded.descricao, ''), bom.descricao),
       unidade    = COALESCE(NULLIF(excluded.unidade, ''), bom.unidade),
       updated_at = excluded.updated_at`
  );

  const lote = [];
  let ignorados = 0;
  for (const r of rows) {
    const projeto = texto(r.projeto, 40).toUpperCase();
    const material = normCodigo(r.material).slice(0, 40);
    if (!projeto || !material) { ignorados++; continue; }
    lote.push(stmt.bind(projeto, material, texto(r.descricao, 200), normUn(r.unidade), agora, normClasse(r.classe)));
  }
  for (let i = 0; i < lote.length; i += 500) await env.DB.batch(lote.slice(i, i + 500));
  await novaVersaoBom(env);
  const classificados = await completarClasses(env);
  return json({ ok: true, gravados: lote.length, ignorados, classificados });
}

/* ---------------- edição da BOM pela tela (admin) ---------------- */

// Itens de um projeto, direto da memória. "herdada" é a classe que o site usa quando esta BOM
// não informa a classe, vinda de outra BOM com o mesmo código.
async function listarItensBom(url, env) {
  const projeto = texto(url.searchParams.get('projeto'), 40).toUpperCase();
  if (!projeto) return json({ erro: 'Informe o projeto' }, 400);
  const idx = await bomIndex(env, true);
  const itens = [];
  for (const m of idx.materiais) {
    const l = m.linhas.find((x) => x.projeto === projeto);
    if (l) itens.push({ material: l.material, descricao: l.descricao, unidade: l.unidade, classe: normClasse(l.propria), herdada: l.propria ? '' : normClasse(l.classe) });
  }
  return json({ projeto, itens });
}

// Classe que o site usava para a peça nesse projeto: a da própria BOM ou a herdada de outra BOM
function classeEfetiva(idx, projeto, material, propria) {
  return normClasse(propria) || normClasse(idx.porMaterial.get(material)?.linhas.find((l) => l.projeto === projeto)?.classe);
}

// Classe corrigida na BOM: os registros dessa peça nesse projeto que tinham a classe antiga
// (ou nenhuma) passam a ter a nova. Depois, quem ficou sem classe pega a das outras BOMs.
async function classeNosRegistros(env, projeto, mudancas) {
  const stmts = mudancas.filter((x) => x.antes !== x.depois).map((x) => env.DB.prepare(
    `UPDATE scrap SET classe = ? WHERE excluido_em IS NULL AND projeto = ? AND material = ?
       AND (classe IS NULL OR classe = '' OR classe = ?)`
  ).bind(x.depois, projeto, x.material, x.antes || ''));
  let n = 0;
  for (let i = 0; i < stmts.length; i += 100) {
    for (const r of await env.DB.batch(stmts.slice(i, i + 100))) n += r.meta?.changes || 0;
  }
  return n + await completarClasses(env);
}

// Classe de um ou vários itens de uma vez
async function definirClasseBom(req, env) {
  const b = await req.json().catch(() => null);
  const projeto = texto(b?.projeto, 40).toUpperCase();
  const classe = normClasse(b?.classe);
  const materiais = [...new Set((Array.isArray(b?.materiais) ? b.materiais : []).map((x) => normCodigo(x).slice(0, 40)).filter(Boolean))];
  if (!projeto || !materiais.length) return json({ erro: 'Escolha os itens' }, 400);
  if (materiais.length > 3000) return json({ erro: 'Máximo de 3000 itens por vez' }, 400);
  const idx = await bomIndex(env, true);
  const antes = new Map();     // material -> classe que o site usava (própria ou herdada)
  const mudar = [];            // só os itens cuja classe na BOM muda de fato
  for (let i = 0; i < materiais.length; i += 90) {   // D1 aceita até 100 parâmetros por consulta
    const lote = materiais.slice(i, i + 90);
    const rs = (await env.DB.prepare(
      `SELECT material, classe FROM bom WHERE projeto = ? AND material IN (${lote.map(() => '?').join(',')})`
    ).bind(projeto, ...lote).all()).results;
    for (const r of rs) {
      if (normClasse(r.classe) === classe) continue;
      antes.set(r.material, classeEfetiva(idx, projeto, r.material, r.classe));
      mudar.push(r.material);
    }
  }
  if (!mudar.length) return json({ ok: true, alterados: 0, registros: 0 });
  const agora = new Date().toISOString();
  const ups = mudar.map((mat) =>
    env.DB.prepare('UPDATE bom SET classe = ?, updated_at = ? WHERE projeto = ? AND material = ?').bind(classe, agora, projeto, mat));
  for (let i = 0; i < ups.length; i += 100) await env.DB.batch(ups.slice(i, i + 100));
  await bomEditada(env, (rows) => rows.map((r) =>
    r.projeto === projeto && antes.has(r.material) ? { ...r, classe, updated_at: agora } : r));
  const idx2 = await bomIndex(env);
  const registros = await classeNosRegistros(env, projeto,
    mudar.map((material) => ({ material, antes: antes.get(material), depois: classeEfetiva(idx2, projeto, material, classe) })));
  const itens = mudar.map((material) => ({ material, classe, herdada: classe ? '' : classeEfetiva(idx2, projeto, material, '') }));
  return json({ ok: true, alterados: mudar.length, registros, itens });
}

// Adicionar um material na BOM ou corrigir descrição, unidade e classe de um item
async function salvarItemBom(req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return json({ erro: 'Dados inválidos' }, 400);
  const projeto = texto(b.projeto, 40).toUpperCase();
  const material = normCodigo(b.material).slice(0, 40);
  const descricao = texto(b.descricao, 200);
  const unidade = normUn(b.unidade);
  const classe = normClasse(b.classe);
  if (!projeto) return json({ erro: 'Informe o projeto', campo: 'projeto' }, 400);
  if (!material) return json({ erro: 'Informe o SAP do material', campo: 'material' }, 400);
  if (String(b.unidade ?? '').trim() && !unidade) return json({ erro: 'Unidade inválida. Use letras, ex.: PC, UN, M, KG.', campo: 'unidade' }, 400);
  if (temPalavrao(descricao)) return json({ erro: MSG_PALAVRAO, campo: 'descricao' }, 422);
  const atual = await env.DB.prepare('SELECT classe FROM bom WHERE projeto = ? AND material = ?').bind(projeto, material).first();
  const classeAntes = classeEfetiva(await bomIndex(env, true), projeto, material, atual?.classe);
  if (b.novo && atual) return json({ erro: 'Esse SAP já está nessa BOM. Procure na lista para editar.', campo: 'material' }, 409);
  if (!b.novo && !atual) return json({ erro: 'Esse item não está mais nessa BOM.', campo: 'material' }, 404);
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO bom (projeto, material, descricao, unidade, classe, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(projeto, material) DO UPDATE SET descricao = excluded.descricao, unidade = excluded.unidade,
       classe = excluded.classe, updated_at = excluded.updated_at`
  ).bind(projeto, material, descricao, unidade, classe, agora).run();
  const linha = { projeto, material, descricao, unidade, classe, updated_at: agora };
  await bomEditada(env, (rows) => atual
    ? rows.map((r) => (r.projeto === projeto && r.material === material ? linha : r))
    : [...rows, linha]);
  const idx2 = await bomIndex(env);
  const registros = await classeNosRegistros(env, projeto,
    [{ material, antes: classeAntes, depois: classeEfetiva(idx2, projeto, material, classe) }]);
  const herdada = classe ? '' : classeEfetiva(idx2, projeto, material, '');
  return json({ ok: true, item: { material, descricao, unidade, classe, herdada }, registros });
}

async function excluirItemBom(url, env) {
  const projeto = texto(url.searchParams.get('projeto'), 40).toUpperCase();
  const material = normCodigo(url.searchParams.get('material')).slice(0, 40);
  if (!projeto || !material) return json({ erro: 'Informe projeto e material' }, 400);
  const r = await env.DB.prepare('DELETE FROM bom WHERE projeto = ? AND material = ?').bind(projeto, material).run();
  if (!r.meta?.changes) return json({ erro: 'Esse item não está mais nessa BOM.' }, 404);
  await bomEditada(env, (rows) => rows.filter((x) => !(x.projeto === projeto && x.material === material)));
  return json({ ok: true });
}

/* ---------------- scrap ---------------- */

async function criarScrap(req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return json({ erro: 'Dados inválidos' }, 400);

  const posto = Number(b.posto);
  let material = normCodigo(b.material).slice(0, 40);
  const quantidade = Number(String(b.quantidade ?? '').replace(',', '.'));
  const defeito = texto(b.defeito, 60);
  const problema = texto(b.descricao_problema, 1000);
  const por = texto(b.registrado_por, 60);
  const matricula = texto(b.matricula, 20).toUpperCase();

  if (!Number.isInteger(posto) || posto < 1 || posto > 10) return json({ erro: 'Selecione o posto (1 a 10)' }, 400);
  if (!material) return json({ erro: 'Informe o material' }, 400);
  if (!(quantidade > 0)) return json({ erro: 'Quantidade deve ser maior que zero' }, 400);
  if (quantidade > 100000) return json({ erro: 'Quantidade alta demais. Confira o valor.' }, 400);
  if (!defeito) return json({ erro: 'Selecione o defeito' }, 400);
  if (!problema) return json({ erro: 'Descreva o problema' }, 400);
  if (!matricula || !por) return json({ erro: 'Identifique o operador (nome e matrícula)' }, 400);
  if (temPalavrao(problema)) return json({ erro: MSG_PALAVRAO, campo: 'descricao_problema' }, 422);
  if (temPalavrao(por)) return json({ erro: 'O nome do operador tem palavras impróprias.', campo: 'registrado_por' }, 422);

  let naBom = (await env.DB.prepare(
    'SELECT projeto, material, descricao, unidade, classe FROM bom WHERE material = ?'
  ).bind(material).all()).results;
  if (!naBom.length) {            // digitado sem hífen: procura pela chave na BOM em memória
    const m = (await bomIndex(env)).porChave.get(chaveCodigo(material));
    if (m) naBom = m.linhas;
  }

  let projeto, descMat, unidade, classe = '', foraBom = 0;
  if (naBom.length) {
    const linha = naBom.length === 1 ? naBom[0] : naBom.find((r) => r.projeto === String(b.projeto || '').toUpperCase());
    if (!linha) return json({ erro: 'Material está em mais de um projeto: selecione o projeto' }, 400);
    ({ projeto, descricao: descMat, unidade } = linha);
    material = linha.material;
    unidade = normUn(unidade);
    classe = normClasse(linha.classe);
    if (!classe) {
      const m = (await bomIndex(env)).porChave.get(chaveCodigo(material));
      classe = normClasse(m?.classe);
    }
  } else {
    projeto = texto(b.projeto, 40).toUpperCase();
    descMat = texto(b.descricao_material, 200);
    unidade = normUn(b.unidade);
    if (!projeto) return json({ erro: 'Material fora da BOM: informe o projeto' }, 400);
    if (temPalavrao(descMat)) return json({ erro: MSG_PALAVRAO, campo: 'descricao_material' }, 422);
    if (temPalavrao(projeto)) return json({ erro: MSG_PALAVRAO, campo: 'projeto' }, 422);
    foraBom = 1;
  }

  const r = await env.DB.prepare(
    `INSERT INTO scrap (created_at, posto, material, projeto, descricao_material, quantidade, unidade,
                        defeito, descricao_problema, registrado_por, matricula, fora_bom, classe)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(new Date().toISOString(), posto, material, projeto, descMat || '', quantidade, unidade || '',
         defeito, problema, por, matricula, foraBom, classe).run();
  if (foraBom) await env.DB.prepare('INSERT OR IGNORE INTO projeto_extra (projeto) VALUES (?)').bind(projeto).run();

  return json({ ok: true, id: r.meta?.last_row_id, material, projeto, descricao_material: descMat }, 201);
}

function filtros(url) {
  const sp = url.searchParams;
  const w = ['excluido_em IS NULL'], v = [];
  if (sp.get('de')) { w.push('created_at >= ?'); v.push(sp.get('de')); }
  if (sp.get('ate')) { w.push('created_at <= ?'); v.push(sp.get('ate')); }
  const posto = Number(sp.get('posto'));
  if (posto) { w.push('posto = ?'); v.push(posto); }
  const proj = texto(sp.get('projeto'), 40).toUpperCase();
  if (proj) { w.push('projeto = ?'); v.push(proj); }
  const mat = normCodigo(sp.get('material'));
  if (mat) { w.push('material LIKE ?'); v.push('%' + semCuringa(mat) + '%'); }
  const def = texto(sp.get('defeito'), 60);
  if (def) { w.push('defeito = ?'); v.push(def); }
  const st = sp.get('status');
  if (st === 'concluido') w.push("status <> 'analise'");
  else if (STATUS.includes(st)) { w.push('status = ?'); v.push(st); }
  const cls = normClasse(sp.get('classe'));
  if (cls === '-') w.push("(classe IS NULL OR classe = '')");
  else if (cls) { w.push('classe = ?'); v.push(cls); }
  if (sp.get('foto') === 'sem') w.push('NOT EXISTS (SELECT 1 FROM foto WHERE foto.scrap_id = scrap.id)');
  if (sp.get('foto') === 'com') w.push('EXISTS (SELECT 1 FROM foto WHERE foto.scrap_id = scrap.id)');
  const mat2 = texto(sp.get('matricula'), 20).toUpperCase();
  if (mat2) { w.push('matricula = ?'); v.push(mat2); }
  // PCP: sim / nao
  for (const [param, col] of [['scrap_feito', 'scrap_feito_em'], ['arrumado', 'arrumado_em']]) {
    if (sp.get(param) === 'sim') w.push(`${col} IS NOT NULL`);
    if (sp.get(param) === 'nao') w.push(`${col} IS NULL`);
  }
  return { where: 'WHERE ' + w.join(' AND '), v };
}

async function listarScrap(url, env) {
  const { where, v } = filtros(url);
  const r = await env.DB.prepare(
    `SELECT scrap.*, (SELECT group_concat(id) FROM foto WHERE foto.scrap_id = scrap.id) AS fotos
       FROM scrap ${where} ORDER BY created_at ${url.searchParams.get('ordem') === 'antigos' ? 'ASC' : 'DESC'} LIMIT 5000`
  ).bind(...v).all();
  let registros = await anexarAvarias(env, r.results);
  const av = url.searchParams.get('avaria');
  if (av === 'com') registros = registros.filter((x) => x.avarias);
  if (av === 'sem') registros = registros.filter((x) => !x.avarias);
  return json({ registros });
}

// Marca nos registros de scrap os materiais que já têm formulário de avaria (pela chave do código,
// com ou sem hífen). Uma consulta pelo índice da chave a cada 90 materiais, todas num lote só.
async function anexarAvarias(env, rows) {
  const chaves = [...new Set(rows.map((r) => chaveCodigo(r.material)).filter(Boolean))];
  if (!chaves.length) return rows;
  const lotes = [];
  for (let i = 0; i < chaves.length; i += 90) lotes.push(chaves.slice(i, i + 90));
  const campos = 'SELECT id, chave, created_at, situacao, ano, numero FROM avaria WHERE excluido_em IS NULL';
  // período enorme (muitos materiais): lê de uma vez a tabela de avarias, que é pequena
  const res = lotes.length > 8
    ? [await env.DB.prepare(`${campos} ORDER BY created_at DESC`).all()]
    : await env.DB.batch(lotes.map((l) => env.DB.prepare(
      `${campos} AND chave IN (${l.map(() => '?').join(',')}) ORDER BY created_at DESC`).bind(...l)));
  const porChave = new Map();
  for (const x of res) {
    for (const a of x.results) {
      if (!porChave.has(a.chave)) porChave.set(a.chave, []);
      porChave.get(a.chave).push({ id: a.id, em: a.created_at, situacao: a.situacao, ra: numeroRA(a) });
    }
  }
  if (porChave.size) for (const r of rows) {
    const l = porChave.get(chaveCodigo(r.material));
    if (l) r.avarias = l;
  }
  return rows;
}

// Lê as linhas do período uma vez só e agrupa aqui (5x menos leitura do que 5 consultas)
async function estatisticas(url, env) {
  const { where, v } = filtros(url);
  const rows = (await env.DB.prepare(
    `SELECT posto, projeto, defeito, material, descricao_material, unidade, quantidade, classe, status, scrap_feito_em, arrumado_em FROM scrap ${where}`
  ).bind(...v).all()).results;

  const grupo = (chave) => {
    const g = new Map();
    for (const r of rows) {
      const k = chave(r);
      const a = g.get(k) || { registros: 0, quantidade: 0, r };
      a.registros++; a.quantidade += Number(r.quantidade) || 0;
      g.set(k, a);
    }
    return [...g.values()];
  };
  const porRegistros = (a, b) => b.registros - a.registros || b.quantidade - a.quantidade;

  const total = { registros: rows.length, quantidade: rows.reduce((t, r) => t + (Number(r.quantidade) || 0), 0) };
  const porPosto = grupo((r) => r.posto).map(({ r, ...a }) => ({ posto: r.posto, ...a })).sort((a, b) => a.posto - b.posto);
  const porProjeto = grupo((r) => r.projeto).map(({ r, ...a }) => ({ projeto: r.projeto, ...a })).sort(porRegistros);
  const porDefeito = grupo((r) => r.defeito).map(({ r, ...a }) => ({ defeito: r.defeito, ...a })).sort(porRegistros);
  const porStatus = grupo((r) => r.status || 'analise').map(({ r, ...a }) => ({ status: r.status || 'analise', ...a })).sort(porRegistros);
  const porClasse = grupo((r) => r.classe || '').map(({ r, ...a }) => ({ classe: r.classe || '', ...a })).sort(porRegistros);
  const desc = new Map();
  for (const r of rows) {
    const k = r.material + '|' + r.projeto;
    if (r.descricao_material && (desc.get(k) || '') < r.descricao_material) desc.set(k, r.descricao_material);
  }
  const topMateriais = grupo((r) => r.material + '|' + r.projeto)
    .map(({ r, ...a }) => ({ material: r.material, projeto: r.projeto, classe: r.classe || '', descricao: desc.get(r.material + '|' + r.projeto) || '', unidade: normUn(r.unidade), ...a }))
    .sort(porRegistros).slice(0, 10);

  // Andamento de cada registro: análise da Qualidade -> baixa do scrap (PCP) -> peça arrumada
  const porEtapa = { analise: 0, aguardando_scrap: 0, falta_arrumar: 0, resolvido: 0 };
  for (const r of rows) porEtapa[etapaScrap(r)]++;
  return json({ total, porPosto, porProjeto, porDefeito, porClasse, porStatus, porEtapa, topMateriais });
}

async function buscarOperador(url, env) {
  const mat = texto(url.searchParams.get('matricula'), 20).toUpperCase();
  if (!mat) return json({ nome: '' });
  const r = await env.DB.prepare(
    'SELECT registrado_por AS nome FROM scrap WHERE matricula = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(mat).first();
  return json({ nome: r?.nome || '' });
}

// Exclusão lógica: o registro continua no banco com quem excluiu e quando
async function excluirScrap(env, id) {
  const reg = await env.DB.prepare('SELECT id, excluido_em FROM scrap WHERE id = ?').bind(id).first();
  if (!reg || reg.excluido_em) return json({ erro: 'Registro não encontrado' }, 404);
  await env.DB.prepare('UPDATE scrap SET excluido_em = ?, excluido_por = ? WHERE id = ?')
    .bind(new Date().toISOString(), 'Administrador', id).run();
  return json({ ok: true });
}

async function editarScrap(req, env, id) {
  const b = await req.json().catch(() => null);
  if (!b) return json({ erro: 'Dados inválidos' }, 400);
  const reg = await env.DB.prepare(
    'SELECT id, excluido_em, material, descricao_material, fora_bom, material_anterior FROM scrap WHERE id = ?'
  ).bind(id).first();
  if (!reg || reg.excluido_em) return json({ erro: 'Registro não encontrado' }, 404);

  const posto = Number(b.posto);
  const quantidade = Number(String(b.quantidade ?? '').replace(',', '.'));
  let projeto = texto(b.projeto, 40).toUpperCase();
  const defeito = texto(b.defeito, 60);
  const problema = texto(b.descricao_problema, 1000);
  let unidade = normUn(b.unidade);
  let classe = normClasse(b.classe);
  let descMat = reg.descricao_material || '';
  let material = reg.material, foraBom = reg.fora_bom ? 1 : 0;
  if (!Number.isInteger(posto) || posto < 1 || posto > 10) return json({ erro: 'Posto inválido (1 a 10)', campo: 'posto' }, 400);
  if (String(b.unidade ?? '').trim() && !unidade) return json({ erro: 'Unidade inválida. Use letras, ex.: PC, UN, M, KG.', campo: 'unidade' }, 400);
  if (quantidade > 100000) return json({ erro: 'Quantidade alta demais. Confira o valor.', campo: 'quantidade' }, 400);

  // SAP corrigido: busca o código novo na BOM e traz descrição, projeto, unidade e classe
  if (b.material != null) {
    const novo = normCodigo(b.material).slice(0, 40);
    if (!novo) return json({ erro: 'Informe o SAP do material', campo: 'material' }, 400);
    if (chaveCodigo(novo) !== chaveCodigo(reg.material)) {
      const idx = await bomIndex(env);
      const m = idx.porMaterial.get(novo) || idx.porChave.get(chaveCodigo(novo));
      if (m) {
        const linha = m.linhas.find((l) => l.projeto === projeto) || (m.linhas.length === 1 ? m.linhas[0] : null);
        if (!linha) {
          return json({ erro: `Esse SAP está em mais de um projeto (${m.linhas.map((l) => l.projeto).join(', ')}). Escolha o projeto.`, campo: 'projeto' }, 400);
        }
        material = m.material;
        projeto = linha.projeto;
        descMat = linha.descricao || m.descricao || '';
        unidade = normUn(linha.unidade) || unidade;     // SAP mudou: vale o que a BOM diz
        classe = normClasse(linha.classe) || classe;
        foraBom = 0;
      } else {
        material = novo;
        foraBom = 1;
      }
    }
  }
  // Material da BOM usa a descrição da BOM; só o que está fora da BOM tem descrição digitada
  if (foraBom && b.descricao_material != null) descMat = texto(b.descricao_material, 200);
  if (!projeto) return json({ erro: 'Informe o projeto', campo: 'projeto' }, 400);
  if (!(quantidade > 0)) return json({ erro: 'Quantidade deve ser maior que zero', campo: 'quantidade' }, 400);
  if (!defeito) return json({ erro: 'Escolha o defeito', campo: 'defeito' }, 400);
  if (!problema) return json({ erro: 'Descreva o problema', campo: 'descricao_problema' }, 400);
  if (temPalavrao(problema)) return json({ erro: MSG_PALAVRAO, campo: 'descricao_problema' }, 422);
  if (temPalavrao(projeto)) return json({ erro: MSG_PALAVRAO, campo: 'projeto' }, 422);
  if (foraBom && temPalavrao(descMat)) return json({ erro: MSG_PALAVRAO, campo: 'descricao_material' }, 422);

  // Guarda o SAP que o operador digitou (só o primeiro; se voltar para ele, a marca some)
  let anterior = reg.material_anterior || null;
  if (material !== reg.material) {
    anterior = reg.material_anterior || reg.material;
    if (chaveCodigo(anterior) === chaveCodigo(material)) anterior = null;
  }
  await env.DB.prepare(
    `UPDATE scrap SET material = ?, descricao_material = ?, fora_bom = ?, material_anterior = ?,
            posto = ?, projeto = ?, quantidade = ?, unidade = ?, classe = ?, defeito = ?, descricao_problema = ?,
            editado_em = ?, editado_por = ? WHERE id = ?`
  ).bind(material, descMat, foraBom, anterior, posto, projeto, quantidade, unidade, classe, defeito, problema,
         new Date().toISOString(), 'Administrador', id).run();
  await env.DB.prepare('INSERT OR IGNORE INTO projeto_extra (projeto) VALUES (?)').bind(projeto).run();
  return json({ ok: true, material, projeto, descricao_material: descMat, fora_bom: foraBom });
}

/* ---------------- fotos ---------------- */
// A foto chega do navegador já reduzida (JPEG ~1600px). No banco ela é guardada em
// pedaços de até 90 KB, porque o D1 limita o tamanho de cada comando.
const MAX_FOTOS = 3;
const MAX_FOTO_B64 = 2_800_000;          // ~2 MB de imagem
const MAX_MINI_B64 = 85_000;             // miniatura do relatório (~480 px), cabe numa linha só
const PEDACO = 90_000;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

// Cada foto chega como "data:image/jpeg;base64,…" ou { foto, mini } (relatório de avarias)
function lerFotos(lista, max = MAX_FOTOS) {
  if (lista == null) return [];
  if (!Array.isArray(lista)) throw Error('Fotos em formato inválido.');
  if (lista.length > max) throw Error(`Máximo de ${max} fotos por registro.`);
  return lista.map((f) => {
    const o = f && typeof f === 'object' ? f : { foto: f };
    const m = DATA_URL.exec(String(o.foto || ''));
    if (!m) throw Error('Uma das fotos não é uma imagem válida.');
    if (m[2].length > MAX_FOTO_B64) throw Error('Foto grande demais. Tire a foto de novo.');
    let mini = null;
    if (o.mini) {
      const mm = DATA_URL.exec(String(o.mini));
      if (mm && mm[2].length <= MAX_MINI_B64) mini = mm[0];   // miniatura ruim: o relatório usa a foto inteira
    }
    return { tipo: 'image/' + m[1], b64: m[2], mini };
  });
}

// dono: { scrap: id } ou { avaria: id, categoria: 'nc' | 'ok' }
async function gravarFotos(env, dono, fotos, autor) {
  const agora = new Date().toISOString();
  for (const f of fotos) {
    const partes = [];
    for (let i = 0; i < f.b64.length; i += PEDACO) partes.push(f.b64.slice(i, i + PEDACO));
    const r = await env.DB.prepare(
      'INSERT INTO foto (scrap_id, avaria_id, criado_em, tipo, partes, enviado_por, mini, categoria) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(dono.scrap || 0, dono.avaria || null, agora, f.tipo, partes.length, autor || null, f.mini || null,
           dono.avaria ? dono.categoria || 'nc' : null).run();
    const id = r.meta?.last_row_id;
    await env.DB.batch(partes.map((d, n) =>
      env.DB.prepare('INSERT INTO foto_parte (foto_id, n, dados) VALUES (?, ?, ?)').bind(id, n, d)));
  }
}

function imagem(b64, tipo) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: { 'Content-Type': tipo, 'Cache-Control': 'private, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
}

// mini: a miniatura guardada junto (relatório de avarias); sem miniatura, vai a foto inteira
async function servirFoto(env, id, mini = false) {
  if (mini) {
    const f = await env.DB.prepare('SELECT mini FROM foto WHERE id = ?').bind(id).first();
    if (!f) return new Response('Foto não encontrada', { status: 404 });
    const m = DATA_URL.exec(f.mini || '');
    if (m) return imagem(m[2], 'image/' + m[1]);
  }
  const f = await env.DB.prepare('SELECT tipo, partes FROM foto WHERE id = ?').bind(id).first();
  if (!f) return new Response('Foto não encontrada', { status: 404 });
  const rows = (await env.DB.prepare('SELECT dados FROM foto_parte WHERE foto_id = ? ORDER BY n').bind(id).all()).results;
  if (rows.length !== f.partes) return new Response('Foto incompleta', { status: 500 });
  return imagem(rows.map((r) => r.dados).join(''), f.tipo);
}

async function adicionarFotos(req, env, scrapId) {
  const b = await req.json().catch(() => null);
  if (!b) return json({ erro: 'Dados inválidos' }, 400);
  let fotos;
  try { fotos = lerFotos(b.fotos); } catch (e) { return json({ erro: e.message }, 400); }
  if (!fotos.length) return json({ erro: 'Nenhuma foto enviada' }, 400);
  const reg = await env.DB.prepare('SELECT id, excluido_em FROM scrap WHERE id = ?').bind(scrapId).first();
  if (!reg || reg.excluido_em) return json({ erro: 'Registro não encontrado' }, 404);
  const ja = (await env.DB.prepare('SELECT COUNT(*) AS n FROM foto WHERE scrap_id = ?').bind(scrapId).first()).n;
  if (ja + fotos.length > MAX_FOTOS) return json({ erro: `Esse registro já tem ${ja} foto(s). O máximo é ${MAX_FOTOS}.` }, 400);
  const nome = texto(b.nome, 60), mat = texto(b.matricula, 20).toUpperCase();
  await gravarFotos(env, { scrap: scrapId }, fotos, nome ? `${nome}${mat ? ' (' + mat + ')' : ''}` : 'Qualidade');
  return json({ ok: true, total: ja + fotos.length }, 201);
}

async function removerFoto(env, id) {
  const f = await env.DB.prepare('SELECT id FROM foto WHERE id = ?').bind(id).first();
  if (!f) return json({ erro: 'Foto não encontrada' }, 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM foto_parte WHERE foto_id = ?').bind(id),
    env.DB.prepare('DELETE FROM foto WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

/* ---------------- PCP: scrap feito e arrumado ----------------
 * "Scrap feito": a baixa do scrap já foi feita. "Arrumado": a peça/o problema já foi resolvido.
 * Guarda quem marcou e quando; marcar de novo não troca o carimbo de quem marcou primeiro. */
const CAMPOS_PCP = { scrap_feito: ['scrap_feito_em', 'scrap_feito_por'], arrumado: ['arrumado_em', 'arrumado_por'] };
// Em que pé está o registro (a tela usa a mesma regra)
const etapaScrap = (r) => ((r.status || 'analise') === 'analise' ? 'analise'
  : r.status === 'scrap' && !r.scrap_feito_em ? 'aguardando_scrap'
    : !r.arrumado_em ? 'falta_arrumar' : 'resolvido');

async function marcarPcp(req, env) {
  const b = await req.json().catch(() => null);
  const par = CAMPOS_PCP[b?.campo];
  if (!par) return json({ erro: 'Escolha o que marcar: scrap feito ou arrumado.' }, 400);
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return json({ erro: 'Escolha pelo menos um registro.' }, 400);
  if (ids.length > 500) return json({ erro: 'Marque no máximo 500 registros de uma vez.' }, 400);
  const [colEm, colPor] = par;
  const marcar = b.valor !== false;
  const em = new Date().toISOString(), por = quemFez(b) || 'Qualidade';
  const lotes = [];
  for (let i = 0; i < ids.length; i += 90) lotes.push(ids.slice(i, i + 90));   // limite de variáveis do D1
  const res = await env.DB.batch(lotes.map((l) => {
    const q = l.map(() => '?').join(',');
    return marcar
      ? env.DB.prepare(`UPDATE scrap SET ${colEm} = ?, ${colPor} = ? WHERE id IN (${q}) AND excluido_em IS NULL AND ${colEm} IS NULL`).bind(em, por, ...l)
      : env.DB.prepare(`UPDATE scrap SET ${colEm} = NULL, ${colPor} = NULL WHERE id IN (${q}) AND excluido_em IS NULL`).bind(...l);
  }));
  const alterados = res.reduce((t, r) => t + (r.meta?.changes ?? 0), 0);
  return json({ ok: true, campo: b.campo, valor: marcar, alterados, em: marcar ? em : null, por: marcar ? por : null });
}

/* ---------------- análise da Qualidade ---------------- */
const STATUS = ['analise', 'scrap', 'retrabalho', 'devolucao', 'liberado'];

async function analisarScrap(req, env, id) {
  const b = await req.json().catch(() => null);
  if (!b) return json({ erro: 'Dados inválidos' }, 400);
  const status = String(b.status || '');
  if (!STATUS.includes(status)) return json({ erro: 'Escolha a decisão da análise.' }, 400);
  const parecer = texto(b.parecer, 1000);
  if (status !== 'analise' && !parecer) return json({ erro: 'Escreva o parecer da Qualidade.', campo: 'parecer' }, 400);
  if (temPalavrao(parecer)) return json({ erro: MSG_PALAVRAO, campo: 'parecer' }, 422);
  const reg = await env.DB.prepare('SELECT id, excluido_em FROM scrap WHERE id = ?').bind(id).first();
  if (!reg || reg.excluido_em) return json({ erro: 'Registro não encontrado' }, 404);
  const nome = texto(b.nome, 60), mat = texto(b.matricula, 20).toUpperCase();
  const quem = status === 'analise' ? null : (nome ? `${nome}${mat ? ' (' + mat + ')' : ''}` : 'Qualidade');
  await env.DB.prepare('UPDATE scrap SET status = ?, parecer = ?, analisado_por = ?, analisado_em = ? WHERE id = ?')
    .bind(status, status === 'analise' ? null : parecer, quem, status === 'analise' ? null : new Date().toISOString(), id).run();
  return json({ ok: true });
}

/* ---------------- relatório de avarias (FO.QA.A.049) ----------------
 * Um relatório por ocorrência, numerado RA-0000-ano. A Qualidade digita o código da peça e tira a foto
 * da avaria; descrição, projeto, unidade e classe vêm da BOM e a tela já escreve o resto (descrição do
 * problema, rastreabilidade e plano de ação), que a Qualidade pode revisar. Os campos do formulário
 * ficam em "dados" (JSON). Fotos: categoria 'nc' (evidência da avaria) e 'ok' (padrão aceitável).
 * O PDF e o e-mail são montados no navegador. Nos registros de scrap, o material aparece marcado
 * "Formulário de avaria" (anexarAvarias). */
const MAX_FOTOS_NC = 4;
const MAX_FOTOS_OK = 3;
const JANELA_DIAS = 7;
const DIA_MS = 864e5;
// Último relatório feito à mão antes do site, por ano: a numeração continua dele
const RA_ULTIMO_MANUAL = { 2026: 17 };
const CLASSIFICACOES = ['processo', 'recebimento'];
const SEVERIDADES = ['baixa', 'media', 'alta', 'critica'];
const STATUS_ACAO = ['Concluído', 'Pendente', 'Em andamento'];
const SQL_AVARIA = `SELECT avaria.*,
    (SELECT group_concat(id) FROM foto WHERE foto.avaria_id = avaria.id AND COALESCE(foto.categoria, 'nc') = 'nc') AS fotos,
    (SELECT group_concat(id) FROM foto WHERE foto.avaria_id = avaria.id AND foto.categoria = 'ok') AS fotos_ok
  FROM avaria`;
// Maior número RA em uso no ano: os relatórios ativos e os que já saíram por e-mail (mesmo se excluídos)
const SQL_MAIOR_RA = 'SELECT MAX(numero) FROM avaria WHERE ano = ? AND (excluido_em IS NULL OR email_em IS NOT NULL)';

const quemFez = (b) => {
  const nome = texto(b?.nome, 60), mat = texto(b?.matricula, 20).toUpperCase();
  return nome ? `${nome}${mat ? ' (' + mat + ')' : ''}` : '';
};
const falha = (e) => json({ erro: e.erro, campo: e.campo }, e.status || 400);
const hojeBR = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);   // Brasília (UTC-3, sem horário de verão)
const numeroRA = (a) => (a && a.numero ? `RA-${String(a.numero).padStart(4, '0')}-${a.ano}` : '');
// "dados" volta como objeto, junto com o número RA pronto
function comDados(a) {
  if (!a) return a;
  let d = {};
  try { d = JSON.parse(a.dados || '{}') || {}; } catch {}
  return { ...a, dados: d, ra: numeroRA(a) };
}
const umaAvaria = async (env, id) => comDados(await env.DB.prepare(`${SQL_AVARIA} WHERE id = ?`).bind(id).first());
const lerNumero = (v) => {
  const n = Number(String(v ?? '').trim().replace(/^RA-?\s*/i, '').split(/[-/]/)[0]);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : null;
};
async function numeroLivre(env, ano, numero, id = 0) {
  return !(await env.DB.prepare(
    'SELECT id FROM avaria WHERE ano = ? AND numero = ? AND id <> ? AND (excluido_em IS NULL OR email_em IS NOT NULL)'
  ).bind(ano, numero, id).first());
}
const jaUsado = (ano, numero) => ({
  erro: `O ${numeroRA({ ano, numero })} já existe. Deixe o número em branco que o site usa o próximo livre.`, campo: 'numero', status: 409,
});

async function proximoRA(url, env) {
  const ano = Number(url.searchParams.get('ano')) || Number(hojeBR().slice(0, 4));
  const r = await env.DB.prepare(`SELECT MAX(?, COALESCE((${SQL_MAIOR_RA}), 0)) + 1 AS n`).bind(RA_ULTIMO_MANUAL[ano] || 0, ano).first();
  return json({ ano, numero: r.n, ra: numeroRA({ ano, numero: r.n }) });
}

// Código digitado → material da BOM (descrição, projeto, unidade e classe). Material em mais de um
// projeto, sem projeto escolhido, fica com todos ("BC22, BC24"). Fora da BOM fica o que foi digitado.
async function materialAvaria(env, b) {
  const digitado = normCodigo(b.material).slice(0, 40);
  if (!chaveCodigo(digitado)) return { erro: 'Digite o código do material.', campo: 'material', status: 400 };
  const idx = await bomIndex(env);
  const m = idx.porMaterial.get(digitado) || idx.porChave.get(chaveCodigo(digitado));
  if (m) {
    const escolhido = texto(b.projeto, 40).toUpperCase();
    const linha = m.linhas.length === 1 ? m.linhas[0] : m.linhas.find((l) => l.projeto === escolhido);
    const linhas = linha ? [linha] : m.linhas;
    return {
      material: m.material, chave: chaveCodigo(m.material), fora_bom: 0,
      projeto: linhas.map((l) => l.projeto).join(', '),
      descricao_material: (linha && linha.descricao) || m.descricao || '',
      unidade: normUn(linhas.map((l) => l.unidade).find((u) => normUn(u))),
      classe: normClasse(linha ? linha.classe : m.classe),
    };
  }
  const projeto = texto(b.projeto, 40).toUpperCase();
  const descricao = texto(b.descricao_material, 200);
  if (temPalavrao(descricao)) return { erro: MSG_PALAVRAO, campo: 'descricao_material', status: 422 };
  if (temPalavrao(projeto)) return { erro: MSG_PALAVRAO, campo: 'projeto', status: 422 };
  return { material: digitado, chave: chaveCodigo(digitado), fora_bom: 1, projeto, descricao_material: descricao, unidade: normUn(b.unidade), classe: '' };
}

// Quantidade, defeito (tipo de avaria) e situação da peça. parcial (edição): só o que veio no pedido.
function dadosAvaria(b, parcial) {
  const d = {};
  const veio = (k) => !parcial || b[k] !== undefined;
  if (veio('quantidade')) {
    const bruto = String(b.quantidade ?? '').trim().replace(',', '.');
    const q = bruto ? Number(bruto) : 1;
    if (!(q > 0)) return { erro: 'A quantidade deve ser maior que zero.', campo: 'quantidade' };
    if (q > 100000) return { erro: 'Quantidade alta demais. Confira o valor.', campo: 'quantidade' };
    d.quantidade = q;
  }
  if (veio('defeito')) d.defeito = texto(b.defeito, 60);
  if (veio('observacao')) d.observacao = texto(b.observacao, 1000);
  if (veio('situacao')) {
    const s = String(b.situacao || 'analise');
    if (!STATUS.includes(s)) return { erro: 'Escolha a situação da peça.', campo: 'situacao' };
    d.situacao = s;
  }
  if (temPalavrao(d.observacao)) return { erro: MSG_PALAVRAO, campo: 'observacao', status: 422 };
  if (temPalavrao(d.defeito)) return { erro: MSG_PALAVRAO, campo: 'defeito', status: 422 };
  return { d };
}

// Campos do FO.QA.A.049. Na edição, só o que veio muda; o resto continua como estava.
function dadosRA(e, antes) {
  const d = { ...(antes || {}) };
  if (e && typeof e === 'object') {
    const t = (k, max) => { if (e[k] !== undefined) d[k] = texto(e[k], max); };
    if (e.data !== undefined) d.data = /^\d{4}-\d{2}-\d{2}$/.test(String(e.data)) ? String(e.data) : '';
    t('turno', 20);
    if (e.classificacao !== undefined) d.classificacao = CLASSIFICACOES.includes(e.classificacao) ? e.classificacao : '';
    if (e.severidade !== undefined) d.severidade = SEVERIDADES.includes(e.severidade) ? e.severidade : '';
    t('o_que', 500); t('por_que', 500); t('quem', 120); t('como', 120); t('onde', 120); t('quando', 120); t('quanto', 120);
    t('nota_fiscal', 60);
    if (e.itens !== undefined) {
      d.itens = (Array.isArray(e.itens) ? e.itens : []).slice(0, 3).map((i) => ({
        codigo: normCodigo(i?.codigo).slice(0, 40), qtd: texto(i?.qtd, 12), nf: texto(i?.nf, 60), descricao: texto(i?.descricao, 120),
      })).filter((i) => i.codigo || i.descricao);
    }
    if (e.acoes !== undefined) {
      d.acoes = (Array.isArray(e.acoes) ? e.acoes : []).slice(0, 2).map((a, n) => ({
        tipo: n ? 'corretiva' : 'contencao', descricao: texto(a?.descricao, 500), responsavel: texto(a?.responsavel, 80),
        prazo: texto(a?.prazo, 40), status: STATUS_ACAO.includes(a?.status) ? a.status : 'Pendente',
      }));
    }
  }
  if (!d.data) d.data = hojeBR();
  const campos = [['o_que', d.o_que], ['por_que', d.por_que], ['quem', d.quem], ['como', d.como], ['onde', d.onde],
    ['quando', d.quando], ['quanto', d.quanto], ['nota_fiscal', d.nota_fiscal], ['turno', d.turno],
    ...(d.itens || []).flatMap((i, n) => [[`item${n}`, i.descricao], [`item${n}`, i.nf]]),
    ...(d.acoes || []).flatMap((a, n) => [[`acao${n}`, a.descricao], [`acao${n}`, a.responsavel], [`acao${n}`, a.prazo]])];
  const ruim = campos.find(([, v]) => temPalavrao(v));
  if (ruim) return { erro: MSG_PALAVRAO, campo: ruim[0], status: 422 };
  return { d };
}

async function criarAvaria(req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return json({ erro: 'Dados inválidos' }, 400);
  const nome = texto(b.nome, 60), matricula = texto(b.matricula, 20).toUpperCase();
  if (!nome) return json({ erro: 'Identifique quem está fazendo o relatório (nome e matrícula).', campo: 'nome' }, 400);
  if (temPalavrao(nome)) return json({ erro: 'Esse nome tem palavras impróprias.', campo: 'nome' }, 422);
  const mat = await materialAvaria(env, b);
  if (mat.erro) return falha(mat);
  const x = dadosAvaria(b, false);
  if (x.erro) return falha(x);
  const ra = dadosRA(b.dados, {});
  if (ra.erro) return falha(ra);
  const ano = Number(ra.d.data.slice(0, 4));
  const manual = lerNumero(b.numero);
  if (manual && !(await numeroLivre(env, ano, manual))) return falha(jaUsado(ano, manual));
  let r;
  try {
    // número no mesmo comando do INSERT: dois relatórios salvos juntos não pegam o mesmo RA
    r = await env.DB.prepare(
      `INSERT INTO avaria (created_at, material, chave, projeto, descricao_material, unidade, classe, fora_bom,
                           quantidade, defeito, observacao, situacao, registrado_por, matricula, dados, ano, numero)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, MAX(?, COALESCE((${SQL_MAIOR_RA}), 0)) + 1))`
    ).bind(new Date().toISOString(), mat.material, mat.chave, mat.projeto, mat.descricao_material, mat.unidade, mat.classe,
           mat.fora_bom, x.d.quantidade, x.d.defeito, x.d.observacao, x.d.situacao, nome, matricula, JSON.stringify(ra.d),
           ano, manual, RA_ULTIMO_MANUAL[ano] || 0, ano).run();
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) return falha(jaUsado(ano, manual || 0));
    throw e;
  }
  if (mat.fora_bom && mat.projeto) await env.DB.prepare('INSERT OR IGNORE INTO projeto_extra (projeto) VALUES (?)').bind(mat.projeto).run();
  return json({ ok: true, item: await umaAvaria(env, r.meta?.last_row_id) }, 201);
}

// Edição: o relatório inteiro ou só uma parte (a situação, por exemplo). Relatório sem número (feito na
// versão anterior do site) ganha o próximo número livre.
async function editarAvaria(req, env, id) {
  const b = await req.json().catch(() => null);
  if (!b) return json({ erro: 'Dados inválidos' }, 400);
  const atual = await env.DB.prepare('SELECT * FROM avaria WHERE id = ?').bind(id).first();
  if (!atual || atual.excluido_em) return json({ erro: 'Esse relatório de avaria não existe mais.' }, 404);
  const novo = { ...atual };
  if (b.material !== undefined) {
    const mat = await materialAvaria(env, b);
    if (mat.erro) return falha(mat);
    Object.assign(novo, mat);
  }
  const x = dadosAvaria(b, true);
  if (x.erro) return falha(x);
  Object.assign(novo, x.d);
  const ra = dadosRA(b.dados, comDados(atual).dados);
  if (ra.erro) return falha(ra);
  const ano = Number(ra.d.data.slice(0, 4));
  const manual = lerNumero(b.numero);
  let numero = atual.ano === ano ? atual.numero : null;          // mudou o ano: próximo número livre do ano novo
  if (manual && (manual !== atual.numero || ano !== atual.ano)) {
    if (!(await numeroLivre(env, ano, manual, id))) return falha(jaUsado(ano, manual));
    numero = manual;
  }
  try {
    await env.DB.prepare(
      `UPDATE avaria SET material = ?, chave = ?, projeto = ?, descricao_material = ?, unidade = ?, classe = ?, fora_bom = ?,
              quantidade = ?, defeito = ?, observacao = ?, situacao = ?, dados = ?, ano = ?,
              numero = COALESCE(?, MAX(?, COALESCE((${SQL_MAIOR_RA}), 0)) + 1), editado_em = ?, editado_por = ? WHERE id = ?`
    ).bind(novo.material, novo.chave, novo.projeto, novo.descricao_material, novo.unidade, novo.classe, novo.fora_bom,
           novo.quantidade, novo.defeito, novo.observacao, novo.situacao, JSON.stringify(ra.d), ano,
           numero, RA_ULTIMO_MANUAL[ano] || 0, ano, new Date().toISOString(), quemFez(b) || 'Qualidade', id).run();
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) return falha(jaUsado(ano, numero || 0));
    throw e;
  }
  return json({ ok: true, item: await umaAvaria(env, id) });
}

// Exclusão lógica, como nos registros de scrap: fica no banco com quem excluiu e quando. O número de
// um relatório que não chegou a ir por e-mail volta a ficar livre.
async function excluirAvaria(req, env, id) {
  const b = await req.json().catch(() => ({}));
  const a = await env.DB.prepare('SELECT id, excluido_em FROM avaria WHERE id = ?').bind(id).first();
  if (!a || a.excluido_em) return json({ erro: 'Esse relatório de avaria não existe mais.' }, 404);
  await env.DB.prepare('UPDATE avaria SET excluido_em = ?, excluido_por = ? WHERE id = ?')
    .bind(new Date().toISOString(), quemFez(b) || 'Qualidade', id).run();
  return json({ ok: true });
}

// categoria 'nc' (evidência da avaria, até 4) ou 'ok' (padrão aceitável, até 3)
async function fotosAvaria(req, env, id) {
  const b = await req.json().catch(() => null);
  if (!b) return json({ erro: 'Dados inválidos' }, 400);
  const categoria = b.categoria === 'ok' ? 'ok' : 'nc';
  const max = categoria === 'ok' ? MAX_FOTOS_OK : MAX_FOTOS_NC;
  let fotos;
  try { fotos = lerFotos(b.fotos, max); } catch (e) { return json({ erro: e.message }, 400); }
  if (!fotos.length) return json({ erro: 'Nenhuma foto enviada' }, 400);
  const a = await env.DB.prepare(
    `SELECT excluido_em, (SELECT COUNT(*) FROM foto WHERE foto.avaria_id = avaria.id AND COALESCE(foto.categoria, 'nc') = ?) AS n
       FROM avaria WHERE id = ?`
  ).bind(categoria, id).first();
  if (!a || a.excluido_em) return json({ erro: 'Esse relatório de avaria não existe mais.' }, 404);
  if (a.n + fotos.length > max) {
    return json({ erro: `Esse relatório já tem ${a.n} foto(s) ${categoria === 'ok' ? 'OK' : 'da avaria'}. O máximo é ${max}.` }, 400);
  }
  await gravarFotos(env, { avaria: id, categoria }, fotos, quemFez(b) || 'Qualidade');
  return json({ ok: true, total: a.n + fotos.length }, 201);
}

// Foto OK (padrão aceitável) de outro relatório do mesmo material: a peça boa é a mesma, a Qualidade
// não precisa fotografar de novo. Copia no banco (cada relatório fica com as suas).
async function copiarFotosOk(req, env, id) {
  const b = await req.json().catch(() => ({}));
  const origem = Number(b.de);
  if (!Number.isInteger(origem) || origem <= 0 || origem === id) return json({ erro: 'Relatório de origem inválido' }, 400);
  const [alvo, fonte] = await env.DB.batch([
    env.DB.prepare(`SELECT excluido_em, (SELECT COUNT(*) FROM foto WHERE foto.avaria_id = avaria.id AND foto.categoria = 'ok') AS n
                      FROM avaria WHERE id = ?`).bind(id),
    env.DB.prepare("SELECT id FROM foto WHERE avaria_id = ? AND categoria = 'ok' ORDER BY id").bind(origem),
  ]);
  const a = alvo.results[0];
  if (!a || a.excluido_em) return json({ erro: 'Esse relatório de avaria não existe mais.' }, 404);
  const ids = fonte.results.map((r) => r.id).slice(0, Math.max(0, MAX_FOTOS_OK - a.n));
  if (!ids.length) return json({ ok: true, copiadas: 0 });
  const agora = new Date().toISOString();
  await env.DB.batch(ids.flatMap((f) => [
    env.DB.prepare(`INSERT INTO foto (scrap_id, avaria_id, criado_em, tipo, partes, enviado_por, mini, categoria)
                    SELECT 0, ?, ?, tipo, partes, enviado_por, mini, 'ok' FROM foto WHERE id = ?`).bind(id, agora, f),
    // dentro do lote (transação), a foto que acabou de entrar é a de maior id
    env.DB.prepare('INSERT INTO foto_parte (foto_id, n, dados) SELECT (SELECT MAX(id) FROM foto), n, dados FROM foto_parte WHERE foto_id = ?').bind(f),
  ]));
  return json({ ok: true, copiadas: ids.length }, 201);
}

// O e-mail sai do Outlook/celular de quem envia: aqui fica só quando foi preparado e por quem
async function marcarEmail(req, env, id) {
  const b = await req.json().catch(() => ({}));
  const r = await env.DB.prepare('UPDATE avaria SET email_em = ?, email_por = ? WHERE id = ? AND excluido_em IS NULL')
    .bind(new Date().toISOString(), quemFez(b) || 'Qualidade', id).run();
  if (!r.meta?.changes) return json({ erro: 'Esse relatório de avaria não existe mais.' }, 404);
  return json({ ok: true, item: await umaAvaria(env, id) });
}

// Destinatários padrão do e-mail (planejamento, engenharia, compras, produção…), iguais em todos os aparelhos
const listaEmails = (s) => [...new Set(String(s ?? '').split(/[;,\s]+/).map((x) => x.trim())
  .filter((x) => /^[^@\s<>"(),;]+@[^@\s<>"(),;]+\.[^@\s<>"(),;]+$/.test(x)))].slice(0, 40).join('; ');
async function configEmail(env) {
  const rows = (await env.DB.prepare("SELECT chave, valor FROM meta WHERE chave IN ('avaria_email_para', 'avaria_email_cc')").all()).results;
  const valor = (k) => rows.find((r) => r.chave === k)?.valor || '';
  return json({ para: valor('avaria_email_para'), cc: valor('avaria_email_cc') });
}
async function salvarConfigEmail(req, env) {
  const b = await req.json().catch(() => ({}));
  const para = listaEmails(b.para), cc = listaEmails(b.cc);
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('avaria_email_para', ?)").bind(para),
    env.DB.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('avaria_email_cc', ?)").bind(cc),
  ]);
  return json({ ok: true, para, cc });
}

// Relatórios de um período (o dia na tela), por número (ids) ou pela busca (RA-0018, RA-0018-2026 ou código
// do material), com os registros de scrap dos mesmos materiais. A tela separa os registros de cada
// relatório no fuso de quem está vendo.
async function listarAvarias(url, env) {
  const sp = url.searchParams;
  const w = ['excluido_em IS NULL'], v = [];
  const ids = [...new Set((sp.get('ids') || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50);
  const q = texto(sp.get('q'), 40).toUpperCase();
  if (ids.length) { w.push(`id IN (${ids.map(() => '?').join(',')})`); v.push(...ids); }
  else if (q) {
    const m = /^RA[-\s]*0*(\d{1,5})(?:[-/\s]+(\d{4}))?$/.exec(q);
    if (m) {
      w.push('numero = ?'); v.push(Number(m[1]));
      if (m[2]) { w.push('ano = ?'); v.push(Number(m[2])); }
    } else {
      const ch = chaveCodigo(q);
      if (!ch) return json({ itens: [], scraps: [] });
      w.push('chave LIKE ?'); v.push('%' + semCuringa(ch) + '%');
    }
  } else {
    if (sp.get('de')) { w.push('created_at >= ?'); v.push(sp.get('de')); }
    if (sp.get('ate')) { w.push('created_at <= ?'); v.push(sp.get('ate')); }
  }
  const itens = (await env.DB.prepare(
    `${SQL_AVARIA} WHERE ${w.join(' AND ')} ORDER BY created_at ${q && !ids.length ? 'DESC' : 'ASC'} LIMIT 3000`
  ).bind(...v).all()).results.map(comDados);
  return json({ itens, scraps: await scrapsDasAvarias(env, itens) });
}

async function scrapsDasAvarias(env, itens) {
  if (!itens.length) return [];
  const chaves = new Set(itens.map((a) => a.chave));
  // janela de cada relatório: 8 dias antes até 1 dia depois (folga para o fuso), juntando as que se encostam
  let janelas = [];
  for (const [de, ate] of itens.map((a) => Date.parse(a.created_at)).sort((x, y) => x - y)
    .map((t) => [t - (JANELA_DIAS + 1) * DIA_MS, t + DIA_MS])) {
    const u = janelas[janelas.length - 1];
    if (u && de <= u[1]) u[1] = Math.max(u[1], ate); else janelas.push([de, ate]);
  }
  if (janelas.length > 20) janelas = [[janelas[0][0], janelas[janelas.length - 1][1]]];
  const res = await env.DB.batch(janelas.map(([de, ate]) => env.DB.prepare(
    `SELECT id, created_at, posto, material, projeto, quantidade, unidade, classe, defeito, descricao_problema,
            registrado_por, matricula, status FROM scrap
      WHERE excluido_em IS NULL AND created_at >= ? AND created_at <= ? ORDER BY created_at`
  ).bind(new Date(de).toISOString(), new Date(ate).toISOString())));
  const vistos = new Set(), out = [];
  for (const x of res) {
    for (const r of x.results) {
      const chave = chaveCodigo(r.material);
      if (vistos.has(r.id) || !chaves.has(chave)) continue;
      vistos.add(r.id);
      out.push({ ...r, chave });
    }
  }
  return out;
}

// Ao digitar o código: relatórios de avaria que o material já tem (com as fotos OK, para reaproveitar)
// e (scraps=1) os registros de scrap dele nos últimos 7 dias
async function avariasDoMaterial(url, env) {
  const chave = chaveCodigo(normCodigo(url.searchParams.get('q')));
  if (!chave) return json({ avarias: [], scraps: [] });
  const consultas = [env.DB.prepare(
    `SELECT id, created_at, material, situacao, quantidade, unidade, defeito, registrado_por, ano, numero,
            (SELECT group_concat(id) FROM foto WHERE foto.avaria_id = avaria.id AND COALESCE(foto.categoria, 'nc') = 'nc') AS fotos,
            (SELECT group_concat(id) FROM foto WHERE foto.avaria_id = avaria.id AND foto.categoria = 'ok') AS fotos_ok
       FROM avaria WHERE excluido_em IS NULL AND chave = ? ORDER BY created_at DESC LIMIT 20`
  ).bind(chave)];
  if (url.searchParams.get('scraps')) consultas.push(env.DB.prepare(
    `SELECT id, created_at, posto, material, projeto, quantidade, unidade, defeito, descricao_problema,
            registrado_por, matricula, status FROM scrap
      WHERE excluido_em IS NULL AND created_at >= ? ORDER BY created_at DESC`
  ).bind(new Date(Date.now() - JANELA_DIAS * DIA_MS).toISOString()));
  const [av, sc] = await env.DB.batch(consultas);
  return json({
    avarias: av.results.map((a) => ({ ...a, ra: numeroRA(a) })),
    scraps: sc ? sc.results.filter((r) => chaveCodigo(r.material) === chave).slice(0, 30) : [],
  });
}
