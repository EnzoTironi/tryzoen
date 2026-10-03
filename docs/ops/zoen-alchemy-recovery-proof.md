# Zoen recovery proof — 2026-09-13

The `ZoenRecovery` Alchemy stack restored production PostgreSQL from the encrypted
Tigris pgBackRest repository on an isolated Fly machine. WAL replay completed and
`pg_amcheck --all --install-missing` passed on PostgreSQL 17.11.

| Evidence                           | Result                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Alchemy run                        | `proof-20260913-v2`                                                                                         |
| Source image                       | `registry.fly.io/companion-pg-prod@sha256:0d257ff75b7058c67addcbf94996be71cb0ff657c11fec1065b939699ccb0ff2` |
| Recovery machine created           | 2026-09-13 13:33:36 UTC                                                                                     |
| Integrity verification passed      | 2026-09-13 13:34:28 UTC                                                                                     |
| Recovered workspaces               | 5                                                                                                           |
| Temporary machine and volume       | Deleted by the Alchemy action                                                                               |
| Original production machine/volume | Preserved; health check passing                                                                             |

The 52-second observation covers this database size and region; it is not a
guaranteed recovery time for larger databases or a regional outage. The drill
does not switch application traffic to the recovered machine.

## Restore concurrency — 2026-10-03 UTC

Production deployment `37078757428` applied the tested release, but its isolated
recovery proof timed out during the single-worker backup restore. On the same
PostgreSQL image and a fresh 10 GB volume, one worker restored about 50.5 MiB
within eight minutes without reaching PostgreSQL startup. Four restore workers
completed the 74.6 MiB backup in 416 seconds, but the older backup's WAL replay
still exceeded the full proof deadline.

Eight restore workers completed the 74.4 MiB latest backup in 171 seconds. WAL
replay, `pg_amcheck --all --install-missing`, all five service databases and role
isolation passed; the proof was observed 223 seconds after machine creation.
The machine used one shared CPU and 1 GB of memory. Sampled pgBackRest resident
memory peaked at 55,044 KiB, with at least 783,364 KiB available in the VM during
the samples. No repository errors were logged. The temporary machine and volume
were deleted, and the original production machine and volume were preserved.

The eight-worker run used the newer backup
`20260927-021753F_20261003-001931I` with 36 referenced backups; the earlier runs
used `20260927-021753F_20261002-235336I` with 35 references. These are recovery
qualification observations, not a controlled timing comparison. A backup label
also does not pin the WAL tail while the primary continues archiving.

The `[global:restore]` setting applies eight workers only to restores. Backup,
check and archive commands retain one worker. The eight-minute action bound,
integrity checks, encrypted repository, TLS verification and isolated recovery
networking are unchanged. These measurements cover the observed database size
and region; larger databases or different repository latency require new
qualification. See the [pgBackRest process setting](https://pgbackrest.org/configuration.html#section-general/option-process-max).

The image also passed an offline integration drill that writes a vector **after**
the full backup, restores into another volume and verifies the WAL-only row.
The restored instance refuses to write backups into the source repository.

The live Mem0 service reports the PostgreSQL backend, completed its atomic legacy
import and uses a login without superuser privileges or access to the application
database. The original memory volume remains available for recovery.

Live inference, semantic search, receipt replay and deletion passed using a
synthetic preference and the actual model providers; the test memory was removed.
Reapplying the Alchemy stack preserved all three machine instance IDs, verifying
that an unchanged deployment does not restart the running services.

See the [infrastructure runbook](../../infrastructure/README.md) for deployment,
the weekly and post-deployment recovery jobs, backup retention and incident steps.
