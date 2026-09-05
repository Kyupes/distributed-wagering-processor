import { createHash, randomUUID } from 'node:crypto';
import { LockMode, MikroORM } from '@mikro-orm/postgresql';
import { Injectable, Optional } from '@nestjs/common';
import { InsufficientFundsError } from '../domain/insufficient-funds.error.js';
import { Money, MoneyProps } from '../domain/money.js';
import { Wallet } from '../domain/wallet.js';
import { WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';
import { OutboxMessageEntity } from '../persistence/outbox-message.entity.js';
import { WalletLedgerEntryEntity } from '../persistence/wallet-ledger-entry.entity.js';
import {
  WagerTransactionEntity,
  WagerTransactionStatus,
} from '../persistence/wager-transaction.entity.js';
import { WalletEntity } from '../persistence/wallet.entity.js';

export interface ProcessBetCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  money: MoneyProps;
}

export interface ProcessBetResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
  idempotentReplay: boolean;
}

export interface BetTransactionHooks {
  afterLedgerPersisted?: () => Promise<void>;
}

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

@Injectable()
export class BetTransactionService {
  constructor(
    private readonly orm: MikroORM,
    @Optional()
    private readonly hooks: BetTransactionHooks = {},
  ) {}

  async process(command: ProcessBetCommand): Promise<ProcessBetResult> {
    const money = Money.from(command.money);
    const payloadHash = hashPayload(command);

    return this.orm.em.fork().transactional(async (em) => {
      const walletRecord = await em.findOne(
        WalletEntity,
        { id: command.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!walletRecord) {
        throw new WalletNotFoundError();
      }
      const existing = await em.findOne(WagerTransactionEntity, {
        idempotencyKey: command.idempotencyKey,
      });

      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new IdempotencyConflictError();
        }

        return {
          transactionId: existing.id,
          status: existing.status,
          balance: {
            amount: existing.balanceAfter ?? walletRecord.balance,
            currency: existing.currency,
          },
          idempotentReplay: true,
        };
      }

      if (walletRecord.playerId !== command.playerId) {
        throw new WalletPlayerMismatchError();
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
        providerId: command.providerId,
        externalTransactionId: command.externalTransactionId,
        idempotencyKey: command.idempotencyKey,
        payloadHash,
        walletId: command.walletId,
        playerId: command.playerId,
        roundId: command.roundId,
        gameId: command.gameId,
        amount: money.toString(),
        currency: money.currency,
        kind: 'BET',
        status: WagerTransactionStatus.Pending,
        createdAt: new Date(),
      });
      em.persist(transaction);
      // The ledger and outbox tables reference this transaction at the database
      // level, so flush it first while still inside the enclosing SQL transaction.
      await em.flush();

      try {
        wallet.debit(money);
      } catch (error) {
        if (!(error instanceof InsufficientFundsError)) {
          throw error;
        }
        transaction.status = WagerTransactionStatus.Rejected;
        transaction.balanceAfter = balanceBefore.toString();
        transaction.failureCode = 'INSUFFICIENT_FUNDS';
        em.persist(
          em.create(OutboxMessageEntity, {
            id: randomUUID(),
            aggregateId: walletRecord.id,
            transactionId: transaction.id,
            eventType: 'WagerTransactionRejected',
            payload: {
              transactionId: transaction.id,
              walletId: walletRecord.id,
              reason: 'INSUFFICIENT_FUNDS',
              status: WagerTransactionStatus.Rejected,
            },
            occurredAt: new Date(),
            createdAt: new Date(),
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

      walletRecord.balance = wallet.balance.toString();
      transaction.status = WagerTransactionStatus.Processed;
      transaction.balanceAfter = wallet.balance.toString();
      transaction.processedAt = new Date();

      const ledger = WalletLedgerEntry.create({
        id: randomUUID(),
        walletId: walletRecord.id,
        transactionId: transaction.id,
        direction: 'DEBIT',
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
      em.persist(
        em.create(OutboxMessageEntity, {
          id: randomUUID(),
          aggregateId: walletRecord.id,
          transactionId: transaction.id,
          eventType: 'WagerTransactionProcessed',
          payload: {
            transactionId: transaction.id,
            walletId: walletRecord.id,
            status: WagerTransactionStatus.Processed,
          },
          occurredAt: new Date(),
          createdAt: new Date(),
        }),
      );
      em.persist(
        em.create(OutboxMessageEntity, {
          id: randomUUID(),
          aggregateId: walletRecord.id,
          transactionId: transaction.id,
          eventType: 'WalletBalanceChanged',
          payload: {
            walletId: walletRecord.id,
            transactionId: transaction.id,
            direction: 'DEBIT',
            money: money.toJSON(),
            balanceBefore: balanceBefore.toJSON(),
            balanceAfter: wallet.balance.toJSON(),
          },
          occurredAt: new Date(),
          createdAt: new Date(),
        }),
      );
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
}

function hashPayload(command: ProcessBetCommand): string {
  const canonicalPayload = JSON.stringify({
    externalTransactionId: command.externalTransactionId,
    gameId: command.gameId,
    kind: 'BET',
    money: command.money,
    playerId: command.playerId,
    providerId: command.providerId,
    roundId: command.roundId,
    walletId: command.walletId,
  });
  return createHash('sha256').update(canonicalPayload).digest('hex');
}
