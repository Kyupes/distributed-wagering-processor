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

  it('opens with the supplied balance and version 1', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('credits the wallet and increments its version', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.zero('BRL'),
    });

    wallet.credit(Money.from({ amount: '30.00', currency: 'BRL' }));

    expect(wallet.balance.toString()).toBe('30.00');
    expect(wallet.version).toBe(2);
  });

  it('does not increment the version for a zero-value credit', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.zero('BRL'),
    });

    wallet.credit(Money.zero('BRL'));

    expect(wallet.balance.toString()).toBe('0.00');
    expect(wallet.version).toBe(1);
  });
});
