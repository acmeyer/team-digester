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
} from '@slack/bolt';
import { KnownBlock, ModalView, WebClient } from '@slack/web-api';
import * as logger from 'firebase-functions/logger';
import { Config } from '../config';
import { prisma } from '../lib/prisma';
import { refreshHomeView } from './viewHandlers';

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
  const [organization, user] = await Promise.all([
    prisma.organization.findUnique({
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
    }),
    prisma.user.findUnique({
      where: {
        slackId: slackUserId,
      },
      include: {
        teamMemberships: {
          include: {
            team: true,
          },
        },
      },
    }),
  ]);

  if (!organization || !user) {
    throw new Error('Organization or user not found');
  }

  const teamBlocks = organization.teams.map((team) => {
    const isMember = user.teamMemberships.some((membership) => membership.team.id === team.id);
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
  slackUserId: string,
  slackOrgId: string,
  viewId?: string
) => {
  if (!viewId) {
    return;
  }

  const teamsModal = await createTeamsModal(slackUserId, slackOrgId);
  await client.views.update({
    token: Config.SLACK_BOT_TOKEN,
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
    token: Config.SLACK_BOT_TOKEN,
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

  client.views.open({
    token: Config.SLACK_BOT_TOKEN,
    trigger_id: triggerId,
    view: teamModal({
      teamName: team.name || '',
      teamMembers: team.members.map((member) => member.user.slackId),
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
    token: Config.SLACK_BOT_TOKEN,
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

  console.log('body', body);

  const { actions, view } = body as BlockAction<ButtonAction>;
  const teamId = actions[0].value;
  const { userId: slackUserId, teamId: slackOrgId } = context;

  const user = await prisma.user.findUnique({
    where: {
      slackId: slackUserId,
    },
  });

  if (!teamId || !user || !slackUserId || !slackOrgId) {
    throw new Error('Not found');
  }

  // Add to team
  await prisma.teamMembership.create({
    data: {
      teamId,
      userId: user.id,
    },
  });

  await Promise.all([
    refreshTeamsModal(client, slackUserId, slackOrgId, view?.id),
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

  const user = await prisma.user.findUnique({
    where: {
      slackId: slackUserId,
    },
  });

  if (!teamId || !user || !slackUserId || !slackOrgId) {
    throw new Error('Not found');
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
    refreshTeamsModal(client, slackUserId, slackOrgId, view?.id),
    refreshHomeView(client, slackUserId, slackOrgId),
  ]);
};
