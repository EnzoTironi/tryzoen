# Plano de paridade do Zoen

Atualizado em 29/09/2026. Base integrada: PR [148](https://github.com/EnzoTironi/tryzoen/pull/148), merge `a1b96ea`. Este é o plano de produto e execução; os documentos de cada frente registram contratos, evidências e limitações. Uma referência visual, uma tela e uma funcionalidade validada são evidências diferentes.

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
| COMM-02 | Sincronização e recuperação   | Parcial         | Matrix incremental, preenchimento de lacunas, retomada após queda/reinício e conta trocada, envio idempotente, cache autorizado e limitado     |
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

Em 29/09/2026, o usuário adiou novas funcionalidades de criadores para priorizar
outras partes do produto. Entrevistas e pilotos já implementados permanecem;
novas importações, publicação e monetização não fazem parte da frente ativa.
Memória pessoal e comunicação continuam no escopo. Evitar repetir validações
amplas sem mudança ou falha que justifique a repetição.

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

### Décima rodada — 29/09/2026

A entrega de sessões agora usa o agendamento Eve existente para até oito rodadas,
parando de iniciar trabalho após 45 segundos ou quando a fila elegível fica vazia.
A concorrência por processo é configurável de um a quatro workers, com padrão um;
chamadas sobrepostas compartilham a execução ativa. Transações iniciadas são
aguardadas e falhas continuam visíveis depois da entrega das contas saudáveis.
O teste com o Akita real entregou 175 fontes de sete contas, preservando a conta
corrompida para retry. Não houve nova migração nem implantação em produção.

Grupos e threads agora propagam o cancelamento TanStack até o transporte tRPC.
Ao sair, perder rede ou ir para segundo plano, o cliente cancela as consultas
daquela conversa e exige revalidação na retomada. O compositor continua editável
sem rede, com aviso discreto e envio desabilitado. Os rascunhos permanecem
separados por conta, espaço, conversa e thread durante a navegação; isso não é
persistência offline após fechar o app nem uma fila de envio em segundo plano.

No Synapse isolado, um intervalo com 135 novas mensagens produziu sync limitado.
Duas páginas recuperaram as 136 mensagens incluindo a âncora anterior, sem
omissões ou duplicações; revogar a membership bloqueou o cursor e a nova sync.
Isso qualifica recuperação paginada neste cenário. Retenção automática da posição
após grandes rajadas, sync incremental de conteúdo e custo de refetch de muitas
páginas continuam abertos. A semântica segue o histórico paginado do Matrix e o
refetch sequencial documentado pelo TanStack, sem uma segunda base de mensagens.

Validação: `pnpm check` passou com 262 arquivos e 1.603 testes; `pnpm build` e
exports Expo web/iOS/Android passaram. Cinco arquivos isolados de runtime passaram
com 14 testes, incluindo entrega, sync, histórico, busca e permissões Matrix.
O commit anterior `e28f470e` também passou nos seis checks do GitHub.

A revisão visual do build confirmou: rascunho principal preservado e editável
sem rede, envio desabilitado; retomada online, rascunho separado da thread; mesma
experiência em viewport mobile com todas as funções na barra inferior; mensagem
sintética enviada depois da reconexão e campo esvaziado. As emulações temporárias
de rede e viewport foram removidas. [Evidências da rodada 10](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5882822766) acompanham o PR 152.

Revisão estrutural sem supressões: o ripwire registrou 19 achados (11 bloqueantes
na classificação da ferramenta), principalmente churn de contratos/componentes,
adapters de transporte com validação repetida e harness de testes. Os caminhos
foram revisados com testes e `--pr-context`; os componentes grandes preexistentes
continuam sendo dívida, sem alegação de qualidade estrutural concluída.

### Décima primeira rodada — cofre editável e revogação — 29/09/2026

Credenciais e cartões usam um único formulário compartilhado para criar e editar.
Abrir a edição faz uma leitura autenticada explícita por POST; os valores
originalmente cifrados ficam somente no editor montado, fora dos caches de
queries/mutations e da persistência do cliente. As respostas tRPC usam
`private, no-store`. Campos sensíveis começam ocultos, voltam a se ocultar em
30 segundos e o editor fecha ao sair do aplicativo ou após cinco minutos.
Os indícios de autofill distinguem cartões de senhas do site. Isso não equivale
a autenticação biométrica nem impede ferramentas privilegiadas no dispositivo.

Salvar mantém o ID do item e compara a revisão lida. Duas edições simultâneas
não sobrescrevem uma à outra. O timestamp avança mesmo com relógio atrasado ou
uma revisão antiga com frações de milissegundo. Metadados, segredo
cifrado e revogação das delegações antigas compartilham a transação; falhas fazem
rollback do conjunto. A mesma trava de delegação impede conceder uma cópia
antiga do segredo depois da atualização. O botão de permissão revalida o estado
quando remonta, sem habilitar ações a partir de uma resposta antiga ou falha.

A revisão encontrou e reproduziu uma falha interna: o leitor de credenciais
delegadas aceitava um vínculo de workspace restante após revogação da organização,
ou um vínculo indevido no espaço pessoal de outra pessoa. Ele agora reutiliza a
mesma regra de membership do controle central e mantém as travas durante a leitura
e decifração. Os testes novos falharam antes da correção e passaram depois.

Chrome confirmou criar, cancelar, editar e reabrir uma credencial fictícia;
a resposta autorizada continha a nova canary e não permitia cache. A ocultação
automática foi observada. Um cartão fictício também foi criado e atualizado na
sheet mobile. Um item antigo do ambiente local falhou na decifração e permaneceu
intacto, com a edição bloqueada; não foi presumida a recuperação desse dado.

Validação: `pnpm check` passou com 264 arquivos e 1.611 testes; `pnpm build`
passou. A suíte completa de runtime passou com 105 arquivos e 414 testes em banco
isolado, incluindo Matrix, memória e cofre. O banco de testes foi recriado antes
da suíte; o banco local de revisão e produção foram preservados.

Os exports Expo web/iOS/Android passaram. A conferência final verificou a sheet e
o modal no build novo, persistência após reiniciar e formulário de cartão vazio
com os indícios corretos de autofill. [Quatro capturas e uma sequência de vídeo](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5883295480)
foram anexadas via `gh --attach`; o vídeo não é gravação contínua.

Revisão estrutural: 23 observações, 11 gating, sem supressões. Permanecem tamanho
e ramificações dos componentes, adaptação e autorização repetidas e churn; o
scanner também não identifica alguns usos por JSX. Os campos do formulário e a
leitura protegida possuem donos separados, sem wrappers criados para testes.

Restam qualificação em aparelhos reais, autenticação adicional para segredos,
provedor de pagamentos e capacidade de produção. O checkpoint não encerra a paridade.

### Décima segunda rodada — recuperação da exclusão de memória — 29/09/2026

Uma falha de filesystem não desfaz mais as confirmações de outras contas. Cada
recibo de exclusão mantém sua transação e trava; falhas preservam a obrigação e
registram somente contagem, horário e próxima tentativa. O atraso cresce de um
minuto até uma hora. O erro continua visível como falha da execução após terminar
as partições saudáveis, sem salvar caminhos ou conteúdo no recibo.

Workers concorrentes pulam recibos ocupados. Ao finalizar duas partições da mesma
conta, a confirmação da obrigação `file_memory` é serializada no pedido de
exclusão e só ocorre depois de todas as partições dessa conta. A obrigação do
provedor anterior continua separada. Interrupção após apagar arquivos mantém o
recibo até uma nova tentativa idempotente confirmar os subdiretórios.

O schedule Eve passa a executar a cada minuto, com até oito lotes de cinco
partições e orçamento suave de 45 segundos. Sobreposições no mesmo processo
compartilham a execução; operações de disco já iniciadas são aguardadas. Isso
limita trabalho por tick, sem declarar prazo máximo de exclusão nem vazão em
produção. Réplicas ainda precisam de placement e armazenamento persistente
qualificados; os testes usam o mesmo diretório de corpus.

A consulta da fila foi medida com 1.000.000 de recibos adiados e um elegível no
PostgreSQL isolado: `workspace_memory_erasure_pending_idx`, uma linha lida,
cinco buffers em cache e 0,017 ms de execução nesta amostra. O experimento foi
revertido e confirmou zero recibos sintéticos restantes. [Relatório da consulta](evidence/memory-erasure-query-2026-09-29.json).
É uma amostra local com cache aquecido, sem exclusão de arquivos, rede ou
concorrência; não comprova capacidade para um milhão de usuários ativos.

A regressão original foi reproduzida antes da alteração. Seis cenários novos
cobrem falha, backoff, limite, trava, concorrência e interrupção; os testes de
memória e corpus existentes também passaram (28 testes em três arquivos).
A migração aditiva 0092 foi aplicada aos bancos locais isolado e de revisão,
preservando registros. `pnpm check` passou com 265 arquivos e 1.614 testes;
`pnpm build` e `pnpm db:check` passaram. A suíte completa do runtime passou com
106 arquivos e 420 testes.

O [cron real do build Eve](evidence/memory-erasure-cron-2026-09-29.json) também
processou duas partições sintéticas: a saudável terminou enquanto a outra manteve
o recibo e registrou a falha. Depois de reparar somente o marcador sintético e
reiniciar o app, a próxima execução concluiu a exclusão sem alterar manualmente
a elegibilidade. Nenhuma conta real foi excluída. Os dois diretórios vazios de
teste foram removidos após confirmar o resultado.

[A conferência visual](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5883517046)
verificou as memórias sintéticas preexistentes preservadas em desktop e mobile.
Duas capturas e um vídeo composto dessas capturas foram anexados via `gh --attach`.
Esta rodada não mudou a UI de memória. A revisão estrutural apontou três
observações, duas gating: formato repetido dos schedules e churn; não foram
introduzidas supressões nem uma abstração genérica para esconder a repetição.

### Décima terceira rodada — cartões de memória e editor único — 29/09/2026

Notas pessoais, memórias aprendidas e trechos históricos agora compartilham os
cartões de documento e renderizam Markdown. Editar, relacionar e remover continuam
com seus contratos e confirmações existentes. Prévias privadas não carregam
imagens de terceiros automaticamente; URLs não seguras não chegam ao renderer.

As notas pessoais passaram ao editor visual. O painel legado com textarea foi
removido de `DocumentEditor`: arquivos de texto e a ausência do adapter visual
usam o editor de código existente dentro do mesmo shell, com histórico, limite
no salvamento, leitura exata do conteúdo e proteção de alterações não salvas.
Todos os documentos Markdown mantêm o editor visual nas plataformas suportadas.

Validação: `pnpm check` passou com 267 arquivos e 1.624 testes; `pnpm build` e os
exports Expo web/iOS/Android passaram. Dez cenários novos cobrem URLs de prévias,
leitura do editor visual, preservação do texto bruto, limite e leitura de versões.
Esta rodada não alterou banco nem runtime; a última suíte completa continua sendo
os 420 testes isolados da rodada 12.

No build de produção em execução, foram conferidos modal desktop, sheet mobile,
editor e descarte sem salvar. A busca real Akita em 28/09/2026 às 03:40 trouxe o
trecho anterior de Cedarbay sem a entrada norte, enquanto fechar o histórico
preservou a nota atual. Somente dados sintéticos de revisão foram utilizados.
Quatro capturas e uma sequência de aproximadamente 15 segundos foram anexadas ao
PR via `gh --attach`; o vídeo não é gravação contínua.

A revisão estrutural apontou oito observações, cinco gating, ligadas a churn e
semelhança estrutural de JSX; o scanner também marcou como mortos usos via JSX e
callbacks de biblioteca. Não foram adicionadas supressões. Paridade completa,
qualificação em aparelhos e capacidade para um milhão de usuários permanecem
como gates abertos.

Evidence: https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5883699640

### Décima quarta rodada — ciclo de vida das reações — 29/09/2026

Reações agora acompanham a visibilidade da conversa e da thread. Detalhes do
grupo, perfis e busca suspendem a consulta; no mobile, abrir a thread também
suspende as reações da conversa encoberta. Background, offline e desmontagem
cancelam o transporte e invalidam o cache. Uma leitura atrasada não pode iniciar
uma reação depois da saída; uma escrita já aceita pelo servidor não pode
sobrescrever o cache de uma conversa reaberta. O identificador de operação
continua estável em uma nova tentativa, sem desfazer escritas já aceitas.

Os novos testes reproduziram cinco falhas antes da correção. Os 18 testes focados
cobrem limites de mensagens visíveis, cancelamento HTTP, perda de atividade,
replay de effects e respostas atrasadas. `pnpm check` passou com 268 arquivos e
1.632 testes; `pnpm build` e exports Expo web/iOS/Android passaram. Não houve
alteração de banco nem de procedures do servidor; a última suíte completa do
runtime permanece com 420 testes isolados na rodada 12.

[A medição no navegador](evidence/reaction-visibility-2026-09-29.json) observou
três consultas em 86,2 segundos com os detalhes abertos no build anterior e zero
em 51,4 segundos no novo. Fechar o modal retomou a consulta. No build atual,
adicionar, recarregar, abrir a thread mobile e remover uma reação sintética
confirmou a persistência e o compartilhamento do estado. A barra inferior foi
preservada. Quatro capturas e um vídeo de aproximadamente 20 segundos composto
das capturas foram [anexados via `gh --attach`](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5883888398).

A revisão estrutural apontou 16 observações, dez gating, sem supressões: churn,
adapters estruturalmente semelhantes e tamanho do hook; há dois falsos positivos
de uso em testes. O ciclo de vida permanece no hook existente. A pausa de overlays
globais de configurações, o sync incremental do histórico e os gates de produção
continuam abertos. Esta medição local não qualifica capacidade de produção.

### Décima quinta rodada — histórico orientado por mudanças — 29/09/2026

O leitor exclusivo de digitação foi substituído por um sync da conversa. Um
único long-poll nativo observa digitação e sinais de mensagens, edições,
exclusões e membership para a conversa e sua thread. O filtro pede somente
identificadores, tipo e participantes digitando, mantendo os limites de tamanho
e a validação da resposta. Os cursores continuam vinculados à conta, sessão,
espaço, sala e época de acesso. O contrato antigo foi removido de todos os clientes.

As queries de histórico não possuem mais timer periódico. Sinais de mudança,
bootstrap e lacuna revalidam as páginas ativas; páginas inativas ficam stale
para a próxima abertura. Uma mudança durante paginação não cancela o prepend
nem avança o cursor de sync: o sinal é repetido depois. A recuperação continua
sequencial pelo TanStack, preservando os cursores fornecidos pelo servidor.
Falhas de sync aparecem na conversa e também revalidam o histórico, para que
revogação não deixe mensagens antigas apresentadas como atuais.

[A medição local](evidence/room-sync-2026-09-29.json), depois do carregamento
inicial e sem novas mensagens, contou cinco consultas de histórico e cinco de
digitação em 48,5 segundos no build anterior. No novo build, foram zero consultas
de histórico, quatro do sync compartilhado e zero do endpoint removido em
49,6 segundos. É uma comparação de uma conversa parada, sem extrapolação de escala.

As verificações focadas usam QueryClient/InfiniteQueryObserver reais, transporte
HTTP cancelável e Synapse isolado. Cobrem paginação concorrente, resposta tardia,
retomada, perda de acesso, chegada/edição/exclusão e lacuna. `pnpm check` passou
com 268 arquivos e 1.644 testes; `pnpm build` e exports Expo web/iOS/Android passaram.

Ainda é necessário aplicar conteúdo incremental às páginas: quando há mudanças,
as páginas carregadas são relidas. Também permanecem retenção de âncora em grandes
rajadas, qualificação em aparelhos, push/E2EE e capacidade de produção.

Referências do contrato: [Matrix sync e filtros](https://spec.matrix.org/latest/client-server-api/#syncing)
e [paginação infinita do TanStack](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries).

Uma segunda aba enviou mensagem e resposta sintéticas; o desktop recebeu a
mensagem e a thread mobile recebeu a resposta sem recarregar. Três capturas e
uma sequência de aproximadamente 16 segundos foram
[anexadas com `gh --attach`](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5884262828).
O gate completo desta rodada está registrado junto à rodada 16 abaixo.

### Décima sexta rodada — pausa sob painéis globais — 29/09/2026

O shell compartilhado informa a visibilidade da inbox e das conversas. Abrir
Configurações ou Atividade do agente suspende os observadores Matrix encobertos;
fechar revalida autorização e retoma o sync. Eventos online/focus e resultados
atrasados não reativam uma tela encoberta. O rascunho é preservado e o compositor
encoberto não apresenta aviso de reconexão. A execução Eve e o conteúdo do painel
do agente continuam com seu ciclo de vida próprio.

[A comparação local](evidence/global-visibility-2026-09-29.json) registrou oito
consultas de room sync, três de reações e onze de inbox em 106,7 segundos com
Configurações abertas antes da mudança. Depois, registrou zero nas três famílias
em 62,2 segundos. O painel do agente manteve zero em 76,6 segundos. Fechar
Configurações retomou as quatro famílias, incluindo histórico; o sync inspecionado
retornou HTTP 200 e `ready`. Um rascunho sintético sobreviveu aos dois painéis.

O gate conjunto das rodadas 15/16 passou: `pnpm check` com 268 arquivos e 1.647
testes, `pnpm build`, exports Expo web/iOS/Android e a suíte isolada completa com
107 arquivos e 421 testes. As duas primeiras execuções completas revelaram
corridas nas fixtures: a projeção inicial de membership e um evento de espera
reemitido após reinício da entrevista. Os testes agora aguardam a projeção
confirmada e a próxima pergunta/resultado, respectivamente. Não houve relaxamento
da autorização nem alteração do workflow de produção.

Quatro capturas do build real e um vídeo de aproximadamente 20 segundos composto
das capturas foram [anexados via `gh --attach`](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5884555065).
A revisão estrutural conjunta apontou 31 observações, 16 gating, sem supressões:
churn, tamanho e repetição de adapters/decodificação de cursor. Esta medição
local não qualifica aparelhos físicos, conteúdo incremental ou capacidade de
produção; esses gates permanecem abertos.

### Décima sétima rodada — aplicação incremental do histórico — 29/09/2026

Os lotes nativos agora aplicam mensagens novas, edições e respostas diretamente
às páginas TanStack já carregadas. A mensagem é inserida uma única vez; a edição
preserva sua posição e usa o conteúdo validado pelo homeserver. Respostas atualizam
a thread e a contagem do pai. Uma escrita local ou paginação concorrente impede
a confirmação do cursor e provoca replay, sem sobrescrever estado mais recente.
Threads inativas permanecem stale até a próxima abertura autorizada.

O lote possui no máximo 20 eventos e quatro leituras de relacionamentos em
paralelo. O cabeçalho ao vivo tem limite de 200 mensagens. Exclusões, mudanças de
membership, lacunas e excesso desse limite continuam recuperando as páginas em
sequência; nenhum cursor de paginação é inventado nem ultrapassado por descarte.
A autorização é revalidada depois de todas as leituras de projeção.

[A conferência local](evidence/incremental-history-2026-09-29.json) registrou zero
leituras de histórico para chegada, edição e resposta na thread mobile. O build
anterior fez uma leitura para sua chegada sintética. Depois de navegar além da
primeira página, três novas mensagens preservaram a Nota 039 em 332 → 332,1875 px.
O botão de novas mensagens levou à última chegada. São janelas e cargas distintas,
sem inferência de vazão ou capacidade de produção.

`pnpm check` passou com 270 arquivos e 1.664 testes; build e exports Expo nas três
plataformas passaram. Três testes focados com Synapse isolado passaram, cobrindo
chegada, edição, thread, exclusão, lacuna, revogação e digitação. A última execução
completa do runtime permanece em 421 testes no commit `86ed2531`; CI repetirá a
suíte completa deste checkpoint. Um timeout no teste QuickJS existente foi
investigado: seus 18 testes focados e a repetição completa do check passaram sem
reduzir asserções. A revisão estrutural mantém 11 observações, seis gating, sem
supressões. Retenção global de páginas, grandes rajadas durante recuperação,
aparelhos físicos e capacidade de produção continuam abertos.

Seis capturas do build real e uma sequência de aproximadamente 24 segundos foram
[anexadas via `gh --attach`](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5884911784).
O vídeo é composto de capturas, não uma gravação contínua.

### Décima oitava rodada — densidade das mensagens — 29/09/2026

Reação, citação, cópia e thread compartilham uma faixa que quebra linha quando
necessário. Ícones mais discretos preservam alvos de 44 px; o acesso à thread
passa de 28 para 44 px. A mesma mensagem curta no desktop caiu de 166 para 110 px
(33,7%). O renderer de conversa remove padding externo duplicado e mantém
separação entre blocos; documentos e cartões de memória conservam seu layout.

No build real foram verificados cópia, citação/remoção, reação persistida, abertura
e retorno de thread mobile e edição/salvamento de negrito, parágrafos e lista pelo
editor visual. A barra inferior continua visível. [Medição local](evidence/message-density-2026-09-29.json).
`pnpm check` passou com 270 arquivos e 1.664 testes; build e exports Expo web/iOS/
Android passaram. Um mock incompleto foi substituído pelo adapter React Native
Web nos testes de imagens privadas, preservando todas as asserções. Não houve
mudança de servidor ou banco. A revisão estrutural trouxe quatro observações,
zero gating e nenhuma supressão.

[Cinco capturas e uma sequência de aproximadamente 20 segundos](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5885161314)
foram anexadas via `gh --attach`. O vídeo é composto de capturas. Texto ampliado,
aparelhos físicos e os alvos menores dos links de nome/perfil ainda precisam de
qualificação; esta rodada não conclui acessibilidade, paridade ou capacidade.

### Décima nona rodada — reações pelo sync nativo — 29/09/2026

O mesmo cursor Matrix da conversa sinaliza mudanças de reações. O cliente
invalida apenas as contagens da conta/workspace/conversa afetados; remove o
polling independente de 30 segundos. Uma leitura anterior em voo impede o
avanço do cursor até a contagem atual ser aplicada. Caches inativos ficam stale,
falhas de autorização chegam a todas as views e eventos de outra sala são
rejeitados. Eventos de reação não reabrem o histórico; remoções continuam na
recuperação conservadora de redactions.

No build local, duas abas receberam adição e remoção sem reload. A adição
consultou reações uma vez e histórico zero; a remoção consultou cada um uma vez.
Em repouso, cinco leituras de reações em 169 s antes passaram a zero em 424 s.
Os tempos observados de até 448/321 ms incluem automação e não representam SLO.
[Medições](evidence/reaction-sync-2026-09-29.json).

`pnpm check` passou com 270 arquivos / 1.669 testes; build e exports Expo web/iOS/
Android passaram. Três testes focados com Synapse real cobrem também outra conta,
remoção, perda de acesso, mensagens, edições, threads e lacunas. A revisão de
qualidade registra oito observações / seis gating de churn, sem supressões;
a extração local da reconciliação removeu regressões de tamanho/complexidade do
polling. Não houve alteração de banco. Quatro capturas e uma sequência de
16 segundos foram [anexadas via gh --attach](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5885515822).
Paridade, retenção total limitada e capacidade de produção permanecem abertas.

### Vigésima rodada — encaminhamento com revisão — 29/09/2026

Mensagens e arquivos podem ser encaminhados a DMs e grupos existentes no mesmo
workspace. O seletor consulta 20 destinos autorizados por página, com cursor
estável e busca por nome/username. A revisão mostra o destino e o conteúdo antes
do envio. O servidor revalida ambos os acessos, exige a revisão do original e
produz uma cópia Matrix independente, marcada como encaminhada, sem autor,
citação, thread ou permissões da origem. Menções copiadas não acionam o agente.

O build real confirmou busca por `@username`, preservação do rascunho, texto
recebido e arquivo baixado idêntico ao original. Editar o original em outra aba
bloqueou o envio até a nova revisão; a versão confirmada chegou ao grupo. A sheet
mobile e o modal desktop preservam a barra inferior. [Registro](evidence/message-forwarding-2026-09-29.json).
Sete capturas e uma sequência de 21 segundos foram [anexadas via `gh --attach`](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5885992122).

`pnpm check`: 272 arquivos / 1.687 testes; build e exports Expo web/iOS/Android
passaram. Dois testes reais de Synapse cobrem outro participante, DM privada,
revogação, retry, 25 destinos paginados e acesso ao arquivo encaminhado após a
exclusão do original. Os seis checks do checkpoint anterior `f59d7c9a` passaram.
Sem migração ou dependência nova. A revisão estrutural registra 28 observações,
nove gating, incluindo wrappers RPC e churn, sem supressões.

Não há encaminhamento em massa ou entre workspaces. Se a confirmação se perder
e o original mudar antes do retry, o usuário deve conferir o destino e revisar
a nova versão; não há garantia global de exatamente uma entrega. Retenção total
do histórico, operação nativa e capacidade de produção continuam abertas.

### Vigésima primeira rodada — exclusões e reconexão — 29/09/2026

O sync verifica o alvo exato de uma exclusão nativa, incluindo sala, tipo e
confirmação do homeserver. Remover uma reação atualiza apenas as contagens;
remover uma mensagem principal já carregada aplica o estado removido às páginas
existentes sem alterar seus cursores. Alvos desconhecidos, edições com relação
apagada e respostas removidas recuperam o histórico para preservar conteúdo e
contagem da thread. As leituras continuam limitadas a quatro em paralelo.

A verificação visual também encontrou e corrigiu uma falha de reconexão: o erro
de leitura desativava o próprio observador necessário para recuperar a conversa.
Agora ele mantém o backoff autorizado; conteúdo privado fica oculto durante a
falha e reaparece somente após revalidação. Parar e reiniciar o servidor local
recuperou a conversa e o rascunho sem reload ou retry manual.

No build real, exclusão de mensagem e remoção de reação em outra aba produziram
zero leituras de histórico; a remoção consultou as contagens uma vez. As janelas
de observação incluem automação e não medem latência. A comparação anterior de
exclusão de mensagem foi descartada porque a aba já estava em erro. [Registro](evidence/redaction-recovery-2026-09-29.json).
Seis capturas e uma sequência de 24 segundos foram [anexadas via `gh --attach`](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5886337421).

`pnpm check`: 272 arquivos / 1.701 testes; build e exports Expo web/iOS/Android
passaram. Três testes reais de Synapse cobrem exclusão de reação, edição, resposta
e mensagem principal, além de lacunas e revogação. Os seis checks do checkpoint
`b6b31ea1` passaram. Sem migração ou dependência nova. A revisão estrutural mantém
sete observações / um gate de churn, sem supressões; o classificador local tem
complexidade 24. Retenção total, grandes rajadas, aparelhos físicos, paridade e
capacidade de produção permanecem abertos.

### Vigésima segunda rodada — silenciar conversas — 29/09/2026

O perfil de uma conversa individual e as informações de um grupo agora permitem
silenciar e reativar seus alertas, inclusive menções. A preferência pertence à
pessoa e à conversa; mensagens continuam disponíveis. O mesmo controle aparece
no modal desktop e na sheet mobile. Carregamento, salvamento e falha têm estados
explícitos; uma falha pede nova consulta antes de permitir outra alteração.

A autoridade é uma regra override nativa do Matrix, com ações vazias e condição
exata de sala. Não há banco paralelo de preferências. Escritas são serializadas
por pessoa/conversa, repetição do estado desejado é segura e o servidor verifica
o valor salvo e a autorização novamente. Isso não implementa push do sistema
operacional nem uma caixa de saída offline.

No build real, foram conferidos silenciar, fechar/reabrir e reativar um grupo,
além do controle da conversa individual, em desktop e viewport de 390 × 844.
As preferências sintéticas foram restauradas após a conferência. Cinco capturas
e uma sequência de 15 segundos foram [anexadas via `gh --attach`](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5887210251).
O vídeo é composto das capturas, não uma gravação contínua. [Registro](evidence/conversation-notifications-2026-09-29.json).

`pnpm check`: 272 arquivos / 1.701 testes; build e exports Expo web/iOS/Android
passaram. Um teste focado com PostgreSQL/Synapse reais verifica contagens, menções
explícitas, repetição, reativação, independência entre pessoas/salas e rejeição de
acesso indevido. Os seis checks de `f45e300d` passaram. Sem dependência ou migração
nova. A revisão estrutural mantém 16 observações / cinco gates, principalmente
padrões diretos de adapters RPC e tamanho/churn dos donos existentes, sem
supressões; o componente apontado como não usado é consumido por dois lugares.

Novas funcionalidades de criadores estão adiadas por orientação do usuário.
O experimento de retenção limitada do histórico foi retirado desta entrega:
lacunas e preservação da leitura ainda precisam de qualificação própria. A
paginação infinita existente permanece. Push nativo, operação offline, aparelhos
físicos, paridade completa e capacidade de produção continuam abertos.

### Vigésima terceira rodada — editar o nome dos grupos — 29/09/2026

Administradores podem editar o nome nas informações do grupo, em modal desktop
e sheet mobile. Membros comuns não recebem a ação; o servidor também exige a
permissão administrativa, a sessão e o workspace corretos. O formulário mantém
o texto em falhas e conflitos. Se outra edição vencer, mostra o nome atual e
exige carregá-lo antes de editar novamente.

A alteração grava `m.room.name` nativo e verifica a leitura antes de atualizar
a projeção existente em `workspace_group_bindings`. O lock usado pelas mudanças
de vínculo também serializa renomeações. Nome esperado protege contra edições
concorrentes pelo produto; repetir o resultado salvo é seguro. Identidade da
sala, epoch, mensagens, cursores e rascunhos permanecem. O sync existente observa
o evento de nome e recupera o histórico autorizado; não há polling adicional.

No build real, outro participante recebeu o novo nome na conversa e no inbox
sem reload, com rascunho preservado. Duas janelas confirmaram o conflito e sua
recuperação. O nome original foi restaurado e apenas o rascunho sintético foi
limpo. Cinco capturas e uma sequência de 15 segundos foram
[anexadas via `gh --attach`](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5887918856).
O vídeo é uma sequência de capturas, não gravação contínua.
[Registro](evidence/group-name-2026-09-29.json).

`pnpm check`: 272 arquivos / 1.701 testes; `pnpm build` passou. Dois testes com
PostgreSQL/Synapse reais cobrem estado nativo, atualização para outro membro,
concorrência, retry, falha nativa e autorização. Os seis checks de `a7137cef`
passaram. Sem dependência ou migração nova. Exports Expo não foram repetidos
nesta rodada; aparelhos físicos continuam sem qualificação. A revisão
estrutural registra 13 observações / três gates de adapters diretos e tamanho
do componente existente, sem supressões; `RenameRoom` é consumido via JSX.

Matrix e PostgreSQL não formam uma transação distribuída: falha após a escrita
nativa continua visível e pode exigir repetição. Não há garantia global de
exatamente uma operação ou CAS entre clientes Matrix externos. Criadores
continuam adiados; paridade completa e capacidade de produção permanecem abertas.

### Vigésima quarta rodada — participação em grupos — 29/09/2026

Pessoas podem sair dos grupos; administradores do espaço podem adicionar,
recolocar e remover participantes comuns do mesmo espaço. A busca usa nome ou
username, a confirmação identifica a pessoa e as consequências, e o mesmo
componente usa modal desktop e sheet mobile. Administradores do espaço não são
removidos por esse controle. Convites externos, grupos privados independentes
do espaço e papéis administrativos por grupo continuam abertos.

A projeção de membros passa a distinguir `joined`, `left` e `removed`. Sair ou
ser removido impede que abrir a conversa provoque reentrada automática; inbox,
histórico, arquivos e autoridade do agente aplicam a mesma restrição. O bloqueio
no produto é persistido antes da retirada no Matrix. Falhas nativas ficam
registradas para retry, com próximo horário, índice parcial, lote de dez e
orçamento de início de 30 segundos no reconciliador Eve existente. Uma chamada
já iniciada pode terminar depois desse orçamento. Reentrada verifica o estado
nativo antes de restabelecer acesso. Eventos atrasados consultam o estado atual
do homeserver; não desfazem uma reentrada mais recente.

O navegador encontrou e motivou a correção de dois detalhes: o grupo focado
revogado não deve interromper o sync do restante do inbox; a conversa removida
mostra acesso indisponível, sem conteúdo antigo ou reconexão interminável.
Rascunhos próprios ficam preservados ao sair. Não foi criado um serviço paralelo
de chat, armazenamento de mensagens ou presença.

`pnpm check`: 272 arquivos / 1.703 testes; cinco testes em três suítes com
PostgreSQL/Synapse reais cobrem saída, reentrada, mensagens preservadas,
permissões, falha de retirada, retry e callbacks atrasados. As migrações aditivas
0093–0094 foram aplicadas apenas nos bancos locais de teste e revisão. Nenhuma
dependência nova. Criadores continuam adiados. Matrix e SQL não são uma
transação distribuída; a entrega não declara capacidade para um milhão de pessoas,
E2EE, push do sistema operacional ou paridade completa.

No build real da rodada 24, foram conferidos o modal de participantes, remoção,
reentrada com histórico preservado e confirmação mobile de saída. Os dois membros
sintéticos foram restaurados. [Imagens e sequência de capturas](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5889635406)
anexadas com `gh --attach`; [registro](evidence/group-membership-2026-09-29.json).
O build passou. A preservação do rascunho ao sair não foi comprovada visualmente
em separado.

### Vigésima quinta rodada — respostas imediatas e cache de navegação — 29/09/2026

Enviar para o agente, grupos e threads agora cria uma bolha local e libera o
compositor imediatamente. A fila usa o QueryClient e mutações TanStack; o trabalho
do agente continua sem bloquear o próximo envio. Falhas pertencem à mensagem,
e confirmações ou erros atrasados não apagam o novo rascunho. O mesmo componente
apresenta entrega e retry. Reações e ações remotas só aparecem após a confirmação.

Matrix mantém sua transação nativa por envio/anexo e carrega essa identidade nos
eventos próprios, inclusive para reconciliar uploads parcialmente confirmados.
Eve usa apenas APIs públicas e associa a bolha ao `message.received` do seu stream
de resposta. Quando o histórico contínuo chega antes dessa confirmação, os eventos
continuam sendo recolhidos, mas sua nova projeção aguarda os recibos pendentes.
Isso evita duplicação sem comparar texto e sem confundir mensagens idênticas.
O SDK não expõe uma chave pública de idempotência: um envio Eve incerto mostra
aviso e exige conferir a conversa antes de repetir manualmente.

O provider web permanece acima das rotas de conversa. Trocar seções por query
string preserva a conversa selecionada e usa o histórico integrado do Next, sem
uma nova navegação de servidor. Histórico e rascunhos do agente reaparecem do
cache e o stream retoma do cursor conhecido. Caches são isolados por conta/espaço,
limpos ao desmontar essa fronteira e expiram após 30 minutos de inatividade.
Curtidas do Feed e silenciar conversas também respondem de modo otimista, com
ordenação das escritas e recuperação de erro. Campos de texto, inclusive em
portais de modal, usam foco neutro; alto contraste mantém indicador explícito.

No navegador real: três mensagens seguidas em grupo, duas na thread e duas com
o agente sob 3,5 segundos de latência; rascunhos preservados e confirmações únicas.
Feed e conversa já carregados reapareceram sem tela de carregamento com cinco
segundos de latência. Desktop e viewport 390 × 844 foram conferidos, sem erros
no console. [Cinco capturas e sequência de 15 segundos](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5889698768) anexadas
com `gh --attach`; o vídeo não é uma gravação contínua.
[Registro](evidence/instant-messaging-2026-09-29.json).

`pnpm check`: 273 arquivos / 1.704 testes; build passou. Cinco testes com
PostgreSQL/Synapse reais verificaram envio, relações e sincronização. A revisão
estrutural mantém 47 observações / 28 gates sem supressões: tamanho, complexidade
e churn dos donos existentes permanecem visíveis; o indicador de entrega foi
consolidado e os novos donos separam fila, projeção e transporte. Nenhuma nova
dependência ou migração nesta rodada.

A fila é limitada a 20 entradas por conversa e existe em memória, não sobrevive
a fechar/recarregar o aplicativo. Primeiras visitas sem cache ainda carregam dados.
Não é a conclusão de operação offline durável, ausência global de layout shifts,
qualificação em aparelhos físicos, paridade completa ou capacidade para um milhão
de pessoas. Criadores permanecem adiados.

### Vigésima sexta rodada — rascunhos e envios duráveis — 29/09/2026

Rascunhos de conversas novas/existentes, grupos e threads agora ficam no disco,
com a fila de envio. TanStack continua como fonte do estado da interface; somente
esses registros locais são persistidos. Web/Electron usam IndexedDB (`idb` 8.0.3)
e o adaptador Expo usa SQLite 57.0.3, compatível com SDK 57. Ambos são as versões
estáveis atuais verificadas nesta rodada. Credenciais, resultados de ferramentas
e o cache geral de consultas não entram nessa persistência.

Gravar a mensagem e remover seu rascunho usa uma transação local antes da chamada
de rede. Os registros são individuais para uma aba não sobrescrever a fila de
outra. O escopo é a sessão autenticada, com as chaves de conta/workspace da
interface. Sair revoga a sessão local e apaga registros na mesma transação;
escritas tardias de outras abas são recusadas. Limites: 200 registros / 32 MiB por
sessão autenticada, além das 20 mensagens por conversa. Rascunhos vazios liberam
seu registro. Falta de espaço mantém a tentativa visível e impede envio sem
persistência; retry volta a tentar o lote local. Conexões aos bancos são reutilizadas.

Ao reabrir a conversa, Matrix retoma a transação original, incluindo suas partes
de mídia. Eve preserva recibos confirmados; uma tentativa sem confirmação exige
revisão/reenvio manual porque seu SDK público não oferece a chave de idempotência
necessária. Promessas, schemas de execução e AbortSignals ficam fora do disco.
Tentativas com falha podem ser removidas apenas do dispositivo, sem apagar o
histórico remoto. Rascunhos da primeira conversa também persistem; criar o
primeiro turno ainda aguarda o estabelecimento atômico da sessão/owner no Eve.

No build local, uma mensagem ficou pendente sem rede; a aba foi fechada ainda
sem rede e outra foi aberta. A fila foi recuperada, a mensagem apareceu uma única
vez com os controles nativos, e o texto seguinte permaneceu no compositor.
Recarregar também preservou o rascunho de uma conversa nova. Desktop e viewport
390×844 foram conferidos. [Registro](evidence/durable-messaging-2026-09-29.json).

Isto não fornece inicialização fria totalmente offline da aplicação Next,
execução de filas de conversas fechadas em segundo plano, sincronização de
rascunhos entre dispositivos ou armazenamento local criptografado/E2EE. Fechar
e reabrir a aba foi verificado; desligar o sistema à força não foi simulado.
O adaptador SQLite foi compilado, mas sua execução em aparelhos físicos segue
como gate. Capacidade de produção e a paridade restante não estão declaradas
concluídas. Criadores continuam fora da expansão atual.

Visual evidence attached with `gh --attach`: [screenshots and screenshot sequence](https://github.com/EnzoTironi/tryzoen/pull/152#issuecomment-5890406756).
Validation: `pnpm check` (274 files / 1,710 tests), `pnpm build`, and the three
isolated Matrix runtime tests passed. Structural review recorded 41 observations /
10 gates without suppressions; existing owner complexity/size/churn remains visible.
