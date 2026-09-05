import { Module } from '@nestjs/common';
import { BetTransactionService } from './application/bet-transaction.service.js';
import { WageringController } from './wagering.controller.js';
import { IdempotencyKeyPipe } from './idempotency-key.pipe.js';

@Module({
  controllers: [WageringController],
  providers: [BetTransactionService, IdempotencyKeyPipe],
  exports: [BetTransactionService],
})
export class WageringModule {}
