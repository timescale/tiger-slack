import type { Channel, Message } from '../types.js';
import { generatePermalink } from './addMessageLinks.js';
import { convertTimestampToTs } from './formatTs.js';

/**
 * Converts a flat list of messages into a tree of channels and threads
 * @param messages An array of messages sorted in reverse chronological order
 */
export const messagesToTree = (
  messages: Message[],
  includePermalinks?: boolean,
): {
  channels: Record<string, Channel>;
  involvedUsers: Set<string>;
} => {
  const channels: Record<string, Channel> = {};
  const threadRoots: Record<string, Message> = {};
  const involvedUsers = new Set<string>();

  // loop in reverse order to build tree in chronological order
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    const row = normalizeMessageTs(msg);
    if (row.user_id) {
      involvedUsers.add(row.user_id);
    }
    if (includePermalinks) {
      row.permalink = generatePermalink(row);
    }

    // prune superfluous File fields
    if (row.files?.length) {
      row.files = row.files.map((x) => ({
        id: x.id,
        name: x.name,
        size: x.size,
        title: x.title,
        mimetype: x.mimetype,
        url_private_download: x.url_private_download,
      }));
    }

    // biome-ignore lint/suspicious/noAssignInExpressions: simplifies type check
    const channel = (channels[row.channel_id] ??= {
      id: row.channel_id,
      name: '',
      messages: [],
    });
    if (row.thread_ts == null || row.ts === row.thread_ts) {
      // This is a root message (not a reply)
      const existing = threadRoots[row.ts];
      if (existing) {
        row.replies = existing.replies;
        // Remove existing root if it exists
        channel.messages.splice(channel.messages.indexOf(existing), 1, row);
      } else {
        channel.messages.push(row);
      }
      threadRoots[row.ts] = row;
    } else {
      // This is a reply in a thread
      let root = threadRoots[row.thread_ts];
      if (!root) {
        root = {
          ts: row.thread_ts,
          channel_id: row.channel_id,
          text: '<missing root message>',
          thread_ts: null,
          permalink: row.permalink,
          reply_count: 1,
          user_id: '<unknown>',
        };

        threadRoots[row.thread_ts] = root;
        channel.messages.push(root);
      }
      // A reply cannot have deeper replies
      delete row.reply_count;
      root.replies ??= [];
      root.replies.push(row);
      root.reply_count = Math.max(root.reply_count ?? 0, root.replies.length);
    }
  }

  return { channels, involvedUsers };
};

const normalizeMessageTs = (msg: Message): Message => ({
  ...msg,
  ts: convertTimestampToTs(msg.ts) ?? msg.ts,
  thread_ts:
    (msg.thread_ts && convertTimestampToTs(msg.thread_ts)) || msg.thread_ts,
});
