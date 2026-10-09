# Auditoria de produção — Repertório Haroldo

**Atualizado em:** 9 de outubro de 2026  
**Repositório:** `MizaelSouza12/haroldobluesrep`  
**Branch auditada:** `audit/producao-hardening-20261009`  
**Evidência completa (antes deste documento):** https://github.com/MizaelSouza12/haroldobluesrep/actions/runs/37887529517

## Resultado confirmado

| Critério | Resultado |
|---|---:|
| Testes Node/JSDOM e Chromium real | **149 / 149 aprovados** |
| Testes adicionais Firefox | **5 / 5 aprovados** |
| Testes adicionais WebKit | **5 / 5 aprovados** |
| Total de execuções de teste aprovadas na matriz | **159 / 159** |
| Funções nomeadas do app alcançadas pelo profiler V8 | **112 / 112** |
| Funções nomeadas do editor público alcançadas | **7 / 7** |
| Botões estáticos com ID clicados no Chromium | **53 / 53** |
| Identificadores distintos de ações clicadas | **65** |
| Cache PWA da versão auditada | **v16** |

**Interpretação da cobertura:** uma função alcançada foi invocada pelo menos uma vez. Isso **não é cobertura de 100% dos ramos, linhas ou situações possíveis**. Existem callbacks e eventos anônimos fora da contagem de funções nomeadas.

## Testes realizados em execução real

- Chromium real via Playwright com servidor HTTP local isolado. Firefox e WebKit em jobs adicionais, executando abertura, categorias, edição, F5, notas, links e preparação para músicos.
- Base de 214 músicas intacta; categorias A com 204 e J com 19 músicas (9 comuns).
- CRUD de letras, categorias e setlists, teleprompter, navegação anterior/próxima, velocidade, Play/Pausa, voz simulada, arrastar botão e configurações.
- Criação de **500 letras artificiais + 50 setlists**, pesquisa, F5, novo filtro e verificação de integridade.
- Edição de **204 cifras + 100 anotações**, recarga e comparação dos valores gravados.
- **1.200 atualizações de campos de nota/anotação** distribuídas por 12 ciclos seguidos de F5.
- Backup completo exportado por download, importado em outro contexto de navegador, com conferência de letra, cifra e anotação.
- Falhas provocadas de localStorage/QuotaExceededError para letras, categorias, setlists, nota, preferências, exclusão/ocultação e importação.
- Conflitos em duas abas editando a mesma música, duas abas editando músicas diferentes e duas telas do app editando notas distintas.
- PWA/offline, atualização do cache, isolamento de caches de projetos externos, rede JSON interrompida, caracteres Unicode, visualização em larguras de 320 a 1280 px, PDF aberto em parser externo e Word .doc gerado.
- Recuperação do rascunho de letra após F5; descarte confirmado não reaparece; F5 no teleprompter preserva conteúdo salvo.

## Defeitos reais reproduzidos e corrigidos

1. **Perda silenciosa ao salvar dados**: preferências, velocidades, renomeação de abas, renomeação/exclusão/seleção de setlists e restaurar/ocultar/remover música agora verificam a gravação. Em falha, revertem a mudança e exibem aviso.
2. **Falsa confirmação de importação de backup**: o fluxo agora confere o resultado de gravação de cada etapa. Não anuncia sucesso quando localStorage recusa gravar. Informa corretamente a possibilidade de importação parcial.
3. **Rascunhos perdidos com F5**: o editor guarda rascunhos na sessionStorage da aba, permite recuperá-los e os descarta após salvar ou confirmar descarte.
4. **Concorrência de notas**: edições em abas diferentes são mescladas por música; alteração conflitante da **mesma** nota é recusada com aviso em vez de sobrescrever silenciosamente.
5. **Corrupção local e importações inválidas**: nomes de setlists, categorias, músicas, overrides e registros de backup são validados antes de entrarem na renderização.
6. **Cache excluído de outro projeto**: o service worker agora remove apenas caches com prefixo `repertorio-haroldo-`.
7. **Backup defasado**: exportação atualiza as notas da playlist armazenadas por outras abas do mesmo navegador.
8. **Modo offline/cache de versões anteriores**: cache atualizado para `v16`; páginas estáticas de `/setlists/` priorizam a rede.

Os testes foram inicialmente executados contra comportamentos que falhavam. Depois das correções, os mesmos testes foram executados novamente com aprovação.

## Limitações ainda abertas

