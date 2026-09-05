import { createHash, randomUUID } from 'node:crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Money, MoneyProps } from '../../wagering/domain/money.js';
import { Wallet } from '../../wagering/domain/wallet.js';
import { WalletLedgerEntry } from '../../wagering/domain/wallet-ledger-entry.js';
import { OutboxMessageEntity } from '../../wagering/persistence/outbox-message.entity.js';
import { WalletLedgerEntryEntity } from '../../wagering/persistence/wallet-ledger-entry.entity.js';
import {
  WagerTransactionEntity,
  WagerTransactionStatus,
} from '../../wagering/persistence/wager-transaction.entity.js';
import { WalletEntity } from '../../wagering/persistence/wallet.entity.js';

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: MoneyProps;
}

export interface CreateWalletResult {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export class WalletAlreadyExistsError extends Error {
  constructor() {
    super('A wallet already exists for this player and currency.');
    this.name = 'WalletAlreadyExistsError';
  }
}

@Injectable()
export class CreateWalletService {
  constructor(private readonly orm: MikroORM) {}

  async create(command: CreateWalletCommand): Promise<CreateWalletResult> {
    const initialBalance = Money.from(command.initialBalance);

    try {
      return await this.orm.em.fork().transactional(async (em) => {
        if (
          await em.findOne(WalletEntity, {
            playerId: command.playerId,
            currency: initialBalance.currency,
          })
        ) {
          throw new WalletAlreadyExistsError();
        }

        const wallet = Wallet.open({
          id: randomUUID(),
          playerId: command.playerId,
          initialBalance,
        });
        const now = new Date();
        const walletRecord = em.create(WalletEntity, {
          id: wallet.id,
          playerId: wallet.playerId,
          balance: wallet.balance.toString(),
          currency: wallet.currency,
          version: wallet.version,
          createdAt: now,
          updatedAt: now,
        });
        em.persist(walletRecord);
        await em.flush();

        if (!initialBalance.isZero()) {
          await this.persistOpeningMovement(em, wallet, initialBalance, now);
        }

        return {
          id: wallet.id,
          playerId: wallet.playerId,
          balance: wallet.balance.toJSON(),
          version: wallet.version,
        };
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new WalletAlreadyExistsError();
      }
      throw error;
    }
  }

  protected async afterLedgerPersisted(): Promise<void> {}

  private async persistOpeningMovement(
    em: EntityManager,
    wallet: Wallet,
    initialBalance: Money,
    now: Date,
  ): Promise<void> {
    const transactionId = randomUUID();
    const internalKey = `opening:${wallet.id}`;
    const transaction = em.create(WagerTransactionEntity, {
      id: transactionId,
      providerId: '__internal__',
      externalTransactionId: internalKey,
      idempotencyKey: internalKey,
      payloadHash: createHash('sha256')
        .update(JSON.stringify({
          playerId: wallet.playerId,
          walletId: wallet.id,
          initialBalance: initialBalance.toJSON(),
        }))
        .digest('hex'),
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: '__opening__',
      gameId: '__internal__',
      amount: initialBalance.toString(),
      currency: initialBalance.currency,
      kind: 'OPENING',
      status: WagerTransactionStatus.Processed,
      balanceAfter: wallet.balance.toString(),
      processedAt: now,
      createdAt: now,
    });
    em.persist(transaction);
    await em.flush();

    const ledger = WalletLedgerEntry.create({
      id: randomUUID(),
      walletId: wallet.id,
      transactionId,
      direction: 'CREDIT',
      money: initialBalance,
      balanceBefore: Money.zero(initialBalance.currency),
      balanceAfter: wallet.balance,
      createdAt: now,
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
    await this.afterLedgerPersisted();

    em.persist([
      em.create(OutboxMessageEntity, {
        id: randomUUID(),
        aggregateId: wallet.id,
        transactionId,
        eventType: 'WagerTransactionProcessed',
        payload: {
          transactionId,
          walletId: wallet.id,
          status: WagerTransactionStatus.Processed,
          kind: 'OPENING',
        },
        occurredAt: now,
        createdAt: now,
      }),
      em.create(OutboxMessageEntity, {
        id: randomUUID(),
        aggregateId: wallet.id,
        transactionId,
        eventType: 'WalletBalanceChanged',
        payload: {
          walletId: wallet.id,
          transactionId,
          direction: 'CREDIT',
          money: initialBalance.toJSON(),
          balanceBefore: Money.zero(initialBalance.currency).toJSON(),
          balanceAfter: wallet.balance.toJSON(),
          walletVersion: wallet.version,
        },
        occurredAt: now,
        createdAt: now,
      }),
    ]);
    await em.flush();
  }
}
