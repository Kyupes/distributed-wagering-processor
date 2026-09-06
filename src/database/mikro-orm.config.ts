import 'reflect-metadata';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Migrator } from '@mikro-orm/migrations';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { defineConfig } from '@mikro-orm/postgresql';
import { OutboxMessageEntity } from '../wagering/persistence/outbox-message.entity.js';
import { WalletLedgerEntryEntity } from '../wagering/persistence/wallet-ledger-entry.entity.js';
import { WagerTransactionEntity } from '../wagering/persistence/wager-transaction.entity.js';
import { WalletEntity } from '../wagering/persistence/wallet.entity.js';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(configDirectory, '../..');

export default defineConfig({
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 5432),
  user: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'postgres',
  dbName: process.env.DATABASE_NAME ?? 'wagering',
  entities: [
    WalletEntity,
    WagerTransactionEntity,
    WalletLedgerEntryEntity,
    OutboxMessageEntity,
  ],
  extensions: [Migrator],
  metadataProvider: ReflectMetadataProvider,
  preferTs: process.env.NODE_ENV !== 'production',
  migrations: {
    path: resolve(configDirectory, 'migrations'),
    pathTs: resolve(projectRoot, 'src/database/migrations'),
    glob: '!(*.d).{js,ts}',
    transactional: true,
    allOrNothing: true,
  },
  debug: process.env.DATABASE_DEBUG === 'true',
  discovery: {
    // The initial infrastructure intentionally has no domain entities yet.
    warnWhenNoEntities: false,
  },
});
