import { Activity, IncomingWebhook, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { openAI } from '../lib/openai';

export const saveIncomingWebhook = async ({
  id,
  event,
  source,
  payload,
}: {
  id: string;
  event: string;
  source: string;
  payload: object;
}): Promise<IncomingWebhook> => {
  return prisma.incomingWebhook.create({
    data: {
      externalId: id,
      data: payload as Prisma.JsonObject,
      event,
      source,
    },
  });
};

export const saveActvity = async ({
  userId,
  organizationId,
  eventData,
}: {
  userId?: string;
  organizationId: string;
  eventData: object;
}): Promise<Activity> => {
  const userWithTeams = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      teamMemberships: true,
    },
  });

  // Send activity to OpenAI for summarization
  const chatCompletion = await openAI.chat.completions.create({
    model: 'gpt-3.5-turbo-16k',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant.',
      },
      {
        role: 'user',
        // eslint-disable-next-line max-len
        content: `The following is a webhook event from GitHub that describes an activity that was performed by a user. Please summarize this activity in a human readable format as briefly as possible. Be sure to include the most important details that would be good for someone else on the user's team to know. If code is included, include what about the code was changed.
  
        Activity Data: ${JSON.stringify(eventData, null, 2)}`,
      },
    ],
    temperature: 0,
  });
  const summary = chatCompletion.choices[0].message.content;

  return prisma.activity.create({
    data: {
      organizationId: organizationId,
      userId: userId,
      summary,
      activityDate: new Date(),
      activityData: eventData as Prisma.JsonObject,
      teams: {
        connect: userWithTeams?.teamMemberships.map((membership) => ({
          id: membership.teamId,
        })),
      },
    },
  });
};
