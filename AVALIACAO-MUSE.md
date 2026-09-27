# Muse próprio: avaliação do OpenMuse e escopo de paridade

Avaliação em 27/09/2026. Objetivo solicitado: **todas as funcionalidades do Muse original**. As etapas abaixo organizam a execução; não reduzem esse objetivo a um MVP.

**Atualização após conhecer o Zoen:** a base recomendada passa a ser o projeto existente `EnzoTironi/tryzoen`. O OpenMuse fica como referência e possível fonte de componentes pontuais. A comparação atual está em [Zoen: capacidades existentes e lacunas para o Muse](ZOEN-MUSE-GAP.md). Este documento preserva a avaliação inicial do OpenMuse.

## Conclusão

O OpenMuse tem componentes aproveitáveis, mas a versão examinada não substitui o Muse completo. Com o Zoen existente, a recomendação atual é estender o Zoen e avaliar reutilização pontual do OpenMuse. Não existe evidência suficiente para prometer uma porcentagem de paridade, prazo total ou qualidade de raciocínio equivalente.

Recriar funcionalidades observáveis é um objetivo de engenharia. Reproduzir o comportamento exato do modelo, serviços internos e integrações particulares da Meta é outra questão, que o código público examinado não resolve. A disponibilidade de cada integração precisa ser confirmada individualmente.

## Evidência usada

