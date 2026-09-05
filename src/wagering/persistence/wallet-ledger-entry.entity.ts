import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallet_ledger_entries' })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ fieldName: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @Property({ fieldName: 'transaction_id', type: 'uuid' })
  transactionId!: string;

  @Property({ type: 'string', length: 6 })
  direction!: 'DEBIT';

  @Property({ type: 'string', columnType: 'numeric(20,2)' })
  amount!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'string', fieldName: 'balance_before', columnType: 'numeric(20,2)' })
  balanceBefore!: string;

  @Property({ type: 'string', fieldName: 'balance_after', columnType: 'numeric(20,2)' })
  balanceAfter!: string;

  @Property({ type: 'Date', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt!: Date;
}
