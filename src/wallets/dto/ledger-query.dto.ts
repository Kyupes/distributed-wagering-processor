import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const DEFAULT_LEDGER_PAGE_SIZE = 50;
export const MAX_LEDGER_PAGE_SIZE = 100;

export class LedgerQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LEDGER_PAGE_SIZE)
  limit: number = DEFAULT_LEDGER_PAGE_SIZE;
}
