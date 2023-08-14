import { IncomingWebhook, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

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
