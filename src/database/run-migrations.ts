import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from './mikro-orm.config.js';

const orm = await MikroORM.init(mikroOrmConfig);
try {
  const migrated = await orm.migrator.up();
  console.log(
    JSON.stringify({
      event: 'database_migrations_completed',
      migrations: migrated.map(({ name }) => name),
    }),
  );
} finally {
  await orm.close();
}
