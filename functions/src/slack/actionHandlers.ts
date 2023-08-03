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
import { WebClient } from '@slack/web-api';
import * as logger from 'firebase-functions/logger';
import { Config } from '../config';
import { prisma } from '../lib/prisma';

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

export const createTeamHandler = async ({
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
  logger.info('createTeam called', context, { structuredData: true });

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

export const editTeamHandler = async ({
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
  logger.info('editTeam called', context, { structuredData: true });

  const { trigger_id: triggerId, actions } = body as BlockAction<BlockElementAction>;
  const teamId = (actions as ButtonAction[]).find(
    (action) => action.action_id === 'edit_team'
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
