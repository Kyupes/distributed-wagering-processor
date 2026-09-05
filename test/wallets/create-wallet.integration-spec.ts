import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mikroOrmConfig from '../../src/database/mikro-orm.config.js';
import {
  CreateWalletService,
  WalletAlreadyExistsError,
} from '../../src/wallets/application/create-wallet.service.js';
import { Money } from '../../src/wagering/domain/money.js';
import { OutboxMessageEntity } from '../../src/wagering/persistence/outbox-message.entity.js';
import { WalletLedgerEntryEntity } from '../../src/wagering/persistence/wallet-ledger-entry.entity.js';
import { WagerTransactionEntity } from '../../src/wagering/persistence/wager-transaction.entity.js';
import { WalletEntity } from '../../src/wagering/persistence/wallet.entity.js';

describe('Create wallet integration', () => {
  let orm: MikroORM;
  let service: CreateWalletService;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    await orm.migrator.up();
    service = new CreateWalletService(orm);
  });

  beforeEach(async () => {
    const em = orm.em.fork();
    await em.getConnection().execute(
      'truncate table "outbox_messages", "wallet_ledger_entries", "wager_transactions", "wallets";',
    );
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  it('opens a funded wallet with one processed OPENING transaction and balanced credit ledger entry', async () => {
    const result = await service.create({
      playerId: 'player-opening-1',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    expect(result).toMatchObject({
      playerId: 'player-opening-1',
      balance: { amount: '100.00', currency: 'BRL' },
      version: 1,
    });
    const em = orm.em.fork();
    const transaction = await em.findOneOrFail(WagerTransactionEntity, {
      walletId: result.id,
    });
    expect(transaction).toMatchObject({
      kind: 'OPENING',
      status: 'PROCESSED',
      amount: '100.00',
      currency: 'BRL',
    });
    const ledger = await em.find(WalletLedgerEntryEntity, {
      walletId: result.id,
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      transactionId: transaction.id,
      direction: 'CREDIT',
      amount: '100.00',
      balanceBefore: '0.00',
      balanceAfter: '100.00',
    });
    const reconstructed = ledger.reduce((balance, entry) => {
      const amount = Money.from({ amount: entry.amount, currency: entry.currency });
      return entry.direction === 'CREDIT'
        ? balance.add(amount)
        : balance.subtract(amount);
    }, Money.zero(result.balance.currency));
    expect(reconstructed.toJSON()).toEqual(result.balance);
    expect(await em.count(OutboxMessageEntity, { transactionId: transaction.id })).toBe(
      2,
    );
  });

  it('opens a zero-balance wallet without an OPENING transaction or financial records', async () => {
    const result = await service.create({
      playerId: 'player-opening-zero',
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });

    expect(result).toMatchObject({
      playerId: 'player-opening-zero',
      balance: { amount: '0.00', currency: 'BRL' },
      version: 1,
    });
    expect(await orm.em.fork().count(WagerTransactionEntity)).toBe(0);
    expect(await orm.em.fork().count(WalletLedgerEntryEntity)).toBe(0);
    expect(await orm.em.fork().count(OutboxMessageEntity)).toBe(0);
  });

  it('rejects a duplicate player and currency without adding financial records', async () => {
    const existing = await service.create({
      playerId: 'player-duplicate',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    await expect(
      service.create({
        playerId: 'player-duplicate',
        initialBalance: { amount: '50.00', currency: 'BRL' },
      }),
    ).rejects.toThrow(WalletAlreadyExistsError);

    const em = orm.em.fork();
    const wallets = await em.find(WalletEntity, {
      playerId: 'player-duplicate',
      currency: 'BRL',
    });
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({ id: existing.id, balance: '100.00' });
    expect(await em.count(WagerTransactionEntity)).toBe(1);
    expect(await em.count(WalletLedgerEntryEntity)).toBe(1);
    expect(await em.count(OutboxMessageEntity)).toBe(2);
  });

  it('rolls back every opening record when a later step fails', async () => {
    class FailingCreateWalletService extends CreateWalletService {
      protected override async afterLedgerPersisted(): Promise<void> {
        throw new Error('simulated outbox failure');
      }
    }

    const failingService = new FailingCreateWalletService(orm);

    await expect(
      failingService.create({
        playerId: 'player-opening-rollback',
        initialBalance: { amount: '100.00', currency: 'BRL' },
      }),
    ).rejects.toThrow('simulated outbox failure');

    const em = orm.em.fork();
    expect(await em.count(WalletEntity)).toBe(0);
    expect(await em.count(WagerTransactionEntity)).toBe(0);
    expect(await em.count(WalletLedgerEntryEntity)).toBe(0);
    expect(await em.count(OutboxMessageEntity)).toBe(0);
  });

  it('prevents committed ledger entries from being updated or deleted', async () => {
    const wallet = await service.create({
      playerId: 'player-immutable-ledger',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });
    const em = orm.em.fork();
    const entry = await em.findOneOrFail(WalletLedgerEntryEntity, {
      walletId: wallet.id,
    });

    await expect(
      em.nativeUpdate(WalletLedgerEntryEntity, entry.id, {
        createdAt: new Date(entry.createdAt.getTime() + 1_000),
      }),
    ).rejects.toThrow();
    await expect(
      em.nativeDelete(WalletLedgerEntryEntity, entry.id),
    ).rejects.toThrow();
  });

  it('allows only processed internal OPENING transactions at the database boundary', async () => {
    const wallet = await service.create({
      playerId: 'player-invalid-opening-state',
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });
    const em = orm.em.fork();
    em.persist(
      em.create(WagerTransactionEntity, {
        id: '00000000-0000-4000-8000-000000000101',
        providerId: '__internal__',
        externalTransactionId: `opening:${wallet.id}`,
        idempotencyKey: `opening:${wallet.id}`,
        payloadHash: 'a'.repeat(64),
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: '__opening__',
        gameId: '__internal__',
        amount: '10.00',
        currency: 'BRL',
        kind: 'OPENING',
        status: 'PENDING',
        createdAt: new Date(),
      }),
    );

    await expect(em.flush()).rejects.toThrow();
  });

  it('rejects an arithmetically inconsistent CREDIT entry at the database boundary', async () => {
    const wallet = await service.create({
      playerId: 'player-invalid-credit',
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });
    const em = orm.em.fork();
    const transactionId = '00000000-0000-4000-8000-000000000102';
    em.persist(
      em.create(WagerTransactionEntity, {
        id: transactionId,
        providerId: 'provider-test',
        externalTransactionId: 'invalid-credit-transaction',
        idempotencyKey: 'provider-test:invalid-credit-transaction',
        payloadHash: 'b'.repeat(64),
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: 'round-test',
        gameId: 'game-test',
        amount: '10.00',
        currency: 'BRL',
        kind: 'BET',
        status: 'PROCESSED',
        balanceAfter: '0.00',
        processedAt: new Date(),
        createdAt: new Date(),
      }),
    );
    await em.flush();
    em.persist(
      em.create(WalletLedgerEntryEntity, {
        id: '00000000-0000-4000-8000-000000000103',
        walletId: wallet.id,
        transactionId,
        direction: 'CREDIT',
        amount: '10.00',
        currency: 'BRL',
        balanceBefore: '0.00',
        balanceAfter: '9.00',
        createdAt: new Date(),
      }),
    );

    await expect(em.flush()).rejects.toThrow();
  });
});
