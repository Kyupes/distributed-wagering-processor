import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { MoneyDto } from '../../http/money.dto.js';
import type { PublicWagerTransactionKind } from '../persistence/wager-transaction.entity.js';

export class ProcessWagerTransactionDto {
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsDefined()
  @IsString()
  @IsUUID()
  walletId!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  roundId!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @IsDefined()
  @IsIn(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'])
  kind!: PublicWagerTransactionKind;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  referenceExternalTransactionId?: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;
}
