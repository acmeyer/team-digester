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
  });

  try {
    const dailyNotifications = await prisma.notificationSetting.findMany({
      where: {
        isEnabled: true,
        type: NotificationType.daily,
        hourUTC: utcHour,
        dailyUTCOffset: dailyOffset,
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
