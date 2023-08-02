import { AckFn, ViewResponseAction, ViewOutput, SlackViewAction, Context } from '@slack/bolt';
import * as logger from 'firebase-functions/logger';
import { prisma } from '../lib/prisma';
import { findOrCreateUser } from './utils';

export const createTeamModalHandler = async ({
  ack,
  body,
  context,
  view,
}: {
  ack: AckFn<void> | AckFn<ViewResponseAction>;
  body: SlackViewAction;
  view: ViewOutput;
  context: Context;
}) => {
  logger.info('createTeamModal called', context, { structuredData: true });
  const { values } = view.state as {
    values: {
      team_name: { team_name: { type: string; value: string } };
      team_members: {
        team_members_select: { type: string; selected_users: string[] };
      };
    };
  };

  // Validate form
  if (!values.team_name.team_name.value || values.team_name.team_name.value === '') {
    await ack({
      response_action: 'errors',
      errors: {
        team_name: 'Please enter a team name',
      },
    });
    return;
  }
  if (
    !values.team_members.team_members_select.selected_users ||
    values.team_members.team_members_select.selected_users.length === 0
  ) {
    await ack({
      response_action: 'errors',
      errors: {
        team_members: 'Please select at least one team member',
      },
    });
  }
  ack();

  // const slackUserId = body.user.id;
  const slackOrgId = body.enterprise ? body.enterprise.id : body.team?.id;
  const slackTeamMemberIds = values.team_members.team_members_select.selected_users;

  if (!slackOrgId) {
    logger.error('No Slack organization ID found', body, { structuredData: true });
    throw new Error('Something went wrong! No Slack organization ID found');
  }

  try {
    const organization = await prisma.organization.findUnique({
      where: {
        slackId: slackOrgId,
      },
    });

    const teamMembers = await Promise.all(
      slackTeamMemberIds.map((id) => findOrCreateUser(id, slackOrgId))
    );

    await prisma.team.create({
      data: {
        name: values.team_name.team_name.value,
        organization: {
          connect: {
            id: organization?.id,
          },
        },
        members: {
          connect: teamMembers.map((member) => ({ id: member.id })),
        },
      },
    });

    // TODO: refresh home view
  } catch (error) {
    logger.error('Error creating team', error, { structuredData: true });
    throw new Error('Something went wrong! Error creating team');
  }
};