- **Sem backend gravável:** GitHub Pages é estático. Tom e anotação sem login ficam em localStorage, **não** sincronizam entre pessoas ou aparelhos. Falhas de quota e limpeza de dados do site ainda exigem backup.
- **Importação sem transação múltipla:** o localStorage não dispõe de transação sobre vários nomes de chave. Se a importação falhar depois de algumas gravações, pode ocorrer importação parcial, explicitamente avisada ao usuário. O arquivo original deve ser preservado.
- **Novos links curtos:** criar setlist no navegador não publica automaticamente `setlists/nome.html`; isso exige publicação autenticada.
- **Privacidade:** o HTML principal ainda contém letras no repositório público, mesmo que as páginas de músico não as mostrem.
- **Formato Word:** a exportação .doc contém HTML compatível, não arquivo .docx.
- **Unicode no PDF:** fonte limitada pode trocar símbolos Unicode fora de Latin-1.
- **Dispositivos físicos:** a matriz testou motores Chromium, Firefox e WebKit em CI, mas não equivale a testes em iPhone/Safari físico, Android/PWA real ou microfone real. Voz foi testada com API simulada.
- **Cobertura por ramos:** ainda não existe garantia de 100% de branches, testes de mutação integrais ou execução de vários dias em palco.
- **Proteção da main:** o CI é automático, mas o GitHub Pages configurado para publicação por branch pode fazer deploy independentemente do status dos testes. Ativar required checks/branch protection no GitHub continua recomendável.

## Como reproduzir

```bash
npm install
npx playwright install --with-deps chromium firefox webkit
npm test
BROWSER_ENGINE=firefox npm run test:compat
BROWSER_ENGINE=webkit npm run test:compat
npm run audit:source
```

A execução GitHub Actions armazena os relatórios `artifacts/function-coverage.json`, `coverage-all-browser-tests.json` e `code-review-inventory.json` no artefato `auditoria-browser`.

**Dados reais do Haroldo não foram acessados nem modificados.** Todos os testes utilizaram perfis isolados e dados artificiais; atualizar os arquivos públicos não altera diretamente o localStorage dos usuários.


## Rodada 2 — PWA offline, dados inválidos e acessibilidade

**Data:** 9/10/2026. **Branch:** `audit/round2-reliability-20261009`.

### Evidência automatizada

- **162/162 verificações** Node/JSDOM + Chromium real aprovadas na [execução de referência](https://github.com/MizaelSouza12/haroldobluesrep/actions/runs/37889098668).
- **5/5 Firefox e 5/5 WebKit** na mesma execução: 172/172 verificações totais.
- **115/115 funções nomeadas** do aplicativo principal executadas pelo profiler V8, **7/7 funções** do editor de músicos e **53/53 botões estáticos com ID** clicados; não equivale a 100% de linhas ou ramos.
- Auditoria automática `axe-core` em quatro estados (principal, editor de letras, preparo para músicos, lista pública), exigindo zero violações **critical/serious** com tags WCAG 2 A/AA, WCAG 2.1 AA.
- Testes reais de F5 sem conexão após visitar playlists, pré-cache da A Sua Maneira/Jazz & Blues sem visita prévia, dados de nota persistidos após voltar online, preferência/velocidade local malformada e zoom no celular.

### Defeitos reproduzidos e corrigidos

1. **Playlist offline não carregava após atualização:** service worker v17 agora usa network-first para buscar conteúdo atualizado, armazena cópias válidas de HTML, JSON e JavaScript e permite fallback offline. Faz pré-cache dos dois repertórios e recursos associados.
2. **Preferências locais inválidas quebravam fonte/velocidade:** valida tipos e limites (cores hexadecimais, tamanho 14–44, velocidade 4–150, alinhamento e visibilidade) antes de utilizar.
3. **Acessibilidade com falhas reais:** contraste insuficiente de botões, seletor de cor sem rótulo acessível e meta viewport bloqueando zoom. Corrigidos; cor do texto dos botões de destaque agora acompanha luminosidade do destaque configurado.
4. **Recarga inesperada na primeira instalação PWA:** `controllerchange` não deve forçar reload durante navegação. Agora só recarrega após o próprio usuário clicar na atualização disponível.
5. **Rastreabilidade de produção:** `scripts/smoke-production.cjs` verifica por HTTP(S) nove recursos do GitHub Pages, JSONs 204/19, links do editor, service worker e manifest. Novo workflow `.github/workflows/producao.yml` executa diariamente às 09:15 UTC ou manualmente; a verificação de servidor publicado é diferente dos testes locais.

### Escopo que continua fora de verificação completa

- Não existe backend de gravação nem sincronização entre aparelhos: persistência das edições permanece em `localStorage`.
- Navegação e comportamento em celulares físicos iOS/Android, microfone real, persistência do sistema após gerenciamento de energia, testes de vários dias e validação visual integral de PDF/Word não foram comprovados apenas pelo CI.
- Exportação `.doc` não é `.docx` genuíno. PDF ainda pode perder símbolos Unicode por limitação da fonte.
- A suíte mede **funções alcançadas**, não 100% de cobertura de branches, testes de mutação ou totalidade matemática de combinações.
- O repositório principal com letras continua público, pois GitHub Pages hospeda arquivos públicos.
- A publicação automática do GitHub Pages não está bloqueada por required checks do CI; recomenda-se configurar branch protection no GitHub ou migrar o deploy para um workflow dependente da suíte.

A avaliação final depende de o commit de merge e o deploy de produção concluírem suas próprias execuções sem falhas. Não declarar sucesso apenas com um commit anterior.
