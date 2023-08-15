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

    notificationTimingValues.daily = {
      hour,
      hourUTC: hour - tzOffset / 60,
    };
  }

  if (type === NotificationType.weekly) {
    const tzOffset = user.tzOffset || 0;
    const localDate = new Date();
    localDate.setUTCHours(hour - tzOffset / 60);
    localDate.setUTCDate(localDate.getUTCDate() + ((dayOfWeek - localDate.getUTCDay() + 7) % 7));

    const utcDayOfWeek = localDate.getUTCDay();

    notificationTimingValues.weekly = {
      hour,
      hourUTC: hour - tzOffset / 60,
      dayOfWeek,
      dayOfWeekUTC: utcDayOfWeek,
    };
  }

  if (type === NotificationType.monthly) {
    const tzOffset = user.tzOffset || 0;
    const localDate = new Date();
    localDate.setUTCHours(hour - tzOffset / 60);
    localDate.setUTCDate(dayOfMonth);

    const utcDayOfMonth = localDate.getUTCDate();

    notificationTimingValues.monthly = {
      hour,
      hourUTC: hour - tzOffset / 60,
      dayOfMonth,
      dayOfMonthUTC: utcDayOfMonth,
    };
  }

  return notificationTimingValues[type];
};
