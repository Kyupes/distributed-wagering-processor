import {
  GetQueueUrlCommand,
  SQSClient,
  type SQSClientConfig,
} from '@aws-sdk/client-sqs';
import { Injectable, OnModuleDestroy } from '@nestjs/common';

export interface SqsConfiguration {
  endpoint?: string;
  region: string;
  mainQueueName: string;
  deadLetterQueueName: string;
  timeoutMs: number;
}

@Injectable()
export class SqsClientProvider implements OnModuleDestroy {
  readonly configuration: SqsConfiguration;
  readonly client: SQSClient;

  constructor() {
    this.configuration = {
      endpoint: process.env.SQS_ENDPOINT,
      region: process.env.AWS_REGION ?? 'us-east-1',
      mainQueueName:
        process.env.SQS_MAIN_QUEUE_NAME ?? 'wager-transactions.fifo',
      deadLetterQueueName:
        process.env.SQS_DLQ_QUEUE_NAME ?? 'wager-transactions-dlq.fifo',
      timeoutMs: Number(process.env.READINESS_TIMEOUT_MS ?? 2_000),
    };
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const config: SQSClientConfig = {
      region: this.configuration.region,
      ...(this.configuration.endpoint
        ? { endpoint: this.configuration.endpoint }
        : {}),
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    };
    this.client = new SQSClient(config);
  }

  async checkAvailability(): Promise<void> {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      this.configuration.timeoutMs,
    );
    try {
      await Promise.all([
        this.client.send(
          new GetQueueUrlCommand({
            QueueName: this.configuration.mainQueueName,
          }),
          { abortSignal: abortController.signal },
        ),
        this.client.send(
          new GetQueueUrlCommand({
            QueueName: this.configuration.deadLetterQueueName,
          }),
          { abortSignal: abortController.signal },
        ),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
