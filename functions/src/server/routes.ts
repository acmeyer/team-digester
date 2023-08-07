import express from 'express';
const router = express.Router();
import * as logger from 'firebase-functions/logger';
import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { OauthStateStore } from '../types';
import { OAUTH_INTEGRATIONS } from '../lib/oauth';
import { forEach } from 'lodash';

router.get('/health_check', (_req, res) => {
  res.send('Ok');
});

router.get('/oauth/:provider/callback', async (req, res) => {
  const { provider } = req.params as { provider: 'github' | 'jira' };
  const { searchParams } = new URL(req.url, process.env.API_BASE_URL);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  logger.info('OAuth Callback', provider, code, state, { structuredData: true });

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
  const integration = OAUTH_INTEGRATIONS[provider];

  if (!organization || !user || !integration) {
    throw new Error('Invalid request');
  }

  const resp = await fetch(`${integration.tokenUri}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: integration.clientId,
      client_secret: integration.clientSecret,
      code: code,
      grant_type: 'authorization_code',
      scope: integration.scope,
      redirect_uri: integration.redirectUri,
      state: state,
    }),
  });
  const authData = await resp.json();
  const profileResult = await fetch(`${integration.profileUri}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authData.access_token}`,
    },
  });
  const profileResultData = await profileResult.json();
  const profileData: { [key: string]: string } = {};
  forEach(integration.profileDataKeyMap, (value, key) => {
    if (profileResultData[value]) {
      profileData[key] = profileResultData[value].toString();
    }
  });

  await prisma.integrationProviderAccount.create({
    data: {
      provider: provider,
      uid: profileData.uid,
      username: profileData.username,
      name: profileData.name,
      pictureUrl: profileData.pictureUrl,
      email: profileData.email,
      rawProfileData: JSON.stringify(profileResultData),
      rawAuthData: authData,
      accessToken: authData.access_token,
      refreshToken: authData.refresh_token,
      expiresIn: authData.expires_in,
      scope: authData.scope,
      organizationId: organization.id,
      userId: user.id,
    },
  });

  return res.redirect(`https://slack.com/app_redirect?app=${process.env.SLACK_APP_ID}`);
});

router.get('/webhooks/incoming/github', async (req, res) => {
  const { headers, body } = req;
  const { 'x-github-event': event, 'x-hub-signature': signature } = headers;
  const { organization, repository, sender, installation } = body;
  const { id: organizationId } = organization;
  const { id: repositoryId } = repository;
  const { id: senderId } = sender;
  const { id: installationId } = installation;

  console.log(
    'GitHub Webhook',
    event,
    signature,
    organizationId,
    repositoryId,
    senderId,
    installationId
  );

  // logger.info('GitHub Webhook', event, organizationId, repositoryId, senderId, installationId, {
  //   structuredData: true,
  // });

  return res.send('Ok');
});

export default router;
