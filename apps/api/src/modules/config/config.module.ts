import { Global, Module } from '@nestjs/common';
import { ConfigStore } from './config.service';

@Global()
@Module({ providers: [ConfigStore], exports: [ConfigStore] })
export class ConfigStoreModule {}
