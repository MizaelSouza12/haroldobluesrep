# Auditoria profunda — Repertório Haroldo
Data: 9 de outubro de 2026

## Escopo e método

**Repositório auditado:** `MizaelSouza12/haroldobluesrep` (`main`). A auditoria cobre o aplicativo principal, as páginas curtas dos dois repertórios, o visualizador de links, arquivos JSON publicados, importação/exportação, PWA, service worker e as rotas de execução implementadas. Não existe backend de gravação próprio: o GitHub Pages hospeda arquivos estáticos e as edições sem login são mantidas no localStorage.

**Execução final aprovada:** https://github.com/MizaelSouza12/haroldobluesrep/actions/runs/37884730263

| Métrica | Resultado |
| --- | ---: |
| Total de testes automatizados | **124 aprovados / 124 executados** |
| Testes em Chromium real (Playwright) | **57** |
| Testes unitários/de integração simulada (Node/JSDOM) | **67** |
| Funções nomeadas do aplicativo alcançadas por cobertura V8 acumulada | **106 / 106** |
| Funções do editor público alcançadas | **7 / 7** |
| Botões estáticos com ID clicados nas execuções em navegador | **53 / 53** |
| Identificadores de botões distintos registrados (inclui botões dinâmicos) | **65** |
| IDs HTML sem referência válida no código JS | **0** |
| Deploy do Pages referente à última versão do aplicativo | **success** |

**Atenção sobre cobertura:** 106/106 funções alcançadas significa que o profiler V8 observou ao menos uma invocação de cada função nomeada. **Não significa 100% de branch coverage, de linhas ou de todas as condições e combinações de eventos**. O analisador AST encontrou 105 nós `FunctionDeclaration` do app principal (o inventário lexical/Profiler lista 106 nomes de função); isso não representa um erro funcional. Além desses procedimentos existem callbacks anônimos e expressões que não aparecem na contagem de funções nomeadas.

## Evidências geradas automaticamente

- `tests/repertorio.test.cjs`: verificações unitárias, integração JSDOM, dados e falhas de persistência.
- `tests/browser.test.cjs`: testes completos em Chromium real via servidor HTTP local isolado, com ciclo de abertura, clique, digitação, atualização, download, importação e offline.
- `scripts/review-source.cjs`: auditoria de sintaxe/AST e inventário função por função, com linhas relativas ao script, sites de `innerHTML`, IDs e botões.
- Artefato `auditoria-browser` anexado à execução GitHub Actions: `function-coverage.json`, `coverage-all-browser-tests.json`, `code-review-inventory.json` e `code-review-inventory.md`.

A automação roda com Node.js 22, JSDOM 26 e navegador Chromium real instalado via Playwright. O PDF gerado é analisado pelo leitor externo `pdf-lib`, em vez de apenas procurar pela extensão `.pdf`.

Para executar localmente:

```bash
npm install
npx playwright install chromium
npm test
npm run audit:source
```

## Fluxos efetivamente exercitados

1. Abertura e renderização das 214 músicas originais; categorias A (204), J (19), combinações AJ e nomes personalizados.
2. Buscas e pesquisa aproximada, 100 buscas consecutivas sob carga, filtro de artistas e estado sem resultados.
3. Setlists manuais: criação, edição, seleção, renomeação, exclusão, cancelamento, fluxo de voz simulado e isolamento entre repertórios.
4. UI da preparação para músicos, links curtos A/J, links dinâmicos para listas sem página fixa, texto compartilhado e Web Share API simulada.
5. Editor público: digitação real de notas/cifras e anotações, recarregamento, persistência por repertório e diferentes perfis de navegador.
6. Estresse de **204 tons e 100 anotações**, persistência e integridade de todos os valores após reload; edição em duas abas.
7. Falhas de localStorage (limite/permissão), JSON malformado e operação de salvar recusada.
8. Exportação PDF pequena/grande, validação com parser externo, exportação Word compatível (.doc), impressão e cópia.
9. Backup JSON baixado pelo Chrome e importado por seletor de arquivos real, contendo os campos públicos editados.
10. Teleprompter com letras, controle de velocidade, Play/Pausa, Próxima/Anterior, opções, edição, ocultação e restauração.
11. Preferências, cores, fonte, alinhamento, barra, botão flutuante e armazenamento.
12. Busca/criação de lista por voz usando **eventos simulados da Web Speech API**; erros de permissão e falta de suporte.
13. Botão flutuante arrastado com mouse real, estado persistente, modo responsivo móvel e registro da PWA.
14. Service worker ativo em Chromium, com abertura da página principal mesmo offline após instalar o cache.
15. Proteção básica contra HTML executável em títulos, tratamento de URL incompleta e falhas de rede JSON.

