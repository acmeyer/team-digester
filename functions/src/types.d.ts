import {
  Organization,
  IntegrationProviderAccount,
  User,
  Team,
  TeamMembership,
  NotificationSetting,
} from '@prisma/client';

export interface OauthStateStore {
  organizationId?: string;
  userId: string;
}

export interface OrganizationWithIntegrationConnections extends Organization {
  integrationConnections: IntegrationProviderAccount[];
}

export interface OrganizationWithTeams extends Organization {
  teams: TeamWithMembers[];
}

export interface TeamWithMembers extends Team {
  members: TeamMembershipWithUser[];
}

export interface OrganizationWithIntegrationConnectionsAndTeams
  extends OrganizationWithIntegrationConnections {
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
