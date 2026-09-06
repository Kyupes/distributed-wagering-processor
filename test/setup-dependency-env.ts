// Dependency-backed test suites use the host-published Compose ports. Dedicated
// TEST_* overrides keep isolated verification stacks possible without allowing
// a developer's production AWS or database variables to leak into tests.
process.env.DATABASE_HOST = process.env.TEST_DATABASE_HOST ?? 'localhost';
process.env.DATABASE_PORT = process.env.TEST_DATABASE_PORT ?? '5432';
process.env.DATABASE_NAME = process.env.TEST_DATABASE_NAME ?? 'wagering';
process.env.DATABASE_USER = process.env.TEST_DATABASE_USER ?? 'postgres';
process.env.DATABASE_PASSWORD =
  process.env.TEST_DATABASE_PASSWORD ?? 'postgres';

process.env.AWS_REGION = process.env.TEST_AWS_REGION ?? 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.TEST_AWS_ACCESS_KEY_ID ?? 'test';
process.env.AWS_SECRET_ACCESS_KEY =
  process.env.TEST_AWS_SECRET_ACCESS_KEY ?? 'test';
process.env.SQS_ENDPOINT =
  process.env.TEST_SQS_ENDPOINT ?? 'http://localhost:4566';
process.env.SQS_MAIN_QUEUE_NAME =
  process.env.TEST_SQS_MAIN_QUEUE_NAME ?? 'wager-transactions.fifo';
process.env.SQS_DLQ_QUEUE_NAME =
  process.env.TEST_SQS_DLQ_QUEUE_NAME ?? 'wager-transactions-dlq.fifo';
