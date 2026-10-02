# Plano de paridade do Zoen

Contrato de produto, prioridades e critérios de aceitação. A [arquitetura atual](../eve/architecture.md) registra os donos da implementação; resultados datados de validação ficam no histórico.

## O produto que estamos construindo

Um lugar para conversar com pessoas, grupos e agentes, realizar trabalho e preservar conhecimento. A experiência cotidiana deve ser simples e familiar; a complexidade de execução, permissões e memória fica com os seus responsáveis técnicos.

| Referência               | Ideia que adotamos                                                                     | Resultado esperado no Zoen                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| iMessage                 | Conversas legíveis, identidade visual, detalhes simples, composição e mídia integradas | Lista agradável, perfis acessíveis, mensagens e anexos com apresentação nativa e poucas etapas       |
| WhatsApp                 | Comunicação confiável, grupos, áudio, chamadas e controles pessoais                    | Envio recuperável, notificações úteis, estados honestos e controle de quem pode interagir            |
| Slack                    | Threads, atenção, busca e colaboração contextual                                       | Discussões organizadas sem perder o contexto; menções, acompanhamento e conteúdo encontrável         |
| Ando / Buzz              | Pessoas e agentes participando de espaços compartilhados                               | Hangouts e colaboração com identidade explícita, atenção controlada e revisão de resultados          |
| Muse                     | Agente pessoal que executa, propõe, acompanha e cria                                   | Chat, Feed, Ideias, Metas, Biblioteca, aprovações, rotinas, conectores e arquivos editáveis          |
| TextQL ontology          | Definições e memória em arquivos versionados; índices derivados e execução governada   | Conhecimento consistente entre conversas, histórico, correções e proveniência com permissões atuais  |
| Visão Zoen / marketplace | Criadores ensinam bots por conversa e publicam uma versão aprovada                     | Conhecimento atribuído, testes com o criador, acesso claro e conversas privadas de cada participante |

As referências são ideias de interação, não uma obrigação de reproduzir todos os produtos ou seus ecossistemas. Os requisitos explícitos do usuário prevalecem: manter a barra mobile de Conversas, Feed, Ideias, Metas, Biblioteca e Configurações; Descobrir fica fora dela. Sheets mobile viram modais no desktop, exceto sugestões do compositor, que ficam acima do campo nos dois. Bots têm tipo de conta e selo IA, sem sufixo obrigatório. Criar, ensinar e corrigir um bot acontece no chat; o editor visual serve para inspecionar e editar seus arquivos.

## Como medir conclusão

- **Base implementada:** existe caminho funcional e evidência registrada, com limites declarados.
- **Parcial:** existe uma parte utilizável, mas a jornada ainda tem lacunas.
- **Pendente:** falta implementar o caminho completo.
- **Não qualificado:** falta evidência suficiente em aparelhos, produção, carga ou comportamento de referência.

Uma entrega só passa para concluída quando atravessa interface, persistência, autorização, recuperação de falha e teste relevante. Nenhuma ação aparece como disponível sem funcionar. Nenhum selo de criptografia, presença, processamento de vídeo, publicação ou escala representa somente intenção.

## Lista de capacidades

As tabelas definem requisitos e critérios de aceitação. Elas não atribuem status de implementação ou qualificação.

### Comunicação e atenção

