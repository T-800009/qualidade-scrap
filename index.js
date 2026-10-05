import APP_HTML from './app.html';
import LOGIN_HTML from './login.html';
import { temPalavrao } from './palavras.js';

const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#e4002b"/><circle cx="29" cy="29" r="14.5" fill="none" stroke="#fff" stroke-width="7"/><path d="M38.5 38.5 49 49" stroke="#fff" stroke-width="7.5" stroke-linecap="round"/></svg>';

const MSG_PALAVRAO = 'Esse texto tem palavras impróprias. Reescreva de forma profissional.';

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
     editado_em TEXT, editado_por TEXT, classe TEXT)`,
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
  `CREATE TABLE IF NOT EXISTS projeto_extra (projeto TEXT PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
     ip TEXT PRIMARY KEY, falhas INTEGER NOT NULL DEFAULT 0, bloqueado_ate INTEGER NOT NULL DEFAULT 0)`,
];
// Colunas adicionadas depois da primeira versão (ignora se já existem)
const MIGRACOES = [
  'ALTER TABLE scrap ADD COLUMN matricula TEXT',
  'ALTER TABLE scrap ADD COLUMN excluido_em TEXT',
  'ALTER TABLE scrap ADD COLUMN excluido_por TEXT',
  'ALTER TABLE scrap ADD COLUMN editado_em TEXT',
  'ALTER TABLE scrap ADD COLUMN editado_por TEXT',
  'ALTER TABLE scrap ADD COLUMN classe TEXT',
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
      // Depois das colunas novas: índice da matrícula e lista de projetos fora da BOM (uma vez só)
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_scrap_matricula ON scrap(matricula, created_at)').run();
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
  if (p === '/login' && m === 'GET') return html(LOGIN_HTML);
  if (p === '/login' && m === 'POST') return login(req, env);
  if (p === '/logout') return logout(url);

  const role = await lerSessao(req, env);
  if (!role) {
    if (p.startsWith('/api/')) return json({ erro: 'Sessão expirada' }, 401);
    return Response.redirect(url.origin + '/login', 302);
  }

  if (p === '/' && m === 'GET') return html(APP_HTML);
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
  if (mFoto && m === 'GET') return servirFoto(env, Number(mFoto[1]));
  if (mFoto && m === 'DELETE') {
    if (!podeFoto) return json({ erro: 'Só a Qualidade pode remover fotos.' }, 403);
    return removerFoto(env, Number(mFoto[1]));
  }
  const mAddFoto = p.match(/^\/api\/scrap\/(\d+)\/fotos$/);
  if (mAddFoto && m === 'POST') {
    if (!podeFoto) return json({ erro: 'Só a Qualidade pode adicionar fotos.' }, 403);
    return adicionarFotos(req, env, Number(mAddFoto[1]));
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

async function bomIndex(env) {
  const agora = Date.now();
  if (BOM && agora - BOM.checado < CHECAR_VERSAO_MS) return BOM;
  const v = (await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'bom_versao'").first())?.valor || '0';
  if (BOM && BOM.versao === v) { BOM.checado = agora; return BOM; }
  if (!carregandoBom) {
    carregandoBom = (async () => {
      const rows = (await env.DB.prepare('SELECT projeto, material, descricao, unidade, classe, updated_at FROM bom').all()).results;
      const porMaterial = new Map();
      const projetos = new Map();
      for (const r of rows) {
        let m = porMaterial.get(r.material);
        if (!m) { m = { material: r.material, descricao: '', busca: '', linhas: [] }; porMaterial.set(r.material, m); }
        m.linhas.push({ projeto: r.projeto, material: r.material, descricao: r.descricao || '', unidade: normUn(r.unidade), classe: r.classe || '' });
        if (!m.descricao && r.descricao) { m.descricao = r.descricao; m.busca = r.descricao.toUpperCase(); }
        const pj = projetos.get(r.projeto) || { projeto: r.projeto, itens: 0, atualizado: '' };
        pj.itens++;
        if (r.updated_at > pj.atualizado) pj.atualizado = r.updated_at;
        projetos.set(r.projeto, pj);
      }
      const porChave = new Map();
      for (const m of porMaterial.values()) {
        m.linhas.sort((a, b) => a.projeto.localeCompare(b.projeto));
        m.chave = chaveCodigo(m.material);
        if (!porChave.has(m.chave)) porChave.set(m.chave, m);
      }
      return {
        versao: v, checado: Date.now(), porMaterial, porChave,
        materiais: [...porMaterial.values()].sort((a, b) => a.material.localeCompare(b.material)),
        projetos: [...projetos.values()].sort((a, b) => a.projeto.localeCompare(b.projeto)),
      };
    })().finally(() => { carregandoBom = null; });
  }
  BOM = await carregandoBom;
  return BOM;
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
  // Registros antigos sem classe ganham a classe da BOM recém-importada
  await env.DB.prepare(
    `UPDATE scrap SET classe = (SELECT classe FROM bom WHERE bom.material = scrap.material AND bom.projeto = scrap.projeto)
      WHERE (classe IS NULL OR classe = '')
        AND EXISTS (SELECT 1 FROM bom WHERE bom.material = scrap.material AND bom.projeto = scrap.projeto AND bom.classe <> '')`
  ).run();
  return json({ ok: true, gravados: lote.length, ignorados });
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
  const cls = normClasse(sp.get('classe'));
  if (cls === '-') w.push("(classe IS NULL OR classe = '')");
  else if (cls) { w.push('classe = ?'); v.push(cls); }
  if (sp.get('foto') === 'sem') w.push('NOT EXISTS (SELECT 1 FROM foto WHERE foto.scrap_id = scrap.id)');
  if (sp.get('foto') === 'com') w.push('EXISTS (SELECT 1 FROM foto WHERE foto.scrap_id = scrap.id)');
  const mat2 = texto(sp.get('matricula'), 20).toUpperCase();
  if (mat2) { w.push('matricula = ?'); v.push(mat2); }
  return { where: 'WHERE ' + w.join(' AND '), v };
}

async function listarScrap(url, env) {
  const { where, v } = filtros(url);
  const r = await env.DB.prepare(
    `SELECT scrap.*, (SELECT group_concat(id) FROM foto WHERE foto.scrap_id = scrap.id) AS fotos
       FROM scrap ${where} ORDER BY created_at DESC LIMIT 5000`
  ).bind(...v).all();
  return json({ registros: r.results });
}

// Lê as linhas do período uma vez só e agrupa aqui (5x menos leitura do que 5 consultas)
async function estatisticas(url, env) {
  const { where, v } = filtros(url);
  const rows = (await env.DB.prepare(
    `SELECT posto, projeto, defeito, material, descricao_material, unidade, quantidade, classe FROM scrap ${where}`
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
  const porClasse = grupo((r) => r.classe || '').map(({ r, ...a }) => ({ classe: r.classe || '', ...a })).sort(porRegistros);
  const desc = new Map();
  for (const r of rows) {
    const k = r.material + '|' + r.projeto;
    if (r.descricao_material && (desc.get(k) || '') < r.descricao_material) desc.set(k, r.descricao_material);
  }
  const topMateriais = grupo((r) => r.material + '|' + r.projeto)
    .map(({ r, ...a }) => ({ material: r.material, projeto: r.projeto, classe: r.classe || '', descricao: desc.get(r.material + '|' + r.projeto) || '', unidade: normUn(r.unidade), ...a }))
    .sort(porRegistros).slice(0, 10);

  return json({ total, porPosto, porProjeto, porDefeito, porClasse, topMateriais });
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
  const reg = await env.DB.prepare('SELECT id, excluido_em FROM scrap WHERE id = ?').bind(id).first();
  if (!reg || reg.excluido_em) return json({ erro: 'Registro não encontrado' }, 404);

  const posto = Number(b.posto);
  const quantidade = Number(String(b.quantidade ?? '').replace(',', '.'));
  const projeto = texto(b.projeto, 40).toUpperCase();
  const defeito = texto(b.defeito, 60);
  const problema = texto(b.descricao_problema, 1000);
  const unidade = normUn(b.unidade);
  const classe = normClasse(b.classe);
  if (!Number.isInteger(posto) || posto < 1 || posto > 10) return json({ erro: 'Posto inválido (1 a 10)', campo: 'posto' }, 400);
  if (String(b.unidade ?? '').trim() && !unidade) return json({ erro: 'Unidade inválida. Use letras, ex.: PC, UN, M, KG.', campo: 'unidade' }, 400);
  if (quantidade > 100000) return json({ erro: 'Quantidade alta demais. Confira o valor.', campo: 'quantidade' }, 400);
  if (!projeto) return json({ erro: 'Informe o projeto', campo: 'projeto' }, 400);
  if (!(quantidade > 0)) return json({ erro: 'Quantidade deve ser maior que zero', campo: 'quantidade' }, 400);
  if (!defeito) return json({ erro: 'Escolha o defeito', campo: 'defeito' }, 400);
  if (!problema) return json({ erro: 'Descreva o problema', campo: 'descricao_problema' }, 400);
  if (temPalavrao(problema)) return json({ erro: MSG_PALAVRAO, campo: 'descricao_problema' }, 422);
  if (temPalavrao(projeto)) return json({ erro: MSG_PALAVRAO, campo: 'projeto' }, 422);

  await env.DB.prepare(
    `UPDATE scrap SET posto = ?, projeto = ?, quantidade = ?, unidade = ?, classe = ?, defeito = ?, descricao_problema = ?,
            editado_em = ?, editado_por = ? WHERE id = ?`
  ).bind(posto, projeto, quantidade, unidade, classe, defeito, problema, new Date().toISOString(), 'Administrador', id).run();
  await env.DB.prepare('INSERT OR IGNORE INTO projeto_extra (projeto) VALUES (?)').bind(projeto).run();
  return json({ ok: true });
}

/* ---------------- fotos ---------------- */
// A foto chega do navegador já reduzida (JPEG ~1600px). No banco ela é guardada em
// pedaços de até 90 KB, porque o D1 limita o tamanho de cada comando.
const MAX_FOTOS = 3;
const MAX_FOTO_B64 = 2_800_000;          // ~2 MB de imagem
const PEDACO = 90_000;

function lerFotos(lista) {
  if (lista == null) return [];
  if (!Array.isArray(lista)) throw Error('Fotos em formato inválido.');
  if (lista.length > MAX_FOTOS) throw Error(`Máximo de ${MAX_FOTOS} fotos por registro.`);
  return lista.map((f) => {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(f || ''));
    if (!m) throw Error('Uma das fotos não é uma imagem válida.');
    if (m[2].length > MAX_FOTO_B64) throw Error('Foto grande demais. Tire a foto de novo.');
    return { tipo: 'image/' + m[1], b64: m[2] };
  });
}

async function gravarFotos(env, scrapId, fotos, autor) {
  const agora = new Date().toISOString();
  for (const f of fotos) {
    const partes = [];
    for (let i = 0; i < f.b64.length; i += PEDACO) partes.push(f.b64.slice(i, i + PEDACO));
    const r = await env.DB.prepare('INSERT INTO foto (scrap_id, criado_em, tipo, partes, enviado_por) VALUES (?, ?, ?, ?, ?)')
      .bind(scrapId, agora, f.tipo, partes.length, autor || null).run();
    const id = r.meta?.last_row_id;
    await env.DB.batch(partes.map((d, n) =>
      env.DB.prepare('INSERT INTO foto_parte (foto_id, n, dados) VALUES (?, ?, ?)').bind(id, n, d)));
  }
}

async function servirFoto(env, id) {
  const f = await env.DB.prepare('SELECT tipo, partes FROM foto WHERE id = ?').bind(id).first();
  if (!f) return new Response('Foto não encontrada', { status: 404 });
  const rows = (await env.DB.prepare('SELECT dados FROM foto_parte WHERE foto_id = ? ORDER BY n').bind(id).all()).results;
  if (rows.length !== f.partes) return new Response('Foto incompleta', { status: 500 });
  const bin = atob(rows.map((r) => r.dados).join(''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: { 'Content-Type': f.tipo, 'Cache-Control': 'private, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
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
  await gravarFotos(env, scrapId, fotos, nome ? `${nome}${mat ? ' (' + mat + ')' : ''}` : 'Qualidade');
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
