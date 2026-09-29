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
2. **Ações e experiência cotidiana:** operações de mensagem, voz/mídia, configurações nativas e qualidade do editor. Cada uma tem testes e dono distintos.
3. **Criadores e memória:** entrevista/testes/revisão pelo chat; ingestão autorizada e publicação de corpus; corrigir gates do motor e sua operação. Sonhos não bloqueiam mensagens nem a autoria deliberada de arquivos.
4. **Colaboração:** hangouts dependem de identidade/membership e transporte de mídia qualificado; agentes em grupo dependem de concessões e entrega durável; edição colaborativa de documento exige contrato próprio antes de considerar Yjs.
5. **Marketplace:** interface de descoberta pode avançar com contratos definidos; publicação depende de versão/fonte/autoridade e acesso pago depende de entitlements. Nunca lançar acesso só porque o cartão ficou pronto.
6. **Muse proativo e distribuição:** Feed/Ideias dependem de fontes autorizadas, orçamento e rotinas, não de sonhos automáticos. Aparelhos reais, proteção contra abuso e capacidade são gates de lançamento e acompanham as entregas.

## Organização da execução

Desde a orientação mais recente do usuário, a implementação e integração seguem
com um único agente. A tabela abaixo preserva os donos de código definidos na
primeira rodada; não representa subagentes ativos.

O PR 148 foi integrado depois dos seis checks aprovados. Com autorização do usuário, a exigência obsoleta `Private Mem0 service` foi removida da proteção da `main`; `Checks` e `Runtime storage and build` continuam obrigatórios, com atualização estrita da base. O segundo já executa qualificação de ingestão, restore e sonhos Akita.

| Frente           | Primeira rodada                                                                 | Dono de código                                                                           | Dependências / limite                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Comunicação      | Exclusão de mensagem própria em DM/grupo/thread, confirmação e redaction Matrix | `server/matrix`, contratos/adapters de rooms, UI de rooms, testes respectivos            | Preservar respostas ao excluir raiz; sem alegação de exclusão de todas as cópias/backups. Caixa de entrada completa precisa primeiro do contrato de projeção |
| Criadores        | Avaliação e previews pelo chat, inspeção de candidato e revisão humana          | Ferramentas Eve de creator, `server/creators`, testes respectivos                        | O agente não pode atribuir a si mesmo o veredito humano; publicação/aprovação de release não são inferidas                                                   |
| Muse/plataformas | Sessões autenticadas nas configurações Expo, revogar outra sessão               | `apps/mobile/src/settings`, chamada em `sections.tsx`, export do primitive compartilhado | Sessão autenticada não é dispositivo pareado/controlável; confirmar revogação e preservar sessão atual                                                       |
| Integração       | Este plano, revisão dos contratos, validação, evidência e PR                    | Documentação central, integração de testes, build/CI                                     | Apenas um escritor por arquivo compartilhado; suites de runtime no banco isolado rodam coordenadas                                                           |

Cada incremento atualiza seu contrato e todos os callers. Não executar duas migrações, builds de artefatos gerados ou suites que resetem o mesmo banco simultaneamente. A integração mantém os testes de autorização e não esconde falhas para obter CI verde.

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

### Sexta rodada — digitação, avaliação fundamentada e configurações — 28/09/2026

- **COMM-03:** digitação nativa Matrix na conversa focada, compartilhada entre compositor principal e thread. A UI usa os membros já autorizados, identifica o estado como relativo à conversa, limpa em falha/background/offline e nunca envia texto do rascunho. Um long-poll de até 10 segundos e intervalo mínimo de 2 segundos limitam a leitura por conversa ativa. O conjunto nativo permanece até atualização/limpeza enquanto o sync está saudável; um replay da mesma requisição não renova seu prazo. Não representa presença online, push ou contagem de não lidas.
- **COMM-06:** autores conhecidos no contexto de mensagens salvas abrem o mesmo perfil utilizado nas conversas. A leitura de contexto já autorizada fornece os membros; abrir um perfil não cria consultas por mensagem. Fechar retorna ao contexto e o cartão de conversa abre a origem.
- **Criadores C3b:** uma versão aprovada e indexada pelo Akita pode ser avaliada privadamente com trechos congelados, autoria, digests e offsets. O especialista recebe somente o pacote da pergunta, sem histórico do participante, rubrica ou exemplos completos; a saída estruturada cita apenas IDs fornecidos. Citações inventadas terminam como falha sem salvar resposta inválida; falta de evidência exige abstenção. O criador revisa o resultado no workflow humano. Avaliações grounded não qualificam nem alteram pilotos ou versões snapshot existentes.
- **Muse/Expo:** configurações passam a usar o painel compartilhado, com famílias e Back/Close; canais, permissões e sessões ficam na mesma superfície. General preserva criadores e Data controls preserva memória. O adaptador web do Expo reutiliza Base UI para nome acessível, contenção de foco, Escape e retorno ao botão de origem; iOS/Android conservam Modal nativo com label. O cofre nativo e onboarding de provedores continuam pendentes.

