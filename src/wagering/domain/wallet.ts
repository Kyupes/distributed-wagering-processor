import { InsufficientFundsError } from './insufficient-funds.error.js';
import { Money } from './money.js';

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
  ) {}

  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
  }): Wallet {
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
    );
  }

  static rehydrate(props: {
    id: string;
    playerId: string;
    currency: string;
    balance: Money;
    version: number;
  }): Wallet {
    return new Wallet(
      props.id,
      props.playerId,
      props.currency,
      props.balance,
      props.version,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  debit(amount: Money): void {
    if (amount.currency !== this.currency) {
      throw new Error('Wallet and debit currencies must match.');
    }
    if (this._balance.isLessThan(amount)) {
      throw new InsufficientFundsError();
    }

    this._balance = this._balance.subtract(amount);
    this._version += 1;
  }
}
