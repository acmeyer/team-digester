/* eslint-disable max-len */
import { HomeView } from '@slack/bolt';
import * as logger from 'firebase-functions/logger';
import { Organization, PrismaClient, User } from '@prisma/client';
const prisma = new PrismaClient();
import {
  HomeTab,
  Header,
  Divider,
  Section,
  Actions,
  setIfTruthy,
  setIfFalsy,
  Button,
} from 'slack-block-builder';

export const createAppHomeView = async (
  slackUserId: string,
  slackOrgId: string
): Promise<HomeView> => {
  logger.info('createAppHomeView', slackUserId, slackOrgId, { structuredData: true });

  // Determine blocks to show based on user, organization, and team states
  const [user, organization, integrations] = await Promise.all([
    prisma.user.findUnique({
      where: {
        slackId: slackUserId,
      },
      include: {
        teams: true,
      },
    }),
    prisma.organization.findUnique({
      where: {
        slackId: slackOrgId,
      },
      include: {
        teams: true,
        integrationConnections: true,
      },
    }),
    prisma.integrationApplication.findMany(),
  ]);

  if (!user || !organization) {
    // Something went wrong, user and org should exist
    logger.error('User or organization not found', slackUserId, slackOrgId, {
      structuredData: true,
    });
    throw new Error('User or organization not found');
  }

  const isNewUser = user.teams.length < 1;
  const orgHasIntegrations = organization.integrationConnections.length > 0;
  // const orgHasTeams = organization.teams.length > 0;

  return HomeTab()
    .blocks(
      setIfTruthy(isNewUser, newUserBlocks(user)),
      setIfFalsy(isNewUser, returningUserBlocks(user)),
      setIfFalsy(orgHasIntegrations, [
        Section().text(
          'To get started, you will need to connect Team Digester to the apps and services that your team uses:'
        ),
        ...integrations
          .map((integration) => [
            Section().text(`Add ${integration.name} integration`),
            Actions().elements(
              Button({
                text: `Connect ${integration.name}`,
                actionId: `connect_${integration.id}`,
              }).primary()
            ),
          ])
          .flat(),
      ]),
      setIfTruthy(orgHasIntegrations, [
        ...teamsBlocks(user, organization),
        ...integrationBlocks(organization),
        ...settingsBlocks(user),
      ])
    )
    .buildToObject();
};

const newUserBlocks = (user: User) => {
  return [
    Header().text(
      `Welcome to Team Digester${user?.firstName ? ', ' + user.firstName : ''}! :wave:`
    ),
    Divider(),
    Section().text(
      'Team Digester is an app for helping teams stay updated on what everyone is doing and coordinate efforts through easy communication and intelligent alerts. No more need for daily standups or weekly status meetings!'
    ),
  ];
};

const returningUserBlocks = (user: User) => {
  return [
    Header().text(`Welcome back, ${user.firstName}! :wave:`),
    Divider(),
    Section().text(
      "Check out the latest updates from your teams, make changes to your settings, or connect new integrations below. If you ever have any questions, don't hesitate to reach out to me by sending me a message in the Messages tab!"
    ),
  ];
};

const teamsBlocks = (user: User, organization: Organization) => {
  return [
    Header().text('Teams'),
    Divider(),
    Section().text(
      `TODO: List teams from ${organization.name} and ones that ${user.firstName} is a member of here`
    ),
  ];
};

const integrationBlocks = (organization: Organization) => {
  return [
    Header().text('Integrations'),
    Divider(),
    Section().text(`TODO: List of integrations for ${organization.name} here`),
  ];
};

const settingsBlocks = (user: User) => {
  return [
    Header().text('Settings'),
    Divider(),
    Section().text(`TODO: ${user.firstName}'s settings here`),
  ];
};
