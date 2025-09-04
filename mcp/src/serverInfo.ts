import { Pool } from 'pg';

import { ServerContext } from './types.js';

export const serverInfo = {
  name: 'tiger-slack',
  version: '1.0.0',
} as const;

const pgPool = new Pool();

export const context: ServerContext = { pgPool };
