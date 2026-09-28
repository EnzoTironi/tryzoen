# Plano de paridade do Zoen

Atualizado em 28/09/2026. Base integrada: PR [148](https://github.com/EnzoTironi/tryzoen/pull/148), merge `a1b96ea`. Este é o plano de produto e execução; os documentos de cada frente registram contratos, evidências e limitações. Uma referência visual, uma tela e uma funcionalidade validada são evidências diferentes.

## O produto que estamos construindo

Um lugar para conversar com pessoas, grupos e agentes, realizar trabalho e preservar conhecimento. A experiência cotidiana deve ser simples e familiar; a complexidade de execução, permissões e memória fica com os seus responsáveis técnicos.

| Referência               | Ideia que adotamos                                                                     | Resultado esperado no Zoen                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| iMessage                 | Conversas legíveis, identidade visual, detalhes simples, composição e mídia integradas | Lista agradável, perfis acessíveis, mensagens e anexos com apresentação nativa e poucas etapas       |
| WhatsApp                 | Comunicação confiável, grupos, áudio, chamadas e controles pessoais                    | Envio recuperável, notificações úteis, estados honestos e controle de quem pode interagir            |
| Slack                    | Threads, atenção, busca e colaboração contextual                                       | Discussões organizadas sem perder o contexto; menções, acompanhamento e conteúdo encontrável         |
| Ando / Buzz              | Pessoas e agentes participando de espaços compartilhados                               | Hangouts e colaboração com identidade explícita, atenção controlada e revisão de resultados          |
| Muse                     | Agente pessoal que executa, propõe, acompanha e cria                                   | Chat, Feed, Ideias, Metas, Biblioteca, aprovações, rotinas, conectores e arquivos editáveis          |
| Akita ai-memory          | Arquivos e Git como autoridade; índice derivado; relações e histórico                  | Memória inspecionável, corrigível, recuperável e isolada por dono                                    |
| Visão Zoen / marketplace | Criadores ensinam bots por conversa e publicam uma versão aprovada                     | Conhecimento atribuído, testes com o criador, acesso claro e conversas privadas de cada participante |

As referências são ideias de interação, não uma obrigação de reproduzir todos os produtos ou seus ecossistemas. Os requisitos explícitos do usuário prevalecem: manter a barra mobile de Conversas, Feed, Ideias, Metas, Biblioteca e Configurações; Descobrir fica fora dela. Sheets mobile viram modais no desktop, exceto sugestões do compositor, que ficam acima do campo nos dois. Bots têm tipo de conta e selo IA, sem sufixo obrigatório. Criar, ensinar e corrigir um bot acontece no chat; o editor visual serve para inspecionar e editar seus arquivos.

## Como medir conclusão

- **Base implementada:** existe caminho funcional e evidência registrada, com limites declarados.
- **Parcial:** existe uma parte utilizável, mas a jornada ainda tem lacunas.
- **Pendente:** falta implementar o caminho completo.
- **Não qualificado:** falta evidência suficiente em aparelhos, produção, carga ou comportamento de referência.

Uma entrega só passa para concluída quando atravessa interface, persistência, autorização, recuperação de falha e teste relevante. Nenhuma ação aparece como disponível sem funcionar. Nenhum selo de criptografia, presença, processamento de vídeo, publicação ou escala representa somente intenção.

## Lista de capacidades

As colunas descrevem a base do PR 148. Entregas posteriores são registradas abaixo, sem transformar o plano inteiro em uma alegação de conclusão.

### Comunicação e atenção

| ID      | Capacidade                    | Base            | Critério de conclusão                                                                                                                          |
| ------- | ----------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| COMM-01 | Caixa de entrada unificada    | Parcial         | Ordenação global por atividade, prévia e horário reais, não lidas/menções, paginação estável, filtros e fixadas sem esconder conversas         |
| COMM-02 | Sincronização e recuperação   | Pendente        | Matrix incremental, preenchimento de lacunas, retomada após queda/reinício e conta trocada, envio idempotente, cache autorizado e limitado     |
| COMM-03 | Leitura, digitação e presença | Pendente        | Marcadores por pessoa/thread, privacidade e visibilidade corretas, expiração de digitação, ausência de estados simulados                       |
| COMM-04 | DMs, contatos e solicitações  | Parcial         | DMs existentes no mesmo espaço preservados; descoberta por username, convites externos, aceitar/recusar e impedir abuso com política explícita |
| COMM-05 | Grupos e comunidades          | Parcial         | Criar, convidar, entrar/sair, papéis, remoção, dados do grupo, permissões do bot e política de histórico testados                              |
| COMM-06 | Threads e ações de mensagem   | Parcial         | Reação/resposta existentes; editar, excluir, salvar, encaminhar, seguir thread e voltar à origem com autoridade e estados consistentes         |
| COMM-07 | Busca e organização           | Parcial         | Busca autorizada em mensagens/anexos com filtros e salto ao resultado; arquivar, fixar e exportar DMs/grupos além do chat pessoal              |
| COMM-08 | Notificações e offline        | Pendente        | Push real, preferências/mute, menções/threads, deep links, recuperação offline e nenhuma notificação duplicada por retry                       |
| COMM-09 | Segurança social              | Pendente        | Bloquear, denunciar com escolha de evidências, controle de desconhecidos, moderação, limites e exclusão/exportação com alcance explicado       |
| COMM-10 | Criptografia e aparelhos      | Não qualificado | E2EE, verificação, chaves/recuperação, mídia cifrada e participação autorizada de bots provadas entre dispositivos                             |
| COMM-11 | Coordenação leve              | Pendente        | Mensagens agendadas, lembretes pessoais, enquetes e eventos/RSVP com ciclo completo e fusos corretos; entrega faseada após o mensageiro básico |

### Composição, mídia e encontro

| ID       | Capacidade                          | Base              | Critério de conclusão                                                                                                                         |
| -------- | ----------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| MEDIA-01 | Editor e referências                | Base implementada | Formatação e referências existentes; preservar rótulos após remontagem, IME/undo/seleção e teclado físico/virtual nos clientes                |
| MEDIA-02 | Arquivos e cartões                  | Parcial           | Envio/recepção/playback existentes; uploads grandes retomáveis, progresso/cancelamento/retry, thumbnails privados e fallback de formato       |
| MEDIA-03 | Voz no compositor                   | Pendente          | Gravar, cancelar, revisar, enviar, retomar após interrupção; permissões, rota de áudio, duração e transcrição quando suportada                |
| MEDIA-04 | Entendimento de anexos              | Parcial           | Agente recebe conteúdo autorizado efetivamente extraído; informar formato não processado, limites e falhas; upload não equivale a compreensão |
| MEDIA-05 | Chamadas e hangouts                 | Pendente          | Entrar/sair, participantes, áudio/vídeo, reconexão, troca de dispositivo, compartilhamento de tela e consentimento de gravação/bot            |
| MEDIA-06 | Aplicativos e artefatos interativos | Pendente          | Host de MCP Apps e visores com comunicação restrita, autenticação, falhas e navegação; cartão de ferramenta sozinho não satisfaz              |

### Agente pessoal e capacidades Muse

| ID      | Capacidade                           | Base              | Critério de conclusão                                                                                                                       |
| ------- | ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| MUSE-01 | Execução durável e aprovações        | Parcial           | Retomar/cancelar, aprovar/negar, inspecionar resultado e falha sem duplicar efeitos externos; histórico global além do chat aberto          |
| MUSE-02 | Rotinas e responsabilidades          | Parcial           | Criar/editar/pausar/excluir, histórico e falhas, próximas execuções e permissões com efeitos concorrentes definidos                         |
| MUSE-03 | Feed proativo                        | Parcial           | Geração opt-in, contexto autorizado, origem/racional, custo/cadência limitados, ranking, feedback, mídia, descarte e discussão              |
| MUSE-04 | Ideias proativas                     | Parcial           | Propostas úteis com validade, categorias e feedback; execução deduplicada; itens dispensados não reaparecem por retry                       |
| MUSE-05 | Metas e acompanhamento               | Base implementada | Metas/submetas/histórico existentes; progresso e briefings reais, vínculo explícito com rotinas, grandes listas e concorrência qualificados |
| MUSE-06 | Biblioteca e arquivos                | Parcial           | Hierarquia/editor existentes; previews, seleção/ações, ordenação, versões, mídia/PDF/documentos, download/share e permissões de publicação  |
| MUSE-07 | Identidade e personalização          | Parcial           | Username/perfil/persona existentes; avatar e preferências com persistência, privacidade, conflitos e comportamento consistente              |
| MUSE-08 | Conectores e ferramentas             | Parcial           | Descoberta/setup/contas/escopos/revogação reais, catálogo honesto, permissões por operação e integração com o agente                        |
| MUSE-09 | Credenciais, carteira e compras      | Parcial           | Reusar cofre web existente; UI nativa, acesso mascarado, delegação e checkout/revisão/negação de compra com provedor real                   |
| MUSE-10 | Configurações e canais               | Parcial           | Mesmas famílias funcionais nos clientes: conta, aparência, idioma, permissões, canais, sessões, aparelhos, dados e suporte                  |
| MUSE-11 | Navegador e controle de dispositivos | Parcial           | Preview/takeover/reconexão e execução no dono existente; dispositivos pareados e capacidades com concessão e revogação explícitas           |

### Memória, criadores e marketplace

| ID         | Capacidade                           | Base                       | Critério de conclusão                                                                                                                                        |
| ---------- | ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MEMORY-01  | Arquivos, relações e histórico Akita | Base implementada          | Motor real integrado; correção, busca, proveniência e relações; UI temporal completa. `as_of` de ingestão não é bitemporalidade completa de tempo válido     |
| MEMORY-02  | Arquivo de sessões                   | Parcial                    | Captura opt-in, sanitização, proveniência, deduplicação, revogação, pausa e remoção; não inventar sessões anteriores à captura                               |
| MEMORY-03  | Sonhos e consolidação                | Bloqueado por qualificação | Não sobrescrever edição humana nem recriar conteúdo excluído; interrupção/undo, custo, qualidade e recuperação comprovados antes de habilitar                |
| MEMORY-04  | Memória multiplayer                  | Parcial                    | Separar privado do criador, versão publicada do bot, privado do assinante e contexto do grupo; promoção de conhecimento só com consentimento                 |
| MEMORY-05  | Operação persistente                 | Não qualificado            | Placement/quotas, backup consistente, restore, retenção/erasure e concorrência; finalizar obrigações dos dados do provedor antigo                            |
| CREATOR-01 | Entrevista e ensino pelo chat        | Parcial                    | Retomar entrevista, reconhecer lacunas, registrar método/voz/limites/exemplos e revisar arquivos sem depender de formulário paralelo                         |
| CREATOR-02 | Importação de fontes                 | Pendente                   | Inventário autorizado de YouTube/documentos/sites, jobs retomáveis, transcrições com timestamps, extração visual quando necessária, origem e falhas visíveis |
| CREATOR-03 | Testes, correções e versão aprovada  | Parcial                    | Casos definidos antes do teste, respostas reais, revisão humana no chat, revisões imutáveis e aprovação do conjunto exato de fontes/conhecimento             |
| CREATOR-04 | Marketplace e publicação             | Pendente                   | Busca/categorias/perfis, autoria/versão/cobertura, publicar/retirar/atualizar, abrir conversa ou convidar bot para grupo autorizado                          |
| CREATOR-05 | Acesso e monetização                 | Pendente                   | Entitlements, assinatura/cancelamento/revogação, limites, cobrança e métricas agregadas; pagar por bot não dá acesso privado ao criador                      |
| CREATOR-06 | Pilotos e melhoria                   | Parcial                    | Feedback voluntário e explícito, avaliação por domínio com métricas pré-definidas; nenhuma leitura automática das conversas dos participantes                |
| CREATOR-07 | Participação de agentes em grupo     | Parcial                    | Atenção/estratégia/ação/reflexão limitadas, silêncio permitido, interrupção e prevenção de loops; identidade IA sempre clara                                 |

### Qualidade e distribuição

| ID      | Capacidade                          | Base            | Critério de conclusão                                                                                                                   |
| ------- | ----------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| SHIP-01 | Experiência nativa e acessibilidade | Parcial         | Tipografia/espaçamento/seleção coerentes, foco e leitor de tela, texto ampliado, reduzir movimento, teclado/back e estados completos    |
| SHIP-02 | Web e Electron                      | Parcial         | Autenticação pelo navegador do sistema, permissões, arquivos, assinatura/distribuição e atualização/recuperação nas três plataformas    |
| SHIP-03 | iOS e Android reais                 | Não qualificado | OAuth, teclado/editor, share/pickers, microfone, rede, segundo plano e push em aparelhos; export de bundle não basta                    |
| SHIP-04 | Confiabilidade e escala             | Não qualificado | Workload explícito, SLOs medidos, filas/backpressure, isolamento, quotas, observabilidade sem conteúdo privado, restore e rollback      |
| SHIP-05 | Auditoria de paridade               | Parcial         | Cobertura de jornadas e telas observadas; registrar desconhecidos e descobertas, comparar visualmente e testar ações em cada plataforma |

## Dependências e ordem de entrega

1. **Fundação de comunicação:** contrato de projeção/sync da caixa de entrada → ordenação e não lidas → leitura/digitação → push e recuperação offline. Não ordenar apenas a página carregada e chamar isso de ordenação global. Não adicionar um segundo serviço de chat/presença.
2. **Ações e experiência cotidiana, em paralelo:** operações de mensagem, voz/mídia, configurações nativas e qualidade do editor. Cada uma tem testes e dono distintos.
3. **Criadores e memória, em paralelo com comunicação:** entrevista/testes/revisão pelo chat; ingestão autorizada e publicação de corpus; corrigir gates do motor e sua operação. Sonhos não bloqueiam mensagens nem a autoria deliberada de arquivos.
4. **Colaboração:** hangouts dependem de identidade/membership e transporte de mídia qualificado; agentes em grupo dependem de concessões e entrega durável; edição colaborativa de documento exige contrato próprio antes de considerar Yjs.
5. **Marketplace:** interface de descoberta pode avançar com contratos definidos; publicação depende de versão/fonte/autoridade e acesso pago depende de entitlements. Nunca lançar acesso só porque o cartão ficou pronto.
6. **Muse proativo e distribuição:** Feed/Ideias dependem de fontes autorizadas, orçamento e rotinas, não de sonhos automáticos. Aparelhos reais, proteção contra abuso e capacidade são gates de lançamento e acompanham as entregas.

## Organização da execução paralela

O PR 148 foi integrado depois dos seis checks aprovados. Com autorização do usuário, a exigência obsoleta `Private Mem0 service` foi removida da proteção da `main`; `Checks` e `Runtime storage and build` continuam obrigatórios, com atualização estrita da base. O segundo já executa qualificação de ingestão, restore e sonhos Akita.

| Frente           | Primeira rodada                                                                 | Dono de código                                                                           | Dependências / limite                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Comunicação      | Exclusão de mensagem própria em DM/grupo/thread, confirmação e redaction Matrix | `server/matrix`, contratos/adapters de rooms, UI de rooms, testes respectivos            | Preservar respostas ao excluir raiz; sem alegação de exclusão de todas as cópias/backups. Caixa de entrada completa precisa primeiro do contrato de projeção |
| Criadores        | Avaliação e previews pelo chat, inspeção de candidato e revisão humana          | Ferramentas Eve de creator, `server/creators`, testes respectivos                        | O agente não pode atribuir a si mesmo o veredito humano; publicação/aprovação de release não são inferidas                                                   |
| Muse/plataformas | Sessões autenticadas nas configurações Expo, revogar outra sessão               | `apps/mobile/src/settings`, chamada em `sections.tsx`, export do primitive compartilhado | Sessão autenticada não é dispositivo pareado/controlável; confirmar revogação e preservar sessão atual                                                       |
| Integração       | Este plano, revisão dos contratos, validação, evidência e PR                    | Documentação central, integração de testes, build/CI                                     | Apenas um escritor por arquivo compartilhado; suites de runtime no banco isolado rodam coordenadas                                                           |

Cada frente publica primeiro o contrato e os arquivos que possui. Alterações em schema/export/adapter compartilhado exigem comunicação entre os donos. Não executar duas migrações, builds de artefatos gerados ou suites que resetem o mesmo banco simultaneamente. A integração mantém os testes de autorização e não esconde falhas para obter CI verde.

## Gates de entrega

### Checkpoint da primeira rodada — 28/09/2026

- `pnpm check`: 9 tarefas aprovadas; 218 arquivos de teste e 1.384 testes passaram.
- `pnpm build` aprovado; Expo exportou iOS, Android e web. Isso não qualifica aparelhos reais.
- PostgreSQL/Synapse isolados: 2 testes de redaction aprovados, incluindo autoria, acesso revogado, mídia e continuidade de threads.
- Eve compilado e banco isolado: 9 testes de preview/revisão aprovados, incluindo pausa/reinício para resposta humana e rejeição de revisão desatualizada.
- Chrome, build corrente, conta sintética: cancelar exclusão preserva conteúdo; excluir raiz mostra tombstone e mantém a resposta da thread. Modal desktop e sheet a 390 × 844 conferidos.
- Expo web com API real em proxy local da mesma origem: sessão antiga pede reautenticação; sessão recente lista dispositivos, revoga somente a sessão descartável e preserva o login atual. A sessão criada para QA foi encerrada ao final. OAuth em aparelho físico continua pendente.
- Nenhuma mudança em produção nem habilitação de sonhos. A evidência visual representa os fluxos executados; o vídeo é uma sequência das capturas, não uma gravação contínua.
- A revisão estrutural continua com observações de churn, pequenos trechos repetidos e tamanho de `MessageActions`; elas não foram suprimidas. A complexidade adicional de `RoomMessage` foi removida separando seus controles em um componente coeso.

### Segunda rodada — 28/09/2026

- **COMM-01:** paginação global por atividade entre chats do agente, DMs e grupos, filtros no servidor e atualização reiniciando na primeira página. O índice Matrix guarda somente metadados; prévias consultam no máximo 30 eventos exatos por página, com concorrência quatro e autorização antes/depois. Reconciliação histórica é limitada e retomável. Mensagens editadas usam indicador conservador; removidas usam tombstone.
- **COMM-03:** marcadores privados de leitura Matrix após 750 ms de visibilidade efetiva, separados entre conversa e thread. Interrupções, modais e troca de conta cancelam o avanço pendente. Não lidas permanecem desconhecidas: o servidor testado devolve contagem zero para usuários virtuais mesmo havendo mensagens novas.
- **MEDIA-03:** gravação compartilhada com adaptadores web/Electron/Expo, limite de 60 segundos, revisão, descarte e anexação explícita. Cancelamento, indisponibilidade e falha ao anexar preservam o rascunho de texto e liberam o microfone. Captura física e permissões reais ainda precisam de qualificação em aparelhos.
- **Criadores:** entrevista por chat sobre propósito, método/voz e limites, com pular/cancelar, prévia exata e confirmação para salvar no rascunho privado. Concorrência, reinício e revogação são testados no workflow Eve. Isso não publica o bot nem importa seu corpus automaticamente.
- Migrações aditivas 0083–0084; nenhum banco de produção foi alterado. Atualização incremental contínua, notificações, não lidas confiáveis e capacidade de um milhão de usuários continuam pendentes. Os limites de consulta são um orçamento explícito, não comprovação de escala.

Validação integrada desta rodada: `pnpm check` passou com 225 arquivos e 1.426 testes; `pnpm build`, `pnpm db:check` e exports Expo para iOS/Android/web passaram. Cinco testes isolados PostgreSQL/Synapse cobrem inbox, recibos e envio com/sem callback; três testes Eve cobrem a entrevista durável. Os 26 testes específicos de áudio cobrem estados e adaptadores, sem qualificar captura física.

Chrome no build final: envio em DM atualizou a prévia e moveu a conversa para o topo, sem depender do callback; busca/filtros e a barra mobile foram conferidos em desktop e 390 × 844. Foram capturadas quatro imagens e um vídeo de 16 segundos composto dessas imagens. A sessão sintética foi retirada do navegador após a revisão. A gravação real de microfone não foi exercitada nem autorizada pelo tooling.

Revisão estrutural comparada ao commit anterior `f8f5498`: 56 observações, 26 marcadas como gating pelo scanner, sem supressões. Incluem churn, scaffolding repetido de testes, falsos candidatos a código morto e crescimento/tamanho real do compositor e ciclos de gravação. A consulta da inbox e o consentimento Electron ganharam responsáveis coesos separados; o restante não está declarado resolvido. Essa rodada não conclui paridade nem qualificação de lançamento.

### Terceira rodada — sincronização da inbox — 28/09/2026

- **COMM-01:** a inbox visível consulta o cursor nativo Matrix a cada 10 segundos, com espera progressiva de até 60 segundos em falhas. Conta, sessão autenticada, workspace, filtro e seleção delimitam o cursor criptografado. A assinatura cobre os primeiros 30 resultados globais e, no desktop, até uma conversa focada adicional.
- App em segundo plano, desmontagem e troca de escopo cancelam consultas. Retorno ao primeiro plano e reconexão atualizam também Bots, Arquivadas e instalações sem Matrix. O transporte tRPC propaga o AbortSignal até o fetch real.
- Novidades invalidam as páginas do mesmo escopo sem refazer toda a cadeia de paginação. No topo, a primeira página é atualizada; abaixo dele, um aviso permite aplicar as novidades sem deslocamento automático. Gerações de atualização impedem uma resposta antiga de apagar uma mudança mais recente; falhas preservam o cursor e a atualização pendente.
- O protocolo entrega apenas identificadores e sinais de mudança/reset/gap. As prévias continuam lendo eventos exatos autorizados; não há segunda cópia das mensagens nem contagem fictícia de não lidas. Um dispositivo lógico de infraestrutura por identidade evita acumular dispositivos por login.
- O cursor vive enquanto o hook está montado; recarregar o aplicativo reinicia uma leitura limitada. Duas sessões podem consumir uma resposta intermediária em cache e alcançar a mudança na consulta seguinte. Histórico de conversa/thread ainda usa seu polling anterior: merge de gaps, edições históricas, push, offline persistente e E2EE pessoal continuam pendentes.

Validação integrada: `pnpm check` passou com 231 arquivos e 1.447 testes; `pnpm build` e exports Expo para iOS, Android e web passaram. Sete testes isolados PostgreSQL/Synapse cobrem o cursor, dispositivo nativo, descoberta fora da página, replay, leitura e envio. Outros nove testes isolados cobrem grupos Eve, ingresso e rede Matrix. Os dez testes do ciclo de atualização incluem concorrência, retry, background, troca de escopo e reconexão; dois testes comprovam cancelamento no transporte tRPC real.

No Chrome com build final e conta sintética, uma mensagem recebida em outro grupo atualizou automaticamente a prévia e moveu o grupo ao topo enquanto a DM aberta permaneceu selecionada. A inbox mobile a 390 × 844 manteve a barra inferior. A perda de conexão emulada exibiu o aviso de reconexão preservando a lista; a rede foi restaurada após o teste. A revisão visual não qualifica aparelhos físicos, push ou rolagem com muitos itens; a atualização diferida durante rolagem é coberta pelos testes do hook.

Revisão estrutural desta rodada: 23 observações, 17 gating, sem supressões. Permanecem o tamanho/complexidade do ciclo de sync e da inbox, padrões repetidos nos adapters e testes, e churn do cliente Matrix. Os testes de regressão validam o comportamento; não tornam essa dívida inexistente nem comprovam capacidade de produção.

### Quarta rodada — edição, atividade e fontes — 28/09/2026

- **COMM-06:** editar texto próprio em DMs, grupos e threads usa substituição nativa Matrix, preservando o evento original, respostas e reações. O editor visual abre como modal desktop e sheet mobile; rascunho do compositor, erro/retry e conflito são preservados. Reusar uma operação com texto/alvo diferentes não retorna sucesso falso. Escritores externos Matrix não participam do lock da aplicação; não há promessa de CAS global.
- **MUSE-01:** Atividade e Aprovações agora listam registros recentes das conversas do próprio usuário, com cursor por data/ID, páginas de 30 e rolagem infinita. A lista usa metadados já retidos pelo observador Eve e abre os detalhes no stream original. Não lê payloads privados, não inventa aprovação/negação e não representa um histórico durável completo: captura é best-effort e metadados expiram após 90 dias. Conta/workspace/aba delimitam cache e seleção.
- **MUSE-09/10:** Expo permite inspecionar e revogar delegações existentes de credenciais. Revalida conta e acesso ao abrir/retornar ao app; consulta e autorização compartilham transação. Confirmação aparece junto à credencial, cancelamento preserva acesso e revogação mantém o item no cofre. Não equivale a permissões gerais de navegador/dispositivo nem CRUD completo do cofre nativo.
- **CREATOR-02:** aquisição conversacional de arquivos Markdown autorizados, snapshot imutável com revisão Git e digest, revisão humana de direitos, uso no preview existente e retirada dos rascunhos futuros. Preserva bytes exatos e não permite colisões com exemplos autorais de outra conta/rascunho. Não importa YouTube nem cria ainda o corpus Akita por release.
- Migrações aditivas 0085–0086 aplicadas somente aos bancos local e isolado. Nenhuma alteração de dados em produção.

Validação integrada: `pnpm check` passou com 235 arquivos e 1.477 testes; `pnpm build`, `pnpm db:check` e exports Expo para iOS, Android e web passaram. Testes isolados incluem 22 cenários de fontes/drafts/previews/releases, quatro de permissões do cofre, dois de atividade e um cenário Matrix abrangente de edição com autorização, threads, concorrência e replay. O teste visual usou Next e Eve juntos: uma conversa sintética respondeu de verdade e gerou a entrada de atividade.

Chrome no build corrente: edição desktop atualizou mensagem e inbox sem perder o rascunho; recarregar preservou a edição. Cancelar no viewport 390 × 844 manteve a mensagem anterior e a barra mobile. Expo web com API real confirmou cancelar/revogar, e a inspeção posterior encontrou uma credencial preservada, uma delegação revogada e nenhuma ativa para a fixture. Aparelhos físicos continuam não qualificados.

Revisão estrutural comparada ao commit `e23b3ea`: 61 observações, 30 gating, sem supressões. O scanner encontra churn, repetição de adapters/testes e componentes novos extensos. A revisão cruzada corrigiu replay incorreto, colisões de identidade de fontes, normalização silenciosa de conteúdo e a leitura de permissões fora da transação. Esses testes não comprovam escala nem paridade total. O backdrop dos modais ainda aparece como um alvo acessível de fechamento além do X; uma correção coesa do primitive precisa preservar um controle acessível em todos os breakpoints.

### Quinta rodada — mensagens salvas e conhecimento aprovado — 28/09/2026

Mensagens salvas usam uma coleção privada de referências no account data nativo do Matrix, limitada a 100 itens por identidade. A lista do espaço pagina de 20 em 20; edições e exclusões vêm do evento original. O contexto busca diretamente o evento selecionado e até 40 vizinhos, sem percorrer todo o histórico. O conteúdo fica oculto após perder acesso. Uma limpeza explícita remove referências de espaços/conversas que a pessoa não pode mais acessar. Escritores Zoen usam revisão e serialização; clientes Matrix externos ainda não têm CAS compartilhado com essa operação.

A aprovação de uma versão de criador agora congela um manifesto tipado de fontes. Indexação e busca usam o Akita real em diretório separado por versão, com validação dos arquivos, digests e proveniência. Pilotos aceitos podem consultar somente a versão compartilhada. A indexação interrompida pode continuar; perda de armazenamento aceito falha sem reconstrução silenciosa, e exclusão usa a fila durável existente. A busca é lexical e não muda o modo atual das respostas do especialista. Avaliação de respostas com recuperação de evidências, YouTube e publicação pública continuam pendentes.

Expo ganhou gerenciamento dos canais de mensagens vinculados. A confirmação explica que desvincular encerra todas as sessões; o último canal é preservado. Consulta e revogação mantêm a autorização dentro da transação. Sessões, permissões e canais reutilizam a mesma abertura de painel com escopo por sessão. A revisão também removeu fundos invisíveis da navegação por teclado, preservando fechamento visível nos painéis e no menu de reações.

Verificação de comportamento: seis testes isolados Matrix (salvas/contexto e sincronização), dez de corpus Akita/versões e três de canais passaram. Incluem mensagem anterior a 105 mensagens novas, capacidade e paginação das 100 referências, perda de membership, indexação interrompida, isolamento de pilotos, erasure, concorrência na revogação e preservação do último acesso. O teste antigo de prévia editada foi atualizado para exigir o texto autorizado atual e conservar o ID original; a cobertura de exclusão permanece.

Gate integrado: `pnpm check` passou com 239 arquivos e 1.496 testes, além de tipos, lint e build Electron; `pnpm build`, `pnpm db:check` e exports Expo para iOS/Android/web passaram. Chrome no build real comprovou salvar → recarregar → abrir contexto → voltar à conversa com rascunho preservado, lista em modal desktop/sheet de 390 px, foco no X, Escape e fechamento de configurações. Expo web comprovou manter os canais ao cancelar e encerrar o login ao desvincular uma identidade sintética; não é qualificação em aparelho físico. Imagens e vídeo de sequência de capturas são anexados ao PR 152.

Revisão estrutural contra `cb066a6`: 69 observações, 31 gating, sem supressões. Permanecem crescimento da inbox, componentes extensos, churn e padrões repetidos de adapters/testes. A revisão visual reduziu ações secundárias dominantes na lista salva; a revisão cruzada não identificou nova falha concreta nos contratos de autorização. Esses resultados não qualificam escala, E2EE, offline, importação de YouTube ou paridade total.

### Critérios para cada rodada

- Testes específicos cobrem usuário correto/incorreto, revogação concorrente, falha/retry e persistência.
- `pnpm check` e `pnpm build` no conjunto integrado; testes de banco/runtime em ambiente isolado.
- Verificação interativa do fluxo no build corrente, nos tamanhos pertinentes; aparelhos reais quando a capacidade depende do SO.
- Imagens e vídeo anexados ao PR por `gh --attach`; evidência sintética sem dados privados e descrição honesta de gravação versus sequência de screenshots.
- Registro do que mudou, do que continua parcial e dos limites. Nada é declarado production-ready só por passar no build.

## Referências e planos detalhados

- [Comunicação: contratos, evidência e fatias](parity-communication.md).
- [Memória e criadores: isolamento, versões e aceitação](parity-memory-creators.md).
- [Muse e plataformas: jornadas, configurações e qualificação](parity-muse-platform.md).
- [Handoff social/Matrix e leituras HUMA/Tutor CoPilot](tryzoen-social-matrix-handoff.md), [memória](file-memory.md), [inventário Muse](interface-audit.md), [cliente universal](universal-client.md).
- Referências primárias: [Apple Messages](https://support.apple.com/en-nz/104982), [organização no iMessage](https://support.apple.com/en-ie/guide/iphone/iphe9b48b89e/27/ios/27), [Slack threads](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions), [Slack huddles](https://slack.com/help/articles/4402059015315-Use-huddles-in-Slack), [WhatsApp privacidade](https://www.whatsapp.com/privacy), [WhatsApp chamadas](https://www.whatsapp.com/calling?lang=en), [Ando](https://www.ando.so/blog/introducing-ando), [Buzz](https://github.com/block/buzz), [Matrix](https://spec.matrix.org/latest/client-server-api/).

O inventário ainda tem lacunas de observação de Muse, especialmente integrações externas, permissões nativas, checkout e alguns visores. Novas descobertas entram aqui com evidência; uma afirmação promocional de um produto não substitui o teste do Zoen.
