import { Config } from '../config';
import { onRequest } from 'firebase-functions/v2/https';
import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
import {
  appHomeOpenedHandler,
  appUninstalledHandler,
  appMentionHandler,
  appDirectMessageHandler,
} from './eventHandlers';
import {
  connectIntegrationHandler,
  showCreateTeamHandler,
  showEditTeamHandler,
  selectTeamMembersHandler,
  showJoinTeamHandler,
  joinTeamHandler,
  leaveTeamHandler,
} from './actionHandlers';
import { createTeamModalHandler, editTeamModalHandler } from './viewHandlers';
import { slackErrorHandler } from './errors';
import { saveInstallation, getInstallation, deleteInstallation } from './utils';

const expressReceiver = new ExpressReceiver({
  logLevel: Config.ENVIRONMENT === 'production' ? LogLevel.ERROR : LogLevel.DEBUG,
  signingSecret: Config.SLACK_SIGNING_SECRET as string,
  endpoints: '/slack/events',
  processBeforeResponse: true,
  installationStore: {
    storeInstallation: saveInstallation,
    fetchInstallation: getInstallation,
    deleteInstallation: deleteInstallation,
  },
  installerOptions: {
    directInstall: true,
    stateVerification: Config.ENVIRONMENT === 'production' ? true : false,
  },
  clientId: Config.SLACK_CLIENT_ID,
  clientSecret: Config.SLACK_CLIENT_SECRET,
  stateSecret: Config.SLACK_STATE_SECRET,
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
// Action listeners
app.action('connect_integration', connectIntegrationHandler);
app.action('show_create_team', showCreateTeamHandler);
app.action('show_edit_team', showEditTeamHandler);
app.action('show_join_team', showJoinTeamHandler);
app.action('join_team', joinTeamHandler);
app.action('leave_team', leaveTeamHandler);
app.action('team_members_select', selectTeamMembersHandler);
// View listeners
app.view('create_team_modal', createTeamModalHandler);
app.view('edit_team_modal', editTeamModalHandler);
// Error handler
app.error(slackErrorHandler);

const slackApp = onRequest(
  {
    minInstances: Config.SLACK_MIN_INSTANCE ? parseInt(Config.SLACK_MIN_INSTANCE) : 0,
    timeoutSeconds: Config.SLACK_TIMEOUT_SECONDS ? parseInt(Config.SLACK_TIMEOUT_SECONDS) : 60,
  },
  expressReceiver.app
);

export default slackApp;
