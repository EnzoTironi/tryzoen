# Qualificação do piloto — 7 de outubro de 2026

Ambiente isolado: Node 24, PostgreSQL 18, payload store e diretório de fontes exclusivos, duas contas sintéticas do Zoen e o login local existente do Codex. Nenhuma credencial foi anexada ao PR.

| Verificação                                                                | Resultado                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suíte geral (`vitest run`)                                                 | 379 arquivos; 3.635 testes passaram                                                                                                                                                            |
| Integração Mastra/PostgreSQL                                               | 12 testes passaram; somente o modelo externo é roteirizado                                                                                                                                     |
| TypeScript e lint dos arquivos do piloto, incluindo inicialização e testes | Passaram                                                                                                                                                                                       |
| Formatação e `git diff --check`                                            | Passaram                                                                                                                                                                                       |
| `pnpm db:check` e execução transacional da migração 0114                   | Passaram                                                                                                                                                                                       |
| `pnpm install --frozen-lockfile` da aplicação                              | Passou                                                                                                                                                                                         |
| `pnpm build` e build Next final após ajustes visuais                       | Passaram                                                                                                                                                                                       |
| Inicialização com a flag do piloto                                         | Somente Next; reconciliação prévia de apagamentos preservada                                                                                                                                   |
| Produção com modelo Codex real                                             | Dez verificações passaram: página autenticada, conversa anterior, recibo, download exato, isolamento e nova resposta sem publicação                                                            |
| Interface                                                                  | Proposta integral, rejeição, aprovação, recibo, download e cancelamento verificados no navegador; troca de conversa em tela menor e resposta simples sem duplicação verificadas no build final |

## Retomada com o modelo real

Uma preferência vegetariana foi publicada no repositório privado com a citação do pedido. Uma nova conversa produziu uma nota compatível com essa preferência. Antes da aprovação, o arquivo ainda não existia. Após parar e iniciar o servidor, a proposta manteve o mesmo conteúdo; a aprovação publicou exatamente o conteúdo revisado. Uma segunda aprovação retornou o mesmo recibo e a mesma revisão Git. A segunda conta não conseguiu ler nem aprovar essa execução.

A suíte de integração também verifica rejeição, cancelamento durante uma chamada ao modelo, revogação da sessão, aprovação com um novo login válido e reconciliação de registros interrompidos após checkpoints suspensos/concluídos. Ela está em `tests/runtime/mastra-pilot.integration.ts`; a preparação e o comando estão em [pilot.md](pilot.md).

## Continuação: apagamento nativo e CI

O setup foi aplicado duas vezes com sucesso no banco isolado. As constraints vinculam os registros nativos a conversas, execuções e workspaces reais. Três novos testes passaram: exclusão de propostas pendentes/concluídas, recursos e registros de observação sem alterar outra conta; rejeição de threads/checkpoints atrasados; reaplicação do tombstone após dados voltarem por rollback; exclusão durante uma resposta sem reaparecimento de mensagens/checkpoints. A observação é apenas um registro sintético persistido pela API pública de storage; Observer/Reflector continuam desativados no Agent.

O build Next e o ensaio com Codex real foram repetidos após essas constraints. A proposta permaneceu suspensa e idêntica após reinício; aprovar publicou o conteúdo revisado, repetir devolveu o mesmo recibo e a segunda conta recebeu 403. O download foi comparado ao conteúdo integral da proposta e o `resourceId` nativo foi confirmado como o workspace pessoal. Novas capturas acompanham o PR.

O primeiro CI remoto passou nos pacotes de desktop das três plataformas, em três shards de runtime e no ensaio PostgreSQL de recuperação. O shard 1 falhou na asserção que fixava 114 migrações; a migração do piloto elevou a cadeia a 115. A asserção agora lê a cadeia registrada. A reprodução local desse harness encontrou a porta de outro fixture ocupada, que foi preservado; a execução remota continua sendo necessária para qualificar o cutover completo.

O check geral remoto parou antes dos testes em `Temporary risk acceptance expired`: a política existente expirou em 5 de outubro UTC. Uma auditoria nova do registry também encontrou outros advisories, além das entradas anteriormente aceitas. Não houve extensão da política, atualização de fingerprint ou desativação de checks. As dependências e a política precisam de uma revisão separada para que o CI geral possa ficar verde.

## Pendência do check global

`pnpm check` ainda não está verde: o Knip encontra duas dependências não usadas e o binário Alchemy não resolvido em `infrastructure`. Os mesmos quatro apontamentos foram reproduzidos no checkout original de `main`. O lint global também recebe erros de tipos/imports desse pacote sem suas dependências instaladas; o lint do piloto está limpo.

A instalação isolada de `infrastructure` com seu lockfile foi tentada, mas terminou com `ERR_PNPM_BROKEN_METADATA_JSON` e timeout na validação de metadados do registry. A política de dependências não foi desativada. Essa pendência fica fora da implementação do piloto e precisa ser resolvida antes de tratar o check global como aprovado.

## Limites da evidência

A retomada exercitada com o modelo real ocorre na proposta suspensa, antes da decisão. A evidência não estabelece recuperação automática de toda falha durante o modelo ou durante a publicação. Não houve benchmark de capacidade, migração dos canais/conectores ou implantação pública. O apagamento nativo foi qualificado por exclusão real de conta, corrida com o modelo e rollback/replay do tombstone; faltam retenção por idade e um ensaio completo de backup/restauração com esses registros. As capturas e o vídeo usam somente as contas e conteúdos sintéticos deste ensaio.
