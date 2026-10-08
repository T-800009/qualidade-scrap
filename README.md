# Scrap QA (scrap e avarias)

Registro de scrap por posto (P0, P½ e P1–P10) com identificação automática do projeto pela BOM, parecer da Qualidade,
relatório de avarias (FO.QA.A.049), relatório emitido (sim/não) por registro e saldo dos depósitos 1500 e 1600.
Cloudflare Worker + D1, publicado pelo GitHub (igual ao Controle de Produção).

## Perfis
- **Operador** (`QUALIDADE_PASSWORD`): registra scrap, vê registros e painel, exporta Excel.
  Ao abrir o site, informa matrícula e nome (ficam gravados em cada registro).
- **Qualidade** (`INSPECAO_PASSWORD`): tudo do operador + **adicionar e remover fotos** dos registros (filtro "Sem foto" em Registros) + montar o **relatório de avarias** + marcar **relatório emitido** + anexar o Excel dos **depósitos 1500 e 1600**.
- **Admin** (`ADMIN_PASSWORD`): tudo acima + importar/excluir BOMs + **editar e apagar registros** (inclusive corrigir o SAP digitado errado).

Registros apagados não somem do banco: ficam marcados com quem apagou e quando.
Registros editados ficam marcados como "editado", com data e hora da edição.

