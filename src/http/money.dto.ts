import { IsDefined, IsString, Matches } from 'class-validator';

export class MoneyDto {
  @IsDefined()
  @IsString()
  @Matches(/^(0|[1-9]\d*)\.\d{2}$/)
  amount!: string;

  @IsDefined()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}
