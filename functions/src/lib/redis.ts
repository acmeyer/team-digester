import { Redis } from '@upstash/redis';
import { Config } from '../config';

export const redis = new Redis({
  url: Config.REDIS_URL,
  token: Config.REDIS_TOKEN,
});