Gate integrado: `pnpm check` passou com 245 arquivos e 1.518 testes; `pnpm build`, `pnpm db:check` e exports Expo iOS/Android/web passaram. Cinco testes isolados Matrix cobrem digitação, sync e salvas, incluindo renovação contínua, entrada durante digitação, stop/timeout e acesso revogado. Dezenove testes isolados de criadores cobrem Akita real, saída estruturada, revisão após reinício, isolamento e falha terminal de citação inventada. Migração aditiva 0088 aplicada apenas aos bancos locais de teste/revisão.

Chrome no build integrado confirmou perfil a partir do contexto salvo, retorno à DM, digitação recebida de outra identidade sintética e limpeza após stop, em desktop e 390 px. Expo web confirmou o painel único, acesso preservado a criadores/memória, famílias reais, estados de reautenticação, ciclo de Tab, Escape e restauração de foco. Isso não qualifica aparelhos físicos nem capacidade de produção.

O fluxo real de criador no chat executou o caso ficcional, coletou revisão e permitiu salvar uma nova versão privada sem alterar a anterior. Após indexação Akita dessa versão, a avaliação fundamentada recuperou a fonte de facilitação, identificou que ela não comprovava uma citação do romance e respondeu `insufficient-evidence`, sem citar a fonte como prova indevida. A revisão foi feita pelo fluxo humano nativo. Nenhum piloto foi habilitado nem versão publicada. A inspeção também encontrou cartões de revisão extensos e rascunho visual ainda preenchido após envio; esses ajustes de experiência ficam registrados para a próxima fatia.

Revisão estrutural comparada a `b8afd95`: 46 observações, 22 gating, sem supressões. O transporte nativo `/sync` foi consolidado; permanecem crescimento de componentes, ciclos de publicação/leitura de digitação, repetição de adaptação de configurações e churn. Esses pontos não foram declarados resolvidos, e esta rodada não conclui a paridade total.

### Sétima rodada — notificações, cofre e pilotos fundamentados — 28/09/2026

- **COMM-03:** contadores de notificações e destaques vêm do Synapse. A instalação precisa habilitar explicitamente `ZOEN_MATRIX_NATIVE_NOTIFICATIONS` depois de qualificar as regras nativas e o bloqueio de registro/login dos identificadores reservados. O cursor criptografado conserva apenas o snapshot limitado das conversas autorizadas; troca de escopo exige bootstrap, e falhas escondem contadores desconhecidos. Recibos nativos atualizam a contagem. Isso não conta toda mensagem não lida nem implementa push do sistema operacional.
- **MUSE-09/10:** web e Expo compartilham listagem paginada, criação e remoção confirmada do cofre. A autorização e a consulta/mutação usam a mesma transação; membros podem consultar metadados e administradores gerenciar. Segredos ficam no formulário enquanto ele está aberto, sem entrar no cache de mutations; erro de validação local preserva os campos e falha de transporte limpa o segredo com aviso explícito. Não inclui revelar/editar, provedor de pagamentos ou preenchimento nativo em aparelhos.
- **Criadores C3c:** qualificação humana congela versão aprovada, digest do corpus Akita e evidências revisadas de casos com suporte e com evidência insuficiente. Novos pilotos explicitamente qualificados usam esse pacote; pilotos snapshot anteriores não mudam. Autorização, versão e acesso são verificados antes e depois da execução. Revogação impede conclusão tardia. A aprovação da versão privada de base também pode ser feita inteiramente no chat, com conteúdo legível, confirmação e notas.
- **Chat:** solicitações concluídas deixam de oferecer respostas; envios repetidos são bloqueados e erros permitem tentar novamente. O compositor visual não restaura o texto antigo quando volta a ficar editável depois do envio. O mesmo ciclo de resposta é usado no chat compartilhado e no adaptador anterior.

