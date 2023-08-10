import { User } from '@prisma/client';
import { prisma } from './prisma';
import { INTEGRATION_NAMES } from './constants';

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