- App local: `/Applications/Muse.app`, identificador `com.meta.endo`, versão 4.0. Foram observadas a navegação principal e as categorias de configurações, Computer use, Conectores, Canais de mensagens e Controles de dados. Isso confirma a presença dessas superfícies, não o funcionamento de cada operação.
- OpenMuse: análise estática do commit [`34b15bc80340e582fb8c25573646cfb0bbc5184d`](https://github.com/CopilotKit/openmuse/tree/34b15bc80340e582fb8c25573646cfb0bbc5184d), obtido em cache temporário pela ferramenta ripwire. Não foram instaladas dependências, executados testes ou conectadas contas.
- Documentação oficial de ambos os produtos. A verificação publicada pelo OpenMuse descreve testes com fixtures e dados fictícios; a aceitação com modelos e contas Google reais ainda está pendente. Isso limita o que suas demonstrações comprovam. [Verificação publicada](https://github.com/CopilotKit/openmuse/blob/34b15bc80340e582fb8c25573646cfb0bbc5184d/docs/VERIFICATION.md).

Nenhum conteúdo de conversa, credencial ou documento pessoal foi copiado para este inventário.

## Funcionalidades a igualar

“Parcial” significa que existe uma implementação relacionada, mas falta comportamento necessário para o objetivo. “Ausente” se refere ao escopo documentado e ao código examinado, sem inferir que todo o repositório foi auditado.

| Área                             | Situação do OpenMuse                              | Trabalho necessário para a paridade                                                                 |
| -------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Chat e conversas paralelas       | Há streaming e histórico, com dependência externa | Validar retomada e sincronização reais; decidir quem armazena as conversas                          |
| Personalidade e memória          | Contexto pessoal editável                         | Aprendizado contínuo, recuperação relevante, procedência, correção, importação e esquecimento       |
| Ideias proativas                 | Sugestões baseadas em regras                      | Inferir sugestões úteis combinando fontes e contexto                                                |
| Metas                            | Metas, marcos e monitoramento                     | Planejamento adaptativo e reavaliação de objetivos                                                  |
| Trabalho em segundo plano        | Worker com estado persistente                     | Validar tarefas abertas, reinícios, concorrência e recuperação com provedores reais                 |
| Rotinas e lembretes              | Monitoramento recorrente de páginas               | Agendamento geral, eventos de conectores, fusos e lembretes ligados à agenda                        |
| Subagentes                       | Delegação de tarefas presente                     | Avaliar e construir coordenação geral de subagentes; delegação não comprova equivalência            |
| Navegador do agente              | Leitura pública e intervenção manual              | Clicar, digitar, preencher formulários, baixar/enviar arquivos e verificar resultados autonomamente |
| Computador persistente           | Linux limitado em Docker                          | Ambiente de execução mais completo, rede controlada e isolamento adequado                           |
| Controle do Mac                  | Sem equivalente identificado                      | Serviço nativo para acessibilidade, captura de tela, cliques, teclado e apps bloqueados             |
| Arquivos locais                  | Arquivos do contêiner                             | Acesso autorizado a diretórios do Mac, busca e operações verificáveis                               |
| Gmail e Google Agenda            | Adaptadores implementados                         | Validar contas reais e capacidades ainda incompletas                                                |
| Outros conectores                | Catálogo mais amplo que a implementação           | Implementar e testar cada integração do inventário abaixo                                           |
| Documentos e biblioteca          | PDFs e artefatos estruturados                     | Documentos, planilhas, apresentações, OCR e formatos adicionais                                     |
| Ferramentas criadas pelo agente  | Scripts no workspace                              | Instalação controlada, versões, testes, permissões e reutilização                                   |
| Ditado, voz e geração de imagens | Planejados                                        | Adicionar provedores e fluxos completos, validando o comportamento de referência                    |
| Compras, reservas e atendimento  | Navegação interativa ainda planejada              | Fluxos completos, confirmação de resultado e tratamento de falhas                                   |
| Carteira e armazenamento seguro  | Sem equivalência comprovada                       | Definir integrações disponíveis e separar segredos do contexto do agente                            |
| WhatsApp                         | Planejado                                         | Validar modalidade de integração e continuidade de conversas                                        |
| Notificações                     | Caixa de entrada interna                          | Push e notificações nativas com encaminhamento à tarefa                                             |
| Clientes                         | Expo para web, iOS e Android                      | Cliente/companion macOS e validação instalada nos dispositivos                                      |
| Dados e recuperação              | Persistência parcial                              | Exportação/importação, restauração, exclusão e migração verificáveis                                |

As diferenças de memória, metas, browser, documentos, notificações e conectores estão explicitadas no [inventário do OpenMuse](https://github.com/CopilotKit/openmuse/blob/34b15bc80340e582fb8c25573646cfb0bbc5184d/docs/FEATURES.md). Voz, mídia, ferramentas geradas, navegação interativa e outros recursos constam como trabalho futuro no [roadmap](https://github.com/CopilotKit/openmuse/blob/34b15bc80340e582fb8c25573646cfb0bbc5184d/ROADMAP.md). A existência de uma tela não é critério de conclusão para nenhuma linha.

## Inventário observado no Muse instalado

A interface principal oferece Conversa, Feed, Ideias, Metas e Biblioteca. Nas configurações aparecem Computer use, File system access, Dictation, Carteira, Armazenamento seguro, Permissões, Canais de mensagens, Dispositivos e Controles de dados. Também há barra de menu, botão flutuante e atalho para conversa rápida.

Computer use descreve controle de apps por cliques e digitação e apresenta permissões de acessibilidade, captura de tela, controle do computador, automação do navegador e uma lista de apps bloqueados. Controles de dados oferece importar memória e baixar dados do agente. WhatsApp aparece como canal de mensagens.

O catálogo observado contém estes nomes, sem testar as conexões ou registrar o estado de contas pessoais:

| Grupo de trabalho proposto | Conectores visíveis                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Apple e máquina            | Apple Calendar, Apple Contacts, Apple Reminders, Browser, Tailscale                                                                      |
| Google                     | Gmail, Google Agenda, Google Drive, Contatos do Google, Formulários Google, Google Docs, Google Slides, Google Tarefas, Planilhas Google |
| Microsoft                  | Outlook Mail, Calendário do Outlook, Contatos do Outlook                                                                                 |
| Meta                       | Facebook, Instagram, Mensagens do Instagram, Threads, Mensagens do Threads, Messenger                                                    |
| Produtividade              | Calendly, Granola, Notion                                                                                                                |
| Saúde e finanças           | Finanças (Plaid), Function Health, HealthEx, Peloton, Withings                                                                           |
| Serviços e dispositivos    | OpenTable, Philips Hue, Printify, Spotify, Tessie                                                                                        |

Esse catálogo é uma lista de requisitos a investigar. Uma entrada “disponível” no Muse não demonstra que um aplicativo independente conseguirá os mesmos escopos de API. Novas funcionalidades descobertas em testes do original devem ser adicionadas ao inventário.

## Diferenças arquiteturais decisivas

**Conversas dependem de um serviço separado.** O OpenMuse exige `CPK_INTELLIGENCE_API_KEY` antes de iniciar. Isso foi confirmado em `apps/server/src/config.ts:66` e na chamada em `apps/server/src/app.ts:29`. O runtime configura `CopilotKitIntelligence`; retirar a exigência da variável não implementa a persistência ausente. Se independência desse serviço for requisito, será necessário substituir essa camada. [Contrato de Rich Threads](https://github.com/CopilotKit/openmuse/blob/34b15bc80340e582fb8c25573646cfb0bbc5184d/docs/RICH-THREADS.md).

**O computador do OpenMuse não é o Mac.** Seu contêiner mantém arquivos, executa comandos limitados e não possui rede no terminal. O browser tem armazenamento e ciclo de vida separados. Não há acesso automático aos diretórios e apps do host. [Computador do OpenMuse](https://github.com/CopilotKit/openmuse/blob/34b15bc80340e582fb8c25573646cfb0bbc5184d/docs/COMPUTER.md).

**A autonomia do browser é limitada.** O prompt de execução em `apps/server/src/engine/model.ts:300` instrui explicitamente que reservas interativas dependem de intervenção da pessoa. O runtime já oferece planejamento, artefatos e preparação de ações, mas isso não fornece um agente de browser equivalente.

**O Muse original tem serviços próprios fora da interface.** A descrição técnica da Meta inclui VM persistente, agente principal, subagentes, rotinas, conectores e criação de ferramentas. Inclui também separação entre execução, credenciais e autoridade de permissões, além da transferência de controle do browser. Esses componentes são parte do comportamento a reconstruir; instalar ou copiar a interface não os reproduz. [Arquitetura publicada pela Meta](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse).

## Caminho inicialmente considerado para o OpenMuse

Antes de conhecer o Zoen, o caminho considerado era usar o OpenMuse como candidato a base, aproveitando UI, contratos AG-UI, artefatos e mecanismo de tarefas/aprovações onde fossem adequados. Esse ponto de partida foi substituído pela continuidade do Zoen, que já implementa vários desses componentes. A sequência abaixo registra a proposta inicial, não o plano atual de implementação.

O produto precisa de cinco blocos: clientes; agente e memória persistente; execução durável de tarefas/rotinas; ferramentas e conectores; ambientes de execução no Linux e no Mac. As permissões e credenciais precisam funcionar entre esses blocos, inclusive quando o agente cria uma ferramenta nova.

Um serviço permanente pode executar o trabalho remoto enquanto os clientes estão fechados. Já ações no Mac dependem do Mac disponível. Se o único servidor estiver no próprio Mac, dormir/desligar a máquina interrompe a capacidade de trabalhar continuamente. Hospedagem, modelos e custos ainda não foram definidos.

| Etapa                    | Resultado verificável                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1. Prova da base         | Conversa real, tarefa real e resultado persistido; reinício sem perda; dependências externas explicitadas     |
| 2. Agente e memória      | Contexto recuperado entre conversas, rotinas e tarefas retomadas sem duplicar ações                           |
| 3. Browser e Mac         | Concluir formulário de teste, transferir controle à pessoa e editar arquivo de teste em app local             |
| 4. Conectores e arquivos | Cada conector com autenticação, capacidades e fluxos completos validados; biblioteca e exportações funcionais |
| 5. Autonomia ampliada    | Metas adaptativas, subagentes e ferramentas geradas com execução e resultados observáveis                     |
| 6. Superfícies restantes | Voz, imagens, canais, notificações, carteira, clientes e recuperação conforme a referência                    |

A primeira prova deve combinar tarefas representativas: pesquisar e salvar um relatório; retomar um trabalho após reinício; preencher um formulário de teste; organizar arquivos de teste no Mac; lembrar uma preferência corrigível. Isso avalia as decisões difíceis antes de ampliar o catálogo.

## Estado ao encerrar esta avaliação

Inventário inicial e análise do OpenMuse concluídos. Não houve execução do OpenMuse, validação de contas reais ou teste funcional de todas as capacidades do Muse original. A análise posterior do Zoen está no documento vinculado acima e passa a orientar os próximos passos, mantendo o inventário completo como escopo.
