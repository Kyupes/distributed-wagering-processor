import { Migration } from '@mikro-orm/migrations';

export class Migration20260905132500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "wager_transactions" drop constraint "wager_transactions_kind_check";',
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_kind_check" check (
        "kind" = 'BET' or (
          "kind" = 'OPENING' and
          "status" = 'PROCESSED' and
          "provider_id" = '__internal__' and
          "round_id" = '__opening__' and
          "game_id" = '__internal__'
        )
      );`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "wager_transactions" drop constraint "wager_transactions_kind_check";',
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_kind_check" check ("kind" in ('BET', 'OPENING'));`,
    );
  }
}
