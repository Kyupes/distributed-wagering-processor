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
ID. The public wagering endpoint never accepts a transaction kind; it always
executes the BET use case, so callers cannot submit `OPENING` operations.

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

## Validation responsibility

`Money` rejects malformed, negative, or non-uppercase currency input before any
transaction starts. `Wallet` owns balance and version behavior. The database owns
cross-process invariants such as uniqueness, non-negative persisted balances,
ledger arithmetic, transaction shape, foreign keys, and ledger immutability.
The HTTP controller only translates invalid money to 400 and duplicate wallets
to 409.

## Intentionally outside the current slice

`WIN`, `LOSS`, `REFUND`, `ROLLBACK`, SQS, inbox processing, outbox publishing,
wallet queries, authentication, and readiness checks are not implemented yet.
