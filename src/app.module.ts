import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import mikroOrmConfig from './database/mikro-orm.config.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { SqsModule } from './messaging/sqs/sqs.module.js';
import { WageringModule } from './wagering/wagering.module.js';
import { WalletsModule } from './wallets/wallets.module.js';

@Module({
  imports:
    process.env.NODE_ENV === 'test'
      ? []
      : [
          MikroOrmModule.forRoot({ ...mikroOrmConfig, autoLoadEntities: true }),
          SqsModule,
          WalletsModule,
          WageringModule,
        ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
