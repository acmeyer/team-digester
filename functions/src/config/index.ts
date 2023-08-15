import 'dotenv/config';

export const Config = {
  // OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY as string,
  OPENAI_API_ORG_ID: process.env.OPENAI_API_ORG_ID as string,

  // Slack
  SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID as string,
  SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET as string,
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET as string,
  SLACK_STATE_SECRET: process.env.SLACK_STATE_SECRET as string,
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN as string,
  SLACK_APP_ID: process.env.SLACK_APP_ID as string,

  // Github
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET as string,
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID as string,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET as string,
  GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG as string,
  GITHUB_APP_ID: process.env.GITHUB_APP_ID as string,
  GITHUB_PRIVATE_KEY_PATH: process.env.GITHUB_PRIVATE_KEY_PATH as string,

  // Google
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID as string,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET as string,

  // Jira
  JIRA_CLIENT_ID: process.env.JIRA_CLIENT_ID as string,
  JIRA_CLIENT_SECRET: process.env.JIRA_CLIENT_SECRET as string,

  // Server config
  API_MIN_INSTANCE: process.env.API_MIN_INSTANCE as string,
  API_TIMEOUT_SECONDS: process.env.API_TIMEOUT_SECONDS as string,
  SLACK_MIN_INSTANCE: process.env.SLACK_MIN_INSTANCE as string,
  SLACK_TIMEOUT_SECONDS: process.env.SLACK_TIMEOUT_SECONDS as string,
  WEBHOOKS_MIN_INSTANCE: process.env.WEBHOOKS_MIN_INSTANCE as string,
  WEBHOOKS_TIMEOUT_SECONDS: process.env.WEBHOOKS_TIMEOUT_SECONDS as string,

  // General
  ENVIRONMENT: process.env.ENVIRONMENT as string,
  API_BASE_URL: process.env.API_BASE_URL as string,
  DATABASE_URL: process.env.DATABASE_URL as string,
  REDIS_URL: process.env.REDIS_URL as string,
  REDIS_TOKEN: process.env.REDIS_TOKEN as string,
};
