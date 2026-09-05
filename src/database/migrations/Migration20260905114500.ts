import { Migration } from '@mikro-orm/migrations';

export class Migration20260905114500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "wager_transactions" add column "failure_code" varchar(64) null;',
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "wager_transactions" drop column if exists "failure_code";',
    );
  }
}
