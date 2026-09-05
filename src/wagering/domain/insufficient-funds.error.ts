export class InsufficientFundsError extends Error {
  constructor() {
    super('Wallet balance is insufficient for this debit.');
    this.name = 'InsufficientFundsError';
  }
}
