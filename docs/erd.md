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

## Phase 2: jobs, candidates, applications

```mermaid
erDiagram
  Team ||--o{ Job : "teamId"
  Team ||--o{ PipelineStage : "teamId (jobId null = portal default)"
  Team ||--o{ TenantCandidate : "teamId"
  Job ||--o{ JobSkill : has
  Job ||--o{ JobLocation : has
  Job ||--o{ ScreeningQuestion : has
  Job ||--o{ JobAssignment : "assigned to"
  User ||--o{ JobAssignment : "assignee"
  Job ||--o{ JobApplication : receives
  TenantCandidate ||--o{ JobApplication : submits
  User ||--o{ TenantCandidate : "userId (nullable)"
  PipelineStage ||--o{ JobApplication : "current stage"
  JobApplication ||--o{ ApplicationActivity : "append-only log"
  CandidateResume ||--o{ JobApplication : "resumeId (nullable)"
  User ||--o| CandidateProfile : "global profile"
  CandidateProfile ||--o{ CandidateResume : has
  CandidateProfile ||--o{ CandidateSkill : has
  CandidateProfile ||--o{ CandidateExperience : has
  CandidateProfile ||--o{ CandidateEducation : has
  CandidateProfile ||--o{ CandidateCertification : has
  User ||--o{ SavedJob : saves
  Job ||--o{ SavedJob : "saved by"
  User ||--o{ CandidateConsent : "gives (per teamId)"

  Job {
    string teamId FK
    string slug "UK with teamId"
    JobStatus status "DRAFT SCHEDULED PUBLISHED CLOSED ARCHIVED"
    JobVisibility visibility "PUBLIC UNLISTED INTERNAL"
    tsvector search "generated, GIN"
    datetime deletedAt "soft delete"
  }
  JobApplication {
    string teamId FK
    string jobId FK
    string tenantCandidateId FK "UK with jobId"
    string stageId FK
    json answers "question snapshot"
    string rejectionReason "internal only"
  }
  ApplicationActivity {
    string teamId FK
    ActivityType type "APPLIED STAGE_CHANGED WITHDRAWN ..."
    string fromStageId
    string toStageId
    string actorUserId "null = system"
  }
  TenantCandidate {
    string teamId FK
    string userId "null after erasure"
    string email "UK with teamId"
  }
  CandidateConsent {
    string userId
    string teamId
    ConsentPurpose purpose
    string policyVersion
    datetime revokedAt
  }
```

Tenant-guarded (teamId required on every query): `Job`, `JobSkill`, `JobLocation`,
`JobAssignment`, `ScreeningQuestion`, `PipelineStage`, `TenantCandidate`,
`JobApplication`, `ApplicationActivity` (also append-only), `CandidateConsent`.
`CandidateProfile`, its children, `CandidateResume` and `SavedJob` belong to a user,
not a tenant.

## Phase 3: talent, interviews, offers, messages, automation

```mermaid
erDiagram
  TenantCandidate ||--o{ CandidateNote : has
  TenantCandidate ||--o{ CandidateTagLink : tagged
  CandidateTag ||--o{ CandidateTagLink : "in"
  TenantCandidate ||--o{ TalentPoolMember : "member of"
  TalentPool ||--o{ TalentPoolMember : has
  TenantCandidate }o--o| TenantCandidate : "mergedIntoId"
  JobApplication ||--o{ Interview : has
  Interview ||--o{ InterviewParticipant : "taken by"
  Interview ||--o{ InterviewFeedback : "scorecards (one per participant)"
  Interview ||--o{ InterviewReminder : "24h / 1h markers"
  JobApplication ||--o{ Offer : has
  Offer ||--o{ OfferApproval : "chain, per round"
  JobApplication ||--o{ MessageDraft : "emails to the candidate"
  Team ||--o{ AutomationRule : has
  User ||--o{ Notification : receives
  User ||--o{ NotificationPreference : sets

  Offer {
    OfferStatus status "DRAFT PENDING_APPROVAL APPROVED SENT ACCEPTED DECLINED EXPIRED"
    int round "increments on each submission"
    int fixed
    datetime expiresAt
  }
  OfferApproval {
    int round
    int order "sequential"
    ApprovalStatus status "PENDING APPROVED REJECTED"
  }
  MessageDraft {
    MessageStatus status "DRAFT APPROVED SENT DISCARDED"
    MessageKind kind
    boolean createdByAi
    string approvedById
    datetime sentAt "also the send claim"
  }
  InterviewFeedback {
    json scores "competency -> 1..4"
    Recommendation recommendation
  }
  AutomationRule {
    json trigger "APPLICATION_CREATED | STAGE_ENTERED"
    json action "CREATE_MESSAGE_DRAFT | NOTIFY_USERS | ADD_TAG"
    boolean requiresApproval
  }
```
