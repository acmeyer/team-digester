import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { prisma } from '../lib/prisma';
import { NotificationType, User } from '@prisma/client';
import { openAI } from '../lib/openai';
import { WebClient } from '@slack/web-api';
import {
  ACTIVITY_SUMMARIZATION_SYSTEM_PROMPT,
  TEAM_ACTVIITY_SUMMARIZATION_SYSTEM_PROMPT,
} from '../lib/prompts';
import { capitalize } from 'lodash';
import { INTEGRATION_NAMES } from '../lib/constants';

// Manually run the task here https://console.cloud.google.com/cloudscheduler
export const notifications = onSchedule('0 * * * *', async (event) => {
  logger.info('Running notifications task', event, { structuredData: true });

  // Find all users that have a notification setting enabled for this time
  const localDate = new Date();
  const utcHour = localDate.getUTCHours();
  const utcDayOfWeek = localDate.getUTCDay();
  let dailyOffset = 0;
  if (utcDayOfWeek === 0) {
    dailyOffset = 1;
  } else if (utcDayOfWeek === 6) {
    dailyOffset = -1;
  }
  let utcDayOfMonth = localDate.getUTCDate();
  // Convert utcDayOfMonth to days from the end of the month if > 2
  // If the day of the month is greater than 2, then only the end of the month is relevant
  // for monthly notifications
  if (utcDayOfMonth > 2) {
    const daysInMonth = new Date(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth() + 1,
      0
    ).getUTCDate();
    // Keep it negative to match how we store it
    utcDayOfMonth = utcDayOfMonth - daysInMonth;
  }

  console.log('finding notifications', {
    utcHour,
    utcDayOfWeek,
    utcDayOfMonth,
    dailyOffset,
  });

  try {
    const dailyNotifications = await prisma.notificationSetting.findMany({
      where: {
        isEnabled: true,
        type: NotificationType.daily,
        hourUTC: utcHour,
        dailyUTCOffset: dailyOffset,
      },
      include: {
        user: {
          include: {
            teamMemberships: true,
          },
        },
      },
    });

    const weeklyNotifications = await prisma.notificationSetting.findMany({
      where: {
        isEnabled: true,
        type: NotificationType.weekly,
        dayOfWeekUTC: utcDayOfWeek,
        hourUTC: utcHour,
      },
      include: {
        user: {
          include: {
            teamMemberships: true,
          },
        },
      },
    });

    const monthlyNotifications = await prisma.notificationSetting.findMany({
      where: {
        isEnabled: true,
        type: NotificationType.monthly,
        dayOfMonthUTC: utcDayOfMonth,
        hourUTC: utcHour,
      },
      include: {
        user: {
          include: {
            teamMemberships: true,
          },
        },
      },
    });

    // Configure and send the notifications
    await Promise.all([
      ...dailyNotifications.map(async (notification) => {
        console.log('Sending daily notification to', notification.user);
        await Promise.all(
          // - Find all team member activity since last notification (24 hours typically)
          // TODO: improve this to handle weekends better
          notification.user.teamMemberships.map((membership) =>
            sendNotification({
              notificationType: NotificationType.daily,
              teamId: membership.teamId,
              notificationUser: notification.user,
              activitySinceDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
            })
          )
        );
      }),
      ...weeklyNotifications.map(async (notification) => {
        console.log('Sending weekly notification to', notification.user);
        await Promise.all(
          notification.user.teamMemberships.map((membership) => {
            sendNotification({
              notificationType: NotificationType.weekly,
              teamId: membership.teamId,
              notificationUser: notification.user,
              activitySinceDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            });
          })
        );
      }),
      ...monthlyNotifications.map(async (notification) => {
        console.log('Sending monthly notification to', notification.user);
        const daysInMonth = new Date(
          localDate.getUTCFullYear(),
          localDate.getUTCMonth() + 1,
          0
        ).getUTCDate();
        await Promise.all(
          notification.user.teamMemberships.map((membership) => {
            sendNotification({
              notificationType: NotificationType.monthly,
              teamId: membership.teamId,
              notificationUser: notification.user,
              activitySinceDate: new Date(Date.now() - daysInMonth * 24 * 60 * 60 * 1000),
            });
          })
        );
      }),
    ]);

    console.log('Completed sending notifications');
    return;
  } catch (error) {
    console.error(error);
    throw error;
  }
});

