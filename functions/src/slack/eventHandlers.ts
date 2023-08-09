import {
  AppHomeOpenedEvent,
  AppMentionEvent,
  AppUninstalledEvent,
  BasicSlackEvent,
  SayFn,
  HomeView,
  Context,
} from '@slack/bolt';
import { createAppHomeView } from './blocks';
import * as logger from 'firebase-functions/logger';
import { WebClient } from '@slack/web-api';

export interface HomeViewWithTeam extends HomeView {
  team_id: string;
}

export const appHomeOpenedHandler = async ({
  event,
  context,
  client,
}: {
  event: AppHomeOpenedEvent;
  context: Context;
  client: WebClient;
}) => {
  logger.info('appHomeOpenedHandler', event, { structuredData: true });

  if (event.tab !== 'home') {
    return;
  }

  const user = event.user;
  const teamId = context.teamId;
  const token = context.botToken;

  if (!teamId) {
    // Something went wrong
    throw new Error('Invalid request');
  }

  const homeView = await createAppHomeView(user, teamId);
  await client.views.publish({
    token: token,
    user_id: user,
    view: homeView,
  });
};

export const appMentionHandler = async ({ event, say }: { event: AppMentionEvent; say: SayFn }) => {
  logger.info('app_mention', event, { structuredData: true });
  await say({
    text: `Hello, <@${event.user}>! :wave:`,
    thread_ts: event.ts,
  });
};

export const appDirectMessageHandler = async ({
  event,
}: {
  event: BasicSlackEvent<'message'>;
  say: SayFn;
}) => {
  logger.info('message', event, { structuredData: true });
  // {
  //   client_msg_id: 'c198ba22-f291-4758-899f-57ac16257739',
  //   type: 'message',
  //   text: 'test',
  //   user: 'U053GPTS544',
  //   ts: '1690652443.291349',
  //   blocks: [ { type: 'rich_text', block_id: 'pkK', elements: [Array] } ],
  //   team: 'T053E9V678S',
  //   channel: 'D05KCRY2MU4',
  //   event_ts: '1690652443.291349',
  //   channel_type: 'im'
  // }
};

export const appUninstalledHandler = async ({ event }: { event: AppUninstalledEvent }) => {
  logger.info('app_uninstalled', event, { structuredData: true });
  return;
};
