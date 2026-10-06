# Qualidade · Scrap

Registro de scrap por posto (P1–P10) com identificação automática do projeto pela BOM.
Cloudflare Worker + D1, publicado pelo GitHub (igual ao Controle de Produção).

## Perfis
- **Operador** (`QUALIDADE_PASSWORD`): registra scrap, vê registros e painel, exporta Excel.
  Ao abrir o site, informa matrícula e nome (ficam gravados em cada registro).
- **Qualidade** (`INSPECAO_PASSWORD`): tudo do operador + **adicionar e remover fotos** dos registros (filtro "Sem foto" em Registros).
- **Admin** (`ADMIN_PASSWORD`): tudo acima + importar/excluir BOMs + **editar e apagar registros** (inclusive corrigir o SAP digitado errado). Também pode adicionar fotos.

Registros apagados não somem do banco: ficam marcados com quem apagou e quando.
Registros editados ficam marcados como "editado", com data e hora da edição.

## Arquivos que vão para o GitHub
```
src/index.js
src/app.html
src/login.html
src/palavras.js
wrangler.jsonc
package.json
.gitignore
README.md
```
Não suba `node_modules`, `.wrangler` nem `.dev.vars`.

## 1. Criar o repositório
GitHub → **New repository** → nome `qualidade-scrap` (privado) → **Create**.
Clique em **uploading an existing file**, arraste o conteúdo desta pasta (a pasta `src` junto) e clique em **Commit changes**.

## 2. Ligar no Cloudflare
Workers & Pages → **Create** → **Import a repository** → escolha `qualidade-scrap`.
- Build command: deixe vazio
- Deploy command: `npx wrangler deploy`

Clique em **Deploy**. No log deve aparecer:
```
env.DB (qualidade-scrap-db)     D1 Database
Success
```
O banco `qualidade-scrap-db` é criado sozinho no primeiro deploy, e as tabelas são criadas na primeira vez que o site abrir.

## 3. Senhas
No Worker `qualidade-scrap` → **Settings** → **Variables and Secrets** → **Add**, tipo **Secret**:

| Nome | Valor |
|---|---|
| `QUALIDADE_PASSWORD` | senha dos operadores |
| `ADMIN_PASSWORD` | sua senha de admin |
| `INSPECAO_PASSWORD` | senha do pessoal da Qualidade (fotos) |
| `SESSION_SECRET` | um texto longo e aleatório (ex.: 40 letras e números misturados) |

Salve com **Deploy**. Sem essas senhas o site não deixa ninguém entrar.

## 4. Domínio próprio
No Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain** → ex.: `qualidade.seudominio.com.br`.

## 5. Importar BOMs
Entre com a senha de admin → aba **BOMs** → escolha o Excel. O site detecta o cabeçalho e as colunas (Material, Descrição, Unidade, Projeto).
- **Um arquivo por projeto:** preencha "Nome do projeto" (ele tenta pegar do nome do arquivo, ex.: `BOM BC22S02.xlsx`).
- **Um arquivo com todos:** escolha a coluna Projeto.
- Marque "Substituir" para trocar a BOM inteira do projeto.
- **Classe (A/B/C):** vem da coluna CLASSIFICAÇÃO da BOM. Ao importar, os registros antigos sem classe recebem a classe automaticamente.
- **Unidade:** só é aceita se for texto (PC, UN, M, KG…). Se a coluna escolhida tiver números, o site avisa e ignora.

## Atualizar depois
Edite ou reenvie os arquivos no GitHub. Cada commit publica sozinho.

**Configuração do build no Cloudflare** (Settings → Builds):
- Build command: `pnpm run build` ou vazio (o script de build não faz nada, o Worker usa `src/` direto)
- Deploy command: `npx wrangler deploy`
- Os arquivos do site ficam **só** em `src/`. Não suba cópias na raiz nem em outras pastas.
- Se o repositório for apagado e criado de novo, é preciso desconectar e conectar o Git de novo no Cloudflare. Depois disso, o build só roda no **próximo commit**.

## Em análise
Todo scrap registrado entra como **Em análise**. A Qualidade (ou o admin) dá o parecer na aba **Em análise**:
Scrap confirmado, Retrabalho, Devolver ao fornecedor ou Liberado para uso, sempre com um texto de parecer.
Itens com mais de 2 dias aparecem em vermelho. O número na aba mostra quantos estão pendentes.

## Corrigir SAP digitado errado
Admin → aba **Em análise** ou **Registros** → **Editar registro** → digite o SAP certo.
- SAP da BOM: descrição, projeto, unidade e classe vêm sozinhos. Se o SAP estiver em mais de um projeto, escolha o projeto.
- SAP fora da BOM: o registro fica marcado "fora BOM"; preencha projeto e descrição.
- O registro mostra **SAP corrigido · era X** (o código que o operador digitou) e o Excel tem a coluna "SAP antes da correção".

## Filtro de palavras
O site bloqueia palavrões e ofensas em "O que aconteceu", no nome do operador e nos campos de material fora da BOM.
Para acrescentar palavras, edite `src/palavras.js` no GitHub (instruções no topo do arquivo).
