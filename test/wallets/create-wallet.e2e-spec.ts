import { INestApplication } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM } from '@mikro-orm/postgresql';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mikroOrmConfig from '../../src/database/mikro-orm.config.js';
import { WalletsModule } from '../../src/wallets/wallets.module.js';

describe('POST /wallets (e2e)', () => {
  let app: INestApplication;
  let orm: MikroORM;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [MikroOrmModule.forRoot(mikroOrmConfig), WalletsModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    orm = moduleFixture.get(MikroORM);
    await orm.migrator.up();
  });

  beforeEach(async () => {
    await orm.em.fork().getConnection().execute(
      'truncate table "outbox_messages", "wallet_ledger_entries", "wager_transactions", "wallets";',
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a funded wallet through HTTP', async () => {
    const response = await request(app.getHttpServer()).post('/wallets').send({
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

  it('returns HTTP 409 for a duplicate player and currency', async () => {
    const body = {
      playerId: 'player-http-duplicate',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    };
    await request(app.getHttpServer()).post('/wallets').send(body).expect(201);

    await request(app.getHttpServer()).post('/wallets').send(body).expect(409);
  });

  it.each([
    { amount: '100', currency: 'BRL' },
    { amount: '-1.00', currency: 'BRL' },
    { amount: '100.00', currency: 'brl' },
  ])('returns HTTP 400 for invalid initial money ($amount $currency)', async (initialBalance) => {
    await request(app.getHttpServer())
      .post('/wallets')
      .send({ playerId: 'player-http-invalid', initialBalance })
      .expect(400);
  });
});