Gate integrado: `pnpm check` passou com 251 arquivos e 1.558 testes; `pnpm build`, `pnpm db:check` e exports Expo web/iOS/Android passaram. Runtime isolado cobriu quatro testes de notificações mais a prova de registro/login/SSO reservado, oito de cofre, 22 de serviços de criadores e dez de workflow. A projeção de payload do especialista preserva o contrato mínimo anterior; não foram relaxadas as quatro assertions que haviam falhado no CI da sexta rodada. Overrides de patches compatíveis corrigem os avisos de segurança de fast-uri, ip-address e undici; `pnpm audit` terminou sem vulnerabilidades conhecidas. Migração aditiva 0089 foi aplicada somente aos bancos locais de revisão e teste.

Chrome no build corrente confirmou envio real ao agente com compositor limpo, solicitações concluídas sem controles ativos e aprovação privada persistida pelo workflow nativo. A revisão do criador é sintética, feita pelo agente de código, e não atesta qualidade ou aprovação de um criador real. Expo web criou uma credencial fictícia, mostrou metadados mascarados também no desktop, preservou o item ao cancelar e removeu somente essa fixture na confirmação. Uma mensagem Matrix recebida atualizou automaticamente a prévia e o contador; abrir e visualizar a mensagem limpou o contador nativo após sincronização. Desktop e 390 × 844 foram conferidos. A qualificação de pilotos grounded foi validada em runtime, ainda sem teste interativo do piloto em aparelho.

Evidência desta rodada: nove screenshots do aplicativo em execução e um vídeo composto dessas capturas, anexados ao PR 152 por `gh --attach`. Não é gravação contínua. A inspeção também encontrou paginação manual ainda presente no chat do agente; a próxima fatia deve removê-la como já foi feito nas conversas Matrix.

Revisão estrutural contra `4f31966c`: 93 observações, 45 gating, sem supressões. Incluem crescimento dos fluxos de autorização/qualificação, tamanho dos formulários e cartões, churn, padrões de adaptação/testes e callbacks registrados que o scanner não reconhece. Não foi criada uma abstração genérica para reduzir métricas. A dívida continua registrada; esses resultados não concluem paridade, lançamento em aparelhos, sonhos, YouTube, marketplace público, offline, E2EE, chamadas ou capacidade para um milhão de usuários.

### Oitava rodada — busca, histórico e arquivos do criador — 28/09/2026

A busca usa o índice nativo do Matrix em uma conversa autorizada, com filtro por
autor, páginas de 20 resultados, cursor vinculado ao usuário/sessão/sala/consulta
e verificação do evento atual para descartar resultados editados ou excluídos.
Abrir o resultado mostra seu contexto autorizado sem perder o termo pesquisado
nem o rascunho. O mesmo contexto atende às mensagens salvas. A busca não inclui
um segundo índice social nem consulta conversas de outras contas.

O histórico do agente agora carrega páginas automaticamente com TanStack nas
interfaces compartilhadas e na rota `/chat`. Cada leitura tem orçamento explícito;
somente a intenção de rolar para cima solicita outra página. A posição de leitura
é preservada ao inserir o histórico e o stream atual continua sob responsabilidade
do Eve. Os botões de mensagens anteriores foram removidos. A inbox usa datas
compactas do calendário local, mantendo a data completa para acessibilidade.

Criadores podem solicitar um novo arquivo Markdown/texto pelo chat. O recebimento
é vinculado à sessão, ao dono e à revisão do rascunho; só a revisão humana de
conteúdo/direitos adiciona o texto ao ensino. Acrescentar um caso de avaliação
preserva os casos anteriores; removê-lo exige uma ação explícita e confirmada.
As revisões de fonte e rascunho são distintas e conflitos ficam visíveis antes da
pergunta de aprovação. A migração 0090 foi aplicada apenas nos bancos locais.

A conferência real encontrou duas falhas de memória: continuações sem ID de turno
colidiam na ingestão Akita e anexos retiravam ferramentas de memória do catálogo
do Eve. Ambas têm regressões executáveis. A correção do Eve serializa somente os
campos de mídia previstos pelo SDK, preservando validação JSON, autorização e
aprovações. Os testes verificam anexos íntegros após reinício. A suíte de restauração
agora usa arquivo temporário para o dump; um evento Matrix atrasado de entrada não
rotaciona novamente uma audiência já registrada.

