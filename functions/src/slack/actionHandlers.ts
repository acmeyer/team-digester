import { AckFn, SayArguments, DialogValidation, Context } from '@slack/bolt';
import * as logger from 'firebase-functions/logger';

export const connectIntegrationHandler = async ({
  ack,
  context,
}: {
  ack: AckFn<void> | AckFn<string | SayArguments> | AckFn<DialogValidation>;
  context: Context;
}) => {
  ack();
  logger.info('connectIntegration', context, { structuredData: true });
};
