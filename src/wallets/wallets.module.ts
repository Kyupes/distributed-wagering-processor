import { Module } from '@nestjs/common';
import { CreateWalletService } from './application/create-wallet.service.js';
import { WalletsController } from './wallets.controller.js';

@Module({
  controllers: [WalletsController],
  providers: [CreateWalletService],
  exports: [CreateWalletService],
})
export class WalletsModule {}
