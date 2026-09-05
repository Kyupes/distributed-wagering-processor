import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { ApiException } from '../http/api.exception.js';
import { InvalidMoneyError } from '../wagering/domain/money.js';
import {
  CreateWalletService,
  WalletAlreadyExistsError,
} from './application/create-wallet.service.js';
import type { CreateWalletResult } from './application/create-wallet.service.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';

@Controller('wallets')
export class WalletsController {
  constructor(private readonly createWalletService: CreateWalletService) {}

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
}
