import { describe, expect, it } from 'vitest';
import { Money } from './money.js';
import { WalletLedgerEntry } from './wallet-ledger-entry.js';

describe('WalletLedgerEntry', () => {
  it('creates a balanced credit entry', () => {
    const entry = WalletLedgerEntry.create({
      id: 'ledger-1',
      walletId: 'wallet-1',
      transactionId: 'transaction-1',
      direction: 'CREDIT',
      money: Money.from({ amount: '100.00', currency: 'BRL' }),
      balanceBefore: Money.zero('BRL'),
      balanceAfter: Money.from({ amount: '100.00', currency: 'BRL' }),
      createdAt: new Date(),
    });

    expect(entry.isBalanced()).toBe(true);
  });

  it.each([
    ['CREDIT', '0.00', '100.00', '90.00'],
    ['DEBIT', '100.00', '30.00', '80.00'],
  ] as const)('rejects invalid %s arithmetic', (direction, before, amount, after) => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'ledger-1',
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction,
        money: Money.from({ amount, currency: 'BRL' }),
        balanceBefore: Money.from({ amount: before, currency: 'BRL' }),
        balanceAfter: Money.from({ amount: after, currency: 'BRL' }),
        createdAt: new Date(),
      }),
    ).toThrow('Ledger entry is not balanced.');
  });
});
