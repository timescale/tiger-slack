import type { Message } from '../types';

export const getMessageKey = (message: Message): string =>
  `${message.ts}+${message.channel_id}`;
