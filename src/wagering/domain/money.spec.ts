import { describe, expect, it } from 'vitest';
import { Money } from './money.js';

describe('Money', () => {
  it('accepts a positive, fixed-scale decimal amount', () => {
    expect(Money.from({ amount: '30.00', currency: 'BRL' }).toString()).toBe(
      '30.00',
    );
  });

  it.each(['', '30', '30.0', '-30.00', '30.001', '3e1'])(
    'rejects invalid input amounts (%s)',
    (amount) => {
      expect(() => Money.from({ amount, currency: 'BRL' })).toThrow();
    },
  );

  it.each(['brl', 'BR', 'BRLL', '12$'])(
    'rejects invalid currency values (%s)',
    (currency) => {
      expect(() => Money.from({ amount: '10.00', currency })).toThrow();
    },
  );

  it('accepts BRL as a supported currency', () => {
    expect(Money.from({ amount: '10.00', currency: 'BRL' }).toJSON()).toEqual({
      amount: '10.00',
      currency: 'BRL',
    });
  });
});
