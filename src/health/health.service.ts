import { MikroORM } from '@mikro-orm/postgresql';
import { Injectable, Optional } from '@nestjs/common';
import { SqsClientProvider } from '../messaging/sqs/sqs-client.provider.js';

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  dependencies: {
    postgres: 'up' | 'down';
    sqs: 'up' | 'down';
  };
}

@Injectable()
export class HealthService {
  constructor(
    @Optional() private readonly orm?: MikroORM,
    @Optional() private readonly sqs?: SqsClientProvider,
  ) {}

  getLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const [postgres, sqs] = await Promise.all([
      this.checkPostgres(),
      this.checkSqs(),
    ]);
    return {
      status: postgres === 'up' && sqs === 'up' ? 'ready' : 'not_ready',
      dependencies: { postgres, sqs },
    };
  }

  private async checkPostgres(): Promise<'up' | 'down'> {
    if (!this.orm) {
      return 'down';
    }
    return this.safeCheck(() =>
      this.withTimeout(this.orm!.em.fork().getConnection().execute('select 1')),
    );
  }

  private async checkSqs(): Promise<'up' | 'down'> {
    if (!this.sqs) {
      return 'down';
    }
    return this.safeCheck(() => this.sqs!.checkAvailability());
  }

  private async safeCheck(
    check: () => Promise<unknown>,
  ): Promise<'up' | 'down'> {
    try {
      await check();
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    const timeoutMs = Number(process.env.READINESS_TIMEOUT_MS ?? 2_000);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('readiness timeout')),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
