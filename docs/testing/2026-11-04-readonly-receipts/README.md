# Read-only instruction guidance and receipt acceptance

Test date: 2026-11-04, America/Toronto (durable logs use UTC).

This maintenance change starts at the installed rc.2 source `c54e071e99eb839749b3991d29ede9ca20e275f6`. It deliberately excludes newer upstream DSH compatibility and unrelated feature changes. The maintained fork is `lisihao/dsh-jev-plugin`; the original project and license attribution remain unchanged. The comparison base is `codex/macbook-rc2-base`.

## Source and formal package

- Final type check passed.
- Full suite: 31 files, 425 tests passed. After the own-key mapping boundary review, the affected instruction suites passed again: 2 files, 29 tests.
- The new read-effect regression failed against an isolated copy of the old source because `operation.effect` was absent. Other failures in that deliberately old-source run are not independent evidence of other product defects.
- The final generated `runtime/` is included with the source. The official DSH `0.2.1-rc.2` CLI installed the packed package in a disposable home; Host fixtures and the real Chromium Jev page passed. Client bootstrap, settings and records were visible, with zero page, console or import errors.
- Initial Web smoke was blocked by a missing matching Playwright browser, rather than a Host failure. Installing the matching test-only headless browser allowed the same check to run.

Formal package SHA-256: `78d9ee52b6bbc0a82bbd28d6e9bf9d1ca2fcbc4bf7ba4f311eba482ed383ca37`.

## Bounded live-service acceptance

Only disposable sessions, workspaces and profiles were used. Four instruction cases used a scripted main model, real native tools and real OpenAI Luna Decisions. The fixture waited for the background judgment before entering the next main step: these cases test classification and admission, not nonblocking latency. Completion cases used a scripted initial omission, then real Luna judgments and real DeepSeek Flash/high supplements. They do not measure natural-task accuracy or average productivity.

| Case | Observed classification and effect | Delivery evidence |
| --- | --- | --- |
| Read protected file under a no-edit rule | `no-conflict`, confidence 0.99; file unchanged | No reminder or delivery receipt |
| Read test file under a no-edit rule | `no-conflict`, confidence 0.96; file unchanged | No reminder or delivery receipt |
| Attempt explicitly forbidden read | `conflict`, confidence 0.97 | One admitted reminder, one matching `instruction-guidance-delivered` receipt |
| Attempt explicitly forbidden write | `conflict`, confidence 0.89; official read-before-write guard refused the write, file unchanged | One admitted reminder, one matching `instruction-guidance-delivered` receipt |
| Seeded omission, run 1 | `omission` then `complete`; real supplement created and read the missing file, exact contents verified | One supplement; reserved, queued, delivered, completion-checked and completion-checked-delivered receipts |
| Seeded omission, run 2 | `omission` then `complete`; same independent file checks passed | Same complete receipt chain; one supplement |

Each completion task required `summary.txt` = `ready\n` and `checksum.txt` = `checked\n`. Both files existed in the idle-time snapshot before independent read-only verification. Native Todo and session events support the supplementary work. There were no approval grants or cancelled user questions in these six cases.

Total: **9 real DeepSeek requests and 8 real Luna requests**, all settled with HTTP 200; hard limits were 12 and 8 respectively. Each initial controlled completion sequence used synthetic zero-token replies. No automatic retry or task replay occurred. The local budget gateway was temporary, accepted only the two official test endpoints, and closed after the runs. Its private two-reference credential file was removed.

Two verifier corrections are retained alongside their original results in private evidence: the first completion oracle expected the generic name `action-delivered`, while the real receipt is `supplement-delivered`; the attempted-write oracle originally expected a changed file, although the native guard correctly refused it. Revalidation read the original logs and artifacts and made no new model requests. The blocked write is not claimed as an executed write.

## Evidence boundaries

A delivery receipt proves Session admission, not obedience or general instruction compliance. The read-only facts do not grant permissions; explicit access/tool restrictions and preconditions still apply. Unknown tools, shell commands and PTC remain unknown effects. Deterministic tests cover unadmitted notices, duplicate events and receipt persistence failure without resending. This report covers source and isolated package acceptance; production Desktop installation and settings preservation are checked separately. Raw records, credentials, local account state and personal sessions are excluded from Git.
