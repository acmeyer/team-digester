/* eslint-disable max-len */
import { Installation, InstallationQuery, Option } from '@slack/bolt';
import { app } from './index';
import * as logger from 'firebase-functions/logger';
import { User, Prisma, IntegrationInstallation, Organization } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { Config } from '../config';
import { INTEGRATION_NAMES } from '../lib/constants';

const getInstallationFromDatabase = async (id: string) => {
  return await prisma.integrationInstallation.findUnique({
    where: {
      integrationName_externalId: {
        integrationName: INTEGRATION_NAMES.SLACK,
        externalId: id,
      },
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
      const integrationInstallation = await prisma.integrationInstallation.create({
        data: {
          integrationName: INTEGRATION_NAMES.SLACK,
          externalId: slackId,
          accountName: installation.enterprise
            ? installation.enterprise.name
            : installation.team?.name,
          accessToken: authToken || Config.SLACK_BOT_TOKEN,
          data: installation as unknown as Prisma.JsonObject,
        },
      });

      // Create or connect organization and user
      const org = await findOrCreateOrganizationFromSlack(
        integrationInstallation,
        installation,
        slackId
      );
      const user = await findOrCreateUserFromSlack(installation.user.id, org);
      await sendIntroMessage(integrationInstallation, installation.user.id, user);
      return;
    } else {
      logger.info('Installation already exists, updating...', installation, {
        structuredData: true,
      });
      const integrationInstallation = await prisma.integrationInstallation.update({
        where: {
          integrationName_externalId: {
            integrationName: INTEGRATION_NAMES.SLACK,
            externalId: slackId,
          },
        },
        data: {
          accessToken: authToken || Config.SLACK_BOT_TOKEN,
          data: slackInstall.data as Prisma.JsonObject,
          accountName: installation.enterprise
            ? installation.enterprise.name
            : installation.team?.name,
        },
      });
      // Create or connect organization and user
      const org = await findOrCreateOrganizationFromSlack(
        integrationInstallation,
        installation,
        slackId
      );
      await findOrCreateUserFromSlack(installation.user.id, org);
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
  const installationData = installation.data as unknown as Installation<'v1' | 'v2', boolean>;
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
  await prisma.integrationInstallation.delete({
    where: {
      integrationName_externalId: {
        integrationName: INTEGRATION_NAMES.SLACK,
        externalId: installationId,
      },
    },
  });

  // Future question? Should we remove all associated IntegrationAccounts too?
};

const findOrCreateOrganizationFromSlack = async (
  integrationInstallation: IntegrationInstallation,
  slackInstallation: Installation<'v1' | 'v2', boolean>,
  slackOrgId: string
): Promise<Organization> => {
  logger.info('findOrCreateOrganizationFromSlack', integrationInstallation, slackOrgId, {
    structuredData: true,
  });

  const organization = await prisma.organization.findUnique({
    where: {
      slackId: slackOrgId,
    },
  });

  if (organization) {
    return organization;
  }

  const newOrganization = await prisma.organization.create({
    data: {
      slackId: slackOrgId,
      name: slackInstallation.enterprise?.name || slackInstallation.team?.name,
      isSlackEnterprise: slackInstallation.isEnterpriseInstall,
    },
  });

  // If it's a new organization, connect IntegrationInstallation to it
  await prisma.integrationInstallation.update({
    where: {
      id: integrationInstallation.id,
    },
    data: {
      organization: {
        connect: {
          id: newOrganization.id,
        },
      },
    },
  });

  return newOrganization;
};

export const findOrCreateUserFromSlack = async (
  slackId: string,
  organization: Organization
): Promise<User> => {
  logger.info('findOrCreateUserFromSlack', slackId, { structuredData: true });

  // Try to find an integration account for the user
  const integrationAccount = await prisma.integrationAccount.findUnique({
    where: {
      integrationName_externalId_organizationId: {
        externalId: slackId,
        integrationName: INTEGRATION_NAMES.SLACK,
        organizationId: organization.id,
      },
    },
    include: {
      user: true,
    },
  });

  if (integrationAccount) {
    return integrationAccount.user;
  }

  // There's nothing we could find on this Slack user, so create one
  // Slack Installation must exist for this to work, this is an assumption
  const slackInstallation = await prisma.integrationInstallation.findUnique({
    where: {
      integrationName_externalId: {
        externalId: organization.slackId,
        integrationName: INTEGRATION_NAMES.SLACK,
      },
    },
  });

  // Try to find the user by email
  const { user: slackUserData } = await app.client.users.info({
    token: slackInstallation?.accessToken as string | undefined,
    user: slackId,
    include_locale: true,
  });

  const user = await prisma.user.findFirst({
    where: {
      email: slackUserData?.profile?.email,
    },
  });

  if (user) {
    // User exists, create a new integration account and connect to organization
    await prisma.integrationAccount.create({
      data: {
        integrationName: INTEGRATION_NAMES.SLACK,
        externalId: slackId,
        username: slackUserData?.profile?.display_name,
        name: slackUserData?.profile?.real_name,
        email: slackUserData?.profile?.email,
        pictureUrl: slackUserData?.profile?.image_512,
        accessToken: slackInstallation?.accessToken,
        rawProfileData: slackUserData?.profile as Prisma.JsonObject,
        rawAuthData: slackUserData as Prisma.JsonObject,
        organization: {
          connect: {
            id: organization.id,
          },
        },
        user: {
          connect: {
            id: user.id,
          },
        },
      },
    });
    return user;
  }

  // User doesn't exist, create a new user and connect to organization
  const newUser = await prisma.user.create({
    data: {
      email: slackUserData?.profile?.email,
      pictureUrl: slackUserData?.profile?.image_512,
      firstName: slackUserData?.profile?.first_name,
      lastName: slackUserData?.profile?.last_name,
      name: slackUserData?.profile?.real_name,
      tz: slackUserData?.tz,
      tzLabel: slackUserData?.tz_label,
      tzOffset: (slackUserData?.tz_offset || 0) / 60, // Convert to minutes, Slack returns seconds
      organizations: {
        connect: {
          id: organization.id,
        },
      },
    },
  });

  // Then create a new integration account and connect to user and organization
  await prisma.integrationAccount.create({
    data: {
      integrationName: INTEGRATION_NAMES.SLACK,
      externalId: slackId,
      username: slackUserData?.profile?.display_name,
      name: slackUserData?.profile?.real_name,
      email: slackUserData?.profile?.email,
      pictureUrl: slackUserData?.profile?.image_512,
      accessToken: slackInstallation?.accessToken,
      rawProfileData: slackUserData?.profile as Prisma.JsonObject,
      rawAuthData: slackUserData as Prisma.JsonObject,
      organization: {
        connect: {
          id: organization.id,
        },
      },
      user: {
        connect: {
          id: newUser.id,
        },
      },
    },
  });

  return newUser;
};

export const NOTIFICATION_TIMING_OPTIONS = {
  hour: [
    {
      text: {
        type: 'plain_text',
        text: '8:00 AM',
        emoji: true,
      },
      value: '8',
    },
    {
      text: {
        type: 'plain_text',
        text: '12:00 PM',
        emoji: true,
      },
      value: '12',
    },
    {
      text: {
        type: 'plain_text',
        text: '5:00 PM',
        emoji: true,
      },
      value: '17',
    },
  ] as Option[],
  dayOfWeek: [
    {
      text: {
        type: 'plain_text',
        text: 'Monday',
        emoji: true,
      },
      value: '1',
    },
    {
      text: {
        type: 'plain_text',
        text: 'Tuesday',
        emoji: true,
      },
      value: '2',
    },
    {
      text: {
        type: 'plain_text',
        text: 'Wednesday',
        emoji: true,
      },
      value: '3',
    },
    {
      text: {
        type: 'plain_text',
        text: 'Thursday',
        emoji: true,
      },
      value: '4',
    },
    {
      text: {
        type: 'plain_text',
        text: 'Friday',
        emoji: true,
      },
      value: '5',
    },
  ] as Option[],
  dayOfMonth: [
    {
      text: {
        type: 'plain_text',
        text: 'First of the month',
        emoji: true,
      },
      value: '1',
    },
    {
      text: {
        type: 'plain_text',
        text: 'Last of the month',
        emoji: true,
      },
      value: '-1',
    },
  ] as Option[],
};

const sendIntroMessage = async (
  integrationInstallation: IntegrationInstallation,
  slackId: string,
  user: User
): Promise<void> => {
  app.client.chat.postMessage({
    token: integrationInstallation.accessToken as string,
    channel: slackId,
    text: `Hi ${user.name || 'there'}! :wave:

Welcome to *Team Digester*! :tada:

Team Digester is a simple Slack app that helps you stay up to date with your team's activity on GitHub. You can choose to receive daily or weekly or month digests of your team's activity. I'll just send you a message when there's updates to share.

To get started with Team Digester, head over to the Home tab. That's where you can configure your teams, integrations, and notification settings.

Have a great day! :smile:`,
  });
};