## Defeitos reais reproduzidos, corrigidos e regredidos

- **Perda de músicas em setlists:** a função de reconstrução removia IDs da lista persistente ao ocultar uma música. Agora preserva a associação para restauração posterior.
- **Falso salvamento de letras:** uma falha de gravação podia fechar o editor sem salvar. Agora verifica a persistência, mantém a edição aberta e avisa.
- **Links de compartilhamento errados:** A Sua Maneira e Jazz & Blues ainda geravam URL longa. Agora usam suas páginas estáticas curtas.
- **Falso salvamento de setlists:** erro de armazenamento era silenciosamente ignorado. Agora criação, confirmação de seleção e criação por voz interrompem a operação e alertam em caso de falha.
- **Dados locais malformados:** objetos de letras e categorias inválidos podiam impedir a inicialização. Agora são validados antes do uso.
- **Edições concorrentes:** o editor de notas podia sobrescrever alterações de outra aba. Agora mescla a entrada atual antes de gravar a música.
- **Backup incompleto:** anotações das páginas curtas não estavam sendo incluídas. Agora fazem parte do backup completo.
- **Backup bloqueado por JSON local corrompido:** um registro de anotações inválido podia impedir a exportação das outras playlists. Agora apenas a entrada inválida é ignorada.
- **Importação vulnerável a configurações locais inválidas:** a leitura dos nomes das abas era passível de falha. Agora trata dados ilegíveis.
- **Cache PWA desatualizado:** o service worker foi atualizado para `v15` e as páginas de `/setlists/` procuram conteúdo atualizado pela rede.

As reprovações usadas para demonstrar bugs reais ocorreram **antes das correções**, e todos esses casos passaram na rodada final. Também houve reprovações **do próprio teste**, por sincronização de `fetch` assíncrono e hipóteses antigas sobre links, corrigidas sem alterar o app indevidamente.

## Limitações e riscos ainda existentes

1. **Sem servidor gravável / sem sincronização entre pessoas:** editar tom/anotação sem login em GitHub Pages salva apenas no browser. Outro músico e Haroldo em outro aparelho não recebem automaticamente a alteração.
2. **Publicação automática inexistente:** criar nova playlist no app não cria o arquivo `setlists/nova-playlist.html` no GitHub. As páginas curtas são publicações independentes; alterações locais no repertório não atualizam o JSON hospedado.
3. **Privacidade:** o repositório principal é público e contém letras dentro do HTML. Esconder a navegação do link do músico não torna essas letras confidenciais.
4. **Formato Word:** o arquivo exportado como `.doc` contém HTML compatível com Word, não é `.docx` Office Open XML genuíno.
5. **Unicode em PDF:** o gerador manual usa WinAnsi/Latin-1, podendo substituir alguns símbolos por `?`.
6. **Microfone real:** o parser e a UI de voz foram exercitados com eventos simulados; o serviço Web Speech e as permissões de hardware precisam de homologação manual em celulares reais.
7. **Dispositivos físicos e navegadores:** Chromium desktop e viewport móvel foram testados; não houve prova em Safari/iOS nem em aparelhos Android físicos.
8. **Dados exclusivamente locais:** limpar o armazenamento do site, trocar de navegador ou aparelho pode fazer os dados desaparecerem. O backup manual completo continua necessário.
9. **Gate de implantação:** o build padrão do GitHub Pages é independente do workflow de testes; uma alteração futura com testes reprovados ainda poderá ser publicada, a menos que a implantação seja condicionada às verificações.
10. **Cobertura de ramos:** 100% das funções nomeadas foram alcançadas, mas não todos os ramos, exceções, entradas possíveis ou limites de memória.

## Homologação manual recomendada

Depois da execução automatizada aprovada, testar em aparelhos reais a instalação/atualização PWA, reconhecimento de voz com microfone, modo sem rede, compartilhamento pelo sistema operacional, acessibilidade, restauração de um backup de produção e atualização por outro usuário/dispositivo. Fazer backup antes de importar ou modificar dados reais.

A auditoria **não alterou ou leu o localStorage real do dispositivo do Haroldo**; os testes foram executados em contextos isolados com dados fictícios. As letras originais e os arquivos do repositório não foram removidos.
