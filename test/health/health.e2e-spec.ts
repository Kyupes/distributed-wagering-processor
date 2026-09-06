import { INestApplication } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mikroOrmConfig from '../../src/database/mikro-orm.config.js';
import { HealthController } from '../../src/health/health.controller.js';
import { HealthService } from '../../src/health/health.service.js';
import { configureHttpApplication } from '../../src/http/configure-http-application.js';
import { SqsModule } from '../../src/messaging/sqs/sqs.module.js';

describe('Health behavior', () => {
  it('answers liveness without calling PostgreSQL or SQS', () => {
    const databaseCall = vi.fn();
    const sqsCall = vi.fn();
    const service = new HealthService(
      { em: { fork: databaseCall } } as never,
      { checkAvailability: sqsCall } as never,
    );

    expect(service.getLiveness()).toEqual({ status: 'ok' });
    expect(databaseCall).not.toHaveBeenCalled();
    expect(sqsCall).not.toHaveBeenCalled();
  });

  it('returns 503 and safe dependency states when readiness fails', async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: {
            getReadiness: async () => ({
              status: 'not_ready',
              dependencies: { postgres: 'up', sqs: 'down' },
            }),
          },
        },
      ],
    }).compile();
    const app = moduleFixture.createNestApplication();
    configureHttpApplication(app);
    await app.init();

    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      statusCode: 503,
      code: 'NOT_READY',
      message: 'One or more required dependencies are unavailable',
      details: { dependencies: { postgres: 'up', sqs: 'down' } },
    });
    await app.close();
  });
});

describe('Health readiness with real dependencies (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [MikroOrmModule.forRoot(mikroOrmConfig), SqsModule],
      controllers: [HealthController],
      providers: [HealthService],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureHttpApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ready when PostgreSQL and the provisioned SQS queues respond', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ready',
      dependencies: { postgres: 'up', sqs: 'up' },
    });
  });
});
