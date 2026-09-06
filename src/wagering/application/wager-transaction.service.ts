import { createHash, randomUUID } from 'node:crypto';
import { EntityManager, LockMode, MikroORM } from '@mikro-orm/postgresql';
import { Injectable, Optional } from '@nestjs/common';
import { InsufficientFundsError } from '../domain/insufficient-funds.error.js';
import { InvalidMoneyError, Money, MoneyProps } from '../domain/money.js';
import { Wallet } from '../domain/wallet.js';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../domain/wallet-ledger-entry.js';
import { OutboxMessageEntity } from '../persistence/outbox-message.entity.js';
import { WalletLedgerEntryEntity } from '../persistence/wallet-ledger-entry.entity.js';
import {
  PublicWagerTransactionKind,
  WagerTransactionEntity,
  WagerTransactionStatus,
} from '../persistence/wager-transaction.entity.js';
import { WalletEntity } from '../persistence/wallet.entity.js';

export const REFERENCE_RETRY_BASE_MS = 5_000;
export const REFERENCE_RETRY_MAX_ATTEMPTS = 8;
export const REFERENCE_RETRY_TTL_MS = 24 * 60 * 60 * 1_000;

export type WagerFailureCode =
  | 'INSUFFICIENT_FUNDS'
  | 'REFERENCE_OWNERSHIP_MISMATCH'
  | 'INVALID_REFERENCE_TYPE'
  | 'REFERENCE_AMOUNT_MISMATCH'
  | 'REFERENCE_ALREADY_REVERSED'
  | 'REVERSAL_WOULD_OVERDRAW'
  | 'REFERENCE_NOT_FOUND';

export interface ProcessWagerTransactionCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: PublicWagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export type ProcessBetCommand = Omit<ProcessWagerTransactionCommand, 'kind'> & {
  kind?: 'BET';
};

export interface ProcessWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
  failureCode: string | null;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  idempotentReplay: boolean;
}

export type ProcessBetResult = ProcessWagerTransactionResult;

export interface TransactionProcessingHooks {
  afterLedgerPersisted?: () => Promise<void>;
}

export type BetTransactionHooks = TransactionProcessingHooks;

export class IdempotencyConflictError extends Error {
  constructor() {
    super(
      'The idempotency key has already been used with a different payload.',
    );
    this.name = 'IdempotencyConflictError';
  }
}

export class InvalidReferenceContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReferenceContractError';
  }
}

export class WalletNotFoundError extends Error {
  constructor() {
    super('The requested wallet does not exist.');
    this.name = 'WalletNotFoundError';
  }
}

export class WalletPlayerMismatchError extends Error {
  constructor() {
    super('The wallet does not belong to the supplied player.');
    this.name = 'WalletPlayerMismatchError';
  }
}

export class WalletCurrencyMismatchError extends Error {
  constructor() {
    super('The transaction currency does not match the wallet currency.');
    this.name = 'WalletCurrencyMismatchError';
  }
}

@Injectable()
export class WagerTransactionService {
  constructor(
    private readonly orm: MikroORM,
    @Optional() private readonly hooks: TransactionProcessingHooks = {},
  ) {}

