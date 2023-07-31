/* eslint-disable max-len */
import { HomeView } from '@slack/bolt';
import * as logger from 'firebase-functions/logger';

export const createAppHomeView = async (
  slackUserId: string,
  slackOrgId: string
): Promise<HomeView> => {
  // TODO: Determine blocks to show based on user and organization state
  logger.info('createAppHomeView', slackUserId, slackOrgId, { structuredData: true });

  return {
    type: 'home',
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Your Dashboard',
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
          text: 'Welcome to Team Digester! :wave:',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Team Digester is an app for helping teams stay updated on what everyone is doing and coordinate efforts through easy communication and intelligent alerts.',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'To get started, create a team by clicking the button below.',
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Create Team',
            emoji: true,
          },
          value: 'create_team',
          action_id: 'create_team',
        },
      },
    ],
  };
};
