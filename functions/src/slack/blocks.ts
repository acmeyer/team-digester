/* eslint-disable max-len */
import { KnownBlock, HomeView, Button, Option, StaticSelect } from '@slack/bolt';
import * as logger from 'firebase-functions/logger';
import { User, NotificationType, NotificationSetting, IntegrationAccount } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import * as crypto from 'crypto';
import { flatMap, startCase, sortBy, indexOf } from 'lodash';
import {
  OauthStateStore,
  OrganizationWithIntegrationAccounts,
  OrganizationWithIntegrationAccountsAndInstallations,
  UserWithTeams,
  OrganizationWithTeams,
  UserWithNotificationSettings,
} from '../types';
import { NOTIFICATION_TIMING_OPTIONS } from './utils';
import { INTEGRATIONS, Integrations, Integration } from '../lib/integrations';
import { INTEGRATION_NAMES } from '../lib/constants';
import {
  Installation as GithubIntegrationInstallationData,
  User as GithubAccount,
} from '@octokit/webhooks-types';
import { githubApiRequestWithRetry } from '../lib/github';

export const createAppHomeView = async (
  slackUserId: string,
  slackOrgId: string
): Promise<HomeView> => {
  logger.info('createAppHomeView', slackUserId, slackOrgId, { structuredData: true });

  // Determine blocks to show based on user, organization, and team states
  const organization = await prisma.organization.findUnique({
    where: {
      slackId: slackOrgId,
    },
    include: {
      teams: {
        include: {
          members: {
            include: {
              user: true,
            },
          },
        },
      },
      integrationAccounts: true,
      integrationInstallations: true,
    },
  });

  if (!organization) {
    // Something went wrong, org should exist
    logger.error('Organization not found', slackUserId, slackOrgId, { structuredData: true });
    throw new Error('Organization not found');
  }

  const user = await prisma.integrationAccount
    .findUnique({
      where: {
        integrationName_externalId_organizationId: {
          externalId: slackUserId,
          integrationName: INTEGRATION_NAMES.SLACK,
          organizationId: organization.id,
        },
      },
      include: {
        user: {
          include: {
            teamMemberships: {
              include: {
                team: {
                  include: {
                    members: {
                      include: {
                        user: true,
                      },
                    },
                  },
                },
              },
            },
            notificationSettings: true,
          },
        },
      },
    })
    .then((account) => account?.user);
  const integrations = INTEGRATIONS;

  if (!user) {
    // Something went wrong, user and org should exist
    logger.error('User not found', slackUserId, slackOrgId, {
      structuredData: true,
    });
    throw new Error('User not found');
  }

  const isNewUser = user.teamMemberships.length < 1;
  const orgHasIntegrations =
    organization.integrationAccounts.length > 0 || organization.integrationInstallations.length > 0;

  const integrationsBlocks = await integrationsSection(user, organization, integrations);

  return {
    type: 'home',
    blocks: [
      ...(isNewUser ? newUserSection(user) : returningUserSection(user)),
      ...(!orgHasIntegrations
        ? [...integrationsBlocks, ...teamsSection(user, organization), ...settingsSection(user)]
        : [...teamsSection(user, organization), ...integrationsBlocks, ...settingsSection(user)]),
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
  const userTeams = user.teamMemberships.map((membership) => membership.team);

  const createTeamButton = {
    type: 'button',
    text: {
      type: 'plain_text',
      text: 'Create New Team',
      emoji: true,
    },
    style: 'primary',
    value: 'show_create_team',
    action_id: 'show_create_team',
  } as Button;

  const joinTeamButton = {
    type: 'button',
    text: {
      type: 'plain_text',
      text: 'Join a Team',
      emoji: true,
    },
    value: 'show_join_team',
    action_id: 'show_join_team',
  } as Button;

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Your Teams',
        emoji: true,
      },
    },
    {
      type: 'divider',
    },
  ] as KnownBlock[];

  if (orgTeams.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Get started by creating a new team.',
      },
    });
  } else if (userTeams.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'You are not a member of any teams yet. Click to join a team or create a new one.',
      },
    });
  } else {
    blocks.push(
      ...userTeams.map(
        (team) =>
          ({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${team.name}*\nMembers: ${team.members
                .map((membership) => membership.user.name)
                .join(', ')}`,
            },
            accessory: {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Manage Team',
                emoji: true,
              },
              value: team.id,
              action_id: 'show_edit_team',
            },
          } as KnownBlock)
      )
    );
  }

  const footerBlocks = [createTeamButton];
  if (orgTeams.length > userTeams.length) {
    footerBlocks.push(joinTeamButton);
  }

  blocks.push({
    type: 'actions',
    block_id: 'team_actions',
    elements: footerBlocks,
  });

  return blocks;
};

const addIntegrationConnectionButton = ({
  user,
  organization,
  integration,
  additionalActions,
  isInstallation,
}: {
  user: User;
  organization: OrganizationWithIntegrationAccounts;
  integration: Integration;
  additionalActions?: (Button | StaticSelect)[];
  isInstallation?: boolean;
}): KnownBlock => {
  const state = crypto.randomBytes(16).toString('hex');
  const stateData: OauthStateStore = {
    organizationId: organization.id,
    userId: user.id,
  };
  redis.set(`oauth:state:${state}`, JSON.stringify(stateData));
  const connectionUrl = isInstallation
    ? integration.getInstallationUrl(state)
    : integration.getAuthorizationUrl(state);

  const actions: (Button | StaticSelect)[] = [
    {
      type: 'button',
      text: {
        type: 'plain_text',
        text: `Connect ${integration.label}`,
        emoji: true,
      },
      action_id: 'connect_integration',
      url: connectionUrl,
    } as Button,
  ];

  if (additionalActions) {
    additionalActions.forEach((action) => actions.push(action));
  }

  return {
    type: 'actions',
    block_id: `connect_${integration.value}`,
    elements: actions,
  };
};

const integrationBlocks = async (
  integration: Integration,
  organization: OrganizationWithIntegrationAccountsAndInstallations,
  user: User
): Promise<KnownBlock[]> => {
  const integrationInstallation = organization.integrationInstallations.find(
    (ii) => ii.integrationName === integration.value
  );
  const integrationAccounts = organization.integrationAccounts.filter(
    (ic: IntegrationAccount) => ic.integrationName === integration.value
  );

  const integrationBlocks = [
    {
      type: 'section',
      block_id: `integration_${integration.value}`,
      text: {
        type: 'mrkdwn',
        text: `*${integration.label}*`,
      },
    },
  ] as KnownBlock[];

  // Github is the only integration for now and it has some custom logic
  // TODO: update this when more integrations are added
  if (integration.value === INTEGRATION_NAMES.GITHUB) {
    // Get users integration account for given integration and organization
    const integrationAccount = integrationAccounts.find(
      (ia) => ia.organizationId === organization.id && ia.userId === user.id
    );

    if (integrationInstallation) {
      integrationBlocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `:white_check_mark: Installed on ${integrationInstallation.accountName}'s account`,
          },
        ],
      });

      if (!integrationAccount) {
        integrationBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `You have not connected your GitHub account yet. In order to share your actvity with your team, you'll need to tell us who you are on ${integration.label}. You can do this by either connecting your account directly or selecting your ${integration.label} account below.`,
          },
        });

        let membersSelect: StaticSelect | undefined;
        if (
          (integrationInstallation.data as unknown as GithubIntegrationInstallationData)
            .target_type === 'Organization'
        ) {
          // Get the members of organization and use those as options in the dropdown
          const { data: orgMembers } = await githubApiRequestWithRetry(
            integrationInstallation,
            'GET /orgs/{org}/members',
            {
              org: (integrationInstallation.data as unknown as GithubIntegrationInstallationData)
                .account.login,
            }
          );

          const membersOptions = orgMembers.map((member: GithubAccount) => ({
            text: {
              type: 'plain_text',
              text: member.login,
              emoji: true,
            },
            value: member.login,
          }));

          membersSelect = {
            type: 'static_select',
            placeholder: {
              type: 'plain_text',
              text: 'Select your username',
              emoji: true,
            },
            options: membersOptions,
            action_id: 'github_username_select',
          } as StaticSelect;
        }

        integrationBlocks.push(
          addIntegrationConnectionButton({
            user,
            organization,
            integration,
            additionalActions: membersSelect ? [membersSelect] : undefined,
            isInstallation: false, // Just using OAuth for this connection, since install is already done
          })
        );
      } else {
        integrationBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `You're connected as *@${integrationAccount.username}*`,
          },
        });
      }

      return integrationBlocks;
    } else {
      integrationBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${integration.description}`,
        },
      });
    }

    // If the integration is not installed, then we need to show the connect button
    return [
      ...integrationBlocks,
      addIntegrationConnectionButton({ user, organization, integration, isInstallation: true }),
    ];
  }

  return [
    ...integrationBlocks,
    addIntegrationConnectionButton({ user, organization, integration, isInstallation: false }),
  ];
};

const integrationsSection = async (
  user: User,
  organization: OrganizationWithIntegrationAccountsAndInstallations,
  integrations: Integrations
): Promise<KnownBlock[]> => {
  const [detailsSection] = await Promise.all(
    flatMap(integrations, (integration: Integration) => {
      return integrationBlocks(integration, organization, user);
    })
  );

  return [
    {
      type: 'header',
      block_id: 'integrations_header',
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

const getNotificationSettingOption = (type: string): Option => {
  switch (type) {
    case NotificationType.daily:
      return {
        text: {
          type: 'plain_text',
          text: 'Daily',
          emoji: true,
        },
        description: {
          type: 'plain_text',
          text: "Receive a summary of your team's activity every week day.",
        },
        value: NotificationType.daily,
      };
    case NotificationType.weekly:
      return {
        text: {
          type: 'plain_text',
          text: 'Weekly',
          emoji: true,
        },
        description: {
          type: 'plain_text',
          text: "Receive a summary of your team's activity every week.",
        },
        value: NotificationType.weekly,
      };
    case NotificationType.monthly:
      return {
        text: {
          type: 'plain_text',
          text: 'Monthly',
          emoji: true,
        },
        description: {
          type: 'plain_text',
          text: "Receive a summary of your team's activity every month on the 1st of the month.",
        },
        value: NotificationType.monthly,
      };
    default:
      // this should never happen
      return {
        text: {
          type: 'plain_text',
          text: 'Never',
          emoji: true,
        },
        value: 'none',
      };
  }
};

const getNotificationTimingSelectedOptions = (
  setting: NotificationSetting,
  timingOption: string
): Option | undefined => {
  const currentValue = {
    hour: setting.hour,
    dayOfWeek: setting.dayOfWeek,
    dayOfMonth: setting.dayOfMonth,
  };
  if (currentValue && currentValue !== null) {
    const options =
      NOTIFICATION_TIMING_OPTIONS[timingOption as 'hour' | 'dayOfWeek' | 'dayOfMonth'];

    if (timingOption === 'hour') {
      const time = currentValue.hour;
      return options.find((option) => option.value === time?.toString());
    } else if (timingOption === 'dayOfWeek') {
      const day = currentValue.dayOfWeek;
      return options.find((option) => option.value === day?.toString());
    } else if (timingOption === 'dayOfMonth') {
      const day = currentValue.dayOfMonth;
      return options.find((option) => option.value === day?.toString());
    }
  }

  return undefined;
};

const timingNotificationSettingsSection = (
  userNotficationSettings: NotificationSetting[]
): KnownBlock[] => {
  const blocks = [
    {
      block_id: 'notification_timing_options',
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*When would you like your summaries sent to you?*',
      },
    } as KnownBlock,
  ];

  // for each enabled notification setting, show options for timing, sort by type: daily, weekly, monthly
  const order = [NotificationType.daily, NotificationType.weekly, NotificationType.monthly];
  sortBy(userNotficationSettings, (o) => indexOf(order, o.type)).map((setting) => {
    blocks.push({
      type: 'section',
      block_id: `notification_timing_${setting.type}_section`,
      text: {
        type: 'mrkdwn',
        text: `*${startCase(setting.type)} notifications*`,
      },
    } as KnownBlock);
    blocks.push({
      type: 'divider',
    } as KnownBlock);
    switch (setting.type) {
      case NotificationType.daily:
        blocks.push({
          type: 'section',
          block_id: `${setting.type}_hour`,
          text: {
            type: 'mrkdwn',
            text: "The time of day you would like to receive a summary of your team's activity every week day.",
          },
          accessory: {
            type: 'static_select',
            action_id: 'notification_timing',
            placeholder: {
              type: 'plain_text',
              text: 'Time of day',
              emoji: true,
            },
            options: NOTIFICATION_TIMING_OPTIONS.hour,
            initial_option: getNotificationTimingSelectedOptions(setting, 'hour'),
          },
        } as KnownBlock);
        break;
      case NotificationType.weekly:
        blocks.push({
          type: 'section',
          block_id: `${setting.type}_dayOfWeek`,
          text: {
            type: 'mrkdwn',
            text: "The day of the week you would like to receive a summary of your team's activity every week.",
          },
          accessory: {
            type: 'static_select',
            action_id: 'notification_timing',
            placeholder: {
              type: 'plain_text',
              text: 'Day of week',
              emoji: true,
            },
            options: NOTIFICATION_TIMING_OPTIONS.dayOfWeek,
            initial_option: getNotificationTimingSelectedOptions(setting, 'dayOfWeek'),
          },
        } as KnownBlock);
        blocks.push({
          type: 'section',
          block_id: `${setting.type}_hour`,
          text: {
            type: 'mrkdwn',
            text: "The time of day you would like to receive a summary of your team's activity every week.",
          },
          accessory: {
            type: 'static_select',
            action_id: 'notification_timing',
            placeholder: {
              type: 'plain_text',
              text: 'Time of day',
              emoji: true,
            },
            options: NOTIFICATION_TIMING_OPTIONS.hour,
            initial_option: getNotificationTimingSelectedOptions(setting, 'hour'),
          },
        } as KnownBlock);
        break;
      case NotificationType.monthly:
        blocks.push({
          type: 'section',
          block_id: `${setting.type}_dayOfMonth`,
          text: {
            type: 'mrkdwn',
            text: "The day of the month you would like to receive a summary of your team's activity every month.",
          },
          accessory: {
            type: 'static_select',
            action_id: 'notification_timing',
            placeholder: {
              type: 'plain_text',
              text: 'Day of month',
              emoji: true,
            },
            options: NOTIFICATION_TIMING_OPTIONS.dayOfMonth,
            initial_option: getNotificationTimingSelectedOptions(setting, 'dayOfMonth'),
          },
        } as KnownBlock);
        blocks.push({
          type: 'section',
          block_id: `${setting.type}_hour`,
          text: {
            type: 'mrkdwn',
            text: "The time of day you would like to receive a summary of your team's activity every month.",
          },
          accessory: {
            type: 'static_select',
            action_id: 'notification_timing',
            placeholder: {
              type: 'plain_text',
              text: 'Time of day',
              emoji: true,
            },
            options: NOTIFICATION_TIMING_OPTIONS.hour,
            initial_option: getNotificationTimingSelectedOptions(setting, 'hour'),
          },
        } as KnownBlock);
        break;
      default:
        break;
    }
  });

  return blocks;
};

const settingsSection = (user: UserWithNotificationSettings): KnownBlock[] => {
  const userNotficationSettings = user.notificationSettings;
  let initialNotificationSettings = [] as Option[];
  if (userNotficationSettings && userNotficationSettings.length > 0) {
    initialNotificationSettings = userNotficationSettings
      .filter((setting) => setting.isEnabled)
      .map((setting) => {
        return getNotificationSettingOption(setting.type);
      });
  }

  const notificationTypes = [];
  // eslint-disable-next-line guard-for-in
  for (const type in NotificationType) {
    notificationTypes.push(type);
  }

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Notification Settings',
        emoji: true,
      },
    },
    {
      type: 'divider',
    },
    {
      block_id: 'notification_frequency',
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*What types of summaries would you like to be sent to you?*',
      },
      accessory: {
        type: 'checkboxes',
        initial_options:
          initialNotificationSettings?.length > 0 ? initialNotificationSettings : undefined,
        options: notificationTypes.map((type: string) => {
          return getNotificationSettingOption(type);
        }),
        action_id: 'notification_frequency',
      },
    },
  ] as KnownBlock[];

  const enabledNotficationSettings = user.notificationSettings.filter(
    (setting) => setting.isEnabled
  );
  if (enabledNotficationSettings && enabledNotficationSettings.length > 0) {
    blocks.push(...timingNotificationSettingsSection(enabledNotficationSettings));
  }
  return blocks;
};
