import { Channel, Message } from '../types.js';
import { generatePermalink } from './addMessageLinks.js';

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
    const row = messages[i];
    if (row.user) {
      involvedUsers.add(row.user);
    }
    if (includePermalinks) {
      row.permalink = generatePermalink(row);
    }

    const channel = (channels[row.channel] ??= {
      id: row.channel,
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
          channel: row.channel,
          text: '<missing root message>',
          thread_ts: null,
          permalink: row.permalink,
          reply_count: 1,
          user: '<unknown>',
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
