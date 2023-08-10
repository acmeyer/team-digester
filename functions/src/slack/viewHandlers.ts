/* eslint-disable max-len */
import { AckFn, ViewResponseAction, ViewOutput, SlackViewAction, Context } from '@slack/bolt';
import * as logger from 'firebase-functions/logger';
import { createAppHomeView } from './blocks';
import { prisma } from '../lib/prisma';
import { findOrCreateUserFromSlack } from './utils';
import { Config } from '../config';
import { WebClient } from '@slack/web-api';
import { User } from '@prisma/client';
import { INTEGRATION_NAMES } from '../lib/constants';
import { findUserFromSlackId, findSlackIdForUserAndOrganization } from '../lib/utils';

type TeamFormState = {
  values: {
    team_name: { team_name: { type: string; value: string } };
    team_members: {
      team_members_select: { type: string; selected_users: string[] };
    };
  };
};

type TeamFormValues = TeamFormState['values'];

type AddUsernameState = {
  values: {
    github: {
      username: { type: string; value: string };
    };
  };
};

const validateTeamForm = (values: TeamFormValues) => {
  let errors = {};
  let isValid = true;
  if (!values.team_name.team_name.value || values.team_name.team_name.value === '') {
    errors = {
      team_name: 'Please enter a team name',
    };
    isValid = false;
  }
  if (
    !values.team_members.team_members_select.selected_users ||
    values.team_members.team_members_select.selected_users.length === 0
  ) {
    errors = {
      team_members: 'Please select at least one team member',
    };
    isValid = false;
  }

  return { isValid, errors };
};

export const refreshHomeView = async (
  client: WebClient,
  slackUserId: string,
  slackOrgId: string
) => {
  const slackInstallation = await prisma.integrationInstallation.findUnique({
    where: {
      integrationName_externalId: {
        integrationName: INTEGRATION_NAMES.SLACK,
        externalId: slackOrgId,
      },
    },
  });
  const homeView = await createAppHomeView(slackUserId, slackOrgId);
  await client.views.publish({
    token: slackInstallation?.accessToken as string | undefined,
    user_id: slackUserId,
    view: homeView,
  });
};

const sendTeamCreatedNotifications = async (
  client: WebClient,
  teamMembers: User[],
  slackOrgId: string,
  invitingUser: User,
  teamName: string
) => {
  const slackInstallation = await prisma.integrationInstallation.findUnique({
    where: {
      integrationName_externalId: {
        integrationName: INTEGRATION_NAMES.SLACK,
        externalId: slackOrgId,
      },
    },
  });

  const organization = await prisma.organization.findUnique({
    where: {
      slackId: slackOrgId,
    },
  });

  if (!organization) {
    logger.error('No organization found', { structuredData: true });
    throw new Error('Something went wrong! No organization found');
  }

  return Promise.all(
    teamMembers.map(async (member) => {
      // Get the slack ID of the user
      const slackId = await findSlackIdForUserAndOrganization(member.id, slackOrgId);

      if (!slackId) {
        logger.error('No Slack ID found for user', member, { structuredData: true });
        return;
      }

      client.chat.postMessage({
        token: slackInstallation?.accessToken as string | undefined,
        channel: slackId,
        text: `${invitingUser.name} added to the *${teamName}* team! Go to <slack://app?team=${slackOrgId}&id=${Config.SLACK_APP_ID}&tab=home|the home tab> to configure your settings.`,
      });
    })
  );
};

export const createTeamModalHandler = async ({
  ack,
  body,
  context,
  view,
  client,
}: {
  ack: AckFn<void> | AckFn<ViewResponseAction>;
  body: SlackViewAction;
  view: ViewOutput;
  context: Context;
  client: WebClient;
}) => {
  logger.info('createTeamModal called', context, { structuredData: true });
  const { values } = view.state as TeamFormState;
  const { isValid, errors } = validateTeamForm(values);
  if (!isValid) {
    await ack({
      response_action: 'errors',
      errors,
    });
    return;
  }
  ack();

  const slackUserId = body.user.id;
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

    if (!organization) {
      logger.error('No organization found', body, { structuredData: true });
      throw new Error('Something went wrong! No organization found');
    }

    const teamMembers = await Promise.all(
      slackTeamMemberIds.map((id) => findOrCreateUserFromSlack(id, organization))
    );
    const user = await findOrCreateUserFromSlack(slackUserId, organization);

    await prisma.team.create({
      data: {
        name: values.team_name.team_name.value,
        organization: {
          connect: {
            id: organization?.id,
          },
        },
        members: {
          create: teamMembers.map((member) => ({
            userId: member.id,
            addedById: user.id,
          })),
        },
      },
    });

    // Send notifications to team members, except the user who created the team
    const filteredTeamMembers = teamMembers.filter((member) => member.id !== user.id);
    await sendTeamCreatedNotifications(
      client,
      filteredTeamMembers,
      slackOrgId,
      user,
      values.team_name.team_name.value
    );
    // Refresh the home tab
    await refreshHomeView(client, slackUserId, slackOrgId);
  } catch (error) {
    logger.error('Error creating team', error, { structuredData: true });
    throw new Error('Something went wrong! Error creating team');
  }
};