| ID      | Capacidade                    | Critério de conclusão                                                                                                                          |
| ------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| COMM-01 | Caixa de entrada unificada    | Ordenação global por atividade, prévia e horário reais, não lidas/menções, paginação estável, filtros e fixadas sem esconder conversas         |
| COMM-02 | Sincronização e recuperação   | Matrix incremental, preenchimento de lacunas, retomada após queda/reinício e conta trocada, envio idempotente, cache autorizado e limitado     |
| COMM-03 | Leitura, digitação e presença | Marcadores por pessoa/thread, privacidade e visibilidade corretas, expiração de digitação, ausência de estados simulados                       |
| COMM-04 | DMs, contatos e solicitações  | DMs existentes no mesmo espaço preservados; descoberta por username, convites externos, aceitar/recusar e impedir abuso com política explícita |
| COMM-05 | Grupos e comunidades          | Criar, convidar, entrar/sair, papéis, remoção, dados do grupo, permissões do bot e política de histórico testados                              |
| COMM-06 | Threads e ações de mensagem   | Reação/resposta existentes; editar, excluir, salvar, encaminhar, seguir thread e voltar à origem com autoridade e estados consistentes         |
| COMM-07 | Busca e organização           | Busca autorizada em mensagens/anexos com filtros e salto ao resultado; arquivar, fixar e exportar DMs/grupos além do chat pessoal              |
| COMM-08 | Notificações e offline        | Push real, preferências/mute, menções/threads, deep links, recuperação offline e nenhuma notificação duplicada por retry                       |
| COMM-09 | Segurança social              | Bloquear, denunciar com escolha de evidências, controle de desconhecidos, moderação, limites e exclusão/exportação com alcance explicado       |
| COMM-10 | Criptografia e aparelhos      | E2EE, verificação, chaves/recuperação, mídia cifrada e participação autorizada de bots provadas entre dispositivos                             |
| COMM-11 | Coordenação leve              | Mensagens agendadas, lembretes pessoais, enquetes e eventos/RSVP com ciclo completo e fusos corretos; entrega faseada após o mensageiro básico |

### Composição, mídia e encontro

| ID       | Capacidade                          | Critério de conclusão                                                                                                                         |
| -------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| MEDIA-01 | Editor e referências                | Formatação e referências existentes; preservar rótulos após remontagem, IME/undo/seleção e teclado físico/virtual nos clientes                |
| MEDIA-02 | Arquivos e cartões                  | Envio/recepção/playback existentes; uploads grandes retomáveis, progresso/cancelamento/retry, thumbnails privados e fallback de formato       |
| MEDIA-03 | Voz no compositor                   | Gravar, cancelar, revisar, enviar, retomar após interrupção; permissões, rota de áudio, duração e transcrição quando suportada                |
| MEDIA-04 | Entendimento de anexos              | Agente recebe conteúdo autorizado efetivamente extraído; informar formato não processado, limites e falhas; upload não equivale a compreensão |
| MEDIA-05 | Chamadas e hangouts                 | Entrar/sair, participantes, áudio/vídeo, reconexão, troca de dispositivo, compartilhamento de tela e consentimento de gravação/bot            |
| MEDIA-06 | Aplicativos e artefatos interativos | Host de MCP Apps e visores com comunicação restrita, autenticação, falhas e navegação; cartão de ferramenta sozinho não satisfaz              |

### Agente pessoal e capacidades Muse

| ID      | Capacidade                           | Critério de conclusão                                                                                                                       |
| ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| MUSE-01 | Execução durável e aprovações        | Retomar/cancelar, aprovar/negar, inspecionar resultado e falha sem duplicar efeitos externos; histórico global além do chat aberto          |
| MUSE-02 | Rotinas e responsabilidades          | Criar/editar/pausar/excluir, histórico e falhas, próximas execuções e permissões com efeitos concorrentes definidos                         |
| MUSE-03 | Feed proativo                        | Geração opt-in, contexto autorizado, origem/racional, custo/cadência limitados, ranking, feedback, mídia, descarte e discussão              |
| MUSE-04 | Ideias proativas                     | Propostas úteis com validade, categorias e feedback; execução deduplicada; itens dispensados não reaparecem por retry                       |
| MUSE-05 | Metas e acompanhamento               | Metas/submetas/histórico existentes; progresso e briefings reais, vínculo explícito com rotinas, grandes listas e concorrência qualificados |
| MUSE-06 | Biblioteca e arquivos                | Hierarquia/editor existentes; previews, seleção/ações, ordenação, versões, mídia/PDF/documentos, download/share e permissões de publicação  |
| MUSE-07 | Identidade e personalização          | Username/perfil/persona existentes; avatar e preferências com persistência, privacidade, conflitos e comportamento consistente              |
| MUSE-08 | Conectores e ferramentas             | Descoberta/setup/contas/escopos/revogação reais, catálogo honesto, permissões por operação e integração com o agente                        |
| MUSE-09 | Credenciais, carteira e compras      | Reusar cofre web existente; UI nativa, acesso mascarado, delegação e checkout/revisão/negação de compra com provedor real                   |
| MUSE-10 | Configurações e canais               | Mesmas famílias funcionais nos clientes: conta, aparência, idioma, permissões, canais, sessões, aparelhos, dados e suporte                  |
| MUSE-11 | Navegador e controle de dispositivos | Preview/takeover/reconexão e execução no dono existente; dispositivos pareados e capacidades com concessão e revogação explícitas           |