  async process(
    command: ProcessWagerTransactionCommand | ProcessBetCommand,
  ): Promise<ProcessWagerTransactionResult> {
    const normalizedCommand: ProcessWagerTransactionCommand = {
      ...command,
      kind: command.kind ?? 'BET',
    };
    assertReferenceContract(normalizedCommand);
    const money = Money.from(normalizedCommand.money);
    if (money.isZero()) {
      throw new InvalidMoneyError(
        'Transaction amount must be greater than zero.',
      );
    }
    const payloadHash = hashPayload(normalizedCommand);

    return this.orm.em.fork().transactional(async (em) => {
      const walletRecord = await this.lockWallet(
        em,
        normalizedCommand.walletId,
      );
      const existing = await em.findOne(WagerTransactionEntity, {
        idempotencyKey: normalizedCommand.idempotencyKey,
      });
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new IdempotencyConflictError();
        }
        return mapStoredResult(existing, walletRecord.balance);
      }
      if (walletRecord.playerId !== normalizedCommand.playerId) {
        throw new WalletPlayerMismatchError();
      }
      if (walletRecord.currency !== money.currency) {
        throw new WalletCurrencyMismatchError();
      }

      const transaction = em.create(WagerTransactionEntity, {
        id: randomUUID(),
        providerId: normalizedCommand.providerId,
        externalTransactionId: normalizedCommand.externalTransactionId,
        idempotencyKey: normalizedCommand.idempotencyKey,
        payloadHash,
        walletId: normalizedCommand.walletId,
        playerId: normalizedCommand.playerId,
        roundId: normalizedCommand.roundId,
        gameId: normalizedCommand.gameId,
        amount: money.toString(),
        currency: money.currency,
        kind: normalizedCommand.kind,
        status: WagerTransactionStatus.Pending,
        referenceExternalTransactionId:
          normalizedCommand.referenceExternalTransactionId,
        referenceAttempts: 0,
        createdAt: new Date(),
      });
      em.persist(transaction);
      await em.flush();

      const reference = await this.findReference(em, transaction);
      if (transaction.referenceExternalTransactionId && !reference) {
        return this.persistPendingReference(em, transaction, walletRecord);
      }
      return this.applyTransaction(em, transaction, walletRecord, reference);
    });
  }

  async processDueReferences(now = new Date(), limit = 20): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    let claimed = 0;
    for (let index = 0; index < boundedLimit; index += 1) {
      if (!(await this.processNextDueReference(now))) break;
      claimed += 1;
    }
    return claimed;
  }

  async countLedgerEntries(): Promise<number> {
    return this.orm.em.fork().count(WalletLedgerEntryEntity);
  }

  async countOutboxMessages(): Promise<number> {
    return this.orm.em.fork().count(OutboxMessageEntity);
  }

  private async processNextDueReference(now: Date): Promise<boolean> {
    return this.orm.em.fork().transactional(async (em) => {
      const rows = await em.getConnection().execute<Array<{ id: string }>>(
        `select "id" from "wager_transactions"
         where "status" = 'PENDING_REFERENCE' and "next_reference_attempt_at" <= ?
         order by "next_reference_attempt_at", "created_at", "id"
         for update skip locked limit 1`,
        [now],
      );
      const claimed = rows[0];
      if (!claimed) return false;

      const transaction = await em.findOneOrFail(WagerTransactionEntity, {
        id: claimed.id,
      });
      const wallet = await this.lockWallet(em, transaction.walletId);
      const reference = await this.findReference(em, transaction);
      if (reference) {
        await this.applyTransaction(em, transaction, wallet, reference);
        return true;
      }

      transaction.referenceAttempts += 1;
      const exhausted =
        transaction.referenceAttempts >= REFERENCE_RETRY_MAX_ATTEMPTS ||
        now.getTime() - transaction.createdAt.getTime() >=
          REFERENCE_RETRY_TTL_MS;
      if (exhausted) {
        await this.persistRejected(
          em,
          transaction,
          wallet,
          'REFERENCE_NOT_FOUND',
        );
        return true;
      }
      transaction.nextReferenceAttemptAt = new Date(
        now.getTime() +
          REFERENCE_RETRY_BASE_MS * 2 ** transaction.referenceAttempts,
      );
      await em.flush();
      return true;
    });
  }

  private async lockWallet(
    em: EntityManager,
    walletId: string,
  ): Promise<WalletEntity> {
    const wallet = await em.findOne(
      WalletEntity,
      { id: walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!wallet) throw new WalletNotFoundError();
    return wallet;
  }

  private async findReference(
    em: EntityManager,
    transaction: WagerTransactionEntity,
  ): Promise<WagerTransactionEntity | null> {
    if (!transaction.referenceExternalTransactionId) return null;
    return em.findOne(WagerTransactionEntity, {
      providerId: transaction.providerId,
      externalTransactionId: transaction.referenceExternalTransactionId,
      id: { $ne: transaction.id },
    });
  }

  private async applyTransaction(
    em: EntityManager,
    transaction: WagerTransactionEntity,
    walletRecord: WalletEntity,
    reference: WagerTransactionEntity | null,
  ): Promise<ProcessWagerTransactionResult> {
    if (transaction.kind === 'OPENING') {
      throw new Error('OPENING transactions cannot enter public processing.');
    }
    const transactionKind = transaction.kind;
    const money = Money.from({
      amount: transaction.amount,
      currency: transaction.currency,
    });
    const wallet = Wallet.rehydrate({
      id: walletRecord.id,
      playerId: walletRecord.playerId,
      currency: walletRecord.currency,
      balance: Money.from({
        amount: walletRecord.balance,
        currency: walletRecord.currency,
      }),
      version: walletRecord.version,
    });
    const balanceBefore = wallet.balance;

    if (reference) {
      transaction.referenceTransactionId = reference.id;
      const failureCode = await this.validateReference(
        em,
        transaction,
        reference,
        money,
      );
      if (failureCode) {
        return this.persistRejected(em, transaction, walletRecord, failureCode);
      }
    }

    let direction: LedgerDirection | null;
    try {
      direction = applyOperation(wallet, money, transactionKind, reference);
    } catch (error) {
      if (!(error instanceof InsufficientFundsError)) throw error;
      return this.persistRejected(
        em,
        transaction,
        walletRecord,
        transactionKind === 'ROLLBACK'
          ? 'REVERSAL_WOULD_OVERDRAW'
          : 'INSUFFICIENT_FUNDS',
      );
    }

    transaction.status = WagerTransactionStatus.Processed;
    transaction.balanceAfter = wallet.balance.toString();
    transaction.failureCode = undefined;
    transaction.nextReferenceAttemptAt = undefined;
    transaction.processedAt = new Date();

    if (direction) {
      walletRecord.balance = wallet.balance.toString();
      const ledger = WalletLedgerEntry.create({
        id: randomUUID(),
        walletId: walletRecord.id,
        transactionId: transaction.id,
        direction,
        money,
        balanceBefore,
        balanceAfter: wallet.balance,
        createdAt: new Date(),
      });
      em.persist(
        em.create(WalletLedgerEntryEntity, {
          id: ledger.id,
          walletId: ledger.walletId,
          transactionId: ledger.transactionId,
          direction: ledger.direction,
          amount: ledger.money.toString(),
          currency: ledger.money.currency,
          balanceBefore: ledger.balanceBefore.toString(),
          balanceAfter: ledger.balanceAfter.toString(),
          createdAt: ledger.createdAt,
        }),
      );
      await this.hooks.afterLedgerPersisted?.();
    }

    em.persist(
      createOutboxMessage(em, {
        aggregateId: walletRecord.id,
        transactionId: transaction.id,
        eventType: 'WagerTransactionProcessed',
        payload: {
          transactionId: transaction.id,
          walletId: walletRecord.id,
          kind: transaction.kind,
          status: WagerTransactionStatus.Processed,
          referenceTransactionId: transaction.referenceTransactionId ?? null,
        },
      }),
    );
    if (direction) {
      em.persist(
        createOutboxMessage(em, {
          aggregateId: walletRecord.id,
          transactionId: transaction.id,
          eventType: 'WalletBalanceChanged',
          payload: {
            walletId: walletRecord.id,
            transactionId: transaction.id,
            direction,
            money: money.toJSON(),
            balanceBefore: balanceBefore.toJSON(),
            balanceAfter: wallet.balance.toJSON(),
          },
        }),
      );
    }
    await em.flush();
    return mapStoredResult(transaction, wallet.balance.toString(), false);
  }

  private async validateReference(
    em: EntityManager,
    transaction: WagerTransactionEntity,
    reference: WagerTransactionEntity,
    money: Money,
  ): Promise<WagerFailureCode | null> {
    if (transaction.kind === 'OPENING') return 'INVALID_REFERENCE_TYPE';
    if (
      reference.providerId !== transaction.providerId ||
      reference.playerId !== transaction.playerId ||
      reference.walletId !== transaction.walletId ||
      reference.currency !== transaction.currency ||
      reference.roundId !== transaction.roundId
    )
      return 'REFERENCE_OWNERSHIP_MISMATCH';
    if (
      reference.status !== WagerTransactionStatus.Processed ||
      !isAllowedReferenceType(transaction.kind, reference.kind)
    )
      return 'INVALID_REFERENCE_TYPE';
    const referenceMoney = Money.from({
      amount: reference.amount,
      currency: reference.currency,
    });
    if (!money.equals(referenceMoney)) return 'REFERENCE_AMOUNT_MISMATCH';
    if (transaction.kind === 'REFUND' || transaction.kind === 'ROLLBACK') {
      const prior = await em.findOne(WagerTransactionEntity, {
        referenceTransactionId: reference.id,
        kind: transaction.kind,
        status: WagerTransactionStatus.Processed,
        id: { $ne: transaction.id },
      });
      if (prior) return 'REFERENCE_ALREADY_REVERSED';
    }
    return null;
  }

  private async persistPendingReference(
    em: EntityManager,
    transaction: WagerTransactionEntity,
    wallet: WalletEntity,
  ): Promise<ProcessWagerTransactionResult> {
    transaction.status = WagerTransactionStatus.PendingReference;
    transaction.balanceAfter = wallet.balance;
    transaction.nextReferenceAttemptAt = new Date(
      Date.now() + REFERENCE_RETRY_BASE_MS,
    );
    em.persist(
      createOutboxMessage(em, {
        aggregateId: wallet.id,
        transactionId: transaction.id,
        eventType: 'WagerTransactionPendingReference',
        payload: {
          transactionId: transaction.id,
          walletId: wallet.id,
          kind: transaction.kind,
          referenceExternalTransactionId:
            transaction.referenceExternalTransactionId,
          status: WagerTransactionStatus.PendingReference,
        },
      }),
    );
    await em.flush();
    return mapStoredResult(transaction, wallet.balance, false);
  }

  private async persistRejected(
    em: EntityManager,
    transaction: WagerTransactionEntity,
    wallet: WalletEntity,
    failureCode: WagerFailureCode,
  ): Promise<ProcessWagerTransactionResult> {
    transaction.status = WagerTransactionStatus.Rejected;
    transaction.balanceAfter = wallet.balance;
    transaction.failureCode = failureCode;
    transaction.nextReferenceAttemptAt = undefined;
    transaction.processedAt = new Date();
    em.persist(
      createOutboxMessage(em, {
        aggregateId: wallet.id,
        transactionId: transaction.id,
        eventType: 'WagerTransactionRejected',
        payload: {
          transactionId: transaction.id,
          walletId: wallet.id,
          kind: transaction.kind,
          reason: failureCode,
          status: WagerTransactionStatus.Rejected,
          referenceTransactionId: transaction.referenceTransactionId ?? null,
        },
      }),
    );
    await em.flush();
    return mapStoredResult(transaction, wallet.balance, false);
  }
}

