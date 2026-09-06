import { MikroORM } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Money } from '../../wagering/domain/money.js';
import { WalletLedgerEntryEntity } from '../../wagering/persistence/wallet-ledger-entry.entity.js';
import { WalletEntity } from '../../wagering/persistence/wallet.entity.js';
import { WalletQueryNotFoundError } from './wallet-query.service.js';

export type DifferenceDirection =
  'NONE' | 'STORED_GREATER' | 'CALCULATED_GREATER';

export interface WalletReconciliationResponse {
  walletId: string;
  storedBalance: { amount: string; currency: string };
  calculatedBalance: { amount: string; currency: string };
  difference: { amount: string; currency: string };
  differenceDirection: DifferenceDirection;
  consistent: boolean;
  checkedEntries: number;
}

@Injectable()
export class WalletReconciliationService {
  constructor(private readonly orm: MikroORM) {}

  async reconcile(walletId: string): Promise<WalletReconciliationResponse> {
    const em = this.orm.em.fork();
    const wallet = await em.findOne(WalletEntity, { id: walletId });
    if (!wallet) {
      throw new WalletQueryNotFoundError();
    }

    const entries = await em.find(
      WalletLedgerEntryEntity,
      { walletId },
      { fields: ['direction', 'amount', 'currency'] },
    );
    let credits = Money.zero(wallet.currency);
    let debits = Money.zero(wallet.currency);
    for (const entry of entries) {
      const amount = Money.from({
        amount: entry.amount,
        currency: entry.currency,
      });
      if (entry.direction === 'CREDIT') {
        credits = credits.add(amount);
      } else {
        debits = debits.add(amount);
      }
    }

    const calculatedBalance = credits.subtract(debits);
    const storedBalance = Money.from({
      amount: wallet.balance,
      currency: wallet.currency,
    });
    const { difference, direction } = calculateDifference(
      storedBalance,
      calculatedBalance,
    );

    return {
      walletId,
      storedBalance: storedBalance.toJSON(),
      calculatedBalance: calculatedBalance.toJSON(),
      difference: difference.toJSON(),
      differenceDirection: direction,
      consistent: storedBalance.equals(calculatedBalance),
      checkedEntries: entries.length,
    };
  }
}

function calculateDifference(
  stored: Money,
  calculated: Money,
): { difference: Money; direction: DifferenceDirection } {
  if (stored.equals(calculated)) {
    return { difference: Money.zero(stored.currency), direction: 'NONE' };
  }
  if (stored.isLessThan(calculated)) {
    return {
      difference: calculated.subtract(stored),
      direction: 'CALCULATED_GREATER',
    };
  }
  return {
    difference: stored.subtract(calculated),
    direction: 'STORED_GREATER',
  };
}