### Memória, criadores e marketplace

| ID         | Capacidade                                      | Critério de conclusão                                                                                                                                        |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MEMORY-01  | Arquivos, relações e histórico memória canônica | Motor real integrado; correção, busca, proveniência e relações; UI temporal completa. `as_of` de ingestão não é bitemporalidade completa de tempo válido     |
| MEMORY-02  | Arquivo de sessões                              | Captura opt-in, sanitização, proveniência, deduplicação, revogação, pausa e remoção; não inventar sessões anteriores à captura                               |
| MEMORY-03  | Sonhos e consolidação                           | Não sobrescrever edição humana nem recriar conteúdo excluído; interrupção/undo, custo, qualidade e recuperação comprovados antes de habilitar                |
| MEMORY-04  | Memória multiplayer                             | Separar privado do criador, versão publicada do bot, privado do assinante e contexto do grupo; promoção de conhecimento só com consentimento                 |
| MEMORY-05  | Operação persistente                            | Placement/quotas, backup consistente, restore, retenção/erasure e concorrência; finalizar obrigações dos dados do provedor antigo                            |
| CREATOR-01 | Entrevista e ensino pelo chat                   | Retomar entrevista, reconhecer lacunas, registrar método/voz/limites/exemplos e revisar arquivos sem depender de formulário paralelo                         |
| CREATOR-02 | Importação de fontes                            | Inventário autorizado de YouTube/documentos/sites, jobs retomáveis, transcrições com timestamps, extração visual quando necessária, origem e falhas visíveis |
| CREATOR-03 | Testes, correções e versão aprovada             | Casos definidos antes do teste, respostas reais, revisão humana no chat, revisões imutáveis e aprovação do conjunto exato de fontes/conhecimento             |
| CREATOR-04 | Marketplace e publicação                        | Busca/categorias/perfis, autoria/versão/cobertura, publicar/retirar/atualizar, abrir conversa ou convidar bot para grupo autorizado                          |
| CREATOR-05 | Acesso e monetização                            | Entitlements, assinatura/cancelamento/revogação, limites, cobrança e métricas agregadas; pagar por bot não dá acesso privado ao criador                      |
| CREATOR-06 | Pilotos e melhoria                              | Feedback voluntário e explícito, avaliação por domínio com métricas pré-definidas; nenhuma leitura automática das conversas dos participantes                |
| CREATOR-07 | Participação de agentes em grupo                | Atenção/estratégia/ação/reflexão limitadas, silêncio permitido, interrupção e prevenção de loops; identidade IA sempre clara                                 |

### Qualidade e distribuição

| ID      | Capacidade                          | Critério de conclusão                                                                                                                   |
| ------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| SHIP-01 | Experiência nativa e acessibilidade | Tipografia/espaçamento/seleção coerentes, foco e leitor de tela, texto ampliado, reduzir movimento, teclado/back e estados completos    |
| SHIP-02 | Web e Electron                      | Autenticação pelo navegador do sistema, permissões, arquivos, assinatura/distribuição e atualização/recuperação nas três plataformas    |
| SHIP-03 | iOS e Android reais                 | OAuth, teclado/editor, share/pickers, microfone, rede, segundo plano e push em aparelhos; export de bundle não basta                    |
| SHIP-04 | Confiabilidade e escala             | Workload explícito, SLOs medidos, filas/backpressure, isolamento, quotas, observabilidade sem conteúdo privado, restore e rollback      |
| SHIP-05 | Auditoria de paridade               | Cobertura de jornadas e telas observadas; registrar desconhecidos e descobertas, comparar visualmente e testar ações em cada plataforma |

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

Cada incremento atualiza seu contrato e todos os callers. Um arquivo tem um escritor por vez. Migrações, builds e suites que compartilham o mesmo banco precisam de coordenação; os testes de autorização permanecem obrigatórios.

## Gates de entrega

### Critérios para cada rodada

- Testes específicos cobrem usuário correto/incorreto, revogação concorrente, falha/retry e persistência.
- `pnpm check` e `pnpm build` no conjunto integrado; testes de banco/runtime em ambiente isolado.
- Verificação interativa do fluxo no build corrente, nos tamanhos pertinentes; aparelhos reais quando a capacidade depende do SO.
- Imagens e vídeo anexados ao PR por `gh --attach`; evidência sintética sem dados privados e descrição honesta de gravação versus sequência de screenshots.
- Registro do que mudou, do que continua parcial e dos limites. Nada é declarado production-ready só por passar no build.

