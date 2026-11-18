# Entity relationship diagram

Phase 1 models (new and changed). Tenant-owned tables carry `teamId` and are
protected by the Prisma tenant guard (`lib/tenantGuard.ts`).

```mermaid
erDiagram
  Team ||--o| PortalProfile : "1:1 teamId"
  Team ||--o| PortalBranding : "1:1 teamId"
  Team ||--o{ PortalRole : "teamId (null = template)"
  Team ||--o{ TeamMember : has
  Team ||--o{ Invitation : has
  User ||--o{ TeamMember : "is"
  User ||--o{ Invitation : "invitedBy"
  PortalRole ||--o{ TeamMember : "portalRoleId (nullable)"
  PortalRole ||--o{ Invitation : "portalRoleId (nullable)"
  PortalRole ||--o{ PortalRolePermission : grants
  Permission ||--o{ PortalRolePermission : "in"

  Team {
    string id PK
    string slug UK
    string domain UK "email domain, NOT a hostname"
    PortalStatus status "ACTIVE | SUSPENDED (new)"
    string suspendedReason "(new)"
  }
  TeamMember {
    string id PK
    string teamId FK
    string userId FK
    Role role "OWNER | ADMIN | MEMBER"
    string portalRoleId FK "(new)"
  }
  Invitation {
    string id PK
    string teamId FK
    Role role
    string portalRoleId FK "(new)"
  }
  PortalProfile {
    string teamId UK
    string companyName
    string website
    string contactEmail
    string logoKey
    string industry
    datetime onboardingCompletedAt
  }
  PortalBranding {
    string teamId UK
    string primaryColor
    PortalTheme theme
    string heroTitle
    string aboutHtml "sanitised"
    string privacyPolicyHtml "sanitised"
    string seoTitle
  }
  Permission {
    string key UK
    string group
  }
  PortalRole {
    string id PK
    string teamId "null = system template"
    string key "UK with teamId; UK(key) when teamId is null"
    Role baseRole "(not in prompt)"
    boolean isSystem
    boolean isOwnerRole
  }
  PortalRolePermission {
    string roleId PK
    string permissionId PK
  }
```

Notes

- `PortalRole` uniqueness: `UNIQUE(teamId, key)` plus a partial unique index
  `PortalRole_system_key_unique ON (key) WHERE teamId IS NULL` (added in the
  migration) because NULLs are distinct in a plain unique index.
- Deleting a `PortalRole` sets `TeamMember.portalRoleId` / `Invitation.portalRoleId`
  to NULL (the API refuses to delete a role that is still in use).
- Models for jobs, candidates, applications, AI, billing entitlements and so on
  are added by later phases; this file grows with them.
