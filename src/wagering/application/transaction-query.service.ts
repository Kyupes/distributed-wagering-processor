import { MikroORM } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import {
  WagerTransactionEntity,
  WagerTransactionKind,
} from '../persistence/wager-transaction.entity.js';

export interface TransactionResponse {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  status: string;
  money: { amount: string; currency: string };
  balanceAfter: { amount: string; currency: string } | null;
  failureCode: string | null;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  createdAt: string;
  processedAt: string | null;
}

export class TransactionNotFoundError extends Error {
  constructor() {
    super('The requested wagering transaction does not exist.');
    this.name = 'TransactionNotFoundError';
  }
}

@Injectable()
export class TransactionQueryService {
  constructor(private readonly orm: MikroORM) {}

  async findById(transactionId: string): Promise<TransactionResponse> {
    const transaction = await this.orm.em
      .fork()
      .findOne(WagerTransactionEntity, { id: transactionId });
    return this.mapOrThrow(transaction);
  }

  async findByProviderIdentity(
    providerId: string,
    externalTransactionId: string,
  ): Promise<TransactionResponse> {
    const transaction = await this.orm.em
      .fork()
      .findOne(WagerTransactionEntity, {
        providerId,
        externalTransactionId,
      });
    return this.mapOrThrow(transaction);
  }

  private mapOrThrow(
    transaction: WagerTransactionEntity | null,
  ): TransactionResponse {
    if (!transaction) {
      throw new TransactionNotFoundError();
    }
    return mapTransactionResponse(transaction);
  }
}

function mapTransactionResponse(
  transaction: WagerTransactionEntity,
): TransactionResponse {
  return {
    transactionId: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    status: transaction.status,
    money: { amount: transaction.amount, currency: transaction.currency },
    balanceAfter:
      transaction.balanceAfter == null
        ? null
        : { amount: transaction.balanceAfter, currency: transaction.currency },
    failureCode: transaction.failureCode ?? null,
    referenceExternalTransactionId: null,
    referenceTransactionId: null,
    createdAt: transaction.createdAt.toISOString(),
    processedAt: transaction.processedAt?.toISOString() ?? null,
  };
}
