import { INestApplication } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM } from '@mikro-orm/postgresql';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mikroOrmConfig from '../../src/database/mikro-orm.config.js';
import { configureHttpApplication } from '../../src/http/configure-http-application.js';
import { WageringModule } from '../../src/wagering/wagering.module.js';
import { WalletsModule } from '../../src/wallets/wallets.module.js';

describe('Reference-aware wagering HTTP contract (e2e)', () => {
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

  it('returns 202 for a missing reference and exposes its persisted identity', async () => {
    const playerId = 'reference-http-player';
    const wallet = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });
    const body = {
      providerId: 'reference-http-provider',
      externalTransactionId: 'out-of-order-refund',
      playerId,
      walletId: wallet.body.id,
      roundId: 'reference-http-round',
      gameId: 'reference-http-game',
      kind: 'REFUND',
      money: { amount: '20.00', currency: 'BRL' },
      referenceExternalTransactionId: 'future-bet',
    };

    const pending = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'reference-http-provider:out-of-order-refund')
      .send(body);
    const replay = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'reference-http-provider:out-of-order-refund')
      .send(body);
    const queried = await request(app.getHttpServer()).get(
      `/wagering/transactions/${pending.body.transactionId}`,
    );

    expect(pending.status).toBe(202);
    expect(pending.body).toMatchObject({
      status: 'PENDING_REFERENCE',
      referenceExternalTransactionId: 'future-bet',
      referenceTransactionId: null,
      idempotentReplay: false,
    });
    expect(replay.status).toBe(202);
    expect(replay.body).toEqual({ ...pending.body, idempotentReplay: true });
    expect(queried.body).toMatchObject({
      status: 'PENDING_REFERENCE',
      referenceExternalTransactionId: 'future-bet',
      referenceTransactionId: null,
    });
  });

  it('rejects missing reversal references and references on BET', async () => {
    const payload = {
      providerId: 'reference-validation-provider',
      externalTransactionId: 'reference-validation',
      playerId: 'reference-validation-player',
      walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
      roundId: 'reference-validation-round',
      gameId: 'reference-validation-game',
      kind: 'REFUND',
      money: { amount: '20.00', currency: 'BRL' },
    };
    const missing = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'reference-validation-provider:missing')
      .send(payload);
    const disallowed = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'reference-validation-provider:disallowed')
      .send({
        ...payload,
        kind: 'BET',
        referenceExternalTransactionId: 'some-bet',
      });

    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('INVALID_PAYLOAD');
    expect(disallowed.status).toBe(400);
    expect(disallowed.body.code).toBe('INVALID_PAYLOAD');
  });

  it('returns resolved external and internal reference identifiers', async () => {
    const playerId = 'reference-query-player';
    const wallet = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });
    const common = {
      providerId: 'reference-query-provider',
      playerId,
      walletId: wallet.body.id,
      roundId: 'reference-query-round',
      gameId: 'reference-query-game',
      money: { amount: '20.00', currency: 'BRL' },
    };
    const bet = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'reference-query-provider:bet')
      .send({ ...common, externalTransactionId: 'query-bet', kind: 'BET' });
    const refund = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'reference-query-provider:refund')
      .send({
        ...common,
        externalTransactionId: 'query-refund',
        kind: 'REFUND',
        referenceExternalTransactionId: 'query-bet',
      });
    const queried = await request(app.getHttpServer()).get(
      `/wagering/transactions/${refund.body.transactionId}`,
    );

    expect(refund.status).toBe(201);
    expect(queried.body).toMatchObject({
      referenceExternalTransactionId: 'query-bet',
      referenceTransactionId: bet.body.transactionId,
    });
  });
});
