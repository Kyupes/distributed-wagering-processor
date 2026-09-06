import { Module } from '@nestjs/common';
import { WagerTransactionService } from './application/wager-transaction.service.js';
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
    WagerTransactionService,
    TransactionQueryService,
    IdempotencyKeyPipe,
  ],
  exports: [WagerTransactionService],
})
export class WageringModule {}
