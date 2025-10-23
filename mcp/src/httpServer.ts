#!/usr/bin/env node
import { httpServerFactory } from '@tigerdata/mcp-boilerplate';
import { apiFactories } from './apis/index.js';
import { context, serverInfo } from './serverInfo.js';

export const { registerCleanupFn } = httpServerFactory({
  ...serverInfo,
  context,
  apiFactories,
  stateful: false,
});
