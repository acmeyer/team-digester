import express from 'express';
const router = express.Router();
import * as logger from 'firebase-functions/logger';
import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { OauthStateStore } from '../types';
import { Config } from '../config';
import { Prisma } from '@prisma/client';
import { Octokit } from '@octokit/core';
import { INTEGRATION_NAMES } from '../lib/constants';
import { getInstallationAuth } from '../lib/github';

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
    const stateData = (await redis.get(`oauth:state:${state}`)) as OauthStateStore;
    const { organizationId, userId } = stateData;
    await redis.set(
      `oauth:state:${state}`,
      JSON.stringify({ organizationId, userId, installationId })
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

  const stateData = (await redis.get(`oauth:state:${state}`)) as OauthStateStore;
  const { organizationId, userId, installationId } = stateData;
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

    if (installationId) {
      // Verify that the installation id is valid and user is associated with it
      const { data: installationsData } = await octokit.request('GET /user/installations');
      const installationData = installationsData.installations.find((installation) => {
        return installation.id.toString() === installationId;
      });
      if (!installationData) {
        logger.error('Installation not found', installationId, userProfileData.id, {
          structuredData: true,
        });
        return res.status(400).send('Invalid request');
      }

      // Set up the installation
      const installationAuth = await getInstallationAuth(installationId);

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
            externalId: installationId.toString(),
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
          externalId: installationId.toString(),
          accountName: accountName,
          data: installationData as unknown as Prisma.JsonObject,
          accessToken: installationAuth.token,
          organizationId: organization.id,
        },
      });
    }

    return res.redirect(`https://slack.com/app_redirect?app=${Config.SLACK_APP_ID}`);
  } catch (err) {
    logger.error(err, { structuredData: true });
    return res.status(500).send({
      message: 'Failed to create integration provider account',
    });
  }
});

export default router;
