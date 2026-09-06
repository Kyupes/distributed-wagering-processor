# Architecture decision log

## Scope

The implemented vertical slices are wallet creation, `BET`, and the required
wallet, ledger, and transaction read API. SQS consumption, inbox handling,
outbox publishing, and the other wagering transaction kinds are still deferred.

## Money and domain rules

`Money` stores an integer count of cents with `bigint`; the public and database
representations remain fixed-scale decimal strings. This avoids JavaScript binary
floating-point arithmetic. `Wallet` owns the debit decision and throws when a
debit would make the balance negative.

## Persistence and concurrency

PostgreSQL is the source of truth. The migration uses `numeric(20,2)` for money,
a non-negative wallet-balance check, positive transaction and ledger amount
checks, idempotency/provider uniqueness constraints, foreign keys, and a ledger
arithmetic check.

The BET application service opens one `EntityManager.transactional()` block and
locks its wallet row with `SELECT ... FOR UPDATE`. This serializes operations for
one wallet while allowing different wallet rows to proceed independently. The
database transaction contains the wager transaction, wallet update, ledger
entry, and outbox messages.

## Idempotency and events

The idempotency key and a SHA-256 hash of the business payload are stored with
the wager transaction. An identical retry returns the originally observed
balance; a changed payload raises a conflict. A processed BET stores
`WagerTransactionProcessed` and `WalletBalanceChanged`; an insufficient-funds
BET stores `WagerTransactionRejected`. Publishing is intentionally deferred to a
later worker.

## Wallet opening is an internal financial transaction

A positive initial balance is real money entering a wallet. Representing that
change as an internal `OPENING` transaction gives it the same audit chain as a
BET: transaction, ledger entry, and durable outbox events. The internal row uses
a reserved `__internal__` provider namespace and a key derived from the wallet
ID. The public wagering endpoint requires callers to state `kind: "BET"`. The
DTO accepts that literal value only, so callers cannot submit `OPENING` or imply
that an unimplemented kind is a BET.

PostgreSQL permits only `BET` and `OPENING` at this stage. It also requires an
`OPENING` row to be processed and carry the reserved internal markers. This is
more restrictive than accepting every future enum value before its rules exist.

## Zero-balance interpretation

The challenge says an initial balance “when greater than zero” creates the
internal transaction and credit ledger entry. Therefore a `0.00` wallet is
created at version 1 with no `OPENING`, ledger entry, or outbox event. This avoids
recording a financial movement that did not happen. A later real credit will
increment the version because it changes the balance.

## Ledger consistency and immutability

The domain ledger factory checks both supported equations:

- `CREDIT`: balance before + amount = balance after
- `DEBIT`: balance before - amount = balance after

PostgreSQL repeats this check as a constraint, so imports, scripts, or future code
cannot bypass it. A database trigger rejects every update and delete of a
committed ledger entry. This makes the ledger append-only at the actual source of
truth, not merely by convention in TypeScript.

The materialized wallet balance can be rebuilt by adding CREDIT entries and
subtracting DEBIT entries. Integration tests compare the opening ledger with the
stored wallet balance and exercise the database constraints directly.

## Wallet-creation transaction boundary

The wallet row, processed internal transaction, credit ledger entry, and both
outbox messages are written inside one PostgreSQL transaction. A protected,
no-op seam lets integration tests inject a failure after the ledger is staged;
it does not change production behavior. The rollback test proves that even rows
already flushed inside the transaction disappear together when a later step
fails.

Duplicate protection exists in two layers. The service detects the common case
and returns a clear conflict, while a unique `(player_id, currency)` constraint
settles concurrent races safely.

## HTTP boundary and runtime validation

TypeScript interfaces help the compiler while the application is being built,
but they disappear from the running JavaScript. An interface therefore cannot
inspect JSON received from a client. The HTTP boundary uses DTO **classes** with
`class-validator` decorators and Nest's `ValidationPipe`, giving Nest something
that exists at runtime and can reject bad input before an application service or
database transaction starts.

`configureHttpApplication()` owns the global validation pipe and exception
filter. Both `main.ts` and every end-to-end Nest application call that same
function. This avoids a testing gap where tests pass under different settings
than the real server.

