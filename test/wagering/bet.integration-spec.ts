import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../src/database/mikro-orm.config.js';
import { BetTransactionService } from '../../src/wagering/application/bet-transaction.service.js';
import { IdempotencyConflictError } from '../../src/wagering/application/bet-transaction.service.js';
import { WagerTransactionEntity } from '../../src/wagering/persistence/wager-transaction.entity.js';
import { WalletEntity } from '../../src/wagering/persistence/wallet.entity.js';

describe('BET transaction integration', () => {
  let orm: MikroORM;
  let service: BetTransactionService;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    await orm.migrator.up();
    service = new BetTransactionService(orm);
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

  it('processes a bet with its wallet, ledger, transaction, and outbox changes atomically', async () => {
    const em = orm.em.fork();
    const wallet = em.create(WalletEntity, {
      id: '00000000-0000-4000-8000-000000000001',
      playerId: 'player-1',
      balance: '100.00',
      currency: 'BRL',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(wallet);
    await em.flush();

    const result = await service.process({
      providerId: 'provider-a',
      externalTransactionId: 'bet-1',
      idempotencyKey: 'provider-a:bet-1',
      walletId: '00000000-0000-4000-8000-000000000001',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      money: { amount: '30.00', currency: 'BRL' },
    });

    expect(result).toMatchObject({
      status: 'PROCESSED',
      balance: { amount: '70.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(await service.countLedgerEntries()).toBe(1);
    expect(await service.countOutboxMessages()).toBe(2);
  });

  it('rejects a bet with insufficient funds without debiting the wallet', async () => {
    const em = orm.em.fork();
    const wallet = em.create(WalletEntity, {
      id: '00000000-0000-4000-8000-000000000002',
      playerId: 'player-2',
      balance: '100.00',
      currency: 'BRL',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(wallet);
    await em.flush();

    const result = await service.process({
      providerId: 'provider-a',
      externalTransactionId: 'bet-insufficient',
      idempotencyKey: 'provider-a:bet-insufficient',
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: 'round-2',
      gameId: 'game-1',
      money: { amount: '100.01', currency: 'BRL' },
    });

    expect(result).toMatchObject({
      status: 'REJECTED',
      balance: { amount: '100.00', currency: 'BRL' },
    });
    expect(await service.countLedgerEntries()).toBe(0);
    expect(await service.countOutboxMessages()).toBe(1);
    expect(
      (await orm.em.fork().findOneOrFail(WagerTransactionEntity, {
        idempotencyKey: 'provider-a:bet-insufficient',
      })).failureCode,
    ).toBe('INSUFFICIENT_FUNDS');
  });

  it('returns the original result when the same provider transaction is delivered twice', async () => {
    const em = orm.em.fork();
    const wallet = em.create(WalletEntity, {
      id: '00000000-0000-4000-8000-000000000003',
      playerId: 'player-3',
      balance: '100.00',
      currency: 'BRL',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(wallet);
    await em.flush();
    const command = {
      providerId: 'provider-a',
      externalTransactionId: 'bet-duplicate',
      idempotencyKey: 'provider-a:bet-duplicate',
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: 'round-3',
      gameId: 'game-1',
      money: { amount: '30.00', currency: 'BRL' },
    };

    const first = await service.process(command);
    const replay = await service.process(command);

    expect(replay).toEqual({ ...first, idempotentReplay: true });
    expect(await service.countLedgerEntries()).toBe(1);
    expect(await service.countOutboxMessages()).toBe(2);
  });

  it('rejects reuse of an idempotency key with a different BET payload', async () => {
    const em = orm.em.fork();
    const wallet = em.create(WalletEntity, {
      id: '00000000-0000-4000-8000-000000000008',
      playerId: 'player-8',
      balance: '100.00',
      currency: 'BRL',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(wallet);
    await em.flush();
    const command = {
      providerId: 'provider-a',
      externalTransactionId: 'bet-conflict',
      idempotencyKey: 'provider-a:bet-conflict',
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: 'round-8',
      gameId: 'game-1',
      money: { amount: '30.00', currency: 'BRL' },
    };
    await service.process(command);

    await expect(
      service.process({ ...command, money: { amount: '31.00', currency: 'BRL' } }),
    ).rejects.toThrow(IdempotencyConflictError);
    expect(await service.countLedgerEntries()).toBe(1);
    expect(await service.countOutboxMessages()).toBe(2);
  });

  it('rolls back the transaction, wallet, ledger, and outbox when a later step fails', async () => {
    const em = orm.em.fork();
    const wallet = em.create(WalletEntity, {
      id: '00000000-0000-4000-8000-000000000004',
      playerId: 'player-4',
      balance: '100.00',
      currency: 'BRL',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(wallet);
    await em.flush();
    const failingService = new BetTransactionService(orm, {
      afterLedgerPersisted: async () => {
        throw new Error('simulated outbox failure');
      },
    });

    await expect(
      failingService.process({
        providerId: 'provider-a',
        externalTransactionId: 'bet-rollback',
        idempotencyKey: 'provider-a:bet-rollback',
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: 'round-4',
        gameId: 'game-1',
        money: { amount: '30.00', currency: 'BRL' },
      }),
    ).rejects.toThrow('simulated outbox failure');

    const unchangedWallet = await orm.em.fork().findOneOrFail(WalletEntity, wallet.id);
    expect(unchangedWallet.balance).toBe('100.00');
    expect(await service.countLedgerEntries()).toBe(0);
    expect(await service.countOutboxMessages()).toBe(0);
    expect(await orm.em.fork().count(WagerTransactionEntity)).toBe(0);
  });

  it('serializes two concurrent bets for the same wallet so only one can spend the balance', async () => {
    const em = orm.em.fork();
    const wallet = em.create(WalletEntity, {
      id: '00000000-0000-4000-8000-000000000005',
      playerId: 'player-5',
      balance: '100.00',
      currency: 'BRL',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(wallet);
    await em.flush();

    const results = await Promise.all([
      service.process({
        providerId: 'provider-a',
        externalTransactionId: 'bet-concurrent-1',
        idempotencyKey: 'provider-a:bet-concurrent-1',
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: 'round-5',
        gameId: 'game-1',
        money: { amount: '80.00', currency: 'BRL' },
      }),
      service.process({
        providerId: 'provider-a',
        externalTransactionId: 'bet-concurrent-2',
        idempotencyKey: 'provider-a:bet-concurrent-2',
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: 'round-5',
        gameId: 'game-1',
        money: { amount: '80.00', currency: 'BRL' },
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'PROCESSED',
      'REJECTED',
    ]);
    expect((await orm.em.fork().findOneOrFail(WalletEntity, wallet.id)).balance).toBe(
      '20.00',
    );
    expect(await service.countLedgerEntries()).toBe(1);
    expect(await service.countOutboxMessages()).toBe(3);
  });

  it('allows independent wallets to process bets concurrently', async () => {
    const em = orm.em.fork();
    const wallets = [
      em.create(WalletEntity, {
        id: '00000000-0000-4000-8000-000000000006',
        playerId: 'player-6',
        balance: '100.00',
        currency: 'BRL',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      em.create(WalletEntity, {
        id: '00000000-0000-4000-8000-000000000007',
        playerId: 'player-7',
        balance: '100.00',
        currency: 'BRL',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ];
    em.persist(wallets);
    await em.flush();

    const results = await Promise.all(
      wallets.map((wallet, index) =>
        service.process({
          providerId: 'provider-a',
          externalTransactionId: `bet-independent-${index}`,
          idempotencyKey: `provider-a:bet-independent-${index}`,
          walletId: wallet.id,
          playerId: wallet.playerId,
          roundId: `round-independent-${index}`,
          gameId: 'game-1',
          money: { amount: '30.00', currency: 'BRL' },
        }),
      ),
    );

    expect(results.every((result) => result.status === 'PROCESSED')).toBe(true);
    const storedWallets = await orm.em.fork().find(WalletEntity, {
      id: { $in: wallets.map((wallet) => wallet.id) },
    });
    expect(storedWallets.map((wallet) => wallet.balance).sort()).toEqual([
      '70.00',
      '70.00',
    ]);
    expect(await service.countLedgerEntries()).toBe(2);
    expect(await service.countOutboxMessages()).toBe(4);
  });
});
