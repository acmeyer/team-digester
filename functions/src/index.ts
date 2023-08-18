import slackApp from './slack';
import serverApp from './server';
import webhooksApp from './webhooks';
import { notifications } from './jobs';

export const slack = slackApp;
export const api = serverApp;
export const webhooks = webhooksApp;
exports.notifications = notifications;
