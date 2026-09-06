import { createHash, randomUUID } from 'node:crypto';
import { LockMode, MikroORM } from '@mikro-orm/postgresql';
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
}

// Existing internal BET callers can migrate independently. HTTP always supplies
// an explicit kind; only this compatibility type permits the old omission.
export type ProcessBetCommand = Omit<ProcessWagerTransactionCommand, 'kind'> & {
  kind?: 'BET';
};

export interface ProcessWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
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
    @Optional()
    private readonly hooks: TransactionProcessingHooks = {},
  ) {}

  async process(
    command: ProcessWagerTransactionCommand | ProcessBetCommand,
  ): Promise<ProcessWagerTransactionResult> {
    const normalizedCommand: ProcessWagerTransactionCommand = {
      ...command,
      kind: command.kind ?? 'BET',
    };
    const money = Money.from(normalizedCommand.money);
    if (money.isZero()) {
      throw new InvalidMoneyError(
        'Transaction amount must be greater than zero.',
      );
    }
    const payloadHash = hashPayload(normalizedCommand);

    return this.orm.em.fork().transactional(async (em) => {
      const walletRecord = await em.findOne(
        WalletEntity,
        { id: normalizedCommand.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!walletRecord) {
        throw new WalletNotFoundError();
      }

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
        createdAt: new Date(),
      });
      em.persist(transaction);
      await em.flush();

      let direction: LedgerDirection | null;
      try {
        direction = applyOperation(wallet, money, normalizedCommand.kind);
      } catch (error) {
        if (
          normalizedCommand.kind !== 'BET' ||
          !(error instanceof InsufficientFundsError)
        ) {
          throw error;
        }
        return this.persistRejectedBet(
          em,
          transaction,
          walletRecord,
          balanceBefore,
        );
      }

      transaction.status = WagerTransactionStatus.Processed;
      transaction.balanceAfter = wallet.balance.toString();
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
            kind: normalizedCommand.kind,
            status: WagerTransactionStatus.Processed,
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

      return {
        transactionId: transaction.id,
        status: transaction.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    });
  }

  async countLedgerEntries(): Promise<number> {
    return this.orm.em.fork().count(WalletLedgerEntryEntity);
  }

  async countOutboxMessages(): Promise<number> {
    return this.orm.em.fork().count(OutboxMessageEntity);
  }

  private async persistRejectedBet(
    em: ReturnType<MikroORM['em']['fork']>,
    transaction: WagerTransactionEntity,
    wallet: WalletEntity,
    balanceBefore: Money,
  ): Promise<ProcessWagerTransactionResult> {
    transaction.status = WagerTransactionStatus.Rejected;
    transaction.balanceAfter = balanceBefore.toString();
    transaction.failureCode = 'INSUFFICIENT_FUNDS';
    em.persist(
      createOutboxMessage(em, {
        aggregateId: wallet.id,
        transactionId: transaction.id,
        eventType: 'WagerTransactionRejected',
        payload: {
          transactionId: transaction.id,
          walletId: wallet.id,
          kind: 'BET',
          reason: 'INSUFFICIENT_FUNDS',
          status: WagerTransactionStatus.Rejected,
        },
      }),
    );
    await em.flush();
    return {
      transactionId: transaction.id,
      status: transaction.status,
      balance: balanceBefore.toJSON(),
      idempotentReplay: false,
    };
  }
}

function applyOperation(
  wallet: Wallet,
  money: Money,
  kind: PublicWagerTransactionKind,
): LedgerDirection | null {
  switch (kind) {
    case 'BET':
      wallet.debit(money);
      return 'DEBIT';
    case 'WIN':
      wallet.credit(money);
      return 'CREDIT';
    case 'LOSS':
      return null;
  }
}

function createOutboxMessage(
  em: ReturnType<MikroORM['em']['fork']>,
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
): ProcessWagerTransactionResult {
  return {
    transactionId: transaction.id,
    status: transaction.status,
    balance: {
      amount: transaction.balanceAfter ?? currentWalletBalance,
      currency: transaction.currency,
    },
    idempotentReplay: true,
  };
}

function hashPayload(command: ProcessWagerTransactionCommand): string {
  const canonicalPayload = JSON.stringify({
    externalTransactionId: command.externalTransactionId,
    gameId: command.gameId,
    kind: command.kind,
    money: {
      amount: command.money.amount,
      currency: command.money.currency,
    },
    playerId: command.playerId,
    providerId: command.providerId,
    roundId: command.roundId,
    walletId: command.walletId,
  });
  return createHash('sha256').update(canonicalPayload).digest('hex');
}

// Both names are the same injectable class/token, preserving existing callers.
export { WagerTransactionService as BetTransactionService };