function assertReferenceContract(
  command: ProcessWagerTransactionCommand,
): void {
  const hasReference = command.referenceExternalTransactionId !== undefined;
  if (
    (command.kind === 'REFUND' || command.kind === 'ROLLBACK') &&
    !hasReference
  ) {
    throw new InvalidReferenceContractError(
      `${command.kind} requires referenceExternalTransactionId.`,
    );
  }
  if ((command.kind === 'BET' || command.kind === 'LOSS') && hasReference) {
    throw new InvalidReferenceContractError(
      `${command.kind} does not accept referenceExternalTransactionId.`,
    );
  }
}

function isAllowedReferenceType(
  kind: PublicWagerTransactionKind,
  referenceKind: WagerTransactionEntity['kind'],
): boolean {
  switch (kind) {
    case 'WIN':
    case 'REFUND':
      return referenceKind === 'BET';
    case 'ROLLBACK':
      return (
        referenceKind === 'BET' ||
        referenceKind === 'WIN' ||
        referenceKind === 'REFUND'
      );
    case 'BET':
    case 'LOSS':
      return false;
  }
}

function applyOperation(
  wallet: Wallet,
  money: Money,
  kind: PublicWagerTransactionKind,
  reference: WagerTransactionEntity | null,
): LedgerDirection | null {
  switch (kind) {
    case 'BET':
      wallet.debit(money);
      return 'DEBIT';
    case 'WIN':
    case 'REFUND':
      wallet.credit(money);
      return 'CREDIT';
    case 'LOSS':
      return null;
    case 'ROLLBACK':
      if (!reference)
        throw new Error('A rollback cannot be applied without its reference.');
      if (reference.kind === 'BET') {
        wallet.credit(money);
        return 'CREDIT';
      }
      wallet.debit(money);
      return 'DEBIT';
  }
}

