#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliEntrypoint } from '@tigerdata/mcp-boilerplate';
import dotenv from 'dotenv';
import { initWorkspaceBaseUrl } from './util/addMessageLinks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

initWorkspaceBaseUrl().finally(() =>
  cliEntrypoint(
    join(__dirname, 'stdio.js'),
    join(__dirname, 'httpServer.js'),
    join(__dirname, 'instrumentation.js'), // Provide explicit path for Node.js compatibility
  ).catch(console.error),
);
