import express from 'express';
const router = express.Router();
import * as logger from 'firebase-functions/logger';
import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { GithubOauthStateStore } from '../types';
import { Config } from '../config';
import { Webhooks, EmitterWebhookEventName } from '@octokit/webhooks';
import { Prisma } from '@prisma/client';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/core';
import fs from 'fs';
import { INTEGRATION_NAMES } from '../lib/constants';

const githubWebhooks = new Webhooks({
  secret: Config.GITHUB_WEBHOOK_SECRET,
});

router.get('/health_check', (_req, res) => {
  res.send('Ok');
});

router.get('/github/installation/setup', async (req, res) => {
  const { searchParams } = new URL(req.url, process.env.API_BASE_URL);
  const state = searchParams.get('state');
  const installationId = searchParams.get('installation_id');
  const setupAction = searchParams.get('setup_action');

  logger.info('Github Installation Setup', state, { structuredData: true });

  if (!state) {
    logger.error('Missing state', { structuredData: true });
    return res.status(400).send('Missing state');
  }

  if (setupAction === 'install') {
    if (!installationId) {
      logger.error('Missing installation id', { structuredData: true });
      return res.status(400).send('Missing installation id');
    }
    const stateData = (await redis.get(`oauth:state:${state}`)) as GithubOauthStateStore;
    const { organizationId, userId } = stateData;
    await redis.set(
      `oauth:state:${state}`,
      JSON.stringify({ organizationId, userId, githubInstallationId: installationId })
    );

    // Add installation id to state and redirect to authorization url
    // eslint-disable-next-line max-len
    const authorizationUrl = `https://github.com/login/oauth/authorize?client_id=${Config.GITHUB_CLIENT_ID}&redirect_uri=${Config.API_BASE_URL}/github/callback&state=${state}&scope=user%20project%20repo%20read:org`;
    return res.redirect(authorizationUrl);
  } else {
    logger.error('Unknown setup action', setupAction, { structuredData: true });
    return res.status(400).send('Unknown setup action');
  }
});

router.get('/github/callback', async (req, res) => {
  const { searchParams } = new URL(req.url, process.env.API_BASE_URL);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  logger.info('Github Callback', code, state, { structuredData: true });

  if (!code || !state) {
    throw new Error('Missing code or state');
  }

  const stateData = (await redis.get(`oauth:state:${state}`)) as GithubOauthStateStore;
  const { organizationId, userId, githubInstallationId } = stateData;
  const [organization, user] = await Promise.all([
    prisma.organization.findUnique({
      where: {
        id: organizationId,
      },
    }),
    prisma.user.findUnique({
      where: {
        id: userId,
      },
    }),
  ]);

  if (!organization || !user) {
    // In the future, we should handle a situation where the user or organization does not exist yet
    logger.error('Organization or user not found', { structuredData: true });
    return res.status(400).send('Invalid request');
  }

  const resp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: Config.GITHUB_CLIENT_ID,
      client_secret: Config.GITHUB_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      scope: 'user project repo read:org',
      redirect_uri: `${Config.API_BASE_URL}/github/callback`,
      state: state,
    }),
  });
  const authData = await resp.json();

  const octokit = new Octokit({ auth: authData.access_token });
  const { data: userProfileData } = await octokit.request('GET /user');
  try {
    await prisma.integrationAccount.upsert({
      where: {
        integrationName_userId_organizationId: {
          userId: user.id,
          organizationId: organization.id,
          integrationName: INTEGRATION_NAMES.GITHUB,
        },
      },
      update: {
        name: userProfileData.name,
        pictureUrl: userProfileData.avatar_url,
        email: userProfileData.email,
        rawProfileData: userProfileData as Prisma.JsonObject,
        rawAuthData: authData,
        accessToken: authData.access_token,
        refreshToken: authData.refresh_token,
        expiresIn: authData.expires_in,
        scope: authData.scope,
      },
      create: {
        integrationName: INTEGRATION_NAMES.GITHUB,
        externalId: userProfileData.id.toString(),
        username: userProfileData.login,
        name: userProfileData.name,
        pictureUrl: userProfileData.avatar_url,
        email: userProfileData.email,
        rawProfileData: userProfileData as Prisma.JsonObject,
        rawAuthData: authData,
        accessToken: authData.access_token,
        refreshToken: authData.refresh_token,
        expiresIn: authData.expires_in,
        scope: authData.scope,
        organizationId: organization.id,
        userId: user.id,
      },
    });

    if (githubInstallationId) {
      // Verify that the installation id is valid and user is associated with it
      const { data: installationsData } = await octokit.request('GET /user/installations');
      const installationData = installationsData.installations.find((installation) => {
        return installation.id.toString() === githubInstallationId;
      });
      if (!installationData) {
        logger.error('Installation not found', githubInstallationId, userProfileData.id, {
          structuredData: true,
        });
        return res.status(400).send('Invalid request');
      }

      // Set up the installation
      const privateKey = fs.readFileSync(Config.GITHUB_PRIVATE_KEY_PATH, 'utf-8');
      const auth = createAppAuth({
        appId: Config.GITHUB_APP_ID,
        privateKey: privateKey,
        installationId: githubInstallationId,
      });
      const installationAuth = await auth({ type: 'installation' });

      // Get account name
      let accountName = '';
      if (installationData.target_type === 'Organization') {
        const { data: organizationData } = await octokit.request('GET /orgs/{org}', {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          org: installationData.account?.login,
        });
        accountName = organizationData.name || organizationData.login;
      } else {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        accountName = installationData.account?.login;
      }

      // Use installation to create or update a new integration installation,
      // one should in theory already exist from the webhook
      await prisma.integrationInstallation.upsert({
        where: {
          integrationName_externalId: {
            integrationName: INTEGRATION_NAMES.GITHUB,
            externalId: githubInstallationId.toString(),
          },
        },
        update: {
          data: installationData as unknown as Prisma.JsonObject,
          accessToken: installationAuth.token,
          accountName: accountName,
          organizationId: organization.id,
        },
        create: {
          integrationName: INTEGRATION_NAMES.GITHUB,
          externalId: githubInstallationId.toString(),
          accountName: accountName,
          data: installationData as unknown as Prisma.JsonObject,
          accessToken: installationAuth.token,
          organizationId: organization.id,
        },
      });
    }

    return res.redirect(`https://slack.com/app_redirect?app=${Config.SLACK_APP_ID}`);
  } catch (err) {
    console.error(err);
    return res.status(500).send({
      message: 'Failed to create integration provider account',
    });
  }
});

