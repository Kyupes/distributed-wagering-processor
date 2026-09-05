# Architecture decision log

## Scope

The implemented vertical slices are wallet creation and `BET`. SQS consumption,
inbox handling, outbox publishing, and the other wagering transaction kinds are
still deferred.

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

## Intentionally outside the current slice

`WIN`, `LOSS`, `REFUND`, `ROLLBACK`, SQS, inbox processing, outbox publishing,
wallet and transaction queries, authentication, and readiness checks are not
implemented yet. `OPENING` remains internal, and unsupported public transaction
kinds are rejected before the BET service is called.
