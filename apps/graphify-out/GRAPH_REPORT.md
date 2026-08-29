# Graph Report - apps  (2026-08-29)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1194 nodes · 2696 edges · 48 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 26 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0aface35`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- TestSessionScreen.tsx
- jobs.router.ts
- public.router.ts
- evaluation.service.ts
- sandbox/index.ts
- web/src/api/types.ts
- llm/index.ts
- scripts
- evaluation-routes.test.ts
- compilerOptions
- src/App.tsx
- errMessage
- ApplicationDetail.tsx
- JobConsole.tsx
- blueprint.service.ts
- item.ts
- companies.service.ts
- AppError
- oidc.ts
- mobile/package.json
- TestFlow.tsx
- session-draw.test.ts
- session.service.ts
- expo
- compilerOptions
- app.ts
- devDependencies
- draw.ts
- auth.ts
- web/src/api/client.ts
- session-routes.test.ts
- auth.service.ts
- setup.router.ts
- lib/http.ts
- compilerOptions
- env.ts
- web/package.json
- token.ts
- devDependencies
- dependencies
- devDependencies
- worker/package.json
- seed.ts
- PlatformPage

## God Nodes (most connected - your core abstractions)
1. `AppError` - 107 edges
2. `errMessage()` - 45 edges
3. `humanize()` - 23 edges
4. `prisma` - 22 edges
5. `useAuth()` - 18 edges
6. `newItemId()` - 16 edges
7. `fmtDateTime()` - 15 edges
8. `createApp()` - 15 edges
9. `compilerOptions` - 15 edges
10. `ApiErrorScreen()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `ipRateLimit()` --calls--> `AppError`  [EXTRACTED]
  api/src/modules/public/public.router.ts → api/src/lib/http.ts
- `CodeReviewPromptInput` --references--> `CodeLanguage`  [EXTRACTED]
  api/src/prompts/evaluation.ts → api/src/lib/assessment/item.ts
- `changeStatus()` --calls--> `errMessage()`  [EXTRACTED]
  web/src/hr/ApplicationDetail.tsx → web/src/api/client.ts
- `moveStage()` --calls--> `errMessage()`  [EXTRACTED]
  web/src/hr/ApplicationDetail.tsx → web/src/api/client.ts
- `ProviderRow()` --calls--> `fmtDate()`  [EXTRACTED]
  web/src/admin/ProvidersPage.tsx → web/src/components/ui.tsx

## Import Cycles
- None detected.

## Communities (48 total, 0 thin omitted)

### Community 0 - "TestSessionScreen.tsx"
Cohesion: 0.05
Nodes (68): App(), Route, styles, api, ApiError, ApiErrorBody, apiUrl(), DEFAULT_API_URL (+60 more)

### Community 1 - "jobs.router.ts"
Cohesion: 0.06
Nodes (55): assertPublicHttpUrl(), extractText(), fetchPageText(), isAcceptableContentType(), isPrivateIpv4(), isPrivateIpv6(), parseIpv4(), parseIpv6() (+47 more)

### Community 2 - "public.router.ts"
Cohesion: 0.06
Nodes (56): createRateLimiter(), RateLimiterOptions, generateTestToken(), hashTestToken(), isTokenShapeValid(), TEST_TOKEN_LENGTH, ApplyInput, applySchema (+48 more)

### Community 3 - "evaluation.service.ts"
Cohesion: 0.06
Nodes (54): backoffMs(), claimNext(), complete(), fail(), JobType, QueueJob, requeueStale(), McqAnswerLike (+46 more)

### Community 4 - "sandbox/index.ts"
Cohesion: 0.12
Nodes (32): CODE_LANGUAGES, CodeLanguage, assertHardenedArgs(), buildRunArgs(), CANONICAL_PREFIXES, COMMAND_PREFIX, IMAGE_ALLOW_LIST, stdinPayload() (+24 more)

### Community 5 - "web/src/api/types.ts"
Cohesion: 0.05
Nodes (42): BASE_URL_PLACEHOLDER, KIND_HELPER, KIND_LABEL, KINDS, ProviderRow(), TestOutcome, TEXT_MODEL_PLACEHOLDER, AiLikelihood (+34 more)

### Community 6 - "llm/index.ts"
Cohesion: 0.14
Nodes (26): AnthropicAdapter, buildAnthropicMessages(), ContentBlock, parseAnthropicResponse(), AzureOpenAiAdapter, LlmError, redactSecret(), buildOpenAiChatBody() (+18 more)

### Community 7 - "scripts"
Cohesion: 0.05
Nodes (42): dependencies, bcryptjs, cors, express, helmet, jsonwebtoken, morgan, @prisma/client (+34 more)

### Community 8 - "evaluation-routes.test.ts"
Cohesion: 0.09
Nodes (28): decryptSecret(), deriveKey(), encryptSecret(), CreateProviderInput, createProviderSchema, UpdateProviderInput, updateProviderSchema, activateProvider() (+20 more)

### Community 9 - "compilerOptions"
Cohesion: 0.06
Nodes (33): prisma, compilerOptions, outDir, rootDir, exclude, extends, include, dist (+25 more)

### Community 10 - "src/App.tsx"
Cohesion: 0.10
Nodes (27): ROLE_BADGE_CLASS, ROLE_EXPLAINERS, ROLES, TeamPage(), setToken(), AuthResponse, CreateUserInput, PublicUser (+19 more)

### Community 11 - "errMessage"
Cohesion: 0.09
Nodes (31): AddProviderForm(), submit(), ProvidersPage(), activate(), confirmDelete(), test(), InviteForm(), submit() (+23 more)

### Community 12 - "ApplicationDetail.tsx"
Cohesion: 0.11
Nodes (28): api, asPresented(), DashboardStats, Stage, STAGES, stageTransitionsFrom(), SwipeValuation, Xray (+20 more)

### Community 13 - "JobConsole.tsx"
Cohesion: 0.11
Nodes (25): SettingsPage(), AuthMode, BlueprintSection, BlueprintStatusView, CreateCompanyInput, JdDraft, JdView, PlatformCompany (+17 more)

### Community 14 - "blueprint.service.ts"
Cohesion: 0.16
Nodes (28): countByFormat(), drawSizes(), poolSatisfiesBlueprint(), QUESTION_FORMATS, requiredPoolSizes(), getActiveAdapter(), enqueue(), enqueueEvaluation() (+20 more)

### Community 15 - "item.ts"
Cohesion: 0.08
Nodes (26): blueprintSectionSchema, codeItem, difficultySchema, formatCount, formatsShape, hiddenCaseSchema, itemId, mcqItem (+18 more)

### Community 16 - "companies.service.ts"
Cohesion: 0.12
Nodes (23): slugify(), createCompany(), deleteCompany(), freeSlug(), listCompanies(), patchCompany(), PlatformCompanyRow, requireSuperAdmin() (+15 more)

### Community 17 - "AppError"
Cohesion: 0.15
Nodes (20): AppError, requireRole(), getDetail(), VoidItemInput, voidItemSchema, router, CreateInterviewInput, createInterviewSchema (+12 more)

### Community 18 - "oidc.ts"
Cohesion: 0.12
Nodes (13): isJwksDocument(), Jwk, JwksCache, jwksCaches, JwksDocument, nonEmptyString(), OidcTokenInfo, stringArray() (+5 more)

### Community 19 - "mobile/package.json"
Cohesion: 0.08
Nodes (24): expo, expo-clipboard, expo-constants, expo-status-bar, dependencies, expo, expo-clipboard, expo-constants (+16 more)

### Community 20 - "TestFlow.tsx"
Cohesion: 0.11
Nodes (18): AnswerContent, SessionView, SignalType, TestLinkInfo, mmss(), asMcqSaved(), asSwipeSaved(), asTextSaved() (+10 more)

### Community 21 - "session-draw.test.ts"
Cohesion: 0.15
Nodes (19): newItemId(), deadlineFor(), isExpired(), remainingMs(), SUBMIT_GRACE_MS, withinSubmitGrace(), ALL_FORMATS, codeItem() (+11 more)

### Community 22 - "session.service.ts"
Cohesion: 0.16
Nodes (23): assertClockRunning(), assertNotSubmitted(), buildView(), effectiveTimeLimit(), findLiveStartedSession(), getSessionView(), isPlainObject(), linkExpired() (+15 more)

### Community 23 - "expo"
Cohesion: 0.09
Nodes (22): softwareKeyboardLayoutMode, usesCleartextTraffic, expo, android, assetBundlePatterns, backgroundColor, extra, ios (+14 more)

### Community 24 - "compilerOptions"
Cohesion: 0.09
Nodes (21): DOM, DOM.Iterable, vite.config.ts, compilerOptions, isolatedModules, jsx, lib, module (+13 more)

### Community 25 - "app.ts"
Cohesion: 0.13
Nodes (13): createApp(), errorHandler(), notFoundHandler(), router, router, router, app, app (+5 more)

### Community 26 - "devDependencies"
Cohesion: 0.11
Nodes (19): devDependencies, supertest, tsx, @types/cors, @types/express, @types/jsonwebtoken, @types/morgan, @types/node (+11 more)

### Community 27 - "draw.ts"
Cohesion: 0.19
Nodes (15): AssessmentItem, BlueprintSection, QuestionFormat, DrawInput, DrawnQuestion, drawSession(), hashSeed(), KeyAbsent (+7 more)

### Community 28 - "auth.ts"
Cohesion: 0.22
Nodes (12): getJwksCache(), mapRoles(), Express, localAuth(), oidcAuth(), provisionOidcUser(), Request, requireAuth() (+4 more)

### Community 29 - "web/src/api/client.ts"
Cohesion: 0.16
Nodes (13): ApiError, ApiErrorBody, ApiErrorDetail, getToken(), isNotFound(), request(), TOKEN_STORAGE_KEY, ApplyInput (+5 more)

### Community 30 - "session-routes.test.ts"
Cohesion: 0.15
Nodes (10): assessmentItemSchema, app, BLUEPRINT, ENCRYPTED_POOL, POOL_IDS, POOL_ITEMS, PRESENTED_MCQ, sessionRow() (+2 more)

### Community 31 - "auth.service.ts"
Cohesion: 0.26
Nodes (9): hashPassword(), verifyPassword(), router, LoginInput, loginSchema, RegisterInput, registerSchema, DUMMY_HASH (+1 more)

### Community 32 - "setup.router.ts"
Cohesion: 0.22
Nodes (10): register(), hits, NOTE: helmet's default CSP blocks inline <script>, so the page's JS is a, router, WIZARD_HTML, WIZARD_JS, InstallInput, installSchema (+2 more)

### Community 33 - "lib/http.ts"
Cohesion: 0.27
Nodes (8): asyncHandler(), router, router, CreateUserInput, createUserSchema, createCompanyUser(), listCompanyUsers(), toPublicUser()

### Community 34 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters, strict, types, extends, include (+4 more)

### Community 35 - "env.ts"
Cohesion: 0.21
Nodes (8): boolString, DEV_DEFAULT_SECRETS_KEY, env, parsed, schema, usesUnsafeProductionSecrets(), app, server

### Community 36 - "web/package.json"
Cohesion: 0.17
Nodes (11): description, license, name, private, scripts, build, dev, preview (+3 more)

### Community 37 - "token.ts"
Cohesion: 0.24
Nodes (8): SignExpiresIn, signToken(), verifyToken(), app, auth, recruiterUser, superAdminUser, token

### Community 38 - "devDependencies"
Cohesion: 0.20
Nodes (10): typescript, typescript, @babel/core, devDependencies, @babel/core, @types/react, typescript, @types/react (+2 more)

### Community 39 - "dependencies"
Cohesion: 0.29
Nodes (7): react-dom, react-router-dom, dependencies, react, react-dom, react-router-dom, react

### Community 40 - "devDependencies"
Cohesion: 0.29
Nodes (7): @types/react-dom, vite, @vitejs/plugin-react, devDependencies, @types/react-dom, vite, @vitejs/plugin-react

### Community 41 - "worker/package.json"
Cohesion: 0.33
Nodes (5): description, license, name, private, version

### Community 42 - "seed.ts"
Cohesion: 0.60
Nodes (4): daysAgo(), daysFromNow(), main(), prisma

### Community 43 - "PlatformPage"
Cohesion: 1.00
Nodes (3): PlatformPage(), deleteCompany(), reload()

## Knowledge Gaps
- **343 isolated node(s):** `Route`, `ApiErrorBody`, `EmploymentType`, `QuestionFormat`, `RoleFamily` (+338 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppError` connect `AppError` to `setup.router.ts`, `lib/http.ts`, `jobs.router.ts`, `public.router.ts`, `sandbox/index.ts`, `token.ts`, `llm/index.ts`, `evaluation.service.ts`, `evaluation-routes.test.ts`, `blueprint.service.ts`, `companies.service.ts`, `oidc.ts`, `session.service.ts`, `app.ts`, `auth.ts`, `auth.service.ts`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `prisma` connect `auth.ts` to `setup.router.ts`, `jobs.router.ts`, `public.router.ts`, `evaluation.service.ts`, `env.ts`, `lib/http.ts`, `llm/index.ts`, `token.ts`, `evaluation-routes.test.ts`, `blueprint.service.ts`, `companies.service.ts`, `AppError`, `session.service.ts`, `auth.service.ts`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `errMessage()` connect `errMessage` to `web/src/api/types.ts`, `src/App.tsx`, `ApplicationDetail.tsx`, `JobConsole.tsx`, `web/src/api/client.ts`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `Route`, `ApiErrorBody`, `EmploymentType` to the rest of the system?**
  _343 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TestSessionScreen.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.051590483827853514 - nodes in this community are weakly interconnected._
- **Should `jobs.router.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.056189640035118525 - nodes in this community are weakly interconnected._
- **Should `public.router.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05547785547785548 - nodes in this community are weakly interconnected._