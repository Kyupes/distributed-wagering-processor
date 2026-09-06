import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM } from '@mikro-orm/postgresql';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mikroOrmConfig from '../../src/database/mikro-orm.config.js';
import { configureHttpApplication } from '../../src/http/configure-http-application.js';
import { WagerTransactionEntity } from '../../src/wagering/persistence/wager-transaction.entity.js';
import { WalletEntity } from '../../src/wagering/persistence/wallet.entity.js';
import { WageringModule } from '../../src/wagering/wagering.module.js';
import { WalletsModule } from '../../src/wallets/wallets.module.js';

describe('POST /wagering/transactions (e2e)', () => {
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

  async function createWallet(playerId = 'player-bet-http', amount = '100.00') {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount, currency: 'BRL' },
      });
    expect(response.status).toBe(201);
    return response.body as { id: string };
  }

  function validBet(walletId: string, overrides: Record<string, unknown> = {}) {
    return {
      providerId: 'provider-a',
      externalTransactionId: 'transaction-123',
      playerId: 'player-bet-http',
      walletId,
      roundId: 'round-987',
      gameId: 'fortune-chimp',
      kind: 'BET',
      money: { amount: '30.00', currency: 'BRL' },
      ...overrides,
    };
  }

  it('processes a valid BET', async () => {
    const wallet = await createWallet();

    const response = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-a:transaction-123')
      .send(validBet(wallet.id));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      status: 'PROCESSED',
      balance: { amount: '70.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(response.body.transactionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('rejects a %s Idempotency-Key', async (_scenario, key) => {
    const wallet = await createWallet();
    let pendingRequest = request(app.getHttpServer())
      .post('/wagering/transactions')
      .send(validBet(wallet.id));
    if (key !== undefined) {
      pendingRequest = pendingRequest.set('Idempotency-Key', key);
    }

    const response = await pendingRequest;

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'INVALID_IDEMPOTENCY_KEY',
    });
  });

  it.each([
    ['missing kind', { kind: undefined }],
    ['unsupported REFUND kind', { kind: 'REFUND' }],
    ['unsupported ROLLBACK kind', { kind: 'ROLLBACK' }],
    ['internal OPENING kind', { kind: 'OPENING' }],
  ])(
    'rejects %s without invoking transaction processing',
    async (_scenario, overrides) => {
      const wallet = await createWallet();
      const before = await orm.em.fork().count(WagerTransactionEntity);

      const response = await request(app.getHttpServer())
        .post('/wagering/transactions')
        .set('Idempotency-Key', `kind-test:${randomUUID()}`)
        .send(validBet(wallet.id, overrides));

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_PAYLOAD');
      expect(await orm.em.fork().count(WagerTransactionEntity)).toBe(before);
    },
  );

  it.each([
    ['providerId', { providerId: undefined }],
    ['externalTransactionId', { externalTransactionId: undefined }],
    ['playerId', { playerId: undefined }],
    ['walletId', { walletId: undefined }],
    ['roundId', { roundId: undefined }],
    ['gameId', { gameId: undefined }],
    ['money', { money: undefined }],
  ])('rejects a missing %s', async (_field, overrides) => {
    const wallet = await createWallet();
    const response = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', `missing-test:${randomUUID()}`)
      .send(validBet(wallet.id, overrides));

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_PAYLOAD');
  });

  it.each([
    ['providerId is not a string', { providerId: 7 }],
    ['walletId is not a string', { walletId: 7 }],
    ['money is not an object', { money: '30.00 BRL' }],
    ['amount is missing', { money: { currency: 'BRL' } }],
    ['currency is missing', { money: { amount: '30.00' } }],
    ['amount is not a string', { money: { amount: 30, currency: 'BRL' } }],
    [
      'amount has the wrong scale',
      { money: { amount: '30', currency: 'BRL' } },
    ],
    ['amount is negative', { money: { amount: '-1.00', currency: 'BRL' } }],
    ['currency is lowercase', { money: { amount: '30.00', currency: 'brl' } }],
    [
      'currency has the wrong length',
      { money: { amount: '30.00', currency: 'REAL' } },
    ],
    ['an unexpected property is present', { publishImmediately: true }],
  ])('rejects invalid input when %s', async (_scenario, overrides) => {
    const wallet = await createWallet();
    const response = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', `invalid-test:${randomUUID()}`)
      .send(validBet(wallet.id, overrides));

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_PAYLOAD');
  });

  it('returns the original result for an identical retry', async () => {
    const wallet = await createWallet();
    const body = validBet(wallet.id);
    const first = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-a:replay')
      .send(body);
    const replay = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-a:replay')
      .send(body);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual({ ...first.body, idempotentReplay: true });
  });

  it('returns a conflict when an idempotency key is reused for a different payload', async () => {
    const wallet = await createWallet();
    await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-a:conflict')
      .send(validBet(wallet.id))
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-a:conflict')
      .send(validBet(wallet.id, { roundId: 'different-round' }));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('returns a business rejection for insufficient funds', async () => {
    const wallet = await createWallet('player-bet-http', '20.00');

    const response = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-a:insufficient')
      .send(validBet(wallet.id));

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      statusCode: 422,
      code: 'BUSINESS_RULE_REJECTED',
      details: { failureCode: 'INSUFFICIENT_FUNDS' },
    });
  });

  it('returns not found for a missing wallet', async () => {
    const response = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-a:missing-wallet')
      .send(validBet(randomUUID()));

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('WALLET_NOT_FOUND');
  });

  it('returns a deliberate conflict for a wallet/player mismatch', async () => {
    const wallet = await createWallet('actual-player');

    const response = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-a:wrong-player')
      .send(validBet(wallet.id, { playerId: 'different-player' }));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('WALLET_PLAYER_MISMATCH');
    const persistedWallet = await orm.em.fork().findOneOrFail(WalletEntity, {
      id: wallet.id,
    });
    expect(persistedWallet.balance).toBe('100.00');
  });
});
