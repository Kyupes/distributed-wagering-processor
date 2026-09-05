import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { ApiException } from '../http/api.exception.js';
import { InvalidMoneyError } from './domain/money.js';
import {
  BetTransactionService,
  IdempotencyConflictError,
  WalletNotFoundError,
  WalletPlayerMismatchError,
} from './application/bet-transaction.service.js';
import type { ProcessBetResult } from './application/bet-transaction.service.js';
import { ProcessBetDto } from './dto/process-bet.dto.js';
import { IdempotencyKey, IdempotencyKeyPipe } from './idempotency-key.pipe.js';

@Controller('wagering/transactions')
export class WageringController {
  constructor(private readonly betTransactionService: BetTransactionService) {}

  @Post()
  async processBet(
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
    @Body() body: ProcessBetDto,
  ): Promise<ProcessBetResult> {
    try {
      const { kind: _publicKind, ...command } = body;
      const result = await this.betTransactionService.process({
        ...command,
        idempotencyKey,
      });
      if (result.status === 'REJECTED') {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'BUSINESS_RULE_REJECTED',
          'The BET was rejected by a business rule',
          {
            failureCode: 'INSUFFICIENT_FUNDS',
            transactionId: result.transactionId,
            balance: result.balance,
            idempotentReplay: result.idempotentReplay,
          },
        );
      }
      return result;
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      if (error instanceof IdempotencyConflictError) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'IDEMPOTENCY_CONFLICT',
          error.message,
        );
      }
      if (error instanceof WalletNotFoundError) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'WALLET_NOT_FOUND',
          error.message,
        );
      }
      if (error instanceof WalletPlayerMismatchError) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'WALLET_PLAYER_MISMATCH',
          error.message,
        );
      }
      if (error instanceof InvalidMoneyError) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_PAYLOAD',
          error.message,
        );
      }
      throw error;
    }
  }
}
