import {
  Organization,
  IntegrationAccount,
  User,
  Team,
  TeamMembership,
  NotificationSetting,
  IntegrationInstallation,
} from '@prisma/client';

export interface OauthStateStore {
  organizationId?: string;
  userId: string;
}

export interface OrganizationWithIntegrationAccounts extends Organization {
  integrationAccounts: IntegrationAccount[];
}

export interface OrganizationWithIntegrationAccountsAndInstallations extends Organization {
  integrationAccounts: IntegrationAccount[];
  integrationInstallations: IntegrationInstallation[];
}

export interface OrganizationWithTeams extends Organization {
  teams: TeamWithMembers[];
}

export interface TeamWithMembers extends Team {
  members: TeamMembershipWithUser[];
}

export interface OrganizationWithintegrationAccountsAndTeams
  extends OrganizationWithIntegrationAccounts {
  teams: Team[];
}

export interface TeamMembershipWithTeam extends TeamMembership {
  team: TeamWithMembers;
}

export interface UserWithTeams extends User {
  teamMemberships: TeamMembershipWithTeam[];
}

export interface TeamMembershipWithUser extends TeamMembership {
  user: User;
}

export interface UserWithNotificationSettings extends User {
  notificationSettings: NotificationSetting[];
}
