import { Module } from '@nestjs/common';
import { SqsClientProvider } from './sqs-client.provider.js';

@Module({
  providers: [SqsClientProvider],
  exports: [SqsClientProvider],
})
export class SqsModule {}
