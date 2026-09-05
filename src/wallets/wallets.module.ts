import { Module } from '@nestjs/common';
import { CreateWalletService } from './application/create-wallet.service.js';
import { WalletQueryService } from './application/wallet-query.service.js';
import { WalletsController } from './wallets.controller.js';

@Module({
  controllers: [WalletsController],
  providers: [CreateWalletService, WalletQueryService],
  exports: [CreateWalletService],
})
export class WalletsModule {}
