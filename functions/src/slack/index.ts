import 'dotenv/config';
import { onRequest } from 'firebase-functions/v2/https';
import { App, ExpressReceiver } from '@slack/bolt';
import {
  appHomeOpenedHandler,
  appUninstalledHandler,
  appMentionHandler,
  appDirectMessageHandler,
} from './eventHandlers';
import { slackErrorHandler } from './errors';

const expressReceiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET as string,
  endpoints: '/slack/events',
  processBeforeResponse: true,
});

export const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: expressReceiver,
});
// Event listeners
app.event('app_home_opened', appHomeOpenedHandler);
app.event('app_mention', appMentionHandler);
app.event('message', appDirectMessageHandler);
app.event('app_uninstalled', appUninstalledHandler);
// Error handler
app.error(slackErrorHandler);

const slackApp = onRequest(
  {
    minInstances: process.env.SLACK_MIN_INSTANCES ? parseInt(process.env.SLACK_MIN_INSTANCES) : 0,
    timeoutSeconds: process.env.SLACK_TIMEOUT_SECONDS
      ? parseInt(process.env.SLACK_TIMEOUT_SECONDS)
      : 60,
  },
  expressReceiver.app
);

export default slackApp;
