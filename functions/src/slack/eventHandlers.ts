import {
  AppHomeOpenedEvent,
  AppMentionEvent,
  AppUninstalledEvent,
  BasicSlackEvent,
  SayFn,
  HomeView,
  Context,
  UserChangeEvent,
} from '@slack/bolt';
import { createAppHomeView } from './blocks';
import * as logger from 'firebase-functions/logger';
import { WebClient } from '@slack/web-api';
import { prisma } from '../lib/prisma';
import { INTEGRATION_NAMES } from '../lib/constants';

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

export const appUninstalledHandler = async ({
  event,
  context,
}: {
  event: AppUninstalledEvent;
  context: Context;
}) => {
  logger.info('app_uninstalled', event, context, { structuredData: true });

  console.log('slack.app_uninstalled webhook called', {
    event,
    context,
  });

  const slackId = context.isEnterpriseInstall ? context.enterpriseId : context.teamId;

  // Remove the Slack installation from database
  await prisma.integrationInstallation.delete({
    where: {
      integrationName_externalId: {
        externalId: slackId || '',
        integrationName: INTEGRATION_NAMES.SLACK,
      },
    },
  });
};

export const userChangeHandler = async ({
  event,
  context,
}: {
  event: UserChangeEvent;
  context: Context;
}) => {
  logger.info('user_change', event, context, { structuredData: true });

  const slackUser = event.user;

  if (!slackUser) {
    return;
  }

  const users = await prisma.user.findMany({
    where: {
      integrationAccounts: {
        some: {
          externalId: slackUser.id,
          integrationName: INTEGRATION_NAMES.SLACK,
        },
      },
    },
  });

  // Update user
  await Promise.all(
    users.map(async (user) => {
      await prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          name: slackUser.profile.real_name,
          pictureUrl: slackUser.profile.image_512,
          tz: slackUser.tz,
          tzLabel: slackUser.tz_label,
          tzOffset: slackUser.tz_offset,
        },
      });
    })
  );
};
