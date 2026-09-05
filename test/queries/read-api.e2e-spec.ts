import { randomUUID } from 'node:crypto';
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

describe('Read API (e2e)', () => {
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
    await app.close();
  });

  async function createWallet() {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: 'query-player',
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });
    expect(response.status).toBe(201);
    return response.body as { id: string };
  }

  async function placeBet(walletId: string, suffix: string) {
    const response = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', `query-provider:${suffix}`)
      .send({
        providerId: 'query-provider',
        externalTransactionId: suffix,
        playerId: 'query-player',
        walletId,
        roundId: `round-${suffix}`,
        gameId: 'query-game',
        kind: 'BET',
        money: { amount: '10.00', currency: 'BRL' },
      });
    expect(response.status).toBe(201);
    return response.body as { transactionId: string };
  }

  it('returns the current wallet representation', async () => {
    const wallet = await createWallet();

    const response = await request(app.getHttpServer()).get(
      `/wallets/${wallet.id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: wallet.id,
      playerId: 'query-player',
      balance: { amount: '100.00', currency: 'BRL' },
      currency: 'BRL',
      version: 1,
    });
    expect(response.body.createdAt).toEqual(expect.any(String));
    expect(response.body.updatedAt).toEqual(expect.any(String));
  });

  it('uses the same transaction representation for both lookup routes', async () => {
    const wallet = await createWallet();
    const transaction = await placeBet(wallet.id, 'lookup');

    const byId = await request(app.getHttpServer()).get(
      `/wagering/transactions/${transaction.transactionId}`,
    );
    const byProvider = await request(app.getHttpServer()).get(
      '/providers/query-provider/wagering/transactions/lookup',
    );

    expect(byId.status).toBe(200);
    expect(byProvider.status).toBe(200);
    expect(byProvider.body).toEqual(byId.body);
    expect(byId.body).toMatchObject({
      transactionId: transaction.transactionId,
      providerId: 'query-provider',
      externalTransactionId: 'lookup',
      kind: 'BET',
      status: 'PROCESSED',
      money: { amount: '10.00', currency: 'BRL' },
      balanceAfter: { amount: '90.00', currency: 'BRL' },
      failureCode: null,
      referenceExternalTransactionId: null,
      referenceTransactionId: null,
    });
  });

  it('returns a deliberate transaction-not-found response', async () => {
    const response = await request(app.getHttpServer()).get(
      `/wagering/transactions/${randomUUID()}`,
    );

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('TRANSACTION_NOT_FOUND');
  });

  it('continues ledger pagination without duplicates when a newer entry is added', async () => {
    const wallet = await createWallet();
    await placeBet(wallet.id, 'first');
    const original = await request(app.getHttpServer()).get(
      `/wallets/${wallet.id}/ledger?limit=100`,
    );
    const firstPage = await request(app.getHttpServer()).get(
      `/wallets/${wallet.id}/ledger?limit=1`,
    );
    expect(original.body.entries).toHaveLength(2);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));

    await placeBet(wallet.id, 'newer');
    const secondPage = await request(app.getHttpServer())
      .get(`/wallets/${wallet.id}/ledger`)
      .query({ limit: 1, cursor: firstPage.body.nextCursor });

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.entries[0].id).toBe(original.body.entries[1].id);
    expect(secondPage.body.entries[0].id).not.toBe(
      firstPage.body.entries[0].id,
    );
  });

  it('rejects a malformed ledger cursor', async () => {
    const wallet = await createWallet();

    const response = await request(app.getHttpServer())
      .get(`/wallets/${wallet.id}/ledger`)
      .query({ cursor: 'not-a-valid-cursor!' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_CURSOR');
  });
});
