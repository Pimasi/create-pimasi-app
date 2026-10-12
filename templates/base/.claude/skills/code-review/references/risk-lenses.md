# Review risk lenses

Use these prompts to generate hypotheses. A candidate becomes a finding only
when it passes the evidence gate in
[severity-and-evidence.md](severity-and-evidence.md).

## Core lenses for every review

### Contract and scope

- Trace every acceptance criterion to implementation and evidence.
- Identify requirements implemented only on one path, platform, role, or state.
- Detect unrelated changes, accidental deletions, formatting churn, and hidden
  generated or untracked files.
- Check that names, defaults, constraints, and fallback behaviour came from an
  authoritative requirement rather than invention.

### Correctness and lifecycle

- Trace boundary values, empty input, nullability, precision, overflow, ordering,
  locale, timezone, clock, randomness, and nondeterminism where relevant.
- Model each state transition and invariant before and after partial failure.
- Check error propagation, cleanup, cancellation, timeout, retry, and resource
  ownership on every exit path.
- Distinguish absence, failure, and valid falsy values; challenge permissive
  fallbacks that turn errors into apparently valid behaviour.
- Check repeated execution, idempotency, replay, and recovery after interruption.

### Integration and completeness

- Search all producers and consumers of changed symbols, wire fields, schemas,
  events, configuration keys, cache keys, files, and public signatures.
- Trace data through validation, transformation, persistence, serialization, and
  presentation. Check both read and write paths.
- Check docs, examples, fixtures, generated outputs and generators, migrations,
  deployment sequencing, and rollback expectations.
- Verify deleted or renamed surfaces have no remaining dynamic, string-based, or
  external references.
- Verify comments and docs describe current behaviour and do not merely narrate
  or rationalise an implementation.

### Test integrity

- Confirm a test fails for the pre-change defect or a credible counterfactual.
- Prefer observable behaviour over private implementation details.
- Inspect negative, boundary, permission, and side-effect assertions, not only the
  happy-path status or snapshot.
- Detect mocks that reproduce the implementation, mock both sides of a contract,
  accept any call, or bypass the production boundary under review.
- Detect weakened assertions, broad snapshot replacement, skipped tests, retries
  that hide flakes, and coverage that executes without verifying.
- Confirm the test command actually includes the changed test and uses the same
  environment or artefact that will ship.

## AI-workstream failure modes

- **Fabricated completion:** claimed tests, files, migrations, wiring, or cleanup
  are absent or cannot be reproduced.
- **Hallucinated contract:** an API, option, event, command, environment variable,
  or library feature does not exist in the pinned version.
- **Happy-path bias:** validation, permissions, recovery, cleanup, concurrency, or
  partial failure is missing.
- **Unwired implementation:** new code is dead, registered in the wrong place, or
  shadowed by an existing path.
- **Cargo-cult duplication:** existing helpers or policies are reimplemented with
  subtly different behaviour.
- **Environment assumption:** validation ran against stale processes, host-only
  state, ignored artefacts, local credentials, or a different build than ships.
- **Placeholder residue:** TODO branches, sample values, debug bypasses, temporary
  files, broad casts, or permissive flags remain in production paths.

## Conditional elevated-risk lenses

### Authentication, authorisation, privacy, and security

- Identify the principal, resource, tenant, action, and policy at every entry
  point. Test horizontal and vertical privilege boundaries.
- Verify server-side enforcement; UI hiding and client claims are not controls.
- Trace untrusted data into queries, templates, shells, paths, redirects, URLs,
  parsers, logs, and deserializers.
- Check injection, traversal, SSRF, open redirects, unsafe uploads, mass
  assignment, request smuggling assumptions, and resource exhaustion as relevant.
- Check credential creation, storage, comparison, rotation, expiry, revocation,
  redaction, and accidental exposure in logs, errors, analytics, or client bundles.
- Review CSRF, CORS, cookie flags, token audience/issuer, replay, and signature
  verification at the actual trust boundary.
- Confirm denial paths do not reveal protected existence or data.

### Persistence, schemas, and migrations

- Check constraints, indexes, foreign references, nullability, defaults, and
  uniqueness against every writer and reader.
- Model old, new, missing, malformed, partially migrated, and concurrently written
  records.
- Check backfill cost, batching, resumability, transaction boundaries, rollback,
  and forward/backward compatibility during mixed-version deployment.
- Ensure migration registration and ordering are real, not inferred from a file
  name alone.
- Check lost updates, partial commits, stale snapshots, and data deletion or
  retention consequences.

### Concurrency, queues, caches, and distributed work

- Identify atomicity boundaries and every read-modify-write sequence.
- Check lock scope, ownership, expiry, ordering, reentrancy, and external I/O while
  locked.
- Model duplicate, delayed, reordered, concurrent, and at-least-once delivery.
- Check idempotency keys, retry budgets, poison messages, dead-letter handling,
  lease loss, crash recovery, and reconciliation.
- Verify cache key completeness, invalidation, stampede control, stale reads, and
  consistency assumptions.

### APIs, events, and serialization

- Check request and response validation, optionality, units, casing, enum growth,
  error status, pagination, ordering, and compatibility.
- Model older clients with newer servers and newer clients with older persisted
  data when the deployment permits it.
- Check duplicate event handling, unknown fields, schema evolution, and poison
  payloads.

### Payments, entitlements, and webhooks

- Verify amount units, currency, rounding, limits, refunds, and ledger invariants.
- Treat provider callbacks as hostile until signature, timestamp, environment,
  object identity, and expected state are verified.
- Check replay and duplicate delivery, idempotent fulfilment, partial provider
  failure, and reconciliation.
- Ensure client-supplied prices, roles, balances, and entitlement claims are never
  authoritative.

### Frontend, accessibility, and mobile

- Model loading, empty, error, stale, optimistic, offline, retry, and rapid
  navigation states.
- Check request races, cancellation, stale closures, state reset, cache mutation,
  double submission, and cleanup after unmount.
- Verify keyboard access, focus order/restoration, labels, semantics, contrast,
  reduced motion, screen sizes, and touch targets where behaviour changed.
- Check routing, deep links, browser history, storage, and platform-specific APIs
  across supported web and mobile shells.

### Dependencies and supply chain

- Inspect manifest and lockfile together. Explain important direct and transitive
  changes, source URLs, integrity data, lifecycle scripts, and licence impact.
- Verify usage against the pinned version and its authoritative documentation.
- Check runtime versus development placement, duplicated versions, bundle/server
  compatibility, and whether an existing dependency already provides the need.
- Treat audit or scanner output as a lead; establish reachability and affected
  versions before reporting a vulnerability.

### Configuration, CI, containers, and deployment

- Trace each setting through examples, defaults, validation, build arguments,
  runtime injection, secrets, environment overlays, and consumers.
- Compare development, test, CI, staging, and production paths for silent drift.
- Inspect permissions, untrusted-input interpolation, cache keys, artefact flow,
  health checks, rollout order, rollback, and multi-process startup behaviour.
- Distinguish documentation policy from the commands CI actually runs. Report the
  conflict; do not assume either is silently satisfied.
- Never exercise deploy, publish, destructive migration, or production commands as
  review validation.

### Performance and observability

- Check unbounded input, algorithmic growth, N+1 I/O, large allocations, retained
  listeners, blocking work, missing backpressure, and retry amplification.
- Evaluate performance in the expected cardinality and concurrency range rather
  than a toy fixture.
- Ensure failures remain observable without leaking secrets or personal data.
- Check logs, metrics, traces, and alerts identify the operation and outcome while
  avoiding false-success signals and excessive cardinality.
