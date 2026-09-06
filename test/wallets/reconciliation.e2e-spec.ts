import { INestApplication } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM } from '@mikro-orm/postgresql';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mikroOrmConfig from '../../src/database/mikro-orm.config.js';
import { configureHttpApplication } from '../../src/http/configure-http-application.js';
import { WageringModule } from '../../src/wagering/wagering.module.js';
import { WalletEntity } from '../../src/wagering/persistence/wallet.entity.js';
import { WalletsModule } from '../../src/wallets/wallets.module.js';

describe('POST /wallets/:walletId/reconciliation (e2e)', () => {
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

  async function createWalletAndBet(): Promise<string> {
    const wallet = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId: 'reconciliation-player',
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });
    expect(wallet.status).toBe(201);
    await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'reconciliation-provider:bet-1')
      .send({
        providerId: 'reconciliation-provider',
        externalTransactionId: 'bet-1',
        playerId: 'reconciliation-player',
        walletId: wallet.body.id,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '30.00', currency: 'BRL' },
      })
      .expect(201);
    return wallet.body.id as string;
  }

  it('reconstructs a wallet from its opening credit and BET debit', async () => {
    const walletId = await createWalletAndBet();

    const response = await request(app.getHttpServer()).post(
      `/wallets/${walletId}/reconciliation`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      walletId,
      storedBalance: { amount: '70.00', currency: 'BRL' },
      calculatedBalance: { amount: '70.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      differenceDirection: 'NONE',
      consistent: true,
      checkedEntries: 2,
    });
  });

  it('reports inconsistency without repairing the stored wallet', async () => {
    const walletId = await createWalletAndBet();
    await orm.em
      .fork()
      .getConnection()
      .execute('update "wallets" set "balance" = ? where "id" = ?', [
        '80.00',
        walletId,
      ]);

    const response = await request(app.getHttpServer()).post(
      `/wallets/${walletId}/reconciliation`,
    );
    const persisted = await orm.em.fork().findOneOrFail(WalletEntity, {
      id: walletId,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      storedBalance: { amount: '80.00', currency: 'BRL' },
      calculatedBalance: { amount: '70.00', currency: 'BRL' },
      difference: { amount: '10.00', currency: 'BRL' },
      differenceDirection: 'STORED_GREATER',
      consistent: false,
      checkedEntries: 2,
    });
    expect(persisted.balance).toBe('80.00');
  });
});