export const editTeamModalHandler = async ({
  ack,
  body,
  context,
  view,
  client,
}: {
  ack: AckFn<void> | AckFn<ViewResponseAction>;
  body: SlackViewAction;
  view: ViewOutput;
  context: Context;
  client: WebClient;
}) => {
  logger.info('editTeamModal called', context, { structuredData: true });
  const { values } = view.state as TeamFormState;
  const { isValid, errors } = validateTeamForm(values);
  if (!isValid) {
    await ack({
      response_action: 'errors',
      errors,
    });
    return;
  }
  ack();

  const slackUserId = body.user.id;
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

    if (!organization) {
      logger.error('No organization found', body, { structuredData: true });
      throw new Error('Something went wrong! No organization found');
    }

    const teamId = JSON.parse(body.view.private_metadata).teamId;
    const teamMembers = await Promise.all(
      slackTeamMemberIds.map((id) => findOrCreateUserFromSlack(id, organization))
    );
    const user = await findOrCreateUserFromSlack(slackUserId, organization);

    // Store current team members for later use
    const currentTeamMembers = await prisma.teamMembership.findMany({
      where: {
        teamId: teamId,
      },
      select: {
        userId: true,
      },
    });

    // Remove any members that were removed
    await prisma.teamMembership.deleteMany({
      where: {
        teamId: teamId,
        NOT: {
          userId: {
            in: teamMembers.map((member) => member.id),
          },
        },
      },
    });

    // Update the team
    await prisma.team.update({
      where: {
        id: teamId,
      },
      data: {
        name: values.team_name.team_name.value,
        members: {
          connectOrCreate: teamMembers.map((member) => ({
            where: {
              teamId_userId: {
                userId: member.id,
                teamId: teamId,
              },
            },
            create: {
              userId: member.id,
              addedById: user.id,
            },
          })),
        },
      },
    });

    // Send notifications to only new members, except the user who updated the team
    const filteredTeamMembers = teamMembers.filter(
      (member) =>
        member.id !== user.id &&
        !currentTeamMembers.find((currentMember) => currentMember.userId === member.id)
    );
    await sendTeamCreatedNotifications(
      client,
      filteredTeamMembers,
      slackOrgId,
      user,
      values.team_name.team_name.value
    );

    await refreshHomeView(client, slackUserId, slackOrgId);
  } catch (error) {
    logger.error('Error updating team', error, { structuredData: true });
    throw new Error('Something went wrong! Error updating team');
  }
};

export const addUsernameModalHandler = async ({
  ack,
  view,
  context,
  client,
}: {
  ack: AckFn<void> | AckFn<ViewResponseAction>;
  body: SlackViewAction;
  view: ViewOutput;
  context: Context;
  client: WebClient;
}) => {
  const { values } = view.state as unknown as AddUsernameState;
  const { provider } = JSON.parse(view.private_metadata) as { provider: string };

  // hardcoded for now
  console.log(values);
  const username = values.github.username.value;

  if (!values.github.username.value || values.github.username.value === '') {
    await ack({
      response_action: 'errors',
      errors: {
        github_username: 'Please enter a username',
      },
    });
  }
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

  await prisma.integrationAccount.upsert({
    where: {
      integrationName_userId_organizationId: {
        userId: user.id,
        integrationName: provider,
        organizationId: organization.id,
      },
    },
    update: {
      username,
    },
    create: {
      externalId: slackUserId,
      userId: user.id,
      organizationId: organization.id,
      integrationName: provider,
      username,
    },
  });

  await refreshHomeView(client, slackUserId, slackOrgId);
};
