# Graph Report - apps  (2026-08-29)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1146 nodes · 2575 edges · 56 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ce09d756`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- TestSessionScreen.tsx
- lib/http.ts
- evaluation.service.ts
- jobs.router.ts
- applications.router.ts
- sandbox/index.ts
- scripts
- src/App.tsx
- web/src/api/types.ts
- errMessage
- web/src/api/client.ts
- ApplicationDetail.tsx
- AppError
- app.ts
- TestFlow.tsx
- blueprint.service.ts
- oidc.ts
- expo
- auth.ts
- public.router.ts
- compilerOptions
- JobConsole.tsx
- devDependencies
- item.ts
- public.service.ts
- auth.service.ts
- draw.ts
- setup.router.ts
- evaluation-routes.test.ts
- session-routes.test.ts
- session-draw.test.ts
- compilerOptions
- dependencies
- compilerOptions
- ProvidersPage.tsx
- env.ts
- devDependencies
- blueprint-routes.test.ts
- newItemId
- users.service.ts
- runPoolSeal
- tsconfig.build.json
- include
- mobile/package.json
- dependencies
- devDependencies
- web/package.json
- exclude
- worker/package.json
- seed.ts
- scripts
- scripts

## God Nodes (most connected - your core abstractions)
1. `AppError` - 101 edges
2. `errMessage()` - 40 edges
3. `humanize()` - 23 edges
4. `prisma` - 19 edges
5. `useAuth()` - 17 edges
6. `newItemId()` - 16 edges
7. `fmtDateTime()` - 15 edges
8. `compilerOptions` - 15 edges
9. `startSession()` - 14 edges
10. `createApp()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `ipRateLimit()` --calls--> `AppError`  [EXTRACTED]
  api/src/modules/public/public.router.ts → api/src/lib/http.ts
- `CodeReviewPromptInput` --references--> `CodeLanguage`  [EXTRACTED]
  api/src/prompts/evaluation.ts → api/src/lib/assessment/item.ts
- `ProviderRow()` --calls--> `fmtDate()`  [EXTRACTED]
  web/src/admin/ProvidersPage.tsx → web/src/components/ui.tsx
- `changeStatus()` --calls--> `errMessage()`  [EXTRACTED]
  web/src/hr/ApplicationDetail.tsx → web/src/api/client.ts
- `moveStage()` --calls--> `errMessage()`  [EXTRACTED]
  web/src/hr/ApplicationDetail.tsx → web/src/api/client.ts

## Import Cycles
- None detected.

## Communities (56 total, 0 thin omitted)

### Community 0 - "TestSessionScreen.tsx"
Cohesion: 0.05
Nodes (68): App(), Route, styles, api, ApiError, ApiErrorBody, apiUrl(), DEFAULT_API_URL (+60 more)

### Community 1 - "lib/http.ts"
Cohesion: 0.08
Nodes (44): decryptSecret(), deriveKey(), encryptSecret(), AnthropicAdapter, buildAnthropicMessages(), ContentBlock, parseAnthropicResponse(), AzureOpenAiAdapter (+36 more)

### Community 2 - "evaluation.service.ts"
Cohesion: 0.06
Nodes (53): backoffMs(), claimNext(), complete(), fail(), JobType, QueueJob, requeueStale(), McqAnswerLike (+45 more)

### Community 3 - "jobs.router.ts"
Cohesion: 0.07
Nodes (48): assertPublicHttpUrl(), extractText(), fetchPageText(), isAcceptableContentType(), isPrivateIpv4(), isPrivateIpv6(), parseIpv4(), parseIpv6() (+40 more)

### Community 4 - "applications.router.ts"
Cohesion: 0.07
Nodes (47): asyncHandler(), router, ApplyInput, applySchema, changeStatusSchema, listApplicationsQuerySchema, moveStageSchema, StatusAction (+39 more)

### Community 5 - "sandbox/index.ts"
Cohesion: 0.12
Nodes (32): CODE_LANGUAGES, CodeLanguage, assertHardenedArgs(), buildRunArgs(), CANONICAL_PREFIXES, COMMAND_PREFIX, IMAGE_ALLOW_LIST, stdinPayload() (+24 more)

### Community 6 - "scripts"
Cohesion: 0.05
Nodes (42): dependencies, bcryptjs, cors, express, helmet, jsonwebtoken, morgan, @prisma/client (+34 more)

### Community 7 - "src/App.tsx"
Cohesion: 0.11
Nodes (25): ROLE_BADGE_CLASS, ROLE_EXPLAINERS, ROLES, TeamPage(), setToken(), AuthResponse, CreateUserInput, PublicUser (+17 more)

### Community 8 - "web/src/api/types.ts"
Cohesion: 0.08
Nodes (29): AiLikelihood, ApplicationDetail, ApplicationListItem, ApplicationStatus, BlueprintDto, Candidate, EmploymentType, IntakeInput (+21 more)

### Community 9 - "errMessage"
Cohesion: 0.10
Nodes (27): AddProviderForm(), submit(), ProvidersPage(), activate(), confirmDelete(), test(), InviteForm(), submit() (+19 more)

### Community 10 - "web/src/api/client.ts"
Cohesion: 0.11
Nodes (22): SettingsPage(), api, ApiError, ApiErrorBody, ApiErrorDetail, getToken(), isNotFound(), request() (+14 more)

### Community 11 - "ApplicationDetail.tsx"
Cohesion: 0.12
Nodes (24): asPresented(), Stage, stageTransitionsFrom(), SwipeValuation, Xray, XrayEvaluation, XrayExecution, XrayQuestion (+16 more)

### Community 12 - "AppError"
Cohesion: 0.17
Nodes (24): AppError, assertClockRunning(), assertNotSubmitted(), buildView(), effectiveTimeLimit(), findLiveStartedSession(), getSessionView(), isPlainObject() (+16 more)

### Community 13 - "app.ts"
Cohesion: 0.11
Nodes (16): createApp(), errorHandler(), notFoundHandler(), router, router, router, app, app (+8 more)

### Community 14 - "TestFlow.tsx"
Cohesion: 0.11
Nodes (18): AnswerContent, SessionView, SignalType, TestLinkInfo, mmss(), asMcqSaved(), asSwipeSaved(), asTextSaved() (+10 more)

### Community 15 - "blueprint.service.ts"
Cohesion: 0.19
Nodes (21): BlueprintSection, QUESTION_FORMATS, enqueue(), enqueueEvaluation(), activePoolFor(), asItemsArray(), assertProvider(), generateItems() (+13 more)

### Community 16 - "oidc.ts"
Cohesion: 0.13
Nodes (12): isJwksDocument(), Jwk, JwksCache, jwksCaches, JwksDocument, nonEmptyString(), OidcTokenInfo, stringArray() (+4 more)

### Community 17 - "expo"
Cohesion: 0.09
Nodes (22): softwareKeyboardLayoutMode, usesCleartextTraffic, expo, android, assetBundlePatterns, backgroundColor, extra, ios (+14 more)

### Community 18 - "auth.ts"
Cohesion: 0.16
Nodes (15): getJwksCache(), mapRoles(), ProvaRole, SignExpiresIn, verifyToken(), Express, localAuth(), oidcAuth() (+7 more)

### Community 19 - "public.router.ts"
Cohesion: 0.11
Nodes (18): createRateLimiter(), RateLimiterOptions, roleFamilySchema, workModeSchema, applyLimiter, ipRateLimit(), router, sessionLimiter (+10 more)

### Community 20 - "compilerOptions"
Cohesion: 0.09
Nodes (21): DOM, DOM.Iterable, vite.config.ts, compilerOptions, isolatedModules, jsx, lib, module (+13 more)

### Community 21 - "JobConsole.tsx"
Cohesion: 0.14
Nodes (17): BlueprintSection, BlueprintStatusView, JdDraft, JdView, PoolStatusView, QuestionFormat, SampleItem, DIFFICULTY_MIXES (+9 more)

### Community 22 - "devDependencies"
Cohesion: 0.11
Nodes (19): devDependencies, supertest, tsx, @types/cors, @types/express, @types/jsonwebtoken, @types/morgan, @types/node (+11 more)

### Community 23 - "item.ts"
Cohesion: 0.11
Nodes (18): codeItem, difficultySchema, formatCount, formatsShape, hiddenCaseSchema, itemId, mcqItem, mcqOptionSchema (+10 more)

### Community 24 - "public.service.ts"
Cohesion: 0.19
Nodes (16): generateTestToken(), hashTestToken(), isTokenShapeValid(), TEST_TOKEN_LENGTH, applyToJob(), apply(), ApplyResult, getPublicJob() (+8 more)

### Community 25 - "auth.service.ts"
Cohesion: 0.24
Nodes (12): hashPassword(), verifyPassword(), slugify(), signToken(), LoginInput, loginSchema, RegisterInput, registerSchema (+4 more)

### Community 26 - "draw.ts"
Cohesion: 0.20
Nodes (14): AssessmentItem, QuestionFormat, DrawInput, DrawnQuestion, drawSession(), hashSeed(), KeyAbsent, mulberry32() (+6 more)

### Community 27 - "setup.router.ts"
Cohesion: 0.20
Nodes (10): hits, NOTE: helmet's default CSP blocks inline <script>, so the page's JS is a, router, WIZARD_HTML, WIZARD_JS, InstallInput, installSchema, install() (+2 more)

### Community 28 - "evaluation-routes.test.ts"
Cohesion: 0.13
Nodes (10): app, auth, ENCRYPTED_POOL, {
  mockUser,
  savedEvaluations,
  userFindUnique,
  applicationFindUnique,
  applicationUpdate,
  testSessionFindUnique,
  sessionQuestionFindFirst,
  sessionQuestionFindMany,
  answerUpsertUnused,
  poolFindFirst,
  voidedItemFindMany,
  voidedItemUpsert,
  voidedItemFindUnique,
  llmProviderFindFirst,
  evaluationFindUnique,
  evaluationUpsert,
  evaluationFindMany,
  evaluationUpdateMany,
  executionResultUpsert,
  sessionAssessmentUpsert,
  sessionAssessmentFindUnique,
  signalFindMany,
}, now, POOL_ITEMS, NOTE: the collusion probe also carries sessionId ({ not: ... }) — branch, SESSION_QUESTIONS (+2 more)

### Community 29 - "session-routes.test.ts"
Cohesion: 0.15
Nodes (10): assessmentItemSchema, app, BLUEPRINT, ENCRYPTED_POOL, POOL_IDS, POOL_ITEMS, PRESENTED_MCQ, sessionRow() (+2 more)

### Community 30 - "session-draw.test.ts"
Cohesion: 0.25
Nodes (11): deadlineFor(), isExpired(), remainingMs(), SUBMIT_GRACE_MS, withinSubmitGrace(), codeItem(), fullMixedPool(), itemsOf() (+3 more)

### Community 31 - "compilerOptions"
Cohesion: 0.14
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, noImplicitOverride, outDir, resolveJsonModule (+6 more)

### Community 32 - "dependencies"
Cohesion: 0.15
Nodes (13): expo, expo-clipboard, expo-constants, expo-status-bar, dependencies, expo, expo-clipboard, expo-constants (+5 more)

### Community 33 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters, strict, types, extends, include (+4 more)

### Community 34 - "ProvidersPage.tsx"
Cohesion: 0.15
Nodes (11): BASE_URL_PLACEHOLDER, KIND_HELPER, KIND_LABEL, KINDS, ProviderRow(), TestOutcome, TEXT_MODEL_PLACEHOLDER, CreateProviderInput (+3 more)

### Community 35 - "env.ts"
Cohesion: 0.21
Nodes (8): boolString, DEV_DEFAULT_SECRETS_KEY, env, parsed, schema, usesUnsafeProductionSecrets(), app, server

### Community 36 - "devDependencies"
Cohesion: 0.20
Nodes (10): typescript, typescript, @babel/core, devDependencies, @babel/core, @types/react, typescript, @types/react (+2 more)

### Community 37 - "blueprint-routes.test.ts"
Cohesion: 0.22
Nodes (8): blueprintSectionSchema, PutBlueprintInput, putBlueprintSchema, samplesRequestSchema, app, auth, token, validBlueprint

### Community 38 - "newItemId"
Cohesion: 0.29
Nodes (8): newItemId(), ALL_FORMATS, codeItem(), mcqItem(), swipeItem(), writtenItem(), mcqItem(), sixOptionMcq()

### Community 39 - "users.service.ts"
Cohesion: 0.36
Nodes (6): requireRole(), router, CreateUserInput, createUserSchema, createCompanyUser(), listCompanyUsers()

### Community 40 - "runPoolSeal"
Cohesion: 0.46
Nodes (8): countByFormat(), drawSizes(), poolSatisfiesBlueprint(), requiredPoolSizes(), getActiveAdapter(), formatSummary(), runPoolSeal(), runSamplesGeneration()

### Community 41 - "tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ./tsconfig.json

### Community 42 - "include"
Cohesion: 0.29
Nodes (6): exclude, include, dist, src/**/*.ts, prisma/**/*.ts, tests/**/*.ts

### Community 43 - "mobile/package.json"
Cohesion: 0.29
Nodes (6): description, license, main, name, private, version

### Community 44 - "dependencies"
Cohesion: 0.29
Nodes (7): react-dom, react-router-dom, dependencies, react, react-dom, react-router-dom, react

### Community 45 - "devDependencies"
Cohesion: 0.29
Nodes (7): @types/react-dom, vite, @vitejs/plugin-react, devDependencies, @types/react-dom, vite, @vitejs/plugin-react

### Community 46 - "web/package.json"
Cohesion: 0.29
Nodes (6): description, license, name, private, type, version

### Community 47 - "exclude"
Cohesion: 0.33
Nodes (6): prisma, exclude, dist, node_modules, prisma, tests

### Community 48 - "worker/package.json"
Cohesion: 0.33
Nodes (5): description, license, name, private, version

### Community 49 - "seed.ts"
Cohesion: 0.60
Nodes (4): daysAgo(), daysFromNow(), main(), prisma

### Community 50 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, android, ios, start, typecheck

### Community 51 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, preview, typecheck

## Knowledge Gaps
- **331 isolated node(s):** `Route`, `ApiErrorBody`, `EmploymentType`, `QuestionFormat`, `RoleFamily` (+326 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppError` connect `AppError` to `lib/http.ts`, `evaluation.service.ts`, `jobs.router.ts`, `applications.router.ts`, `sandbox/index.ts`, `users.service.ts`, `runPoolSeal`, `app.ts`, `blueprint.service.ts`, `oidc.ts`, `auth.ts`, `public.router.ts`, `public.service.ts`, `auth.service.ts`, `setup.router.ts`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `devDependencies`, `scripts`, `exclude`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `prisma` connect `auth.ts` to `lib/http.ts`, `evaluation.service.ts`, `env.ts`, `applications.router.ts`, `jobs.router.ts`, `users.service.ts`, `AppError`, `blueprint.service.ts`, `public.service.ts`, `auth.service.ts`, `setup.router.ts`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `Route`, `ApiErrorBody`, `EmploymentType` to the rest of the system?**
  _331 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TestSessionScreen.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.051590483827853514 - nodes in this community are weakly interconnected._
- **Should `lib/http.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08490945674044266 - nodes in this community are weakly interconnected._
- **Should `evaluation.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05654761904761905 - nodes in this community are weakly interconnected._