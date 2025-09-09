#!/usr/bin/env node
import dotenv from 'dotenv';
import { cliEntrypoint } from './shared/boilerplate/src/cliEntrypoint.js';

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

cliEntrypoint(
  join(__dirname, 'stdio.js'),
  join(__dirname, 'httpServer.js'),
).catch(console.error);
