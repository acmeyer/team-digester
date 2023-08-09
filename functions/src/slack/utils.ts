import { Installation, InstallationQuery, Option } from '@slack/bolt';
import { app } from './index';
import * as logger from 'firebase-functions/logger';
import { User, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { Config } from '../config';

const getInstallationFromDatabase = async (id: string) => {
  return await prisma.slackInstallation.findUnique({
    where: {
      slackId: id,
    },
  });
};

export const saveInstallation = async (installation: Installation): Promise<void> => {
  logger.info('saveInstallation', installation, { structuredData: true });
  let slackId;
  let isEnterpriseInstall;
  if (installation.isEnterpriseInstall && installation.enterprise !== undefined) {
    slackId = installation.enterprise.id;
    isEnterpriseInstall = true;
  }
  if (installation.team !== undefined) {
    slackId = installation.team.id;
    isEnterpriseInstall = false;
  }

  const authToken =
    installation.tokenType === 'bot' ? installation.bot?.token : installation.user.token;

  if (slackId !== undefined && isEnterpriseInstall !== undefined) {
    const slackInstall = await getInstallationFromDatabase(slackId);

    if (!slackInstall) {
      // New installation, add to database and create organization
      await prisma.slackInstallation.create({
        data: {
          slackId: slackId,
          token: authToken || Config.SLACK_BOT_TOKEN,
          isEnterpriseInstall: isEnterpriseInstall,
          installation: installation as unknown as Prisma.JsonObject,
          organization: {
            create: {
              slackId: slackId,
              name: installation.enterprise?.name || installation.team?.name || '',
              isSlackEnterprise: isEnterpriseInstall,
            },
          },
        },
      });

      await findOrCreateUser(installation.user.id, slackId);
      return;
    } else {
      logger.info('Installation already exists, updating...', installation, {
        structuredData: true,
      });
      await prisma.slackInstallation.update({
        where: {
          slackId: slackId,
        },
        data: {
          token: authToken || Config.SLACK_BOT_TOKEN,
          installation: slackInstall.installation as Prisma.JsonObject,
        },
      });

      await findOrCreateUser(installation.user.id, slackId);
      return;
    }
  }
  throw new Error('Failed saving installation data to installationStore');
};

export const getInstallation = async (
  installQuery: InstallationQuery<boolean>
): Promise<Installation<'v1' | 'v2', boolean>> => {
  logger.info('fetchInstallation', installQuery, { structuredData: true });
  let installation;
  if (installQuery.isEnterpriseInstall && installQuery.enterpriseId !== undefined) {
    installation = await getInstallationFromDatabase(installQuery.enterpriseId);
  } else if (installQuery.teamId !== undefined) {
    installation = await getInstallationFromDatabase(installQuery.teamId);
  } else {
    throw new Error('Failed fetching installation');
  }
  if (!installation) {
    throw new Error('Failed fetching installation');
  }

  // Not sure about this
  const installationData = installation.installation as unknown as Installation<
    'v1' | 'v2',
    boolean
  >;
  return installationData;
};

export const deleteInstallation = async (
  installQuery: InstallationQuery<boolean>
): Promise<void> => {
  logger.info('deleteInstallation', installQuery, { structuredData: true });

  let installationId;
  if (installQuery.isEnterpriseInstall && installQuery.enterpriseId !== undefined) {
    installationId = installQuery.enterpriseId;
  } else if (installQuery.teamId !== undefined) {
    installationId = installQuery.teamId;
  } else {
    throw new Error('Failed deleting installation');
  }
  await prisma.slackInstallation.delete({
    where: {
      slackId: installationId,
    },
  });
};

export const findOrCreateUser = async (slackId: string, slackOrgId: string): Promise<User> => {
  logger.info('findOrCreateUser', slackId, slackOrgId, { structuredData: true });

  const user = await prisma.user.findUnique({
    where: {
      slackId: slackId,
    },
  });

  if (user) {
    return user;
  }

  const slackInstallation = await prisma.slackInstallation.findUnique({
    where: {
      slackId: slackOrgId,
    },
  });

  const slackUserData = await app.client.users.profile.get({
    token: slackInstallation?.token,
    user: slackId,
  });

  // Create the user
  return prisma.user.create({
    data: {
      slackId: slackId,
      email: slackUserData?.profile?.email,
      pictureUrl: slackUserData?.profile?.image_512,
      firstName: slackUserData?.profile?.first_name,
      lastName: slackUserData?.profile?.last_name,
      name: slackUserData?.profile?.real_name,
      organizations: {
        connect: {
          slackId: slackOrgId,
        },
      },
    },
  });
};

export const NOTIFICATION_TIMING_OPTIONS = {
  timeOfDay: [
    {
      text: {
        type: 'plain_text',
        text: '8:00 AM',
        emoji: true,
      },
      value: '8am',
    },
    {
      text: {
        type: 'plain_text',
        text: '12:00 PM',
        emoji: true,
      },
      value: '12pm',
    },
    {
      text: {
        type: 'plain_text',
        text: '5:00 PM',
        emoji: true,
      },
      value: '5pm',
    },
  ] as Option[],
  dayOfWeek: [
    {
      text: {
        type: 'plain_text',
        text: 'Monday',
        emoji: true,
      },
      value: 'monday',
    },
    {
      text: {
        type: 'plain_text',
        text: 'Tuesday',
        emoji: true,
      },
      value: 'tuesday',
    },
    {
      text: {
        type: 'plain_text',
        text: 'Wednesday',
        emoji: true,
      },
      value: 'wednesday',
    },
    {
      text: {
        type: 'plain_text',
        text: 'Thursday',
        emoji: true,
      },
      value: 'thursday',
    },
    {
      text: {
        type: 'plain_text',
        text: 'Friday',
        emoji: true,
      },
      value: 'friday',
    },
  ] as Option[],
  dayOfMonth: [
    {
      text: {
        type: 'plain_text',
        text: 'First of the month',
        emoji: true,
      },
      value: 'first',
    },
    {
      text: {
        type: 'plain_text',
        text: 'Last of the month',
        emoji: true,
      },
      value: 'last',
    },
  ] as Option[],
};
