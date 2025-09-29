import { log } from '../shared/boilerplate/src/logger.js';
import { Message } from '../types.js';
import { convertTimestampToTs } from './formatTs.js';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

let workspaceBaseUrl: string | null;

export const initWorkspaceBaseUrl = async (): Promise<void> => {
  try {
    const response = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!data.ok) {
      log.warn(
        'An error occurred while getting the Slack url base. Will not return permalinks.',
        { data },
      );
    }

    workspaceBaseUrl = data?.url || null;
    log.info(`Permalink base url: ${workspaceBaseUrl}`);
  } catch (err) {
    log.error(
      'An error occurred while getting the Slack url base. Will not return permalinks.',
      err as Error,
    );
    workspaceBaseUrl = null;
  }
};

export const generatePermalink = (message: Message): string | undefined => {
  const messageTs = convertTimestampToTs(message.ts, true);
  const threadTs = message.thread_ts
    ? convertTimestampToTs(message.thread_ts)
    : null;

  if (messageTs && workspaceBaseUrl) {
    return new URL(
      `/archives/${message.channel_id}/p${messageTs}${threadTs ? `?thread_ts=${threadTs}` : ''}`,
      workspaceBaseUrl,
    ).toString();
  }
};
