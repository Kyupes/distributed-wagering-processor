import type { FilterQuery } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { WalletLedgerEntryEntity } from '../../wagering/persistence/wallet-ledger-entry.entity.js';
import { WalletEntity } from '../../wagering/persistence/wallet.entity.js';

export interface WalletResponse {
  id: string;
  playerId: string;
  balance: { amount: string; currency: string };
  currency: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntryResponse {
  id: string;
  transactionId: string;
  direction: 'CREDIT' | 'DEBIT';
  money: { amount: string; currency: string };
  balanceBefore: { amount: string; currency: string };
  balanceAfter: { amount: string; currency: string };
  createdAt: string;
}

export interface LedgerPageResponse {
  walletId: string;
  entries: LedgerEntryResponse[];
  nextCursor: string | null;
}

interface LedgerCursor {
  version: 1;
  createdAt: Date;
  id: string;
}

export class WalletQueryNotFoundError extends Error {
  constructor() {
    super('The requested wallet does not exist.');
    this.name = 'WalletQueryNotFoundError';
  }
}

export class InvalidLedgerCursorError extends Error {
  constructor() {
    super('The ledger cursor is malformed or unsupported.');
    this.name = 'InvalidLedgerCursorError';
  }
}

@Injectable()
export class WalletQueryService {
  constructor(private readonly orm: MikroORM) {}

  async getWallet(walletId: string): Promise<WalletResponse> {
    const wallet = await this.orm.em
      .fork()
      .findOne(WalletEntity, { id: walletId });
    if (!wallet) {
      throw new WalletQueryNotFoundError();
    }

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: { amount: wallet.balance, currency: wallet.currency },
      currency: wallet.currency,
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  async getLedger(
    walletId: string,
    limit: number,
    encodedCursor?: string,
  ): Promise<LedgerPageResponse> {
    const em = this.orm.em.fork();
    if (
      !(await em.findOne(WalletEntity, { id: walletId }, { fields: ['id'] }))
    ) {
      throw new WalletQueryNotFoundError();
    }

    const cursor = encodedCursor ? decodeCursor(encodedCursor) : undefined;
    const where: FilterQuery<WalletLedgerEntryEntity> = { walletId };
    if (cursor) {
      where.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { $lt: cursor.id } },
      ];
    }

    const rows = await em.find(WalletLedgerEntryEntity, where, {
      orderBy: { createdAt: 'DESC', id: 'DESC' },
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);

    return {
      walletId,
      entries: pageRows.map(mapLedgerEntry),
      nextCursor:
        hasMore && last
          ? encodeCursor({ version: 1, createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
}

function mapLedgerEntry(entity: WalletLedgerEntryEntity): LedgerEntryResponse {
  return {
    id: entity.id,
    transactionId: entity.transactionId,
    direction: entity.direction,
    money: { amount: entity.amount, currency: entity.currency },
    balanceBefore: { amount: entity.balanceBefore, currency: entity.currency },
    balanceAfter: { amount: entity.balanceAfter, currency: entity.currency },
    createdAt: entity.createdAt.toISOString(),
  };
}

function encodeCursor(cursor: LedgerCursor): string {
  return Buffer.from(
    JSON.stringify({
      version: cursor.version,
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString('base64url');
}

function decodeCursor(encoded: string): LedgerCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
      throw new Error('invalid base64url');
    }
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.toString('base64url') !== encoded) {
      throw new Error('non-canonical base64url');
    }
    const parsed = JSON.parse(decoded.toString('utf8')) as {
      version?: unknown;
      createdAt?: unknown;
      id?: unknown;
    };
    const keys = Object.keys(parsed).sort();
    if (
      keys.join(',') !== 'createdAt,id,version' ||
      parsed.version !== 1 ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.id,
      )
    ) {
      throw new Error('invalid cursor shape');
    }
    const createdAt = new Date(parsed.createdAt);
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== parsed.createdAt
    ) {
      throw new Error('invalid cursor date');
    }
    return { version: 1, createdAt, id: parsed.id };
  } catch {
    throw new InvalidLedgerCursorError();
  }
}