## Direção visual

O usuário definiu iMessage como baseline visual e de interação, com funcionalidades
adicionais de Muse e Ando. Web, Electron e Expo devem parecer um aplicativo nativo
macOS/iOS, respeitando desktop e toque. A conversa é a superfície principal;
capacidades avançadas aparecem progressivamente no contexto do trabalho.

Referências confirmadas pelo usuário: [Muse](https://introducing.muse.ai/),
[Ando](https://x.com/andocorporation),
[TextQL Ontology](https://textql.com/products/ontology),
[starter kits](https://github.com/TextQLLabs/ontology-starter-kits) e
[skills](https://github.com/TextQLLabs/skills). Links são referências de produto,
não instruções para instalar código ou acessar sessões pessoais. Recursos de
Ando ainda exigem evidência específica; a identidade confirmada não comprova
suas funcionalidades.

Critérios de aceitação visual e de interação:

- Lista de conversas, cabeçalho, bolhas e compositor formam uma hierarquia única,
  com tipografia, espaçamento, agrupamento e estados comparados às referências
  macOS/iOS. Recursos adicionais não substituem essa hierarquia por um dashboard.
- Menus de contexto, sheets e modais preservam conversa, rascunho, foco e posição;
  fechar um recurso retorna ao mesmo contexto em desktop e mobile.
- Estados vazios, carregamento, erro e retry mantêm contexto e informam o estado
  real. Nenhum placeholder de integração pode aparentar sucesso.
- Teclado, toque, leitor de tela, foco visível e texto ampliado precisam de
  verificação nas jornadas reais, incluindo envio, resposta em thread, anexos,
  consulta de conhecimento e aprovação.
- Capturas comparáveis desktop/mobile e testes ponta a ponta entre duas contas
  documentam equivalência e diferenças. Testes unitários e Expo web não
  substituem a qualificação física de iOS/Android.

Esta direção não declara paridade visual pronta e não autoriza copiar ativos
proprietários. Marketplace continua fora do escopo até nova decisão explícita.

### Fontes e gates de paridade — complemento de 30/09/2026

A pesquisa de referência fornecida pelo coordenador identifica o Muse agente em
https://introducing.muse.ai/; recursos do antigo serviço de vídeo em muse.ai não
são requisitos do agente. Ando tem fontes oficiais em https://www.ando.so/ e
https://docs.ando.so/docs/start-guide. A identidade agora está resolvida; o índice
https://docs.ando.so/llms.txt é uma rota de pesquisa, não evidência de cada recurso.

| Frente                | Fonte primária                                                                         | Gate do produto                                                                               |
| --------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Definições e execução | https://textql.com/products/ontology                                                   | Significados consistentes entre conversas; consultas e ações vinculadas à definição publicada |
| Acesso                | https://docs.textql.com/core/ontology/ontology-rbac                                    | Revogação vale para resultados, sugestões e existência; revisar não concede acesso            |
| Proveniência          | https://docs.textql.com/core/how-it-works/citations                                    | Métrica ligada a versão, consulta, fontes e transformação verificáveis                        |
| Skills                | https://docs.textql.com/core/ontology/skills                                           | Procedimentos inspecionáveis e versionados com autorização na execução                        |
| Auditoria             | https://docs.textql.com/core/admin/audit-log                                           | Ator, instante, recurso, resultado/falha e recibo durável                                     |
| Agente pessoal        | https://introducing.muse.ai/                                                           | Chat persistente, side chats, trabalho durável, memória editável, metas, ideias e artefatos   |
| Aprovação             | https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse | Negação impede efeito; aprovação scoped; segredos fora do contexto; export/restauração        |
| Colaboração           | https://docs.ando.so/docs/start-guide                                                  | Identidade humana/IA explícita, canais/menções/permissões e DMs protegidas                    |
| Agentes externos      | https://docs.ando.so/docs/external-agents                                              | Identidade verificada, reconexão sem duplicação e revogação efetiva                           |

Chamadas/Jams, transcrição desligável e pesquisável e Bridge entre workspaces
ficam como lacunas de colaboração, com contratos específicos a qualificar.
Slack sync/backfill e miniapps precisam das páginas detalhadas antes de definir
aceite. Uma VM confidencial futura anunciada pelo Muse não é capacidade entregue
nem gate de equivalência atual. Starter kits TextQL não são dados reais de usuário
e suas licenças, inclusive restrições clínicas, impedem cópia indiscriminada.

Rubrica iMessage: fixar versão e capturas. A direção mais recente do usuário
é macOS 27, com as oito imagens fornecidas como referência visual; não declarar
fidelidade a partir de um guia sem versão. A referência iOS 26 permanece em
https://support.apple.com/en-gb/guide/iphone/iph82fb73ba3/26/ios/26.
Desktop usa sidebar e conversa; mobile lista e chat em uma região por vez.
Compositor inferior; detalhes e agentes opt-in, sem terceira coluna fixa.
Bolhas próprias à direita e demais à esquerda, agrupamento e horários discretos;
texto selecionável, RTL e links longos sem overflow. Enter/Shift+Enter no desktop
respeitam composição IME. Anexos têm preview/progresso/cancelamento/erro individuais.
Resposta aponta à mensagem original inclusive fora da página carregada; busca
exibe estados e destaque; menus funcionam com mouse, teclado e toque.

Usar fonte de sistema ou fallback licenciado, sem embutir SF Pro. Qualificar
claro/escuro, redução de movimento, foco/Escape/restauração e leitor de tela sem
anunciar cada token. Alvos mobile de 44pt, zoom 200%, contraste 4.5 para texto e
3 para indicadores são critérios de QA. Confirmar estados sending/sent/delivered/
read pelo backend; reconexão e retries não duplicam mensagens. Estados de agente
separam digitando, executando, aprovação, falha e conclusão; stop precisa funcionar.

Comparar dados idênticos em web/Electron/Expo iOS/Android: 1440×900, 390×844,
360×800 e desktop estreito, teclado e texto ampliado. Essas dimensões são cenários
de QA, não medidas oficiais do iMessage. Fontes: https://developer.apple.com/design/human-interface-guidelines/accessibility
e https://developer.apple.com/design/tips/. Não declarar pixel-perfect sem comparação,
interoperabilidade iMessage, E2EE ou recursos de backend ainda não implementados.

## Referências e planos detalhados

- [Comunicação: contratos, evidência e fatias](parity-communication.md).
- [Memória e criadores: isolamento, versões e aceitação](parity-memory-creators.md).
- [Muse e plataformas: jornadas, configurações e qualificação](parity-muse-platform.md).
- [Handoff social/Matrix e leituras HUMA/Tutor CoPilot](https://github.com/EnzoTironi/tryzoen/blob/04cf0dfe4f0ce7de4e0652bc5ebacfbfcb696839/docs/muse/tryzoen-social-matrix-handoff.md), [memória](https://github.com/EnzoTironi/tryzoen/blob/04cf0dfe4f0ce7de4e0652bc5ebacfbfcb696839/docs/muse/file-memory.md), [inventário Muse](interface-audit.md), [cliente universal](universal-client.md).
- Referências primárias: [Apple Messages](https://support.apple.com/en-nz/104982), [organização no iMessage](https://support.apple.com/en-ie/guide/iphone/iphe9b48b89e/27/ios/27), [Slack threads](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions), [Slack huddles](https://slack.com/help/articles/4402059015315-Use-huddles-in-Slack), [WhatsApp privacidade](https://www.whatsapp.com/privacy), [WhatsApp chamadas](https://www.whatsapp.com/calling?lang=en), [Ando](https://www.ando.so/blog/introducing-ando), [Buzz](https://github.com/block/buzz), [Matrix](https://spec.matrix.org/latest/client-server-api/).

O inventário ainda tem lacunas de observação de Muse, especialmente integrações externas, permissões nativas, checkout e alguns visores. Novas descobertas entram aqui com evidência; uma afirmação promocional de um produto não substitui o teste do Zoen.

Os [checkpoints anteriores](https://github.com/EnzoTironi/tryzoen/blob/04cf0dfe4f0ce7de4e0652bc5ebacfbfcb696839/docs/muse/parity-roadmap.md) registram apenas suas respectivas versões e não qualificam a implementação atual.
