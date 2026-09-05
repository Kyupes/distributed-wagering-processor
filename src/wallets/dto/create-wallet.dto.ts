import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { MoneyDto } from '../../http/money.dto.js';

export class CreateWalletDto {
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}
