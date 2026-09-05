import { Module } from '@nestjs/common';
import { BetTransactionService } from './application/bet-transaction.service.js';
import { TransactionQueryService } from './application/transaction-query.service.js';
import { WageringController } from './wagering.controller.js';
import { IdempotencyKeyPipe } from './idempotency-key.pipe.js';
import {
  ProviderTransactionQueryController,
  TransactionQueryController,
} from './transaction-query.controller.js';

@Module({
  controllers: [
    WageringController,
    TransactionQueryController,
    ProviderTransactionQueryController,
  ],
  providers: [
    BetTransactionService,
    TransactionQueryService,
    IdempotencyKeyPipe,
  ],
  exports: [BetTransactionService],
})
export class WageringModule {}
