import { INestApplication } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM } from '@mikro-orm/postgresql';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mikroOrmConfig from '../../src/database/mikro-orm.config.js';
import { configureHttpApplication } from '../../src/http/configure-http-application.js';
import { WalletsModule } from '../../src/wallets/wallets.module.js';

describe('POST /wallets (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [MikroOrmModule.forRoot(mikroOrmConfig), WalletsModule],
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

  it('creates a funded wallet through HTTP', async () => {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: 'player-http-1',
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      playerId: 'player-http-1',
      balance: { amount: '100.00', currency: 'BRL' },
      version: 1,
    });
    expect(response.body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('rejects a request without playerId before the use case runs', async () => {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'INVALID_PAYLOAD',
      message: 'Request payload validation failed',
    });
  });

  it('returns HTTP 409 for a duplicate player and currency', async () => {
    const body = {
      playerId: 'player-http-duplicate',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    };
    await request(app.getHttpServer()).post('/wallets').send(body).expect(201);

    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send(body);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      code: 'WALLET_ALREADY_EXISTS',
    });
  });

  it.each([
    ['missing initialBalance', { playerId: 'player-http-invalid' }],
    [
      'missing amount',
      { playerId: 'player-http-invalid', initialBalance: { currency: 'BRL' } },
    ],
    [
      'missing currency',
      { playerId: 'player-http-invalid', initialBalance: { amount: '100.00' } },
    ],
    [
      'non-string playerId',
      {
        playerId: 123,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      },
    ],
    [
      'non-string amount',
      {
        playerId: 'player-http-invalid',
        initialBalance: { amount: 100, currency: 'BRL' },
      },
    ],
    [
      'non-string currency',
      {
        playerId: 'player-http-invalid',
        initialBalance: { amount: '100.00', currency: 123 },
      },
    ],
    [
      'amount without two decimal places',
      {
        playerId: 'player-http-invalid',
        initialBalance: { amount: '100', currency: 'BRL' },
      },
    ],
    [
      'negative amount',
      {
        playerId: 'player-http-invalid',
        initialBalance: { amount: '-1.00', currency: 'BRL' },
      },
    ],
    [
      'lowercase currency',
      {
        playerId: 'player-http-invalid',
        initialBalance: { amount: '100.00', currency: 'brl' },
      },
    ],
    [
      'unexpected property',
      {
        playerId: 'player-http-invalid',
        initialBalance: { amount: '100.00', currency: 'BRL' },
        admin: true,
      },
    ],
  ])('rejects %s with a stable validation error', async (_scenario, body) => {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'INVALID_PAYLOAD',
      message: 'Request payload validation failed',
    });
    expect(response.body.details).toEqual(expect.any(Array));
  });
});
