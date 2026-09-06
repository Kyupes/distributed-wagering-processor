import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM } from '@mikro-orm/postgresql';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mikroOrmConfig from '../../src/database/mikro-orm.config.js';
import { configureHttpApplication } from '../../src/http/configure-http-application.js';
import { OutboxMessageEntity } from '../../src/wagering/persistence/outbox-message.entity.js';
import { WagerTransactionEntity } from '../../src/wagering/persistence/wager-transaction.entity.js';
import { WalletLedgerEntryEntity } from '../../src/wagering/persistence/wallet-ledger-entry.entity.js';
import { WalletEntity } from '../../src/wagering/persistence/wallet.entity.js';
import { WageringModule } from '../../src/wagering/wagering.module.js';
import { WalletsModule } from '../../src/wallets/wallets.module.js';

describe('WIN and LOSS transactions (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        MikroOrmModule.forRoot(mikroOrmConfig),
        WalletsModule,
        WageringModule,
      ],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureHttpApplication(app);
    await app.init();
    orm = moduleFixture.get(MikroORM);
    await orm.migrator.up();
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
    await app?.close();
  });

  async function createWallet(playerId: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  function transactionBody(
    kind: 'BET' | 'WIN' | 'LOSS',
    walletId: string,
    playerId: string,
    amount: string,
  ) {
    return {
      providerId: 'provider-a',
      externalTransactionId: `${kind.toLowerCase()}-${randomUUID()}`,
      playerId,
      walletId,
      roundId: 'round-win-loss',
      gameId: 'fortune-chimp',
      kind,
      money: { amount, currency: 'BRL' },
    };
  }

  it('credits WIN once and stores a CREDIT ledger entry and both events', async () => {
    const playerId = 'player-win';
    const walletId = await createWallet(playerId);
    const body = transactionBody('WIN', walletId, playerId, '25.00');
    const key = 'provider-a:win-once';

    const first = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', key)
      .send(body);
    const replay = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', key)
      .send(body);

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      status: 'PROCESSED',
      balance: { amount: '125.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(replay.body).toEqual({ ...first.body, idempotentReplay: true });
    const queried = await request(app.getHttpServer()).get(
      `/wagering/transactions/${first.body.transactionId}`,
    );
    expect(queried.body).toMatchObject({
      kind: 'WIN',
      money: { amount: '25.00', currency: 'BRL' },
      balanceAfter: { amount: '125.00', currency: 'BRL' },
    });

    const em = orm.em.fork();
    const wallet = await em.findOneOrFail(WalletEntity, walletId);
    const ledger = await em.find(WalletLedgerEntryEntity, {
      transactionId: first.body.transactionId,
    });
    const outbox = await em.find(OutboxMessageEntity, {
      transactionId: first.body.transactionId,
    });
    expect(wallet).toMatchObject({ balance: '125.00', version: 2 });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      direction: 'CREDIT',
      amount: '25.00',
      balanceBefore: '100.00',
      balanceAfter: '125.00',
    });
    expect(outbox.map(({ eventType }) => eventType).sort()).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);

    const changedKind = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', key)
      .send({ ...body, kind: 'LOSS' });
    expect(changedKind.status).toBe(409);
    expect(changedKind.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('records LOSS once without changing wallet, version, or ledger', async () => {
    const playerId = 'player-loss';
    const walletId = await createWallet(playerId);
    const body = transactionBody('LOSS', walletId, playerId, '25.00');
    const key = 'provider-a:loss-once';

    const first = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', key)
      .send(body);
    const replay = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', key)
      .send(body);

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      status: 'PROCESSED',
      balance: { amount: '100.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(replay.body).toEqual({ ...first.body, idempotentReplay: true });

    const em = orm.em.fork();
    expect(await em.findOneOrFail(WalletEntity, walletId)).toMatchObject({
      balance: '100.00',
      version: 1,
    });
    expect(
      await em.count(WalletLedgerEntryEntity, {
        transactionId: first.body.transactionId,
      }),
    ).toBe(0);
    const outbox = await em.find(OutboxMessageEntity, {
      transactionId: first.body.transactionId,
    });
    expect(outbox.map(({ eventType }) => eventType)).toEqual([
      'WagerTransactionProcessed',
    ]);
    expect(
      await em.count(WagerTransactionEntity, { idempotencyKey: key }),
    ).toBe(1);
  });

  it('reconciles OPENING, BET, WIN, and LOSS as one consistent wallet history', async () => {
    const playerId = 'player-sequence';
    const walletId = await createWallet(playerId);
    for (const [kind, amount] of [
      ['BET', '30.00'],
      ['WIN', '20.00'],
      ['LOSS', '10.00'],
    ] as const) {
      const body = transactionBody(kind, walletId, playerId, amount);
      await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', `provider-a:${body.externalTransactionId}`)
        .send(body)
        .expect(201);
    }

    const reconciliation = await request(app.getHttpServer()).post(
      `/wallets/${walletId}/reconciliation`,
    );

    expect(reconciliation.status).toBe(200);
    expect(reconciliation.body).toMatchObject({
      walletId,
      storedBalance: { amount: '90.00', currency: 'BRL' },
      calculatedBalance: { amount: '90.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      differenceDirection: 'NONE',
      consistent: true,
      checkedEntries: 3,
    });
  });
});
