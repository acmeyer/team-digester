import { initializeApp } from 'firebase-admin/app';
initializeApp();

import slackApp from './slack';
import serverApp from './server';

export const slack = slackApp;
export const api = serverApp;
