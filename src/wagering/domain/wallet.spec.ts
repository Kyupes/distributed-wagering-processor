import { describe, expect, it } from 'vitest';
import { InsufficientFundsError } from './insufficient-funds.error.js';
import { Money } from './money.js';
import { Wallet } from './wallet.js';

describe('Wallet', () => {
  it('debits an amount covered by the balance', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    const balanceBefore = wallet.balance;
    wallet.debit(Money.from({ amount: '30.00', currency: 'BRL' }));

    expect(balanceBefore.toString()).toBe('100.00');
    expect(wallet.balance.toString()).toBe('70.00');
    expect(wallet.version).toBe(2);
  });

  it('refuses a debit that would make the balance negative', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    expect(() =>
      wallet.debit(Money.from({ amount: '100.01', currency: 'BRL' })),
    ).toThrow(InsufficientFundsError);
  });
});
