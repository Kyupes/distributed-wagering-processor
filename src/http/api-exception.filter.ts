import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ConnectionException,
  DeadlockException,
  LockWaitTimeoutException,
} from '@mikro-orm/core';
import type { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (
      exception instanceof ConnectionException ||
      exception instanceof DeadlockException ||
      exception instanceof LockWaitTimeoutException
    ) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'INFRASTRUCTURE_UNAVAILABLE',
        message: 'A required service is temporarily unavailable',
        retryable: true,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'code' in exceptionResponse
      ) {
        response.status(statusCode).json(exceptionResponse);
        return;
      }

      response.status(statusCode).json({
        statusCode,
        code: httpCodeFor(statusCode),
        message:
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : exception.message,
      });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  }
}

function httpCodeFor(statusCode: number): string {
  return statusCode === HttpStatus.BAD_REQUEST
    ? 'INVALID_PAYLOAD'
    : 'HTTP_ERROR';
}
