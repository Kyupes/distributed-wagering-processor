import {
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { ApiException } from '../http/api.exception.js';

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): unknown =>
    context.switchToHttp().getRequest().headers['idempotency-key'],
);

@Injectable()
export class IdempotencyKeyPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key header is required and must not be empty',
      );
    }
    return value;
  }
}
