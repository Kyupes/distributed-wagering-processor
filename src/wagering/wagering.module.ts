import { Module } from '@nestjs/common';
import { BetTransactionService } from './application/bet-transaction.service.js';
import { WageringController } from './wagering.controller.js';

@Module({
  controllers: [WageringController],
  providers: [BetTransactionService],
  exports: [BetTransactionService],
})
export class WageringModule {}
