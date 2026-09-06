import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { WagerTransactionService } from './wager-transaction.service.js';

@Injectable()
export class PendingReferenceWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly transactions: WagerTransactionService) {}

  onApplicationBootstrap(): void {
    if (process.env.REFERENCE_WORKER_ENABLED === 'false') return;
    const intervalMs = positiveInteger(
      process.env.REFERENCE_WORKER_INTERVAL_MS,
      1_000,
    );
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()): Promise<number> {
    return this.transactions.processDueReferences(now);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch {
      this.logger.error('Pending reference processing failed.');
    } finally {
      this.running = false;
    }
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
