import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiException } from '../http/api.exception.js';
import { InvalidMoneyError } from './domain/money.js';
import {
  IdempotencyConflictError,
  InvalidReferenceContractError,
  WagerTransactionService,
  WalletCurrencyMismatchError,
  WalletNotFoundError,
  WalletPlayerMismatchError,
} from './application/wager-transaction.service.js';
import type { ProcessWagerTransactionResult } from './application/wager-transaction.service.js';
import { ProcessWagerTransactionDto } from './dto/process-wager-transaction.dto.js';
import { IdempotencyKey, IdempotencyKeyPipe } from './idempotency-key.pipe.js';

@Controller('wagering/transactions')
export class WageringController {
  constructor(
    private readonly wagerTransactionService: WagerTransactionService,
  ) {}

  @Post()
  async processTransaction(
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
    @Body() body: ProcessWagerTransactionDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProcessWagerTransactionResult> {
    try {
      const result = await this.wagerTransactionService.process({
        ...body,
        idempotencyKey,
      });
      if (result.status === 'PENDING_REFERENCE') {
        response.status(HttpStatus.ACCEPTED);
      }
      if (result.status === 'REJECTED') {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'BUSINESS_RULE_REJECTED',
          'The wagering transaction was rejected by a business rule',
          {
            failureCode: result.failureCode,
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
      if (error instanceof InvalidReferenceContractError) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_PAYLOAD',
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
      if (error instanceof WalletCurrencyMismatchError) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'WALLET_CURRENCY_MISMATCH',
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
