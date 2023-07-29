import * as logger from 'firebase-functions/logger';
import { CodedError } from '@slack/bolt';

export const slackErrorHandler = async (error: CodedError) =>
  logger.error('Slack App error', error);
