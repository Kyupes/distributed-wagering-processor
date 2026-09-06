import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../src/database/mikro-orm.config.js';
import { CreateWalletService } from '../../src/wallets/application/create-wallet.service.js';
import { Money } from '../../src/wagering/domain/money.js';
import { WagerTransactionService } from '../../src/wagering/application/wager-transaction.service.js';
import { WalletLedgerEntryEntity } from '../../src/wagering/persistence/wallet-ledger-entry.entity.js';
import { WagerTransactionEntity } from '../../src/wagering/persistence/wager-transaction.entity.js';
import { WalletEntity } from '../../src/wagering/persistence/wallet.entity.js';

describe('Reference-aware wagering transactions (integration)', () => {
  let orm: MikroORM;
  let wallets: CreateWalletService;
  let transactions: WagerTransactionService;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    await orm.migrator.up();
    wallets = new CreateWalletService(orm);
    transactions = new WagerTransactionService(orm);
  });

  beforeEach(async () => {
    await orm.em
      .fork()
      .getConnection()
      .execute(
        'truncate table "outbox_messages", "wallet_ledger_entries", "wager_transactions", "wallets";',
      );
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  async function createWallet(playerId: string, amount = '100.00') {
    return wallets.create({
      playerId,
      initialBalance: { amount, currency: 'BRL' },
    });
  }

  async function process(
    wallet: { id: string; playerId: string },
    kind: 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK',
    externalTransactionId: string,
    amount: string,
    referenceExternalTransactionId?: string,
    overrides: Partial<{
      providerId: string;
      playerId: string;
      walletId: string;
      roundId: string;
    }> = {},
  ) {
    const providerId = overrides.providerId ?? 'provider-reference';
    return transactions.process({
      providerId,
      externalTransactionId,
      idempotencyKey: `${providerId}:${externalTransactionId}`,
      walletId: overrides.walletId ?? wallet.id,
      playerId: overrides.playerId ?? wallet.playerId,
      roundId: overrides.roundId ?? 'round-reference',
      gameId: 'game-reference',
      kind,
      money: { amount, currency: 'BRL' },
      referenceExternalTransactionId,
    });
  }

  it('refunds a processed BET once and preserves idempotent replay', async () => {
    const wallet = await createWallet('refund-player');
    const bet = await process(wallet, 'BET', 'refund-bet', '30.00');
    const refund = await process(
      wallet,
      'REFUND',
      'refund-success',
      '30.00',
      'refund-bet',
    );
    const replay = await process(
      wallet,
      'REFUND',
      'refund-success',
      '30.00',
      'refund-bet',
    );

    expect(refund).toMatchObject({
      status: 'PROCESSED',
      balance: { amount: '100.00', currency: 'BRL' },
      referenceTransactionId: bet.transactionId,
      idempotentReplay: false,
    });
    expect(replay).toEqual({ ...refund, idempotentReplay: true });
    expect(
      await orm.em.fork().findOneOrFail(WalletLedgerEntryEntity, {
        transactionId: refund.transactionId,
      }),
    ).toMatchObject({ direction: 'CREDIT', amount: '30.00' });

    const duplicate = await process(
      wallet,
      'REFUND',
      'refund-duplicate',
      '30.00',
      'refund-bet',
    );
    expect(duplicate).toMatchObject({
      status: 'REJECTED',
      failureCode: 'REFERENCE_ALREADY_REVERSED',
      balance: { amount: '100.00' },
    });
  });

  it('rolls back BET with a credit and WIN with a debit', async () => {
    const wallet = await createWallet('rollback-player');
    const bet = await process(wallet, 'BET', 'rollback-bet', '20.00');
    const rollbackBet = await process(
      wallet,
      'ROLLBACK',
      'rollback-bet-success',
      '20.00',
      'rollback-bet',
    );
    const win = await process(
      wallet,
      'WIN',
      'rollback-win',
      '20.00',
      'rollback-bet',
    );
    const rollbackWin = await process(
      wallet,
      'ROLLBACK',
      'rollback-win-success',
      '20.00',
      'rollback-win',
    );

    expect(rollbackBet).toMatchObject({
      status: 'PROCESSED',
      referenceTransactionId: bet.transactionId,
      balance: { amount: '100.00' },
    });
    expect(rollbackWin).toMatchObject({
      status: 'PROCESSED',
      referenceTransactionId: win.transactionId,
      balance: { amount: '100.00' },
    });
    expect(win.referenceTransactionId).toBe(bet.transactionId);
    const entries = await orm.em.fork().find(WalletLedgerEntryEntity, {
      transactionId: {
        $in: [rollbackBet.transactionId, rollbackWin.transactionId],
      },
    });
    expect(entries.map(({ direction }) => direction).sort()).toEqual([
      'CREDIT',
      'DEBIT',
    ]);
  });

  it.each([
    ['ownership', 'REFERENCE_OWNERSHIP_MISMATCH'],
    ['type', 'INVALID_REFERENCE_TYPE'],
    ['amount', 'REFERENCE_AMOUNT_MISMATCH'],
  ] as const)(
    'rejects invalid reference %s without moving money',
    async (scenario, code) => {
      const wallet = await createWallet(`invalid-${scenario}-player`);
      let target = wallet;
      let referenceKind: 'BET' | 'WIN' = 'BET';
      let reversalAmount = '20.00';
      if (scenario === 'ownership') {
        target = await createWallet('invalid-ownership-other-player');
      } else if (scenario === 'type') {
        referenceKind = 'WIN';
      } else {
        reversalAmount = '19.00';
      }
      await process(
        wallet,
        referenceKind,
        `invalid-${scenario}-reference`,
        '20.00',
      );
      const balanceBefore = (
        await orm.em.fork().findOneOrFail(WalletEntity, target.id)
      ).balance;

      const result = await process(
        target,
        'REFUND',
        `invalid-${scenario}-refund`,
        reversalAmount,
        `invalid-${scenario}-reference`,
      );

      expect(result).toMatchObject({ status: 'REJECTED', failureCode: code });
      expect(
        (await orm.em.fork().findOneOrFail(WalletEntity, target.id)).balance,
      ).toBe(balanceBefore);
      expect(
        await orm.em.fork().count(WalletLedgerEntryEntity, {
          transactionId: result.transactionId,
        }),
      ).toBe(0);
    },
  );

  it('rejects a debit-style rollback that would make the wallet negative', async () => {
    const wallet = await createWallet('rollback-overdraw-player', '10.00');
    await process(wallet, 'WIN', 'overdraw-win', '50.00');
    await process(wallet, 'BET', 'overdraw-spend', '60.00');

    const rollback = await process(
      wallet,
      'ROLLBACK',
      'overdraw-rollback',
      '50.00',
      'overdraw-win',
    );

    expect(rollback).toMatchObject({
      status: 'REJECTED',
      failureCode: 'REVERSAL_WOULD_OVERDRAW',
      balance: { amount: '0.00' },
    });
    expect(
      await orm.em.fork().count(WalletLedgerEntryEntity, {
        transactionId: rollback.transactionId,
      }),
    ).toBe(0);
  });

  it('applies an out-of-order refund exactly once after its BET appears', async () => {
    const wallet = await createWallet('pending-reference-player');
    const pending = await process(
      wallet,
      'REFUND',
      'pending-refund',
      '25.00',
      'late-bet',
    );
    const replay = await process(
      wallet,
      'REFUND',
      'pending-refund',
      '25.00',
      'late-bet',
    );
    expect(pending).toMatchObject({
      status: 'PENDING_REFERENCE',
      balance: { amount: '100.00' },
      referenceTransactionId: null,
      idempotentReplay: false,
    });
    expect(replay).toEqual({ ...pending, idempotentReplay: true });

    const bet = await process(wallet, 'BET', 'late-bet', '25.00');
    await orm.em
      .fork()
      .nativeUpdate(
        WagerTransactionEntity,
        { id: pending.transactionId },
        { nextReferenceAttemptAt: new Date(0) },
      );
    const otherInstance = new WagerTransactionService(orm);
    const claimed = await Promise.all([
      transactions.processDueReferences(new Date()),
      otherInstance.processDueReferences(new Date()),
    ]);

    expect(claimed.reduce((sum, count) => sum + count, 0)).toBe(1);
    const resolved = await orm.em.fork().findOneOrFail(WagerTransactionEntity, {
      id: pending.transactionId,
    });
    expect(resolved).toMatchObject({
      status: 'PROCESSED',
      referenceTransactionId: bet.transactionId,
      balanceAfter: '100.00',
    });
    expect(
      await orm.em.fork().count(WalletLedgerEntryEntity, {
        transactionId: pending.transactionId,
      }),
    ).toBe(1);
    expect(await transactions.processDueReferences(new Date())).toBe(0);
  });

  it('rejects a missing reference after the retry limit is exhausted', async () => {
    const wallet = await createWallet('exhausted-reference-player');
    const pending = await process(
      wallet,
      'ROLLBACK',
      'exhausted-rollback',
      '10.00',
      'never-arrives',
    );
    await orm.em
      .fork()
      .nativeUpdate(
        WagerTransactionEntity,
        { id: pending.transactionId },
        { referenceAttempts: 7, nextReferenceAttemptAt: new Date(0) },
      );

    expect(await transactions.processDueReferences(new Date())).toBe(1);
    expect(
      await orm.em.fork().findOneOrFail(WagerTransactionEntity, {
        id: pending.transactionId,
      }),
    ).toMatchObject({
      status: 'REJECTED',
      failureCode: 'REFERENCE_NOT_FOUND',
      referenceAttempts: 8,
    });
    expect(
      await orm.em.fork().count(WalletLedgerEntryEntity, {
        transactionId: pending.transactionId,
      }),
    ).toBe(0);
  });

  it('serializes concurrent reversals and keeps the wallet equal to its ledger', async () => {
    const wallet = await createWallet('concurrent-reversal-player');
    await process(wallet, 'BET', 'concurrent-reference', '40.00');

    const results = await Promise.all([
      process(
        wallet,
        'REFUND',
        'concurrent-refund-a',
        '40.00',
        'concurrent-reference',
      ),
      process(
        wallet,
        'REFUND',
        'concurrent-refund-b',
        '40.00',
        'concurrent-reference',
      ),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual([
      'PROCESSED',
      'REJECTED',
    ]);
    const em = orm.em.fork();
    const storedWallet = await em.findOneOrFail(WalletEntity, wallet.id);
    const ledger = await em.find(WalletLedgerEntryEntity, {
      walletId: wallet.id,
    });
    const reconstructed = ledger.reduce((balance, entry) => {
      const amount = Money.from({
        amount: entry.amount,
        currency: entry.currency,
      });
      return entry.direction === 'CREDIT'
        ? balance.add(amount)
        : balance.subtract(amount);
    }, Money.zero('BRL'));
    expect(reconstructed.toString()).toBe(storedWallet.balance);
    expect(
      await em.count(WalletLedgerEntryEntity, {
        transactionId: {
          $in: results.map(({ transactionId }) => transactionId),
        },
      }),
    ).toBe(1);
  });
});
