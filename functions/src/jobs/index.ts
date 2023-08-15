import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { prisma } from '../lib/prisma';
import { NotificationType } from '@prisma/client';
import { DateTime } from 'luxon';

// Manually run the task here https://console.cloud.google.com/cloudscheduler
export const notifications = onSchedule('0 * * * *', async (event) => {
  logger.info('Running notifications task', event, { structuredData: true });

  // Find all users that have a notification setting enabled for this time
  const dt = DateTime.utc();
  const utcHour = dt.get('hour');
  const utcDayOfWeek = dt.get('weekday');
  const utcDayOfMonth = dt.get('day');

  const notifications = await prisma.notificationSetting.findMany({
    where: {
      AND: [
        {
          isEnabled: true,
          OR: [
            {
              AND: [
                {
                  type: NotificationType.daily,
                },
                {
                  hour: utcHour,
                },
              ],
            },
            {
              AND: [
                {
                  type: NotificationType.weekly,
                },
                {
                  dayOfWeek: utcDayOfWeek,
                },
                {
                  hour: utcHour,
                },
              ],
            },
            {
              AND: [
                {
                  type: NotificationType.monthly,
                },
                {
                  dayOfMonth: utcDayOfMonth,
                },
                {
                  hour: utcHour,
                },
              ],
            },
          ],
        },
      ],
    },
    include: {
      user: true,
    },
  });

  // Configure the notification for them/their team
  notifications.map((notification) => {
    console.log(notification);
  });
  // Send them the message to them

  return;
});
