import { Migration } from '@mikro-orm/migrations';

export class Migration20260905112000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "wallets" (
      "id" uuid not null,
      "player_id" varchar(255) not null,
      "currency" varchar(3) not null,
      "balance" numeric(20,2) not null,
      "version" integer not null default 1,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      constraint "wallets_pkey" primary key ("id"),
      constraint "wallets_player_currency_unique" unique ("player_id", "currency"),
      constraint "wallets_currency_check" check ("currency" ~ '^[A-Z]{3}$'),
      constraint "wallets_balance_non_negative" check ("balance" >= 0),
      constraint "wallets_version_positive" check ("version" >= 1)
    );`);

    this.addSql(`create table "wager_transactions" (
      "id" uuid not null,
      "provider_id" varchar(255) not null,
      "external_transaction_id" varchar(255) not null,
      "idempotency_key" varchar(255) not null,
      "payload_hash" varchar(64) not null,
      "wallet_id" uuid not null,
      "player_id" varchar(255) not null,
      "round_id" varchar(255) not null,
      "game_id" varchar(255) not null,
      "amount" numeric(20,2) not null,
      "currency" varchar(3) not null,
      "kind" varchar(16) not null,
      "status" varchar(16) not null,
      "balance_after" numeric(20,2) null,
      "processed_at" timestamptz null,
      "created_at" timestamptz not null default now(),
      constraint "wager_transactions_pkey" primary key ("id"),
      constraint "wager_transactions_idempotency_unique" unique ("idempotency_key"),
      constraint "wager_transactions_provider_external_unique" unique ("provider_id", "external_transaction_id"),
      constraint "wager_transactions_wallet_fk" foreign key ("wallet_id") references "wallets" ("id"),
      constraint "wager_transactions_amount_positive" check ("amount" > 0),
      constraint "wager_transactions_currency_check" check ("currency" ~ '^[A-Z]{3}$'),
      constraint "wager_transactions_kind_check" check ("kind" = 'BET'),
      constraint "wager_transactions_status_check" check ("status" in ('PENDING', 'PROCESSED', 'REJECTED'))
    );`);

    this.addSql(`create table "wallet_ledger_entries" (
      "id" uuid not null,
      "wallet_id" uuid not null,
      "transaction_id" uuid not null,
      "direction" varchar(6) not null,
      "amount" numeric(20,2) not null,
      "currency" varchar(3) not null,
      "balance_before" numeric(20,2) not null,
      "balance_after" numeric(20,2) not null,
      "created_at" timestamptz not null default now(),
      constraint "wallet_ledger_entries_pkey" primary key ("id"),
      constraint "wallet_ledger_entries_transaction_unique" unique ("wallet_id", "transaction_id"),
      constraint "wallet_ledger_entries_wallet_fk" foreign key ("wallet_id") references "wallets" ("id"),
      constraint "wallet_ledger_entries_transaction_fk" foreign key ("transaction_id") references "wager_transactions" ("id"),
      constraint "wallet_ledger_entries_amount_positive" check ("amount" > 0),
      constraint "wallet_ledger_entries_balance_non_negative" check ("balance_after" >= 0),
      constraint "wallet_ledger_entries_debit_arithmetic" check ("direction" = 'DEBIT' and "balance_after" = "balance_before" - "amount")
    );`);

    this.addSql(`create table "outbox_messages" (
      "id" uuid not null,
      "aggregate_id" uuid not null,
      "transaction_id" uuid not null,
      "event_type" varchar(255) not null,
      "payload" jsonb not null,
      "occurred_at" timestamptz not null,
      "created_at" timestamptz not null default now(),
      constraint "outbox_messages_pkey" primary key ("id"),
      constraint "outbox_messages_transaction_unique" unique ("transaction_id", "event_type"),
      constraint "outbox_messages_transaction_fk" foreign key ("transaction_id") references "wager_transactions" ("id")
    );`);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "outbox_messages";');
    this.addSql('drop table if exists "wallet_ledger_entries";');
    this.addSql('drop table if exists "wager_transactions";');
    this.addSql('drop table if exists "wallets";');
  }
}
