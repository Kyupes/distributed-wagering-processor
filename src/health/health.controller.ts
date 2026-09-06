import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiException } from '../http/api.exception.js';
import { HealthService } from './health.service.js';
import type { ReadinessResponse } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): { status: 'ok' } {
    return this.healthService.getLiveness();
  }

  @Get('live')
  getLiveness(): { status: 'ok' } {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  async getReadiness(): Promise<ReadinessResponse> {
    const readiness = await this.healthService.getReadiness();
    if (readiness.status === 'not_ready') {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'NOT_READY',
        'One or more required dependencies are unavailable',
        { dependencies: readiness.dependencies },
      );
    }
    return readiness;
  }
}
