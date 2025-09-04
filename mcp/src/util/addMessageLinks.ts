import { Message } from '../types.js';
import { convertTimestampToTs } from './formatTs.js';

const SLACK_DOMAIN = process.env.SLACK_DOMAIN;

export const generatePermalink = (message: Message): string | undefined => {
  const messageTs = convertTimestampToTs(message.ts, true);
  const threadTs = message.thread_ts
    ? convertTimestampToTs(message.thread_ts)
    : null;

  if (messageTs)
    return `https://${SLACK_DOMAIN}.slack.com/archives/${message.channel}/p${messageTs}${threadTs ? `?thread_ts=${threadTs}` : ''}`;
};
