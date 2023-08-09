/* eslint-disable max-len */
import { AckFn, ViewResponseAction, ViewOutput, SlackViewAction, Context } from '@slack/bolt';
import * as logger from 'firebase-functions/logger';
import { createAppHomeView } from './blocks';
import { prisma } from '../lib/prisma';
import { findOrCreateUser } from './utils';
import { Config } from '../config';
import { WebClient } from '@slack/web-api';
import { User } from '@prisma/client';

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
  const slackInstallation = await prisma.slackInstallation.findUnique({
    where: {
      slackId: slackOrgId,
    },
  });
  const homeView = await createAppHomeView(slackUserId, slackOrgId);
  await client.views.publish({
    token: slackInstallation?.token,
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
  const slackInstallation = await prisma.slackInstallation.findUnique({
    where: {
      slackId: slackOrgId,
    },
  });

  return Promise.all(
    teamMembers.map((member) =>
      client.chat.postMessage({
        token: slackInstallation?.token,
        channel: member.slackId,
        text: `${invitingUser.name} added to the *${teamName}* team! Go to <slack://app?team=${slackOrgId}&id=${Config.SLACK_APP_ID}&tab=home|the home tab> to configure your settings.`,
      })
    )
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

    const teamMembers = await Promise.all(
      slackTeamMemberIds.map((id) => findOrCreateUser(id, slackOrgId))
    );
    const user = await findOrCreateUser(slackUserId, slackOrgId);

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
    const filteredTeamMembers = teamMembers.filter((member) => member.slackId !== slackUserId);
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
    const teamId = JSON.parse(body.view.private_metadata).teamId;
    const teamMembers = await Promise.all(
      slackTeamMemberIds.map((id) => findOrCreateUser(id, slackOrgId))
    );
    const user = await findOrCreateUser(slackUserId, slackOrgId);

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
        member.slackId !== slackUserId &&
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

  const [user, organization] = await Promise.all([
    prisma.user.findUnique({
      where: {
        slackId: slackUserId,
      },
    }),
    prisma.organization.findUnique({
      where: {
        slackId: slackOrgId,
      },
    }),
  ]);

  if (!user || !organization) {
    throw new Error('Not found');
  }

  await prisma.integrationProviderAccount.upsert({
    where: {
      provider_userId_organizationId: {
        userId: user.id,
        provider: provider,
        organizationId: organization.id,
      },
    },
    update: {
      username,
    },
    create: {
      userId: user.id,
      organizationId: organization.id,
      provider: provider,
      username,
    },
  });

  await refreshHomeView(client, slackUserId, slackOrgId);
};