function createOutboxMessage(
  em: EntityManager,
  values: {
    aggregateId: string;
    transactionId: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): OutboxMessageEntity {
  const now = new Date();
  return em.create(OutboxMessageEntity, {
    id: randomUUID(),
    ...values,
    occurredAt: now,
    createdAt: now,
  });
}

function mapStoredResult(
  transaction: WagerTransactionEntity,
  currentWalletBalance: string,
  idempotentReplay = true,
): ProcessWagerTransactionResult {
  return {
    transactionId: transaction.id,
    status: transaction.status,
    balance: {
      amount: transaction.balanceAfter ?? currentWalletBalance,
      currency: transaction.currency,
    },
    failureCode: transaction.failureCode ?? null,
    referenceExternalTransactionId:
      transaction.referenceExternalTransactionId ?? null,
    referenceTransactionId: transaction.referenceTransactionId ?? null,
    idempotentReplay,
  };
}

function hashPayload(command: ProcessWagerTransactionCommand): string {
  const canonicalPayload = JSON.stringify({
    externalTransactionId: command.externalTransactionId,
    gameId: command.gameId,
    kind: command.kind,
    money: { amount: command.money.amount, currency: command.money.currency },
    playerId: command.playerId,
    providerId: command.providerId,
    ...(command.referenceExternalTransactionId === undefined
      ? {}
      : {
          referenceExternalTransactionId:
            command.referenceExternalTransactionId,
        }),
    roundId: command.roundId,
    walletId: command.walletId,
  });
  return createHash('sha256').update(canonicalPayload).digest('hex');
}

export { WagerTransactionService as BetTransactionService };
