import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { WalletIdParamDto } from '../http/dto/resource-id.dto.js';
import { ApiException } from '../http/api.exception.js';
import { InvalidMoneyError } from '../wagering/domain/money.js';
import {
  CreateWalletService,
  WalletAlreadyExistsError,
} from './application/create-wallet.service.js';
import type { CreateWalletResult } from './application/create-wallet.service.js';
import {
  InvalidLedgerCursorError,
  WalletQueryNotFoundError,
  WalletQueryService,
} from './application/wallet-query.service.js';
import type {
  LedgerPageResponse,
  WalletResponse,
} from './application/wallet-query.service.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import { LedgerQueryDto } from './dto/ledger-query.dto.js';

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly createWalletService: CreateWalletService,
    private readonly walletQueries: WalletQueryService,
  ) {}

  @Post()
  async create(@Body() command: CreateWalletDto): Promise<CreateWalletResult> {
    try {
      return await this.createWalletService.create(command);
    } catch (error) {
      if (error instanceof WalletAlreadyExistsError) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'WALLET_ALREADY_EXISTS',
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

  @Get(':walletId')
  async findWallet(@Param() params: WalletIdParamDto): Promise<WalletResponse> {
    return this.runWalletQuery(() =>
      this.walletQueries.getWallet(params.walletId),
    );
  }

  @Get(':walletId/ledger')
  async findLedger(
    @Param() params: WalletIdParamDto,
    @Query() query: LedgerQueryDto,
  ): Promise<LedgerPageResponse> {
    return this.runWalletQuery(() =>
      this.walletQueries.getLedger(params.walletId, query.limit, query.cursor),
    );
  }

  private async runWalletQuery<T>(query: () => Promise<T>): Promise<T> {
    try {
      return await query();
    } catch (error) {
      if (error instanceof WalletQueryNotFoundError) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'WALLET_NOT_FOUND',
          error.message,
        );
      }
      if (error instanceof InvalidLedgerCursorError) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_CURSOR',
          error.message,
        );
      }
      throw error;
    }
  }
}