Validation uses an allow-list and rejects unknown properties. This is a strict
contract: misspelled fields and fields a client may hope have an effect do not
silently disappear. Money remains a decimal string with exactly two places and
currency remains a three-letter uppercase code. DTO validation gives fast,
friendly feedback, while the domain repeats financial validation because the
same use cases may later be called by non-HTTP adapters.

The error body always includes `statusCode`, a stable `code`, and a safe
`message`. Validation errors may include field-level `details`; business
rejections include a stable `failureCode`. Internal stack traces and raw
database messages are never returned.

| Situation                                       | HTTP | Code                         | Retry guidance                             |
| ----------------------------------------------- | ---: | ---------------------------- | ------------------------------------------ |
| Invalid fields, types, money, currency, or kind |  400 | `INVALID_PAYLOAD`            | Correct the request first                  |
| Missing or blank header                         |  400 | `INVALID_IDEMPOTENCY_KEY`    | Add a valid key first                      |
| Same key with a different payload               |  409 | `IDEMPOTENCY_CONFLICT`       | Do not retry that key with changed data    |
| Duplicate wallet                                |  409 | `WALLET_ALREADY_EXISTS`      | Treat the existing wallet as authoritative |
| Wallet belongs to another player                |  409 | `WALLET_PLAYER_MISMATCH`     | Correct the identifiers first              |
| Wallet does not exist                           |  404 | `WALLET_NOT_FOUND`           | Retry only after the wallet exists         |
| BET rejected for insufficient funds             |  422 | `BUSINESS_RULE_REJECTED`     | The result is terminal for that key        |
| Connection, deadlock, or lock timeout           |  503 | `INFRASTRUCTURE_UNAVAILABLE` | Retry with the same idempotency key        |
| Unexpected programming failure                  |  500 | `INTERNAL_ERROR`             | Investigate; no internals are exposed      |

A successful new BET and an identical replay both return 201. The replay is
distinguished by `idempotentReplay: true` and returns the original transaction
result. Retrying a successful request with the same key is safe because
PostgreSQL-backed idempotency prevents a second debit. An insufficient-funds
BET is still stored as `REJECTED` with its outbox event, but HTTP uses 422 so a
provider cannot mistake it for a successfully applied debit.

## Validation responsibility beyond HTTP

`Money` rejects malformed, negative, or non-uppercase currency input before any
transaction starts. `Wallet` owns balance and version behavior. The database owns
cross-process invariants such as uniqueness, non-negative persisted balances,
ledger arithmetic, transaction shape, foreign keys, and ledger immutability.
Controllers only pass validated transport data to application services and map
known outcomes to the HTTP vocabulary above.

## Read API and public representations

Read operations live in query services rather than controllers. Controllers
remain responsible for HTTP parameters and error status codes; query services
coordinate PostgreSQL reads and convert persistence records into public response
objects. This prevents a database entity from accidentally becoming an API
contract and makes it possible to change storage details without changing every
client.

Wallet responses contain the wallet ID, player ID, current `Money`, currency,
version, and ISO-8601 creation/update timestamps. Ledger entries expose their
direction, transaction ID, `Money`, before/after balances, and creation time.
Both transaction lookup routes call the same query service and mapper, so lookup
by internal ID and lookup by `(providerId, externalTransactionId)` cannot drift
into different response formats. Transaction responses omit internal values such
as `payloadHash`, while including identifiers, kind, status, money, resulting
balance, failure code, and timestamps. Reference fields are returned as `null`
until reference-based transaction kinds are implemented.

The ledger is ordered newest first by `(created_at DESC, id DESC)`. The UUID is a
deterministic tie-breaker when two entries have the same timestamp. Pages use
keyset pagination: the next query asks for rows strictly older than the final
`(created_at, id)` pair from the current page. Unlike database offsets, inserting
a newer entry cannot shift already-read rows and cause duplicates. PostgreSQL has
a matching `(wallet_id, created_at DESC, id DESC)` index, so the API does not load
the full ledger or repeatedly scan skipped rows.

