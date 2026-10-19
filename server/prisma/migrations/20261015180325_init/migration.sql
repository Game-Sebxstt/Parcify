-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('admin', 'editor', 'viewer');

-- CreateEnum
CREATE TYPE "OrgAccess" AS ENUM ('none', 'viewer', 'editor');

-- CreateEnum
CREATE TYPE "VersionKind" AS ENUM ('auto', 'manual', 'restore_point');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('pending', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "AssetSource" AS ENUM ('upload', 'ai', 'import', 'preview', 'avatar', 'logo', 'template');

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('assistant', 'image', 'animation', 'chat');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "avatarAssetId" UUID,
    "bio" VARCHAR(280),
    "locale" TEXT NOT NULL DEFAULT 'es',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "activeOrganizationId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "password" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ,
    "scope" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "metadata" TEXT,
    "personal" BOOLEAN NOT NULL DEFAULT false,
    "logoAssetId" UUID,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "inviterId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "createdById" TEXT NOT NULL,
    "orgAccess" "OrgAccess" NOT NULL DEFAULT 'editor',
    "previewAssetId" UUID,
    "templateId" UUID,
    "lastEditedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "ProjectColor" (
    "projectId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectColor_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "ProjectShareLink" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "projectId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "email" TEXT,
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "userId" TEXT NOT NULL,
    "targetType" VARCHAR(16) NOT NULL,
    "targetId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("userId","targetType","targetId")
);

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "projectId" UUID NOT NULL,
    "state" BYTEA NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "sizeBytes" INTEGER NOT NULL,
    "nodeCount" INTEGER NOT NULL,
    "nodeCountByType" JSONB NOT NULL,
    "assetRefs" UUID[],
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "ProjectVersion" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "projectId" UUID NOT NULL,
    "kind" "VersionKind" NOT NULL,
    "name" VARCHAR(80),
    "state" BYTEA NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "nodeCount" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" TEXT,
    "projectId" UUID,
    "templateId" UUID,
    "ownerId" TEXT NOT NULL,
    "source" "AssetSource" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'pending',
    "storageKey" TEXT NOT NULL,
    "mime" VARCHAR(64) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" CHAR(64),
    "variants" JSONB NOT NULL DEFAULT '{}',
    "name" VARCHAR(120),
    "aiPrompt" VARCHAR(2000),
    "inGallery" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "projectId" UUID NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "replyToId" UUID,
    "attachments" UUID[],
    "mentions" TEXT[],
    "editedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityDaily" (
    "projectId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "editOps" INTEGER NOT NULL DEFAULT 0,
    "nodesCreated" INTEGER NOT NULL DEFAULT 0,
    "nodesDeleted" INTEGER NOT NULL DEFAULT 0,
    "activeMinutes" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "chatMessages" INTEGER NOT NULL DEFAULT 0,
    "versionsCreated" INTEGER NOT NULL DEFAULT 0,
    "aiActions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ActivityDaily_pkey" PRIMARY KEY ("projectId","userId","day")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "projectId" UUID,
    "actorId" TEXT,
    "type" VARCHAR(48) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" TEXT NOT NULL,
    "projectId" UUID,
    "userId" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "images" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceAiQuota" (
    "organizationId" TEXT NOT NULL,
    "monthlyUnits" INTEGER,
    "perUserDailyUnits" INTEGER,

    CONSTRAINT "WorkspaceAiQuota_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "projectId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "title" VARCHAR(120),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "conversationId" UUID NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "parts" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" TEXT,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "createdById" TEXT,
    "state" BYTEA NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "previewAssetId" UUID,
    "assetRefs" UUID[],
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateLike" (
    "templateId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateLike_pkey" PRIMARY KEY ("templateId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "member_userId_idx" ON "member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "member_organizationId_userId_key" ON "member"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "invitation_organizationId_idx" ON "invitation"("organizationId");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE INDEX "invitation_inviterId_idx" ON "invitation"("inviterId");

-- CreateIndex
CREATE INDEX "Project_organizationId_deletedAt_lastEditedAt_idx" ON "Project"("organizationId", "deletedAt", "lastEditedAt" DESC);

-- CreateIndex
CREATE INDEX "Project_createdById_idx" ON "Project"("createdById");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectShareLink_tokenHash_key" ON "ProjectShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ProjectShareLink_projectId_idx" ON "ProjectShareLink"("projectId");

-- CreateIndex
CREATE INDEX "ProjectVersion_projectId_createdAt_idx" ON "ProjectVersion"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_storageKey_key" ON "Asset"("storageKey");

-- CreateIndex
CREATE INDEX "Asset_projectId_inGallery_createdAt_idx" ON "Asset"("projectId", "inGallery", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Asset_templateId_idx" ON "Asset"("templateId");

-- CreateIndex
CREATE INDEX "Asset_ownerId_source_idx" ON "Asset"("ownerId", "source");

-- CreateIndex
CREATE INDEX "Asset_organizationId_idx" ON "Asset"("organizationId");

-- CreateIndex
CREATE INDEX "Asset_status_createdAt_idx" ON "Asset"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_projectId_createdAt_idx" ON "ChatMessage"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityDaily_projectId_day_idx" ON "ActivityDaily"("projectId", "day");

-- CreateIndex
CREATE INDEX "ActivityEvent_projectId_createdAt_idx" ON "ActivityEvent"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityEvent_actorId_createdAt_idx" ON "ActivityEvent"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AiUsage_organizationId_createdAt_idx" ON "AiUsage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_userId_createdAt_idx" ON "AiUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiConversation_projectId_userId_updatedAt_idx" ON "AiConversation"("projectId", "userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Template_organizationId_createdAt_idx" ON "Template"("organizationId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectColor" ADD CONSTRAINT "ProjectColor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectShareLink" ADD CONSTRAINT "ProjectShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVersion" ADD CONSTRAINT "ProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAiQuota" ADD CONSTRAINT "WorkspaceAiQuota_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateLike" ADD CONSTRAINT "TemplateLike_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
