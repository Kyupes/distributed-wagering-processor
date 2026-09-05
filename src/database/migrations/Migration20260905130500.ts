import { Migration } from '@mikro-orm/migrations';

export class Migration20260905130500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "wager_transactions" drop constraint "wager_transactions_kind_check";',
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_kind_check" check ("kind" in ('BET', 'OPENING'));`,
    );
    this.addSql(
      'alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_debit_arithmetic";',
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_arithmetic" check (
        ("direction" = 'DEBIT' and "balance_after" = "balance_before" - "amount") or
        ("direction" = 'CREDIT' and "balance_after" = "balance_before" + "amount")
      );`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_arithmetic";',
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_debit_arithmetic" check ("direction" = 'DEBIT' and "balance_after" = "balance_before" - "amount");`,
    );
    this.addSql(
      'alter table "wager_transactions" drop constraint "wager_transactions_kind_check";',
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_kind_check" check ("kind" = 'BET');`,
    );
  }
}
