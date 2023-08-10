import {
  AckFn,
  SayArguments,
  DialogValidation,
  Context,
  SlackAction,
  BlockElementAction,
  BlockAction,
  ButtonAction,
  View,
  Option,
} from '@slack/bolt';
import { KnownBlock, ModalView, WebClient } from '@slack/web-api';
import * as logger from 'firebase-functions/logger';
import { NotificationType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { refreshHomeView } from './viewHandlers';
import { startCase } from 'lodash';
import { findUserFromSlackId } from '../lib/utils';
import { INTEGRATION_NAMES } from '../lib/constants';

type NotificationSettingsState = {
  values: {
    notification_frequency: {
      notification_frequency: { type: string; selected_options: Option[] };
    };
    daily_timeOfDay?: {
      notification_timing: { type: string; selected_option: Option };
    };
    weekly_timeOfDay?: {
      notification_timing: { type: string; selected_option: Option };
    };
    weekly_dayOfWeek?: {
      notification_timing: { type: string; selected_option: Option };
    };
    monthly_timeOfDay?: {
      notification_timing: { type: string; selected_option: Option };
    };
    monthly_dayOfMonth?: {
      notification_timing: { type: string; selected_option: Option };
    };
  };
};

type Timing = {
  notification_timing: { type: string; selected_option: Option };
};

type GroupedOptions = {
  daily: Array<{ timeOfDay?: string; dayOfWeek?: string }>;
  weekly: Array<{ timeOfDay?: string; dayOfWeek?: string }>;
  monthly: Array<{ timeOfDay?: string; dayOfMonth?: string }>;
};

const defaultTimingForNotificationType = {
  [NotificationType.daily]: '8am',
  [NotificationType.weekly]: 'friday:8am',
  [NotificationType.monthly]: 'first:8am',
};

export const connectIntegrationHandler = async ({
  ack,
  context,
}: {
  ack: AckFn<void> | AckFn<string | SayArguments> | AckFn<DialogValidation>;
  context: Context;
}) => {
  // Necessary to acknowledge this action, despite not needing to do anything to avoid error showing in Slack
  ack();
  logger.info('connectIntegration called', context, { structuredData: true });
};

export const selectTeamMembersHandler = async ({
  ack,
  context,
}: {
  ack: AckFn<void> | AckFn<string | SayArguments> | AckFn<DialogValidation>;
  context: Context;
}) => {
  // Necessary to acknowledge this action, despite not needing to do anything to avoid error showing in Slack
  ack();
  logger.info('selectTeamMembers called', context, { structuredData: true });
};

const teamModal = ({
  teamName,
  teamMembers,
  type,
  teamId,
}: {
  teamName: string;
  teamMembers: string[];
  type: 'create' | 'edit';
  teamId?: string;
}): View => ({
  type: 'modal',
  callback_id: `${type}_team_modal`,
  title: {
    type: 'plain_text',
    text: `${type === 'create' ? 'Create a new team' : 'Edit team'}`,
  },
  submit: {
    type: 'plain_text',
    text: `${type === 'create' ? 'Create' : 'Save'}`,
  },
  close: {
    type: 'plain_text',
    text: 'Cancel',
  },
  blocks: [
    {
      type: 'input',
      block_id: 'team_name',
      element: {
        type: 'plain_text_input',
        action_id: 'team_name',
        placeholder: {
          type: 'plain_text',
          text: 'Enter a team name',
        },
        initial_value: teamName,
      },
      label: {
        type: 'plain_text',
        text: 'Team name',
      },
    },
    {
      type: 'section',
      block_id: 'team_members',
      text: {
        type: 'mrkdwn',
        text: 'Select users to add to the team',
      },
      accessory: {
        action_id: 'team_members_select',
        type: 'multi_users_select',
        initial_users: teamMembers,
        placeholder: {
          type: 'plain_text',
          text: 'Select team members',
        },
      },
    },
  ],
  private_metadata: JSON.stringify({
    teamId: teamId,
  }),
});

const createTeamsModal = async (slackUserId: string, slackOrgId: string): Promise<ModalView> => {
  // Get list of teams
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
    },
  });

  if (!organization) {
    throw new Error('Organization or user not found');
  }

  const user = await findUserFromSlackId(slackUserId, organization.id);
  const teamBlocks = organization.teams.map((team) => {
    // Find out if user is a member of this team
    const isMember = team.members.some((member) => member.user.id === user?.id);

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${team.name}*\nMembers: ${team.members
          .map((member) => member.user.name)
          .join(', ')}`,
      },
      accessory: {
        type: 'button',
        text: {
          type: 'plain_text',
          text: isMember ? 'Leave' : 'Join',
        },
        style: isMember ? 'danger' : 'primary',
        action_id: isMember ? 'leave_team' : 'join_team',
        value: team.id,
      },
    } as KnownBlock;
  });

  return {
    type: 'modal',
    callback_id: 'join_team_modal',
    title: {
      type: 'plain_text',
      text: 'Join a team',
    },
    close: {
      type: 'plain_text',
      text: 'Close',
    },
    blocks: teamBlocks,
  };
};

export const refreshTeamsModal = async (
  client: WebClient,
  token: string | undefined,
  slackUserId: string,
  slackOrgId: string,
  viewId?: string
) => {
  if (!viewId) {
    return;
  }

  const teamsModal = await createTeamsModal(slackUserId, slackOrgId);
  await client.views.update({
    token: token,
    view_id: viewId,
    view: teamsModal,
  });
};

export const showCreateTeamHandler = async ({
  ack,
  body,
  context,
  client,
}: {
  ack: AckFn<void> | AckFn<string | SayArguments> | AckFn<DialogValidation>;
  body: SlackAction;
  context: Context;
  client: WebClient;
}) => {
  ack();

  const userId = body.user.id;
  logger.info('showCreateTeam called', context, { structuredData: true });

  client.views.open({
    token: context.botToken,
    trigger_id: (body as BlockAction<BlockElementAction>).trigger_id,
    view: teamModal({
      teamName: '',
      teamMembers: [userId],
      type: 'create',
    }),
  });
};

export const showEditTeamHandler = async ({
  ack,
  body,
  context,
  client,
}: {
  ack: AckFn<void> | AckFn<string | SayArguments> | AckFn<DialogValidation>;
  body: SlackAction;
  context: Context;
  client: WebClient;
}) => {
  ack();
  logger.info('showEditTeam called', context, { structuredData: true });

  const { trigger_id: triggerId, actions } = body as BlockAction<BlockElementAction>;
  const teamId = (actions as ButtonAction[]).find(
    (action) => action.action_id === 'show_edit_team'
  )?.value;
  const team = await prisma.team.findUnique({
    where: {
      id: teamId,
    },
    include: {
      members: {
        include: {
          user: true,
        },
      },
    },
  });
  if (!team) {
    throw new Error('No team ID found');
  }

  const slackTeamMemberIds = await Promise.all(
    team.members.map(async (member) => {
      return prisma.integrationAccount
        .findUnique({
          where: {
            integrationName_userId_organizationId: {
              integrationName: INTEGRATION_NAMES.SLACK,
              userId: member.user.id,
              organizationId: team.organizationId,
            },
          },
        })
        .then((integrationAccount) => integrationAccount?.externalId);
    })
  );

  client.views.open({
    token: context.botToken,
    trigger_id: triggerId,
    view: teamModal({
      teamName: team.name || '',
      teamMembers: slackTeamMemberIds as string[],
      type: 'edit',
      teamId: team.id,
    }),
  });
};

export const showJoinTeamHandler = async ({
  ack,
  body,
  context,
  client,
}: {
  ack: AckFn<void> | AckFn<string | SayArguments> | AckFn<DialogValidation>;
  body: SlackAction;
  context: Context;
  client: WebClient;
}) => {
  ack();
  logger.info('showJoinTeam called', context, { structuredData: true });

  const { trigger_id: triggerId } = body as BlockAction<BlockElementAction>;
  const { teamId } = context;
  if (!teamId) {
    throw new Error('Not found');
  }

  const teamsModal = await createTeamsModal(body.user.id, teamId);
  client.views.open({
    token: context.botToken,
    trigger_id: triggerId,
    view: teamsModal,
  });
};

export const joinTeamHandler = async ({
  ack,
  body,
  context,
  client,
}: {
  ack: AckFn<void> | AckFn<string | SayArguments> | AckFn<DialogValidation>;
  body: SlackAction;
  context: Context;
  client: WebClient;
}) => {
  ack();
  logger.info('joinTeam called', context, { structuredData: true });

  const { actions, view } = body as BlockAction<ButtonAction>;
  const teamId = actions[0].value;
  const { userId: slackUserId, teamId: slackOrgId } = context;

  if (!teamId || !slackUserId || !slackOrgId) {
    throw new Error('Not found');
  }
  const organization = await prisma.organization.findUnique({
    where: {
      slackId: slackOrgId,
    },
  });
  if (!organization) {
    throw new Error('Organization not found');
  }
  const user = await findUserFromSlackId(slackUserId, organization.id);
  if (!user) {
    throw new Error('User not found');
  }
  // Add to team
  await prisma.teamMembership.create({
    data: {
      teamId,
      userId: user.id,
    },
  });

  await Promise.all([
    refreshTeamsModal(client, context.botToken, slackUserId, slackOrgId, view?.id),
    refreshHomeView(client, slackUserId, slackOrgId),
  ]);
};

export const leaveTeamHandler = async ({
  ack,
  body,
  context,
  client,
}: {
  ack: AckFn<void> | AckFn<string | SayArguments> | AckFn<DialogValidation>;
  body: SlackAction;
  context: Context;
  client: WebClient;
}) => {
  ack();
  logger.info('leaveTeam called', context, { structuredData: true });

  const { actions, view } = body as BlockAction<ButtonAction>;
  const teamId = actions[0].value;
  const { userId: slackUserId, teamId: slackOrgId } = context;

  if (!teamId || !slackUserId || !slackOrgId) {
    throw new Error('Not found');
  }
  const organization = await prisma.organization.findUnique({
    where: {
      slackId: slackOrgId,
    },
  });
  if (!organization) {
    throw new Error('Organization not found');
  }
  const user = await findUserFromSlackId(slackUserId, organization.id);
  if (!user) {
    throw new Error('User not found');
  }

  // Remove from team
  await prisma.teamMembership.delete({
    where: {
      teamId_userId: {
        userId: user.id,
        teamId,
      },
    },
  });

  await Promise.all([
    refreshTeamsModal(client, context.botToken, slackUserId, slackOrgId, view?.id),
    refreshHomeView(client, slackUserId, slackOrgId),
  ]);
};

export const notificationFrequencyHandler = async ({
  ack,
  body,
  context,
  client,
}: {
  ack: AckFn<void> | AckFn<string | SayArguments> | AckFn<DialogValidation>;
  body: SlackAction;
  context: Context;
  client: WebClient;
}) => {
  ack();
  logger.info('notificationFrequencyHandler called', context, { structuredData: true });

  const { view } = body as BlockAction<ButtonAction>;
  if (!view) {
    return;
  }
  const { values } = view.state as unknown as NotificationSettingsState;
  const selectedNotificationTypes =
    values.notification_frequency.notification_frequency.selected_options.map(
      (option) => option.value
    );
  const { userId: slackUserId, teamId: slackOrgId } = context;
  if (!slackUserId || !slackOrgId) {
    throw new Error('Not found');
  }

  const organization = await prisma.organization.findUnique({
    where: {
      slackId: slackOrgId,
    },
  });
  if (!organization) {
    throw new Error('Organization not found');
  }
  const user = await findUserFromSlackId(slackUserId, organization.id);
  if (!user) {
    throw new Error('User not found');
  }

  const notificationTypes = [];
  // eslint-disable-next-line guard-for-in
  for (const type in NotificationType) {
    notificationTypes.push(type);
  }
  await Promise.all(
    notificationTypes.map(async (type) => {
      const notificationType = type as NotificationType;
      const isEnabled = selectedNotificationTypes.includes(notificationType);

      await prisma.notificationSetting.upsert({
        where: {
          userId_type: {
            userId: user.id,
            type: notificationType,
          },
        },
        update: {
          isEnabled: isEnabled,
        },
        create: {
          userId: user.id,
          type: notificationType,
          timing: defaultTimingForNotificationType[notificationType],
          isEnabled: isEnabled,
        },
      });
    })
  );
  selectedNotificationTypes.map(async (type) => {
    await prisma.notificationSetting.upsert({
      where: {
        userId_type: {
          userId: user.id,
          type: type as NotificationType,
        },
      },
      update: {},
      create: {
        userId: user.id,
        type: type as NotificationType,
        timing: defaultTimingForNotificationType[type as NotificationType],
      },
    });
  });

  await refreshHomeView(client, slackUserId, slackOrgId);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isTimingSetting = (obj: any): obj is Timing => {
  return obj && 'notification_timing' in obj;
};

export const notificationTimingHandler = async ({
  ack,
  body,
  context,
  client,
}: {
  ack: AckFn<void> | AckFn<string | SayArguments> | AckFn<DialogValidation>;
  body: SlackAction;
  context: Context;
  client: WebClient;
}) => {
  ack();
  logger.info('notificationTimingHandler called', context, { structuredData: true });

  const { view } = body as BlockAction<ButtonAction>;
  if (!view) {
    return;
  }

  const { values } = view.state as unknown as NotificationSettingsState;
  const selectedNotificationTypes =
    values.notification_frequency.notification_frequency.selected_options.map(
      (option) => option.value as NotificationType
    );

  const groupedOptions: GroupedOptions = {
    daily: [],
    weekly: [],
    monthly: [],
  };

  // eslint-disable-next-line guard-for-in
  for (const key in values) {
    const item = values[key as keyof typeof values];
    if (isTimingSetting(item)) {
      if (key.startsWith('daily')) {
        const newKey = key.replace('daily_', '');
        groupedOptions.daily.push({
          [newKey]: item.notification_timing.selected_option.value,
        });
      } else if (key.startsWith('weekly')) {
        const newKey = key.replace('weekly_', '');
        groupedOptions.weekly.push({
          [newKey]: item.notification_timing.selected_option.value,
        });
      } else if (key.startsWith('monthly')) {
        const newKey = key.replace('monthly_', '');
        groupedOptions.monthly.push({
          [newKey]: item.notification_timing.selected_option.value,
        });
      }
    }
  }

  const notificationTimingValues: { daily?: string; weekly?: string; monthly?: string } = {};

  if (groupedOptions.daily.length) {
    notificationTimingValues.daily = groupedOptions.daily[0].timeOfDay;
  }

  if (groupedOptions.weekly.length) {
    const weeklyParts: string[] = [];
    for (const item of groupedOptions.weekly) {
      if (item.dayOfWeek) weeklyParts.push(item.dayOfWeek);
      if (item.timeOfDay) weeklyParts.push(item.timeOfDay);
    }
    notificationTimingValues.weekly = weeklyParts.join(':');
  }

  if (groupedOptions.monthly.length) {
    const monthlyParts: string[] = [];
    for (const item of groupedOptions.monthly) {
      if (item.dayOfMonth) monthlyParts.push(item.dayOfMonth);
      if (item.timeOfDay) monthlyParts.push(item.timeOfDay);
    }
    notificationTimingValues.monthly = monthlyParts.join(':');
  }

  const { userId: slackUserId, teamId: slackOrgId } = context;
  if (!slackUserId || !slackOrgId) {
    throw new Error('Not found');
  }

  const organization = await prisma.organization.findUnique({
    where: {
      slackId: slackOrgId,
    },
  });
  if (!organization) {
    throw new Error('Organization not found');
  }
  const user = await findUserFromSlackId(slackUserId, organization.id);
  if (!user) {
    throw new Error('User not found');
  }

  selectedNotificationTypes.map(async (type: NotificationType) => {
    await prisma.notificationSetting.upsert({
      where: {
        userId_type: {
          userId: user.id,
          type: type as NotificationType,
        },
      },
      update: {
        timing: notificationTimingValues[type],
      },
      create: {
        userId: user.id,
        type: type as NotificationType,
        timing: notificationTimingValues[type] || defaultTimingForNotificationType[type],
      },
    });
  });

  await refreshHomeView(client, slackUserId, slackOrgId);
};

export const showAddUsernameHandler = async ({
  ack,
  body,
  context,
  client,
}: {
  ack: AckFn<void> | AckFn<string | SayArguments> | AckFn<DialogValidation>;
  body: SlackAction;
  context: Context;
  client: WebClient;
}) => {
  ack();

  const { userId: slackUserId, teamId: slackOrgId } = context;

  if (!slackUserId || !slackOrgId) {
    throw new Error('Not found');
  }

  const organization = await prisma.organization.findUnique({
    where: {
      slackId: slackOrgId,
    },
  });
  if (!organization) {
    throw new Error('Organization not found');
  }
  const user = await findUserFromSlackId(slackUserId, organization.id);
  if (!user) {
    throw new Error('User not found');
  }

  const { trigger_id: triggerId, actions } = body as BlockAction<ButtonAction>;
  const provider = actions[0].value;

  client.views.open({
    token: context.botToken,
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'add_username_modal',
      private_metadata: JSON.stringify({
        provider,
      }),
      title: {
        type: 'plain_text',
        text: `Add ${startCase(provider)} Username`,
      },
      submit: {
        type: 'plain_text',
        text: 'Submit',
      },
      blocks: [
        {
          type: 'input',
          block_id: `${provider}`,
          element: {
            type: 'plain_text_input',
            action_id: 'username',
            placeholder: {
              type: 'plain_text',
              text: 'Enter your username',
            },
          },
          label: {
            type: 'plain_text',
            text: `${startCase(provider)} Username`,
          },
        },
      ],
    },
  });
};
