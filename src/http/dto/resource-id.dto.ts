import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class WalletIdParamDto {
  @IsString()
  @IsUUID()
  walletId!: string;
}

export class TransactionIdParamDto {
  @IsString()
  @IsUUID()
  transactionId!: string;
}

export class ProviderTransactionParamDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;
}