## Arquivos que vão para o GitHub
```
src/index.js
src/app.html
src/login.html
src/palavras.js
src/marca-byd.js
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

## Postos
A linha tem o **posto 0**, o **posto ½** (o "posto meio", entre o 0 e o 1) e os postos **1 a 10**, nessa ordem, na linha do Registrar,
nos filtros, no Painel e no Excel (**P0**, **P½**, P1…). No banco o ½ é gravado como 0.5 e o 0 como 0.
Na primeira vez que a versão com o ½ roda, a tabela de registros é refeita sozinha (o banco antigo só aceitava 1 a 10):
todas as linhas são copiadas com os mesmos números, e as fotos e os relatórios continuam ligados.

## Depósitos 1500 e 1600
Qualidade e admin → abas **1500** e **1600** → **Anexar Excel** (como no WBYD).
- No SAP, rode a MB52 do depósito e exporte para Excel. O site acha as colunas pelo nome, em qualquer ordem e em qualquer linha do topo:
  Material, Texto breve material, UM básica, Utilização livre e Val.utiliz.livre (Centro, Depósito, Localização, Em controle qualid. e Estoque bloqueado, se tiver).
- Se o arquivo tiver a coluna Depósito com vários depósitos, cada aba pega só as linhas dela.
- Cada arquivo novo substitui o anterior daquele depósito (até 30.000 materiais; o navegador envia em partes).
- A tela mostra os indicadores do WBYD (com saldo, sem saldo, valor do estoque) e, por peça, o projeto e a classe pelas BOMs
  e quantos scraps ela tem no site (clique para ver os registros). **Exportar Excel** baixa a lista filtrada.
- Os operadores não veem essas abas.

## Em análise
Todo scrap registrado entra como **Em análise**. A Qualidade (ou o admin) dá o parecer na aba **Em análise**:
Scrap confirmado, Retrabalho, Devolver ao fornecedor ou Liberado para uso, sempre com um texto de parecer.
Itens com mais de 2 dias aparecem em vermelho. O número na aba mostra quantos estão pendentes.

## Registros e relatório emitido
A aba **Registros** usa a largura toda da tela e mostra cada registro numa linha só (no celular, um cartão por registro).
- **Andamento** (faixa no topo, também no Painel): cada registro está em uma etapa, e clicar numa etapa filtra a lista:
  **Em análise** → **Relatório pendente** (com parecer, relatório ainda não emitido) → **Relatório emitido**.
- **Coluna Relatório emitido**: dois botões por registro, **Sim** e **Não**, sempre um aceso:
  **Sim fica verde**, **Não fica vermelho** (todo registro começa em Não).
  O Sim guarda quem marcou e quando (aparece embaixo; passe o mouse para ver a hora). Qualidade e admin mudam; o operador só vê.
  Voltar para Não pede confirmação. Marcou Sim errado? O aviso que aparece embaixo tem **Desfazer**.
- **Vários de uma vez**: selecione as linhas (ou todas do filtro, pela caixa do cabeçalho) e use **Relatório emitido: Sim / Não** na barra azul.
- **Busca** na hora (código com ou sem hífen, descrição, defeito, operador, RA), **Filtros** (período, posto, projeto, defeito, classe,
  situação, relatório emitido, fotos, avaria) e ordenação clicando no título da coluna.
- **Exportar Excel** sai com o que está na tela, já com as colunas Andamento e Relatório emitido (sim/não, quando e quem) e autofiltro.
- As marcas antigas do PCP (scrap feito / arrumado) continuam guardadas no banco, só saíram da tela.
- Quando sai uma versão nova do site, quem está com ele aberto vê o aviso **Atualizar agora**. A versão fica no rodapé.

## Relatório de avarias (FO.QA.A.049)
Aba **Relatório**: a Qualidade (ou o admin) monta; o operador só vê e baixa o PDF.
- Um relatório por avaria, no modelo **FO.QA.A.049 rev.02** (A4, mesmo layout do formulário em papel). A numeração continua a do papel: o primeiro feito no site é o **RA-0018-2026** (o último manual foi o RA-0017-2026; para mudar, `RA_ULTIMO_MANUAL` em `src/index.js`). O número sai na hora de salvar e não se repete; dá para corrigir à mão, e o site avisa se o número já existir.
- Digite o código da peça e tire a foto NC (até 4). A descrição do problema (o quê, por quê, quem, como, onde, quando, quanto), a rastreabilidade e o plano de ação (contenção + corretiva com prazo de 15 dias) já vêm escritos, a partir da BOM, do tipo de avaria, da situação da peça e do registro de scrap do material nos últimos 7 dias. Tudo pode ser ajustado; o que for mexido à mão não é reescrito.
- **Foto OK** (padrão aceitável) é opcional; no relatório seguinte da mesma peça, as fotos OK do anterior entram sozinhas.
- **Ver PDF** mostra o formulário antes de salvar. **Salvar e enviar por e-mail** salva e abre o e-mail já escrito (assunto, texto formal com a descrição, a rastreabilidade e o plano de ação):
  - **E-mail pronto com PDF (Outlook)** baixa um rascunho `.eml` que abre no Outlook com o texto e o PDF anexado; é só conferir e enviar.
  - No celular, **Compartilhar…** manda o PDF e o texto pelo app escolhido (Outlook, Gmail…).
  - Também dá para abrir no programa de e-mail (o PDF é baixado para anexar), copiar o texto ou baixar só o PDF.
  - Os destinatários (Para e Cc) ficam salvos para os próximos relatórios.
- O cartão de cada RA mostra a situação da peça (dá para mudar ali), se o e-mail já saiu, as fotos e os registros de scrap do material, com os botões PDF, Enviar de novo, Editar, Foto NC e Excluir. Excluir um RA que ainda não foi enviado libera o número.
- **Excel** do dia com todos os campos. A busca acha por `RA-0018` ou pelo código da peça. As setas mostram outros dias.
- Em **Registrar**, **Em análise** e **Registros**, o material que tem relatório aparece com o selo **Formulário de avaria RA-…** (clique mostra os relatórios com o PDF). Em Registros há o filtro "Avaria" e a coluna no Excel.
- Material fora da BOM também entra: preencha projeto e descrição se souber.
- Link direto para um dia: `/?aba=relatorio&dia=2026-10-07`.

## Editar BOM pelo site
Admin → aba **BOMs** → **Editar** no projeto.
- Classe A, B, C ou sem classe em um clique, ou para vários itens de uma vez (marque os itens ou "selecionar todos do filtro").
- Filtro "Sem classe" mostra o que falta classificar. A busca aceita SAP ou descrição.
- Quando a classe de uma peça muda, os registros dessa peça naquele projeto passam a ter a classe nova.
- Classe "vem de outra BOM": a BOM do projeto não informa, e o site usa a classe da mesma peça em outro projeto. Clique na letra para gravar nesta BOM.
- Também dá para adicionar, corrigir (descrição/unidade) e excluir itens, e exportar a BOM em Excel (MATERIAL, DESCRIÇÃO, UNIDADE, CLASSIFICAÇÃO), que pode ser importada de volta.

## Corrigir SAP digitado errado
Admin → aba **Em análise** ou **Registros** → **Editar registro** → digite o SAP certo.
- SAP da BOM: descrição, projeto, unidade e classe vêm sozinhos. Se o SAP estiver em mais de um projeto, escolha o projeto.
- SAP fora da BOM: o registro fica marcado "fora BOM"; preencha projeto e descrição.
- O registro mostra **SAP corrigido · era X** (o código que o operador digitou) e o Excel tem a coluna "SAP antes da correção".

## Filtro de palavras
O site bloqueia palavrões e ofensas em "O que aconteceu", no nome do operador e nos campos de material fora da BOM.
Para acrescentar palavras, edite `src/palavras.js` no GitHub (instruções no topo do arquivo).
