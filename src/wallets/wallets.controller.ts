import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Post,
} from '@nestjs/common';
import { InvalidMoneyError } from '../wagering/domain/money.js';
import {
  CreateWalletService,
  WalletAlreadyExistsError,
} from './application/create-wallet.service.js';
import type {
  CreateWalletCommand,
  CreateWalletResult,
} from './application/create-wallet.service.js';

@Controller('wallets')
export class WalletsController {
  constructor(private readonly createWalletService: CreateWalletService) {}

  @Post()
  async create(
    @Body() command: CreateWalletCommand,
  ): Promise<CreateWalletResult> {
    try {
      return await this.createWalletService.create(command);
    } catch (error) {
      if (error instanceof WalletAlreadyExistsError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof InvalidMoneyError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
