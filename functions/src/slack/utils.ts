import { Installation, InstallationQuery } from '@slack/bolt';
import { app } from './index';
import * as logger from 'firebase-functions/logger';
import { PrismaClient, User, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

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

  if (slackId !== undefined && isEnterpriseInstall !== undefined) {
    const slackInstall = await getInstallationFromDatabase(slackId);

    if (!slackInstall) {
      // New installation, add to database and create organization
      await prisma.slackInstallation.create({
        data: {
          slackId: slackId,
          isEnterpriseInstall: isEnterpriseInstall,
          installation: JSON.stringify(installation),
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
          installation: {
            ...(slackInstall.installation as Prisma.JsonObject),
            user: installation.user,
            appId: installation.appId,
            authversion: installation.authVersion,
            bot: installation.bot,
          },
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

  const slackUserData = await app.client.users.profile.get({
    token: process.env.SLACK_BOT_TOKEN,
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
