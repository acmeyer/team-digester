import express from 'express';
const router = express.Router();
import * as logger from 'firebase-functions/logger';
import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { OauthStateStore } from '../types';
import { Config } from '../config';
import { Webhooks, EmitterWebhookEventName } from '@octokit/webhooks';
import { Prisma } from '@prisma/client';
import { createAppAuth } from '@octokit/auth-app';
import fs from 'fs';

const githubWebhooks = new Webhooks({
  secret: Config.GITHUB_WEBHOOK_SECRET,
});

router.get('/health_check', (_req, res) => {
  res.send('Ok');
});

router.get('/github/callback', async (req, res) => {
  const { searchParams } = new URL(req.url, process.env.API_BASE_URL);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const payload = req.body;

  logger.info('Github Callback', code, state, payload, { structuredData: true });

  if (!code || !state) {
    throw new Error('Missing code or state');
  }

  const stateData = (await redis.get(`oauth:state:${state}`)) as OauthStateStore;
  const { organizationId, userId } = stateData;
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
    throw new Error('Invalid request');
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
  const profileResult = await fetch('https://api.github.com/user', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authData.access_token}`,
    },
  });
  const profileResultData = await profileResult.json();

  try {
    await prisma.integrationProviderAccount.upsert({
      where: {
        provider_userId_organizationId: {
          userId: user.id,
          organizationId: organization.id,
          provider: 'github',
        },
      },
      update: {
        name: profileResultData.name,
        pictureUrl: profileResultData.avatar_url,
        email: profileResultData.email,
        rawProfileData: profileResultData as Prisma.JsonObject,
        rawAuthData: authData,
        accessToken: authData.access_token,
        refreshToken: authData.refresh_token,
        expiresIn: authData.expires_in,
        scope: authData.scope,
      },
      create: {
        provider: 'github',
        uid: profileResultData.id.toString(),
        username: profileResultData.login,
        name: profileResultData.name,
        pictureUrl: profileResultData.avatar_url,
        email: profileResultData.email,
        rawProfileData: profileResultData as Prisma.JsonObject,
        rawAuthData: authData,
        accessToken: authData.access_token,
        refreshToken: authData.refresh_token,
        expiresIn: authData.expires_in,
        scope: authData.scope,
        organizationId: organization.id,
        userId: user.id,
      },
    });

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
  console.log('installation.created callback', { id, name, payload });

  console.log('installation account', payload.installation.account);

  const { installation, sender } = payload;

  // Use sender to find integration provider account, should already exist
  const integrationProviderAccount = await prisma.integrationProviderAccount.findFirst({
    where: {
      provider: 'github',
      uid: sender.id.toString(),
    },
    include: {
      user: true,
    },
  });

  if (!integrationProviderAccount) {
    console.error('Integration provider account not found');
    throw new Error('Integration provider account not found');
  }

  // get a token for later usage
  const privateKey = fs.readFileSync(Config.GITHUB_PRIVATE_KEY_PATH, 'utf-8');
  const auth = createAppAuth({
    appId: Config.GITHUB_APP_ID,
    privateKey: privateKey,
    installationId: installation.id,
  });
  const installationAuth = await auth({ type: 'installation' });
  // Use installation to create a new integration installation
  await prisma.integrationInstallation.create({
    data: {
      integrationName: 'github',
      externalId: installation.id.toString(),
      data: installation as unknown as Prisma.JsonObject,
      installedById: integrationProviderAccount.id,
      organizationId: integrationProviderAccount.organizationId,
      accessToken: installationAuth.token,
    },
  });
});

githubWebhooks.on('installation.deleted', async ({ id, name, payload }) => {
  console.log('installation.deleted callback', { id, name, payload });
  const { installation } = payload;

  // Remove the integration installation from the database
  await prisma.integrationInstallation.delete({
    where: {
      externalId: installation.id.toString(),
    },
  });
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