const sendNotification = async ({
  notificationType,
  teamId,
  notificationUser,
  activitySinceDate,
}: {
  notificationType: NotificationType;
  teamId: string;
  notificationUser: User;
  activitySinceDate: Date;
}) => {
  // Send the notification
  // - Get the team and all members
  const team = await prisma.team.findUnique({
    where: {
      id: teamId,
    },
    include: {
      members: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!team) {
    console.error('Team not found', teamId);
    return;
  }
  // For each member:
  // - get their activity since the last notification
  // - send the activity to OpenAI for summarization and store the summary in the database
  const teamActivity = await Promise.all(
    team.members.map(async (member) => {
      const activity = await prisma.activity.findMany({
        where: {
          userId: member.userId,
          activityDate: {
            gte: activitySinceDate,
          },
        },
      });

      if (!activity) {
        return {
          user: member.user,
          activity: [],
        };
      }

      // Send activity to OpenAI for summarization
      const chatCompletion = await openAI.chat.completions.create({
        model: 'gpt-3.5-turbo-16k',
        messages: [
          {
            role: 'system',
            content: ACTIVITY_SUMMARIZATION_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            // eslint-disable-next-line max-len
            content: `Please summarize the following activities for this particular team member.

Team Member: ${member.user.name}
Activities: ${activity.map((a) => a.summary).join('\n\n- ')}`,
          },
        ],
        temperature: 0,
      });
      const summary = chatCompletion.choices[0].message.content;

      await prisma.activitiesSummary.create({
        data: {
          forUserId: notificationUser.id,
          teamId: team.id,
          summary,
        },
      });

      return {
        user: member.user,
        activity,
        summary,
      };
    })
  );

  // Compile team summmaries and send the message to the user and store it in database
  const chatCompletion = await openAI.chat.completions.create({
    model: 'gpt-3.5-turbo-16k',
    messages: [
      {
        role: 'system',
        content: TEAM_ACTVIITY_SUMMARIZATION_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        // eslint-disable-next-line max-len
        content: `Please summarize the following activities for a team. This message will be sent to each team member. Use markdown for styling and formatting.

Activities: ${teamActivity.map((a) => a.summary).join('\n\n- ')}`,
      },
    ],
    temperature: 0,
  });
  const activitySummaryMessage = chatCompletion.choices[0].message.content;

  const updateMessage = `Here's your ${capitalize(notificationType)} update for *${team.name}*:
  
${activitySummaryMessage}`;

  // Send to user on Slack
  const [slackInstallation, integrationAccount] = await Promise.all([
    prisma.integrationInstallation.findFirst({
      where: {
        integrationName: INTEGRATION_NAMES.SLACK,
        organizationId: team.organizationId,
      },
    }),
    prisma.integrationAccount.findUnique({
      where: {
        integrationName_userId_organizationId: {
          userId: notificationUser.id,
          integrationName: INTEGRATION_NAMES.SLACK,
          organizationId: team.organizationId,
        },
      },
    }),
  ]);

  if (!slackInstallation || !integrationAccount) {
    console.error('Slack installation or integration account not found');
    return;
  }
  const web = new WebClient(slackInstallation.accessToken as string);
  web.chat.postMessage({
    channel: integrationAccount.externalId,
    text: updateMessage,
  });

  // Save message
  await prisma.teamUpdateMessage.create({
    data: {
      sentToId: notificationUser.id,
      teamId: team.id,
      message: updateMessage,
    },
  });

  console.log('Finished sending notification');
};