Chrome com contas sintéticas confirmou busca e contexto em desktop/mobile,
preservação de termo/rascunho, importação com revisão humana e ferramentas de
memória disponíveis depois de um anexo. A paginação mobile passou de 8 para 12
mensagens mantendo a leitura; `/chat` passou de 14 para 25 parágrafos sem botão
legado. As contagens são observações do cenário, não metas de capacidade.

Validação integrada: `pnpm check` passou com 259 arquivos e 1.591 testes;
`pnpm build`, `pnpm db:check` e exportações Expo web/iOS/Android passaram.
A rodada completa de runtime isolado passou 399 de 400 testes; a expectativa
restante, sobre um evento Matrix de entrada já conhecido, foi corrigida para
preservar o epoch. Os quatro testes de ingress/typing passaram novamente. O CI
repetirá a suíte completa no commit publicado; esta evidência local não é descrita
como uma nova execução completa sem falhas.

[Nove screenshots e sequência de 36 segundos](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5882275776)
do aplicativo em execução foram anexados por `gh --attach`. Revisão estrutural
do incremento contra `fdd168f4`: 67 observações, 31 gating, 13 menores e 23 em
símbolos novos, sem supressão. Foi removida a duplicação da âncora de rolagem;
permanecem crescimento de componentes, churn, padrões de testes/adaptadores e
callbacks não reconhecidos pelo scanner. A revisão de contratos confirma os
consumidores compartilhados e os testes de runtime cobrem os caminhos dinâmicos
que o grafo estático não resolve. Isso não encerra o gate de qualidade estrutural.

O próximo incremento operacional é a entrega justa da memória por namespace:
falha em um usuário não pode bloquear outros, e filas precisam de limites,
retentativas e medidas de vazão. Offline, E2EE, chamadas, ingestão externa/YouTube,
marketplace público, sonhos seguros, aparelhos reais e capacidade de um milhão
de usuários continuam com critérios abertos. Esta rodada não os certifica.

### Nona rodada — isolamento da entrega de memória — 28/09/2026

A entrega agora confirma cada conta separadamente: um lote corrompido não desfaz
as contas saudáveis. Cada invocação visita até cinco namespaces, com até 25 fontes
por conta. A fila restante volta atrás de quem já aguardava. Novas capturas
herdam a elegibilidade do primeiro evento pendente e não furam a retentativa.
Falhas persistem contagem/data e espera exponencial de 60 segundos até uma hora;
o erro do agendamento continua visível depois de atender as demais contas.

Os testes com o Akita real cobrem arquivo já gravado antes da falha, replay,
retentativa, conta ruidosa, workers concorrentes, namespace bloqueado e revogação
da organização com vínculo residual no workspace. O comando de medição
`scripts/session-archive-capacity.ts` cria somente contas/corpora sintéticos no
banco isolado, verifica os recibos e produz JSON; não usa modelos nem embeddings.

A migração 0091 acrescenta metadados de entrega e índices. Não há reset de banco,
segunda infraestrutura de filas nem troca de motor. A cadência atual de um minuto
continua limitada a um dispatcher: fan-out, topologia de volumes, corpora grandes,
planos de consulta sob backlog inativo e SLOs de produção permanecem pendentes.
O contrato completo está em [entrega de memória](file-memory.md#fair-session-delivery-and-durable-retry--2026-09-28).

Validação: 405 testes isolados em 104 arquivos passaram; `pnpm check` passou
com 1.591 testes em 259 arquivos e `pnpm db:check` passou. A comparação local
com 500 fontes/20 contas registrou 10,87 s com um worker e 6,43 s com quatro,
com recibos conferidos em todas as contas. O p95 de cada dispatch subiu de
2,77 s para 6,43 s sob concorrência. É uma amostra por configuração em disco
local, sem embeddings/modelos/cadência de cron; não representa capacidade de
um milhão de usuários. [Relatório reproduzível](evidence/session-delivery-2026-09-28.json).

O build passou. Na interface em execução, um turno sintético respondeu e persistiu
após recarregar no mobile; o cron normal confirmou suas quatro fontes, sem
pendências ou falhas. [Capturas desktop/mobile e sequência de oito segundos](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5882578474)
foram anexadas ao PR por `gh --attach`. A revisão estrutural do incremento contra
`f34a3eed` reteve cinco observações, uma gating por churn do capturador, sem
supressões; as demais são tamanho do JSON de evidência e listas de scripts/migrações.
O CI do commit anterior está integralmente aprovado; esta rodada será revalidada.

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
