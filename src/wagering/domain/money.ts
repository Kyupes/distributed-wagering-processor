export interface MoneyProps {
  amount: string;
  currency: string;
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class Money {
  private constructor(
    private readonly cents: bigint,
    public readonly currency: string,
  ) {}

  static from({ amount, currency }: MoneyProps): Money {
    if (!/^(0|[1-9]\d*)\.\d{2}$/.test(amount)) {
      throw new InvalidMoneyError(
        'Amount must be a non-negative decimal with exactly two places.',
      );
    }

    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new InvalidMoneyError('Currency must be an ISO-4217 uppercase code.');
    }

    const [whole, fraction] = amount.split('.');
    return new Money(BigInt(whole) * 100n + BigInt(fraction), currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromCents(this.cents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    if (this.cents < other.cents) {
      throw new RangeError('Resulting money amount cannot be negative.');
    }
    return Money.fromCents(this.cents - other.cents, this.currency);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents < other.cents;
  }

  isZero(): boolean {
    return this.cents === 0n;
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents === other.cents;
  }

  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }

  toString(): string {
    return `${this.cents / 100n}.${(this.cents % 100n).toString().padStart(2, '0')}`;
  }

  private static fromCents(cents: bigint, currency: string): Money {
    return Money.from({
      amount: `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`,
      currency,
    });
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error('Money currencies must match.');
    }
  }
}
