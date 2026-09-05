# First BET slice

## Scope

This iteration implements only `BET`. It leaves SQS consumption, inbox handling,
outbox publishing, other transaction kinds, wallet creation endpoints, and
readiness checks for later slices.

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
