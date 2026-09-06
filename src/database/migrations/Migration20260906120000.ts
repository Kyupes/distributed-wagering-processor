import { Migration } from '@mikro-orm/migrations';

export class Migration20260906120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "wager_transactions" alter column "status" type varchar(32);',
    );
    this.addSql(
      'alter table "wager_transactions" add column "reference_external_transaction_id" varchar(255) null;',
    );
    this.addSql(
      'alter table "wager_transactions" add column "reference_transaction_id" uuid null;',
    );
    this.addSql(
      'alter table "wager_transactions" add column "reference_attempts" integer not null default 0;',
    );
    this.addSql(
      'alter table "wager_transactions" add column "next_reference_attempt_at" timestamptz null;',
    );
    this.addSql(
      'alter table "wager_transactions" add constraint "wager_transactions_reference_fk" foreign key ("reference_transaction_id") references "wager_transactions" ("id");',
    );

    this.addSql(
      'alter table "wager_transactions" drop constraint "wager_transactions_kind_check";',
    );
    this
      .addSql(`alter table "wager_transactions" add constraint "wager_transactions_kind_check" check (
      "kind" in ('BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK') or (
        "kind" = 'OPENING' and
        "status" = 'PROCESSED' and
        "provider_id" = '__internal__' and
        "round_id" = '__opening__' and
        "game_id" = '__internal__'
      )
    );`);
    this.addSql(
      'alter table "wager_transactions" drop constraint "wager_transactions_status_check";',
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_status_check" check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED'));`,
    );
    this
      .addSql(`alter table "wager_transactions" add constraint "wager_transactions_reference_shape_check" check (
      "reference_attempts" >= 0 and
      ("reference_transaction_id" is null or "reference_transaction_id" <> "id") and
      ("reference_transaction_id" is null or "reference_external_transaction_id" is not null) and
      (("kind" in ('BET', 'LOSS', 'OPENING') and "reference_external_transaction_id" is null and "reference_transaction_id" is null) or
       ("kind" = 'WIN') or
       ("kind" in ('REFUND', 'ROLLBACK') and "reference_external_transaction_id" is not null)) and
      (("status" = 'PENDING_REFERENCE' and "reference_external_transaction_id" is not null and "reference_transaction_id" is null and "next_reference_attempt_at" is not null) or
       ("status" <> 'PENDING_REFERENCE' and "next_reference_attempt_at" is null))
    );`);

    this.addSql(
      `create unique index "wager_transactions_processed_reversal_unique" on "wager_transactions" ("reference_transaction_id", "kind") where "kind" in ('REFUND', 'ROLLBACK') and "status" = 'PROCESSED';`,
    );
    this.addSql(
      `create index "wager_transactions_pending_reference_idx" on "wager_transactions" ("next_reference_attempt_at", "created_at", "id") where "status" = 'PENDING_REFERENCE';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      'drop index if exists "wager_transactions_pending_reference_idx";',
    );
    this.addSql(
      'drop index if exists "wager_transactions_processed_reversal_unique";',
    );
    this.addSql(
      'alter table "wager_transactions" drop constraint "wager_transactions_reference_shape_check";',
    );
    this.addSql(
      'alter table "wager_transactions" drop constraint "wager_transactions_reference_fk";',
    );
    this.addSql(
      'alter table "wager_transactions" drop constraint "wager_transactions_status_check";',
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_status_check" check ("status" in ('PENDING', 'PROCESSED', 'REJECTED'));`,
    );
    this.addSql(
      'alter table "wager_transactions" drop constraint "wager_transactions_kind_check";',
    );
    this
      .addSql(`alter table "wager_transactions" add constraint "wager_transactions_kind_check" check (
      "kind" in ('BET', 'WIN', 'LOSS') or (
        "kind" = 'OPENING' and
        "status" = 'PROCESSED' and
        "provider_id" = '__internal__' and
        "round_id" = '__opening__' and
        "game_id" = '__internal__'
      )
    );`);
    this.addSql(
      'alter table "wager_transactions" drop column "next_reference_attempt_at";',
    );
    this.addSql(
      'alter table "wager_transactions" drop column "reference_attempts";',
    );
    this.addSql(
      'alter table "wager_transactions" drop column "reference_transaction_id";',
    );
    this.addSql(
      'alter table "wager_transactions" drop column "reference_external_transaction_id";',
    );
    this.addSql(
      'alter table "wager_transactions" alter column "status" type varchar(16);',
    );
  }
}
