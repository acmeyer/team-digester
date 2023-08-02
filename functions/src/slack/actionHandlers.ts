import {
  AckFn,
  SayArguments,
  DialogValidation,
  Context,
  SlackAction,
  BlockElementAction,
  BlockAction,
} from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import * as logger from 'firebase-functions/logger';
import { Config } from '../config';

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

  const user = body.user.id;
  logger.info('createTeam called', context, { structuredData: true });

  client.views.open({
    token: Config.SLACK_BOT_TOKEN,
    trigger_id: (body as BlockAction<BlockElementAction>).trigger_id,
    view: {
      type: 'modal',
      callback_id: 'create_team_modal',
      title: {
        type: 'plain_text',
        text: 'Create a new team',
      },
      submit: {
        type: 'plain_text',
        text: 'Create',
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
            initial_users: [user],
            placeholder: {
              type: 'plain_text',
              text: 'Select team members',
            },
          },
        },
      ],
    },
  });
};
