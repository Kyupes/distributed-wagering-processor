import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';
import { InvalidMoneyError } from './domain/money.js';
import {
  BetTransactionService,
  IdempotencyConflictError,
} from './application/bet-transaction.service.js';
import type {
  ProcessBetCommand,
  ProcessBetResult,
} from './application/bet-transaction.service.js';

@Controller('wagering/transactions')
export class WageringController {
  constructor(private readonly betTransactionService: BetTransactionService) {}

  @Post()
  async processBet(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: Omit<ProcessBetCommand, 'idempotencyKey'>,
  ): Promise<ProcessBetResult> {
    try {
      return await this.betTransactionService.process({ ...body, idempotencyKey });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof InvalidMoneyError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
