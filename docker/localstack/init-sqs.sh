#!/bin/sh
set -eu

DLQ_NAME="${SQS_DLQ_QUEUE_NAME:-wager-transactions-dlq.fifo}"
MAIN_QUEUE_NAME="${SQS_MAIN_QUEUE_NAME:-wager-transactions.fifo}"

DLQ_URL=$(awslocal sqs create-queue \
  --queue-name "$DLQ_NAME" \
  --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"true"}' \
  --query QueueUrl \
  --output text)

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query Attributes.QueueArn \
  --output text)

MAIN_QUEUE_URL=$(awslocal sqs create-queue \
  --queue-name "$MAIN_QUEUE_NAME" \
  --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"true"}' \
  --query QueueUrl \
  --output text)

REDRIVE_ATTRIBUTES=$(printf \
  '{"RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"%s\\",\\"maxReceiveCount\\":\\"5\\"}"}' \
  "$DLQ_ARN")

awslocal sqs set-queue-attributes \
  --queue-url "$MAIN_QUEUE_URL" \
  --attributes "$REDRIVE_ATTRIBUTES"
