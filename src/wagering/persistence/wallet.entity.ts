import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallets' })
export class WalletEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'string', fieldName: 'player_id' })
  playerId!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'string', columnType: 'numeric(20,2)' })
  balance!: string;

  @Property({ type: 'number', version: true })
  version!: number;

  @Property({ type: 'Date', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt!: Date;

  @Property({ type: 'Date', fieldName: 'updated_at', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date;
}
