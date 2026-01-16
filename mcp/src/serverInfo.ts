import { Pool } from 'pg';

import type { ServerContext } from './types.js';
import OpenAI from 'openai';

export const serverInfo = {
  name: 'tiger-slack',
  version: '1.0.1',
} as const;

const pgPool = new Pool();
const openAIClient = new OpenAI();

export const context: ServerContext = { openAIClient, pgPool };
