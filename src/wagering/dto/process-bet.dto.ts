import { Type } from 'class-transformer';
import {
  Equals,
  IsDefined,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { MoneyDto } from '../../http/money.dto.js';

export class ProcessBetDto {
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
  @Equals('BET')
  kind!: 'BET';

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;
}
