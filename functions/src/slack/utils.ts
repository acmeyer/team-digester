import { Installation, InstallationQuery } from '@slack/bolt';
import { app } from './index';
import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { DATABASE_COLLECTIONS } from '../constants';
import { User } from '../types';
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const getInstallationFromDatabase = async (id: string, isEnterpriseInstall: boolean) => {
  const snapshot = await db
    .collection(DATABASE_COLLECTIONS.SLACK_INSTALLATIONS)
    .where('isEnterpriseInstall', '==', isEnterpriseInstall)
    .where('slackId', '==', id)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  } else {
    return snapshot.docs[0];
  }
};

export const saveInstallation = async (installation: Installation): Promise<void> => {
  logger.info('saveInstallation', installation, { structuredData: true });
  let slackId;
  let isEnterpriseInstall;
  if (installation.isEnterpriseInstall && installation.enterprise !== undefined) {
    slackId = installation.enterprise.id;
    isEnterpriseInstall = true;
  }
  if (installation.team !== undefined) {
    slackId = installation.team.id;
    isEnterpriseInstall = false;
  }

  if (slackId !== undefined && isEnterpriseInstall !== undefined) {
    const doc = await getInstallationFromDatabase(slackId, isEnterpriseInstall);

    if (!doc) {
      // New installation, add to database and create organization
      const orgRef = await db.collection(DATABASE_COLLECTIONS.ORGANIZATIONS).add({
        slackId: slackId,
        name: installation.enterprise?.name || installation.team?.name || '',
        isSlackEnterprise: isEnterpriseInstall,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.collection(DATABASE_COLLECTIONS.SLACK_INSTALLATIONS).add({
        orgId: orgRef.id,
        slackId: slackId,
        isEnterpriseInstall: isEnterpriseInstall,
        installation: installation,
        installedAt: new Date(),
        updatedAt: new Date(),
      });
      await findOrCreateUser(installation.user.id, slackId);
      return;
    } else {
      logger.info('Installation already exists, updating...', installation, {
        structuredData: true,
      });
      await doc.ref.update({
        installation: {
          ...doc.data().installation,
          user: installation.user,
          appId: installation.appId,
          authversion: installation.authVersion,
          bot: installation.bot,
        },
        updatedAt: new Date(),
      });
      await findOrCreateUser(installation.user.id, slackId);
      return;
    }
  }
  throw new Error('Failed saving installation data to installationStore');
};

export const getInstallation = async (
  installQuery: InstallationQuery<boolean>
): Promise<Installation<'v1' | 'v2', boolean>> => {
  logger.info('fetchInstallation', installQuery, { structuredData: true });
  let doc;
  if (installQuery.isEnterpriseInstall && installQuery.enterpriseId !== undefined) {
    doc = await getInstallationFromDatabase(installQuery.enterpriseId, true);
  } else if (installQuery.teamId !== undefined) {
    doc = await getInstallationFromDatabase(installQuery.teamId, false);
  } else {
    throw new Error('Failed fetching installation');
  }
  if (!doc) {
    throw new Error('Failed fetching installation');
  }
  return doc.data().installation;
};

export const deleteInstallation = async (
  installQuery: InstallationQuery<boolean>
): Promise<void> => {
  logger.info('deleteInstallation', installQuery, { structuredData: true });
  let doc;
  if (installQuery.isEnterpriseInstall && installQuery.enterpriseId !== undefined) {
    doc = await getInstallationFromDatabase(installQuery.enterpriseId, true);
  } else if (installQuery.teamId !== undefined) {
    doc = await getInstallationFromDatabase(installQuery.teamId, false);
  } else {
    throw new Error('Failed deleting installation');
  }
  if (doc) {
    await doc.ref.delete();
    return;
  }
  return;
};

export const findOrCreateUser = async (slackId: string, slackOrgId: string): Promise<User> => {
  logger.info('findOrCreateUser', slackId, slackOrgId, { structuredData: true });
  const snapshot = await db
    .collection(DATABASE_COLLECTIONS.USERS)
    .where('slackId', '==', slackId)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    const userData = snapshot.docs[0].data();
    return {
      id: snapshot.docs[0].id,
      email: userData.email,
      pictureUrl: userData.pictureUrl,
      name: userData.name,
      firstName: userData.firstName,
      lastName: userData.lastName,
      slackId: userData.slackId,
      organizations: userData.organizations,
      createdAt: userData.createdAt.toDate(),
      updatedAt: userData.updatedAt.toDate(),
    };
  }

  // Get user info from Slack and organization from database
  const [slackUserData, orgSnapshot] = await Promise.all([
    app.client.users.profile.get({
      token: process.env.SLACK_BOT_TOKEN,
      user: slackId,
    }),
    db
      .collection(DATABASE_COLLECTIONS.ORGANIZATIONS)
      .where('slackId', '==', slackOrgId)
      .limit(1)
      .get(),
  ]);

  // Create the user
  const orgDoc = orgSnapshot.docs[0];
  const userData = {
    slackId: slackId,
    email: slackUserData?.profile?.email,
    pictureUrl: slackUserData?.profile?.image_512,
    firstName: slackUserData?.profile?.first_name,
    lastName: slackUserData?.profile?.last_name,
    name: slackUserData?.profile?.real_name,
    organizations: [orgDoc.id],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const userRef = await db.collection(DATABASE_COLLECTIONS.USERS).add(userData);
  await orgDoc.ref.collection(DATABASE_COLLECTIONS.MEMBERS).add({
    userId: userRef.id,
    ...userData,
  });

  return {
    id: userRef.id,
    ...userData,
  };
};
