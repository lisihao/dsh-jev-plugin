# Durable Jev logging latency

This change combines the initial attempt and its first exact protocol request
into one durable operation write. A normal one-packet judgment now uses four
operation writes: creation, prepared attempt/input, network response, and settled
interpretation. It previously used five. Receipts remain separate. Every network
input is durable before dispatch; every response is durable before another
packet or business adoption. Failed writes still prevent dispatch or usable
answers, and cancellation never resumes a request.

The published rc.2 storage domain serializes all writes in a domain, including
different operation IDs. Its JSON backend atomically replaces a record after
syncing the temporary file and then its parent directory. Small-record latency
therefore measures durability and queueing, rather than sequential SSD bandwidth.
A baseline V8 CPU capture was dominated by idle samples; it did not identify
JSON serialization as the principal cost. This is not a disk-health diagnosis.
The earlier production 1.5-second pre-dispatch outlier was not reproduced by the
controlled storage workload, so this change does not establish its exact cause.

Network records are also copied before entering the write queue. Adapter updates
to a pending or received packet cannot silently change the ledger's in-memory
snapshot before the corresponding durable write completes. The persisted version,
record paths, source inputs, raw response, normalized answer and receipts remain
compatible; no history migration or deletion is performed.

## Reproduce

Build the package with `npm run build`, then run:

```sh
node scripts/performance/jev-service-latency.mjs /absolute/path/to/plugin-package
```

The probe uses the actual built public Jev service, the published storage backend,
a disposable profile, a dummy credential and a fixed loopback HTTP response.
It makes no real model requests and reads no user profile, account or session
contents. It validates reloads before deleting only its own scratch directory.
Results must be compared with the same input, runtime, storage medium and
concurrency; provider inference latency and real-task efficacy are not measured.

## Verification

- Regression suite: 34 files, 452 tests passed.
- Type check and generated runtime build passed.
- Exact packed artifact: official DSH 0.2.1-rc.2 Host and Chromium Web checks passed.
- Prepared-packet regressions cover all three protocol shapes, cancellation
  during the durability barrier, immutable queued snapshots and a 201-question
  OpenRouter run. That run keeps response 1 / input 2 / response 2 writes.
- Existing failure tests still require no HTTP after an input-write failure and
  no usable answer after a result-write failure.

Measured package comparisons and installation acceptance are recorded separately
from these source checks. No live-service speed or task-quality improvement is
claimed by deterministic fixtures.

## Measured comparison

Two alternating trials used the same local machine, Node 22.23.2, published
rc.2 peer services, synthetic 7,800-character state, one predicate question,
fixed loopback response and local JSON storage. The baseline runtime bytes came
from the existing installed package and matched source `38a7371`. Both packages
ran as unchanged built runtime copies in disposable public-service harnesses;
the production profile and endpoint were not used. Each cell ran 48 operations
per trial. Values below are the ranges of the two per-trial medians, not pooled
percentiles. No real model calls were made.

| Concurrency | Before operation median | After operation median | Before first dispatch median | After first dispatch median |
| --- | --- | --- | --- | --- |
| 1 | 48.8–50.0 ms | 37.0–37.8 ms | 27.0–28.0 ms | 17.0–18.0 ms |
| 4 | 170.2–173.6 ms | 132.8–141.3 ms | 95.0–99.0 ms | 57.0–64.0 ms |
| 16 | 654.5–705.2 ms | 482.8–538.8 ms | 369.0–400.0 ms | 207.0–234.0 ms |

Each 48-operation cell performed 240 durable operation writes before and 192
after (20% fewer). All 576 records from the four complete probe runs were
reopened and checked for request, raw response text/JSON and normalized answer.
This verifies controlled log retention and local logging latency; it does not
prove survival of every possible power-loss scenario, eliminate all production
outliers or measure OpenAI service latency. The original production outlier
remains a separate observation.