Clients receive an opaque base64url cursor containing version 2, the wallet ID,
timestamp, and entry ID. Decoding verifies canonical base64url, the exact JSON
shape, an ISO-8601 timestamp, a supported cursor version, UUIDs, and that the
cursor wallet matches the URL wallet. A cursor from wallet A therefore cannot be
used to navigate wallet B's ledger. Invalid or mismatched cursors return `400
INVALID_CURSOR`; versioning lets a future implementation change cursor contents
deliberately rather than silently misreading old cursors. Version 1 cursors
predate wallet binding and are intentionally rejected; clients restart pagination
to receive a wallet-bound version 2 cursor.

The ledger page size defaults to 50 and is capped at 100. Fetching one extra row
determines whether `nextCursor` should be returned without counting or loading
the complete ledger.

Focused PostgreSQL-backed checks currently cover wallet lookup, identical public
transaction representations through both routes, transaction not found, cursor
rejection, and pagination continuation after a newer entry is inserted. Deferred
hardening includes large-ledger performance measurements, randomized multi-page
walks, concurrent inserts with deliberately equal timestamps, every path/query
validation combination, and database-failure checks for each read endpoint.

## Migration execution and Docker startup

Development migration commands use `tsx` and the source configuration exported
from the repository root. The configuration points `pathTs` and the schema
snapshot to `src/database/migrations`, so creating a migration updates versioned
source files without requiring an old `dist` directory.

Production uses the compiled `dist/database/run-migrations.js` entry point. It
loads the compiled configuration and migrations and does not compile TypeScript
inside the running container. This programmatic runner also avoids the MikroORM
CLI's TypeScript-loader selection entirely. The final image installs production
dependencies only, so development-only `tsx` and the migration CLI are absent.

Docker Compose uses the same immutable application image for a one-shot
`migrate` service and the API. The migration service waits for healthy
PostgreSQL. The API waits for healthy PostgreSQL, successful migration
completion, and healthy LocalStack. A migration error gives the one-shot service
a non-zero exit code, so Compose does not start the API against an unknown
schema. Re-running startup on an existing volume is safe because MikroORM records
applied migrations and only executes pending versions.

## Wallet reconciliation

Reconciliation is a read-only diagnostic use case. Its application service loads
one wallet and all immutable ledger entries for that wallet, totals CREDIT and
DEBIT amounts with `Money`, and compares the reconstructed result with the stored
balance. It never changes either side of the comparison; an inconsistency must be
investigated rather than silently hidden by an automatic repair.

`difference.amount` is always an exact, non-negative Money magnitude.
`differenceDirection` makes its meaning explicit: `STORED_GREATER`,
`CALCULATED_GREATER`, or `NONE`. This preserves the existing non-negative Money
representation while still telling monitoring or support tools which side is
higher. The endpoint returns HTTP 200 because it calculates a report rather than
creating a resource.

The current implementation reads the complete target wallet ledger because a
complete calculation is required. Streaming or batched reconciliation for very
large ledgers, scheduled reconciliation, metrics, and alert delivery remain
hardening work.

## Liveness, readiness, and the SQS boundary

Liveness answers only whether the Nest process can serve a request. It performs
no PostgreSQL or SQS calls, so an external dependency outage does not cause an
orchestrator to restart an otherwise healthy process.

Readiness answers whether this instance can safely do required work. PostgreSQL
must execute a small query, and the reusable SQS provider must resolve both the
main FIFO queue and its dead-letter FIFO queue. Checks have short timeouts and
return only `up` or `down`; credentials, endpoints, stack traces, and driver
errors never enter the HTTP response. Any unavailable dependency produces HTTP
503 `NOT_READY`.

LocalStack owns local AWS emulation only. A ready-stage initialization hook
creates `wager-transactions.fifo` and `wager-transactions-dlq.fifo`, then attaches
the DLQ redrive policy with a maximum receive count of five. Region, endpoint,
credentials, queue names, and readiness timeout come from environment variables.
The Nest SQS module exports one client provider so future consumers and outbox
publishers can reuse the same boundary; no message consumption or publication is
implemented in this slice.

## Intentionally outside the current slice

`WIN`, `LOSS`, `REFUND`, `ROLLBACK`, SQS message consumption, inbox processing,
outbox publishing, authentication, scheduled reconciliation, and operational
metrics are not implemented yet. `OPENING` remains internal, and unsupported
public transaction kinds are rejected before the BET service is called. The SQS
client and queues exist only as readiness and future messaging foundations;
consumption and publication remain deferred.
