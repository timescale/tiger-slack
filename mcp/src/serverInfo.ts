import OpenAI from 'openai';
import { Pool } from 'pg';
import type { ServerContext } from './types.js';

export const serverInfo = {
  name: 'tiger-slack',
  version: '1.0.1',
} as const;

const pgPool = new Pool({
  connectionTimeoutMillis: 5000,
  query_timeout: 30000,
  idleTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});
const openAIClient = new OpenAI();

export const context: ServerContext = { openAIClient, pgPool };
