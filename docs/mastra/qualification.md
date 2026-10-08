# Qualificação do piloto — 7 de outubro de 2026

Ambiente isolado: Node 24, PostgreSQL 18, payload store e diretório de fontes exclusivos, duas contas sintéticas do Zoen e o login local existente do Codex. Nenhuma credencial foi anexada ao PR.

| Verificação                                                                | Resultado                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suíte geral (`vitest run`)                                                 | 379 arquivos; 3.635 testes passaram                                                                                                                                                            |
| Integração Mastra/PostgreSQL                                               | 9 testes passaram; somente o modelo externo é roteirizado                                                                                                                                      |
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

## Pendência do check global

`pnpm check` ainda não está verde: o Knip encontra duas dependências não usadas e o binário Alchemy não resolvido em `infrastructure`. Os mesmos quatro apontamentos foram reproduzidos no checkout original de `main`. O lint global também recebe erros de tipos/imports desse pacote sem suas dependências instaladas; o lint do piloto está limpo.

A instalação isolada de `infrastructure` com seu lockfile foi tentada, mas terminou com `ERR_PNPM_BROKEN_METADATA_JSON` e timeout na validação de metadados do registry. A política de dependências não foi desativada. Essa pendência fica fora da implementação do piloto e precisa ser resolvida antes de tratar o check global como aprovado.

## Limites da evidência

A retomada exercitada com o modelo real ocorre na proposta suspensa, antes da decisão. A evidência não estabelece recuperação automática de toda falha durante o modelo ou durante a publicação. Não houve benchmark de capacidade, migração dos canais/conectores, implantação pública ou qualificação do ciclo de exclusão de dados nativos do Mastra. As capturas e o vídeo usam somente as contas e conteúdos sintéticos deste ensaio.
