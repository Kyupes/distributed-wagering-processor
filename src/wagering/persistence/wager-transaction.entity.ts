import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { OptionalProps } from '@mikro-orm/core';

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
}

export type PublicWagerTransactionKind =
  'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';
export type WagerTransactionKind = PublicWagerTransactionKind | 'OPENING';

@Entity({ tableName: 'wager_transactions' })
export class WagerTransactionEntity {
  [OptionalProps]?: 'referenceAttempts';

  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'string', fieldName: 'provider_id' })
  providerId!: string;

  @Property({ type: 'string', fieldName: 'external_transaction_id' })
  externalTransactionId!: string;

  @Property({ type: 'string', fieldName: 'idempotency_key' })
  idempotencyKey!: string;

  @Property({ type: 'string', fieldName: 'payload_hash', length: 64 })
  payloadHash!: string;

  @Property({ fieldName: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @Property({ type: 'string', fieldName: 'player_id' })
  playerId!: string;

  @Property({ type: 'string', fieldName: 'round_id' })
  roundId!: string;

  @Property({ type: 'string', fieldName: 'game_id' })
  gameId!: string;

  @Property({ type: 'string', columnType: 'numeric(20,2)' })
  amount!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'string', length: 16 })
  kind!: WagerTransactionKind;

  @Property({ type: 'string', length: 32 })
  status!: WagerTransactionStatus;

  @Property({
    type: 'string',
    fieldName: 'reference_external_transaction_id',
    nullable: true,
  })
  referenceExternalTransactionId?: string;

  @Property({
    fieldName: 'reference_transaction_id',
    type: 'uuid',
    nullable: true,
  })
  referenceTransactionId?: string;

  @Property({ type: 'number', fieldName: 'reference_attempts', default: 0 })
  referenceAttempts = 0;

  @Property({
    type: 'Date',
    fieldName: 'next_reference_attempt_at',
    nullable: true,
  })
  nextReferenceAttemptAt?: Date;

  @Property({
    type: 'string',
    fieldName: 'balance_after',
    columnType: 'numeric(20,2)',
    nullable: true,
  })
  balanceAfter?: string;

  @Property({ type: 'string', fieldName: 'failure_code', nullable: true })
  failureCode?: string;

  @Property({ type: 'Date', fieldName: 'processed_at', nullable: true })
  processedAt?: Date;

  @Property({
    type: 'Date',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  createdAt!: Date;
}
