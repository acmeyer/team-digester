import {
  AppHomeOpenedEvent,
  AppMentionEvent,
  AppUninstalledEvent,
  BasicSlackEvent,
  SayFn,
} from '@slack/bolt';
import { app } from './index';
import * as logger from 'firebase-functions/logger';

export const appHomeOpenedHandler = async ({ event }: { event: AppHomeOpenedEvent }) => {
  logger.info('app_home_opened', event, { structuredData: true });
  await app.client.views.publish({
    token: process.env.SLACK_BOT_TOKEN,
    user_id: event.user,
    view: {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Hello, World!',
          },
        },
      ],
    },
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
