import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
