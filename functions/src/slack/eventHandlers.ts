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
import { getNotificationSettingValues } from '../lib/utils';

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

// TODO: Handle these in the future: should be able to use GPT to figure out what the user wants
// and respond accordingly using functions.
export const appMentionHandler = async ({ event, say }: { event: AppMentionEvent; say: SayFn }) => {
  logger.info('app_mention', event, { structuredData: true });
  await say({
    // eslint-disable-next-line max-len
    text: `Hello, <@${event.user}>! :wave: Unfortunately, I'm still working on things and can't respond to you yet. But I appreciate you thinking of me! :heart:`,
    thread_ts: event.ts,
  });
};

export const appDirectMessageHandler = async ({
  event,
  context,
  say,
}: {
  event: BasicSlackEvent<'message'>;
  context: Context;
  say: SayFn;
}) => {
  logger.info('direct message sent', event, { structuredData: true });

  const { userId } = context;

  await say({
    // eslint-disable-next-line max-len
    text: `Hello, <@${userId}>! :wave: Unfortunately, I'm still working on things and can't respond to you yet. But I appreciate you thinking of me! :heart:`,
    channel: userId,
  });
};

export const appUninstalledHandler = async ({
  event,
  context,
}: {
  event: AppUninstalledEvent;
  context: Context;
}) => {
  logger.info('app_uninstalled', event, context, { structuredData: true });

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
  const updatedUsers = await Promise.all(
    users.map(async (user) => {
      return prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          name: slackUser.profile.real_name,
          pictureUrl: slackUser.profile.image_512,
          tz: slackUser.tz,
          tzLabel: slackUser.tz_label,
          tzOffset: (slackUser.tz_offset || 0) / 60, // Convert to minutes, Slack returns seconds
        },
      });
    })
  );

  // Update notification settings, which depend on the user's timezone
  await Promise.all(
    updatedUsers.map(async (user) => {
      const usersNotificationSettings = await prisma.notificationSetting.findMany({
        where: {
          userId: user.id,
        },
      });

      await Promise.all(
        usersNotificationSettings.map(async (notificationSetting) => {
          const values = getNotificationSettingValues({
            type: notificationSetting.type,
            user,
            hour: notificationSetting.hour || undefined,
            dayOfWeek: notificationSetting.dayOfWeek || undefined,
            dayOfMonth: notificationSetting.dayOfMonth || undefined,
          });

          await prisma.notificationSetting.update({
            where: {
              id: notificationSetting.id,
            },
            data: {
              ...values,
            },
          });
        })
      );
    })
  );
};
