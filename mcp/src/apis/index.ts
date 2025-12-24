import { getChannelsFactory } from './getChannels.js';
import { getConversationsInChannelFactory } from './getConversationsInChannel.js';
import { getConversationsWithUserFactory } from './getConversationsWithUser.js';
import { getMessageContextFactory } from './getMessageContext.js';
import { getThreadMessagesFactory } from './getThreadMessages.js';
import { getUsersFactory } from './getUsers.js';

export const apiFactories = [
  getChannelsFactory,
  getMessageContextFactory,
  getConversationsInChannelFactory,
  getConversationsWithUserFactory,
  getThreadMessagesFactory,
  getUsersFactory,
] as const;