router.post('/github/webhooks', async (req, res) => {
  const { headers } = req;
  const { 'x-github-event': event } = headers;

  try {
    const webhook = {
      id: req.header('X-GitHub-Delivery') || '',
      name: event as EmitterWebhookEventName,
      payload: JSON.stringify(req.body),
      signature: req.header('X-Hub-Signature') || '',
    };
    await githubWebhooks.verifyAndReceive(webhook);
    return res.status(200).send({
      message: 'Ok',
    });
  } catch (err) {
    logger.error(err, { structuredData: true });
    return res.status(401).send({
      error: 'Unauthorized',
    });
  }
});

githubWebhooks.on('installation.created', async ({ id, name, payload }) => {
  logger.info('installation.created callback', id, name, payload, { structuredData: true });

  const { installation } = payload;

  // get a token for later usage
  const privateKey = fs.readFileSync(Config.GITHUB_PRIVATE_KEY_PATH, 'utf-8');
  const auth = createAppAuth({
    appId: Config.GITHUB_APP_ID,
    privateKey: privateKey,
    installationId: installation.id,
  });
  const installationAuth = await auth({ type: 'installation' });
  // Use installation to create a new integration installation if necessary,
  // this is a placeholder until it's completed after the OAuth flow
  await prisma.integrationInstallation.upsert({
    where: {
      integrationName_externalId: {
        integrationName: INTEGRATION_NAMES.GITHUB,
        externalId: installation.id.toString(),
      },
    },
    update: {}, // We'll skip updating anyting in the webhook since it should be taken care of in the OAuth flow
    create: {
      integrationName: INTEGRATION_NAMES.GITHUB,
      externalId: installation.id.toString(),
      data: installation as unknown as Prisma.JsonObject,
      accessToken: installationAuth.token,
      accountName: installation.account?.name || installation.account?.login,
    },
  });
});

githubWebhooks.on('installation.deleted', async ({ id, name, payload }) => {
  console.log('installation.deleted callback', { id, name, payload });
  const { installation } = payload;

  // Remove the integration installation from the database
  await prisma.integrationInstallation.delete({
    where: {
      integrationName_externalId: {
        externalId: installation.id.toString(),
        integrationName: INTEGRATION_NAMES.GITHUB,
      },
    },
  });

  // Future question? Should we remove all associated IntegrationAccounts too?
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request
githubWebhooks.on('pull_request', async ({ id, name, payload }) => {
  console.log('pull_request callback', { id, name, payload });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request_review_comment
githubWebhooks.on('pull_request_review_comment', async ({ id, name, payload }) => {
  console.log('pull_request_review_comment callback', { id, name, payload });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request_review
githubWebhooks.on('pull_request_review', async ({ id, name, payload }) => {
  console.log('pull_request_review callback', { id, name, payload });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request_review_thread
githubWebhooks.on('pull_request_review_thread', async ({ id, name, payload }) => {
  console.log('pull_request_review_thread callback', { id, name, payload });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#push
githubWebhooks.on('push', async ({ id, name, payload }) => {
  console.log('push callback', { id, name, payload });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#release
githubWebhooks.on('release', async ({ id, name, payload }) => {
  console.log('release callback', { id, name, payload });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#issue_comment
githubWebhooks.on('issue_comment', async ({ id, name, payload }) => {
  // Created and edited only
  console.log('issue_comment callback', { id, name, payload });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#issues
githubWebhooks.on('issues', async ({ id, name, payload }) => {
  console.log('issues callback', { id, name, payload });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#deployment
githubWebhooks.on('deployment', async ({ id, name, payload }) => {
  console.log('deployment callback', { id, name, payload });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#discussion
githubWebhooks.on('discussion', async ({ id, name, payload }) => {
  console.log('discussion callback', { id, name, payload });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#discussion_comment
githubWebhooks.on('discussion_comment', async ({ id, name, payload }) => {
  console.log('discussion_comment callback', { id, name, payload });
});

// https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads#commit_comment
githubWebhooks.on('commit_comment', async ({ id, name, payload }) => {
  console.log('commit_comment callback', { id, name, payload });
});

export default router;
