import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
// import { prisma } from '../lib/prisma';
import { NotificationType, PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();

// Manually run the task here https://console.cloud.google.com/cloudscheduler
export const notifications = onSchedule('0 * * * *', async (event) => {
  logger.info('Running notifications task', event, { structuredData: true });

  // Find all users that have a notification setting enabled for this time
  const localDate = new Date();
  const utcHour = localDate.getUTCHours();
  const utcDayOfWeek = localDate.getUTCDay();
  const utcDayOfMonth = localDate.getUTCDate();

  console.log('finding notifications', {
    utcHour,
    utcDayOfWeek,
    utcDayOfMonth,
  });

  try {
    const dailyNotifications = await prisma.notificationSetting.findMany({
      where: {
        isEnabled: true,
        type: NotificationType.daily,
        hourUTC: utcHour,
      },
      include: { user: true },
    });

    const weeklyNotifications = await prisma.notificationSetting.findMany({
      where: {
        isEnabled: true,
        type: NotificationType.weekly,
        dayOfWeekUTC: utcDayOfWeek,
        hourUTC: utcHour,
      },
      include: { user: true },
    });

    const monthlyNotifications = await prisma.notificationSetting.findMany({
      where: {
        isEnabled: true,
        type: NotificationType.monthly,
        dayOfMonthUTC: utcDayOfMonth,
        hourUTC: utcHour,
      },
      include: { user: true },
    });

    const allNotifications = [
      ...dailyNotifications,
      ...weeklyNotifications,
      ...monthlyNotifications,
    ];

    if (allNotifications.length === 0) {
      console.log('No notifications to send');
      return;
    }

    // Configure and send the notifications
    await Promise.all(
      allNotifications.map((notification) => {
        console.log(`Sending ${notification.type} notification to`, notification.user);
        // Add your notification sending logic here
      })
    );

    return;
  } catch (error) {
    console.error(error);
    throw error;
  }
});
