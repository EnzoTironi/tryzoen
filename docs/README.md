# Documentation

Start with the current architecture and the guide for the work you are doing.
Product plans and dated research describe requirements; they are not proof that
a capability is implemented or qualified.

| Task                                            | Read                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Understand the application and code ownership   | [Architecture](eve/architecture.md)                                                        |
| Set up a local app or isolated tests            | [Local runtime setup](local-runtime-setup.md)                                              |
| Deploy or recover an installation               | [Self-hosting](self-host.md), [Alchemy](../infrastructure/README.md)                       |
| Review verification and remaining release gates | [Eve validation](eve/rebuild.md), [universal client](muse/universal-client.md)             |
| Understand the product and parity requirements  | [Product direction](product-direction.md), [parity roadmap](muse/parity-roadmap.md)        |
| Work on knowledge and memory                    | [Architecture](eve/architecture.md), [knowledge contract](muse/knowledge-plan.md)          |
| Research an integration or recipe               | [Integration research](recipe-integrations/README.md)                                      |
| Understand a recorded decision                  | [Architecture decisions](decisions/)                                                       |
| Review Muse and OpenMuse references             | [Interface audit](muse/interface-audit.md), [OpenMuse evaluation](muse/openmuse-review.md) |

Keep setup instructions with their current owner and link to them. Keep one
authoritative copy of each research catalog. Superseded execution reports and
removed implementation plans remain available in Git history; they do not belong
in the active setup path. Configuration required by a framework or CLI stays at
the repository root; research and implementation notes belong under `docs/`.
