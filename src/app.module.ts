import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import mikroOrmConfig from './database/mikro-orm.config.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';

@Module({
  imports:
    process.env.NODE_ENV === 'test'
      ? []
      : [MikroOrmModule.forRoot({ ...mikroOrmConfig, autoLoadEntities: true })],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
