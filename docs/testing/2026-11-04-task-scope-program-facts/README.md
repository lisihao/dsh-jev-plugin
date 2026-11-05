# Current-turn constraints and requested program facts

Test date: 2026-11-04, America/Toronto; durable timestamps use UTC.

## Scope and source

This maintenance change starts at `6f6626a9f1460937f99a848345ea2b0a93776159` on the owner fork's `codex/macbook-rc2-base`. It retains the installed DSH `0.2.1-rc.2` baseline, advisory behavior, feature defaults and existing model configuration. It does not patch the official App or change the completion-check trigger.

Direct user requirements now come from the native events after the latest `turn/end`, plus pending current-turn input. Same-turn corrections remain available; ended requests expire. Host instruction-form messages and workspace instructions retain their separate persistent authority. A new turn saying only “continue” does not implicitly import old user requirements.

A bounded Acorn 8.15.0 pass extracts statically requested filesystem API calls and literal paths. These are syntax facts, not execution receipts, branch-execution proof, or proof that the whole program is read-only. Obvious alias shadowing, reassignment, computed-property mutation and known reflective mutation invalidate the alias. Unknown imports, opaque/indirect calls, dynamic paths and unsupported syntax remain unknown. The original code is never executed by this analyzer. Each original is judged independently; an unknown source does not discard a supported conflict elsewhere. Partial no-conflict receipts explicitly retain the unresolved-source count.

## Offline and official-package evidence

- Type checking passed.
- Full suite passed: 33 files / 442 tests. After a targeted review identified computed-property alias mutation, affected suites were repeated: 4 files / 50 tests passed. Other unchanged feature tests retain their passing full-suite evidence.
- The old installed package failed a three-turn official-CLI fixture: two ended one-shot restrictions were still present in the next task's judgment input.
- The final formal package passed the same keyless current-turn fixture, plus all seven controlled program fixtures through the real official PTC runtime. The main model was scripted and the local judge replies were deterministic.
- Final official rc.2 package matrix passed Host checks and real Chromium Web checks: client bootstrap, settings and records visible; zero page, console or import errors.
- Partial-source tests keep valid conflicts while retaining unknown answers; entirely undetermined input remains unadopted. Native read/write behavior, receipt admission, deduplication and persistence-failure tests remain covered.

Live-case tarball SHA-256: `bafc54767782a80d5e6e2752e67d9bdf76a51760d30f55dbd1aa74e52b391270`.

Final delivery tarball SHA-256: `ae6609cef4a9e12c2d8b172a34f719335dcf66d9f2239e6248a63b8a17f097ee`. The delivery tarball adds the Acorn attribution notice; its runtime is unchanged from the live-case artifact and its official-package Host/Web matrix passed again.

## Live Luna results and retained failure

The user authorized at most eight additional OpenAI Luna judgments, no DeepSeek calls, synthetic data only, no automatic retries. Seven disposable tasks used the real official CLI/PTC runtime; the main model was scripted. Six tasks made one Luna request each; the business-tool wrapper and its child made two.

| Synthetic case | Observed result |
| --- | --- |
| New task after two ended state_sync-only requests; direct fs read | No conflict; both old requests absent from input |
| Inspection objective with opaque process execution | No conflict; unknown effects did not make the unrelated objective undetermined |
| No-edit rule with requested fs read | No conflict; input file unchanged |
| No-edit rule with requested fs write | Conflict; disposable file actually changed; one admitted notice and receipt |
| Explicit no-read rule with requested fs read | Conflict; one admitted notice and receipt |
| Explicit ban on run_code itself | Conflict; one admitted notice and receipt |
| Only a named business tool, called through run_code | Child tool: no conflict. Parent wrapper: undetermined. No conflict notice was emitted. This control did not fully pass and is retained as a limitation. |

Total: **8 Luna requests, 0 main-model service requests**, all provider replies settled with HTTP 200. Seven judgments were usable; one remained undetermined. This is not an accuracy or productivity estimate. The budget was not extended and the unresolved control was not replayed. Original results, including the failed control, were preserved; no oracle correction changed it into a pass. The temporary real-credential file was removed and the test gateway closed.

The unresolved wrapper result shows that the classifier can still abstain even when a human can relate an SDK call to an allowed tool name. This change reduces blanket uncertainty and excludes expired tasks; it does not establish universal program understanding. Real-task rates and sustained benefits remain unmeasured for this new build. Raw historical user sessions and account data were not transmitted in these synthetic trials or committed to Git.

## Installation boundary

The final source and generated runtime are delivered together. MacBook installed-App acceptance is recorded separately after installing the fixed owner-fork commit. Preserve the user's enabled `instruction-guidance` and `completion-check` switches and the remaining feature states; do not stop Tailscale.
