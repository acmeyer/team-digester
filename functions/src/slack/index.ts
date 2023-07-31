import 'dotenv/config';
import { onRequest } from 'firebase-functions/v2/https';
import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
import {
  appHomeOpenedHandler,
  appUninstalledHandler,
  appMentionHandler,
  appDirectMessageHandler,
} from './eventHandlers';
import { slackErrorHandler } from './errors';
import { saveInstallation, getInstallation, deleteInstallation } from './utils';

const expressReceiver = new ExpressReceiver({
  logLevel: process.env.ENVIRONMENT === 'production' ? LogLevel.ERROR : LogLevel.DEBUG,
  signingSecret: process.env.SLACK_SIGNING_SECRET as string,
  endpoints: '/slack/events',
  processBeforeResponse: true,
  installationStore: {
    storeInstallation: saveInstallation,
    fetchInstallation: getInstallation,
    deleteInstallation: deleteInstallation,
  },
  installerOptions: {
    directInstall: true,
    stateVerification: process.env.ENVIRONMENT === 'production' ? true : false,
  },
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  scopes: [
    'app_mentions:read',
    'channels:history',
    'chat:write',
    'groups:history',
    'im:history',
    'mpim:history',
    'users.profile:read',
    'users:read',
    'users:read.email',
  ],
});

export const app = new App({
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
