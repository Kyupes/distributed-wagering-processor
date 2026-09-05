import { Migration } from '@mikro-orm/migrations';

export class Migration20260905131500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create function "prevent_wallet_ledger_mutation"() returns trigger as $$
      begin
        raise exception 'wallet ledger entries are immutable' using errcode = '55000';
      end;
    $$ language plpgsql;`);
    this.addSql(`create trigger "wallet_ledger_entries_immutable"
      before update or delete on "wallet_ledger_entries"
      for each row execute function "prevent_wallet_ledger_mutation"();`);
  }

  override async down(): Promise<void> {
    this.addSql(
      'drop trigger if exists "wallet_ledger_entries_immutable" on "wallet_ledger_entries";',
    );
    this.addSql('drop function if exists "prevent_wallet_ledger_mutation"();');
  }
}
