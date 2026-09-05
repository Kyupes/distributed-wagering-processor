import { INestApplication } from '@nestjs/common';
import { ConnectionException } from '@mikro-orm/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureHttpApplication } from '../../src/http/configure-http-application.js';
import { BetTransactionService } from '../../src/wagering/application/bet-transaction.service.js';
import { IdempotencyKeyPipe } from '../../src/wagering/idempotency-key.pipe.js';
import { WageringController } from '../../src/wagering/wagering.controller.js';

describe('Wagering HTTP infrastructure error mapping (e2e)', () => {
  let app: INestApplication;
  const process = vi.fn();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [WageringController],
      providers: [
        IdempotencyKeyPipe,
        { provide: BetTransactionService, useValue: { process } },
      ],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureHttpApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('hides a transient database failure behind a retryable response', async () => {
    process.mockRejectedValueOnce(
      new ConnectionException(new Error('secret database connection detail')),
    );

    const response = await request(app.getHttpServer())
      .post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-a:infrastructure-test')
      .send({
        providerId: 'provider-a',
        externalTransactionId: 'infrastructure-test',
        playerId: 'player-a',
        walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
        roundId: 'round-a',
        gameId: 'game-a',
        kind: 'BET',
        money: { amount: '10.00', currency: 'BRL' },
      });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      statusCode: 503,
      code: 'INFRASTRUCTURE_UNAVAILABLE',
      message: 'A required service is temporarily unavailable',
      retryable: true,
    });
    expect(JSON.stringify(response.body)).not.toContain('secret database');
  });
});
