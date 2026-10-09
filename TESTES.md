# Auditoria de regressão — Repertório Haroldo
Data: 2026-10-09

## Execução
- Workflow: [Testes do Repertório](../actions/workflows/testes.yml)
- Execução validada: [37883128803](../actions/runs/37883128803)
- Resultado: **61 testes executados, 61 aprovados**, Node.js 22 / JSDOM 26.1.0.
- Arquivo da suíte: [tests/repertorio.test.cjs](tests/repertorio.test.cjs)
- Executar novamente: `npm install && npm test`

## Sistemas verificados
| Módulo | Casos |
| --- | --- |
| HTML, JavaScript, manifest, inicialização | sintaxe, boot, carregamento, integridade dos dados |
| Repertório principal | 214 músicas, IDs estáveis, busca, acentos, ocultação, edição de letra |
| Categorias A / J / AJ | 204 músicas em A, 19 em J, 9 compartilhadas |
| Criação e renomeação | criação de letra, categoria personalizada, renomeação, persistência |
| Setlists de palco | criar, selecionar, salvar, setlist vazio, compartilhar |
| Preparação para músicos | 3 campos apenas (título, artista e nota), tons separados por repertório, contagem de notas faltantes |
| Links | codificação base64url, formato do payload, rejeição de payload inválido |
| Páginas curtas | HTML e JSON próprios, 204/19 músicas, ausência de letras privadas nesses arquivos |
| Editor público | cifra, anotações multiline, recarga, armazenamento por playlist, atualização concorrente em abas |
| Segurança da interface | texto suspeito renderizado como texto, não como HTML executável |
| Backup | exportar e importar dados locais de tom/anotação sem sobrescrever versões locais |
| Exportação | cópia com notas, PDF de 19 e 204 músicas, HTML escaping |
| Voz | algoritmo de distância textual e correspondência aproximada |
| Teleprompter | abertura de música, aumento de velocidade, integridade da lista |
| Service worker | registro dos eventos, busca network-first em /setlists/ e resposta de erro offline |

## Correções realizadas durante a auditoria
1. **Salvamento concorrente** — o editor relê o estado antes de atualizar uma música, evitando apagar a edição mais recente de outra aba na mesma origem/navegador.
2. **Backup das anotações** — o backup completo do app agora inclui `repHaroldo_musicianFields_v1:*`, restaurando observações e notas sem apagar campos locais existentes.
3. **Exportação tolerante a JSON corrompido** — uma chave de anotações local danificada não impede que outras playlists sejam incluídas no backup.
4. **Importação robusta dos nomes das abas** — dados de `CHIP_NAMES_KEY` inválidos não provocam falha geral na importação.

## Limitações NÃO resolvidas pelos testes
- **Sem sincronização entre aparelhos:** GitHub Pages é estático; `localStorage` persiste apenas no navegador/origem. As notas digitadas por um músico não ficam disponíveis automaticamente para Haroldo em outro aparelho.
- **Publicação de páginas curtas:** adicionar um novo setlist no aparelho **não cria automaticamente** `/setlists/nome.html` no GitHub. Isso exige um processo de publicação autenticado.
- **Atualização dos JSONs publicados:** alterar letras ou repertórios no navegador não atualiza automaticamente os JSONs já publicados no repositório.
- **URL dinâmica longa:** o compartilhamento dinâmico `setlist.html#d=...` continua embutindo o conteúdo da playlist no link. Os dois endereços fixos curtos são alternativas, mas suas notas locais não sincronizam entre aparelhos.
- **Privacidade:** o repositório principal é público; uma página que não exibe letras não protege as letras que já estão disponíveis nos arquivos públicos do repositório.
- **Word:** a opção denominada Word gera HTML com extensão `.doc`, não um arquivo Office Open XML `.docx` genuíno.
- **PDF:** o gerador usa fonte e codificação limitadas; caracteres Unicode fora de Latin-1 podem ser substituídos por `?`.
- **Dispositivos reais:** JSDOM testa lógica e DOM, mas não substitui testes manuais em Chrome Android, Safari iOS, instalação PWA e Web Speech API.

## Roteiro de homologação manual
1. Fazer **Exportar backup completo** em Configurações e guardar o JSON.
2. Abrir as duas páginas curtas em Chrome. Digitar tom e anotação; atualizar, confirmar persistência.
3. Abrir as páginas em outro navegador: confirmar que os dados não sincronizam, como avisado pela interface.
4. Abrir duas abas da mesma playlist, editar músicas diferentes e atualizar as duas.
5. Copiar lista, exportar PDF, verificar acentos e paginação.
6. Entrar no app principal, conferir 214 músicas, 204/19 por categoria e os dois repertórios na opção de compartilhar.
7. Criar letra de teste, renomear uma aba, criar um setlist e conferir persistência após atualizar.
8. Exportar backup, restaurar em perfil de teste e conferir nota/anotação recuperadas.
9. Exercitar teleprompter, velocidade, busca por voz e retorno via botão Android em dispositivo físico.

**Nota:** Aprovação dos testes automatizados significa que os cenários cobertos passaram. Não equivale a 100% de cobertura das 106 funções nomeadas do aplicativo, nem resolve as limitações de arquitetura listadas acima.
