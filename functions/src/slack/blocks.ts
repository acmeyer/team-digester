/* eslint-disable max-len */
import { KnownBlock, HomeView } from '@slack/bolt';
import * as logger from 'firebase-functions/logger';
import { IntegrationProviderAccount, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import * as crypto from 'crypto';
import { flatMap } from 'lodash';
import {
  OauthStateStore,
  OrganizationWithIntegrationConnections,
  UserWithTeams,
  OrganizationWithTeams,
} from '../types';
import { OAUTH_INTEGRATIONS, OAuthIntegrations, OAuthProvider } from '../lib/oauth';

export const createAppHomeView = async (
  slackUserId: string,
  slackOrgId: string
): Promise<HomeView> => {
  logger.info('createAppHomeView', slackUserId, slackOrgId, { structuredData: true });

  // Determine blocks to show based on user, organization, and team states
  const [user, organization] = await Promise.all([
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
  ]);
  const integrations = OAUTH_INTEGRATIONS;

  if (!user || !organization) {
    // Something went wrong, user and org should exist
    logger.error('User or organization not found', slackUserId, slackOrgId, {
      structuredData: true,
    });
    throw new Error('User or organization not found');
  }

  const isNewUser = user.teams.length < 1;
  const orgHasIntegrations = organization.integrationConnections.length > 0;

  return {
    type: 'home',
    blocks: [
      ...(isNewUser ? newUserSection(user) : returningUserSection(user)),
      ...(!orgHasIntegrations
        ? [
            ...integrationsSection(user, organization, integrations),
            ...teamsSection(user, organization),
            ...settingsSection(user),
          ]
        : [
            ...teamsSection(user, organization),
            ...integrationsSection(user, organization, integrations),
            ...settingsSection(user),
          ]),
    ],
  };
};

const newUserSection = (user: User): KnownBlock[] => {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Welcome to Team Digester${user?.firstName ? ', ' + user.firstName : ''}! :wave:`,
        emoji: true,
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Team Digester is an app for helping teams stay updated on what everyone is doing and coordinate efforts through easy communication and intelligent alerts. No more need for daily standups or weekly status meetings!',
      },
    },
  ];
};

const returningUserSection = (user: User): KnownBlock[] => {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Welcome back, ${user.firstName}! :wave:`,
        emoji: true,
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: "Check out the latest updates from your teams, make changes to your settings, or connect new integrations below. If you ever have any questions, don't hesitate to reach out to me by sending me a message in the Messages tab!",
      },
    },
  ];
};

const teamsSection = (user: UserWithTeams, organization: OrganizationWithTeams): KnownBlock[] => {
  const orgTeams = organization.teams;
  const userTeams = user.teams;

  const createTeamButton = {
    type: 'button',
    text: {
      type: 'plain_text',
      text: 'Create Team',
      emoji: true,
    },
    style: 'primary',
    value: 'create_team',
    action_id: 'create_team',
  };

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Teams',
        emoji: true,
      },
    },
    {
      type: 'divider',
    },
    orgTeams.length === 0
      ? {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Get started by creating a new team.',
          },
          accessory: createTeamButton,
        }
      : userTeams.length === 0
      ? {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'You are not a member of any teams yet. Click to join a team or create a new one.',
          },
          accessory: createTeamButton,
        }
      : {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Below is the list of teams that you are a member of. You can also create a new team or join others by clicking the buttons below.',
          },
        },
    // TODO: Add team list and buttons
  ];
};

const integrationBlocks = (
  integration: OAuthProvider,
  organization: OrganizationWithIntegrationConnections,
  user: User
): KnownBlock[] => {
  const integrationConnections = organization.integrationConnections;
  const integrationConnection = integrationConnections.find(
    (ic: IntegrationProviderAccount) => ic.provider === integration.value
  );
  const state = crypto.randomBytes(16).toString('hex');
  const stateData: OauthStateStore = {
    organizationId: organization.id,
    userId: user.id,
  };
  redis.set(`oauth:state:${state}`, JSON.stringify(stateData));

  const headerBlocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${integration.label}*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${integration.description}`,
      },
    },
  ] as KnownBlock[];

  if (integrationConnection) {
    return [
      ...headerBlocks,
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':white_check_mark: Connected',
          },
        ],
      },
    ];
  }

  return [
    ...headerBlocks,
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: `Connect ${integration.label}`,
            emoji: true,
          },
          action_id: 'connect_integration',
          url: `${integration.getAuthorizationUrl(state)}`,
        },
      ],
    },
  ];
};

const integrationsSection = (
  user: User,
  organization: OrganizationWithIntegrationConnections,
  integrations: OAuthIntegrations
): KnownBlock[] => {
  // const orgHasIntegrations = organization.integrationConnections.length > 0;

  const detailsSection = flatMap(integrations, (integration: OAuthProvider) => {
    return integrationBlocks(integration, organization, user);
  });

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Integrations',
        emoji: true,
      },
    },
    {
      type: 'divider',
    },
    ...detailsSection,
  ];
};

const settingsSection = (user: User): KnownBlock[] => {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Settings',
        emoji: true,
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `TODO: ${user.firstName}'s settings here`,
      },
    },
  ];
};
