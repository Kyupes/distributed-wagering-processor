import { HttpStatus, ValidationPipe } from '@nestjs/common';
import type { INestApplication, ValidationError } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { ApiException } from './api.exception.js';

export function configureHttpApplication(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      exceptionFactory: (errors) =>
        new ApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_PAYLOAD',
          'Request payload validation failed',
          flattenValidationErrors(errors),
        ),
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
}

function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): Array<{ field: string; messages: string[] }> {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints
      ? [{ field, messages: Object.values(error.constraints) }]
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}
