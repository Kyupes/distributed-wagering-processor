import { HttpException, HttpStatus } from '@nestjs/common';

export interface ApiErrorDetails {
  field?: string;
  messages?: string[];
  [key: string]: unknown;
}

export class ApiException extends HttpException {
  constructor(
    statusCode: HttpStatus,
    code: string,
    message: string,
    details?: ApiErrorDetails | ApiErrorDetails[],
  ) {
    super(
      {
        statusCode,
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
      statusCode,
    );
  }
}
