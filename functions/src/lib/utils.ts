import { NotificationType, User } from '@prisma/client';
import { prisma } from './prisma';
import { INTEGRATION_NAMES } from './constants';
import { NotificationTimingValues } from '../types';

export const findUserFromSlackId = async (
  slackId: string,
  organizationId: string
): Promise<User | undefined> => {
  const integrationAccount = await prisma.integrationAccount.findUnique({
    where: {
      integrationName_externalId_organizationId: {
        externalId: slackId,
        integrationName: INTEGRATION_NAMES.SLACK,
        organizationId,
      },
    },
    include: {
      user: true,
    },
  });

  return integrationAccount?.user;
};

export const findSlackIdForUserAndOrganization = async (
  userId: string,
  organizationId: string
): Promise<string | undefined> => {
  return prisma.integrationAccount
    .findUnique({
      where: {
        integrationName_externalId_organizationId: {
          externalId: userId,
          integrationName: INTEGRATION_NAMES.SLACK,
          organizationId: organizationId,
        },
      },
    })
    .then((integrationAccount) => integrationAccount?.externalId);
};

export const getNotificationSettingValues = ({
  user,
  type,
  hour = 8,
  dayOfWeek = 5,
  dayOfMonth = 1,
}: {
  user: User;
  type: NotificationType;
  hour?: number | undefined;
  dayOfWeek?: number | undefined;
  dayOfMonth?: number | undefined;
}): NotificationTimingValues['daily' | 'weekly' | 'monthly'] => {
  const notificationTimingValues: NotificationTimingValues = {};

  if (type === NotificationType.daily) {
    const tzOffset = user.tzOffset || 0;
    let hourUTC = hour - tzOffset / 60;
    let dailyUTCOffset = 0;
    // Adjust for UTC offset
    if (hourUTC < 0) {
      hourUTC += 24;
      dailyUTCOffset = -1;
    } else if (hourUTC > 23) {
      hourUTC -= 24;
      dailyUTCOffset = 1;
    }

    notificationTimingValues.daily = {
      hour,
      hourUTC,
      dailyUTCOffset,
    };
  }

  if (type === NotificationType.weekly) {
    const tzOffset = user.tzOffset || 0;
    let hourUTC = hour - tzOffset / 60;
    let utcDayOfWeek = dayOfWeek;
    // Adjust for UTC offset
    if (hourUTC < 0) {
      hourUTC += 24;
      utcDayOfWeek = utcDayOfWeek - 1 < 0 ? 6 : utcDayOfWeek - 1;
    } else if (hourUTC > 23) {
      hourUTC -= 24;
      utcDayOfWeek = utcDayOfWeek + 1 > 6 ? 0 : utcDayOfWeek + 1;
    }

    notificationTimingValues.weekly = {
      hour,
      hourUTC,
      dayOfWeek,
      dayOfWeekUTC: utcDayOfWeek,
    };
  }

  if (type === NotificationType.monthly) {
    const tzOffset = user.tzOffset || 0;
    let hourUTC = hour - tzOffset / 60;
    let utcDayOfMonth = dayOfMonth;
    // Adjust for UTC offset
    // The dayOfMonth setting is only 1 for the 1st of month and -1 for the last day of the month
    // Therefore, we have to adjust the dayOfMonth setting based on the hourUTC accordingly
    if (hourUTC < 0) {
      hourUTC += 24;
      utcDayOfMonth = utcDayOfMonth - 1 === 0 ? -1 : utcDayOfMonth - 1;
    } else if (hourUTC > 23) {
      hourUTC -= 24;
      utcDayOfMonth = utcDayOfMonth + 1 === 0 ? 1 : utcDayOfMonth + 1;
    }

    notificationTimingValues.monthly = {
      hour,
      hourUTC,
      dayOfMonth,
      dayOfMonthUTC: utcDayOfMonth,
    };
  }

  return notificationTimingValues[type];
};
