import { getChannelsFactory } from './getChannels.js';
import { getMessageContextFactory } from './getMessageContext.js';
import { getRecentConversationsInChannelFactory } from './getRecentConversationsInChannel.js';
import { getRecentConversationsWithUserFactory } from './getRecentConversationsWithUser.js';
import { getThreadMessagesFactory } from './getThreadMessages.js';
import { getUsersFactory } from './getUsers.js';

export const apiFactories = [
  getChannelsFactory,
  getMessageContextFactory,
  getRecentConversationsInChannelFactory,
  getRecentConversationsWithUserFactory,
  getThreadMessagesFactory,
  getUsersFactory,
] as const;
