import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
import {
  ProviderTransactionParamDto,
  TransactionIdParamDto,
} from '../http/dto/resource-id.dto.js';
import { ApiException } from '../http/api.exception.js';
import {
  TransactionNotFoundError,
  TransactionQueryService,
} from './application/transaction-query.service.js';
import type { TransactionResponse } from './application/transaction-query.service.js';

@Controller('wagering/transactions')
export class TransactionQueryController {
  constructor(private readonly transactions: TransactionQueryService) {}

  @Get(':transactionId')
  async findById(
    @Param() params: TransactionIdParamDto,
  ): Promise<TransactionResponse> {
    return queryOrNotFound(() =>
      this.transactions.findById(params.transactionId),
    );
  }
}

@Controller('providers/:providerId/wagering/transactions')
export class ProviderTransactionQueryController {
  constructor(private readonly transactions: TransactionQueryService) {}

  @Get(':externalTransactionId')
  async findByProviderIdentity(
    @Param() params: ProviderTransactionParamDto,
  ): Promise<TransactionResponse> {
    return queryOrNotFound(() =>
      this.transactions.findByProviderIdentity(
        params.providerId,
        params.externalTransactionId,
      ),
    );
  }
}

async function queryOrNotFound(
  query: () => Promise<TransactionResponse>,
): Promise<TransactionResponse> {
  try {
    return await query();
  } catch (error) {
    if (error instanceof TransactionNotFoundError) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'TRANSACTION_NOT_FOUND',
        error.message,
      );
    }
    throw error;
  }
}
