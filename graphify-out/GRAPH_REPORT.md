# Graph Report - apps  (2026-08-31)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1286 nodes · 2935 edges · 63 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 29 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e8700dae`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- TestSessionScreen.tsx
- sandbox/index.ts
- evaluation.service.ts
- web/src/api/types.ts
- evaluation-routes.test.ts
- llm/index.ts
- scripts
- prisma.ts
- errMessage
- JobConsole.tsx
- src/App.tsx
- platform.router.ts
- oidc.ts
- applications.router.ts
- TestFlow.tsx
- ApplicationDetail.tsx
- auth.service.ts
- jobs.router.ts
- session.service.ts
- expo
- web/src/api/client.ts
- applications.service.ts
- compilerOptions
- app.ts
- lib/http.ts
- devDependencies
- item.ts
- auth.ts
- public.service.ts
- AppError
- jd.service.ts
- public.router.ts
- SettingsPage.tsx
- draw.ts
- blueprint.service.ts
- session-draw.test.ts
- session-routes.test.ts
- blueprint-routes.test.ts
- compilerOptions
- dependencies
- compilerOptions
- urlFetch.ts
- runPoolSeal
- jd.schema.ts
- devDependencies
- newItemId
- tsconfig.build.json
- applications.schema.ts
- include
- mobile/package.json
- dependencies
- devDependencies
- web/package.json
- exclude
- worker/package.json
- seed.ts
- jobStatus.ts
- scripts
- scripts

## God Nodes (most connected - your core abstractions)
1. `AppError` - 116 edges
2. `errMessage()` - 50 edges
3. `prisma` - 25 edges
4. `humanize()` - 23 edges
5. `useAuth()` - 18 edges
6. `createApp()` - 16 edges
7. `newItemId()` - 16 edges
8. `CodeLanguage` - 15 edges
9. `fmtDateTime()` - 15 edges
10. `requireAuth()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `CodeReviewPromptInput` --references--> `CodeLanguage`  [EXTRACTED]
  api/src/prompts/evaluation.ts → api/src/lib/assessment/item.ts
- `ipRateLimit()` --calls--> `AppError`  [EXTRACTED]
  api/src/modules/public/public.router.ts → api/src/lib/http.ts
- `ProviderRow()` --calls--> `fmtDate()`  [EXTRACTED]
  web/src/admin/ProvidersPage.tsx → web/src/components/ui.tsx
- `changeStatus()` --calls--> `errMessage()`  [EXTRACTED]
  web/src/hr/ApplicationDetail.tsx → web/src/api/client.ts
- `moveStage()` --calls--> `errMessage()`  [EXTRACTED]
  web/src/hr/ApplicationDetail.tsx → web/src/api/client.ts

## Import Cycles
- None detected.

## Communities (63 total, 0 thin omitted)

### Community 0 - "TestSessionScreen.tsx"
Cohesion: 0.05
Nodes (68): App(), Route, styles, api, ApiError, ApiErrorBody, apiUrl(), DEFAULT_API_URL (+60 more)

### Community 1 - "sandbox/index.ts"
Cohesion: 0.08
Nodes (53): CODE_LANGUAGES, CodeLanguage, assertHardenedArgs(), buildRunArgs(), CANONICAL_PREFIXES, canonicalPrefixes(), COMMAND_PREFIX, requireSafeTemplateImage() (+45 more)

### Community 2 - "evaluation.service.ts"
Cohesion: 0.06
Nodes (54): backoffMs(), claimNext(), complete(), fail(), JobType, QueueJob, requeueStale(), McqAnswerLike (+46 more)

### Community 3 - "web/src/api/types.ts"
Cohesion: 0.05
Nodes (46): BASE_URL_PLACEHOLDER, KIND_HELPER, KIND_LABEL, KINDS, ProviderRow(), TestOutcome, TEXT_MODEL_PLACEHOLDER, AiLikelihood (+38 more)

### Community 4 - "evaluation-routes.test.ts"
Cohesion: 0.06
Nodes (36): decryptSecret(), deriveKey(), encryptSecret(), CreateProviderInput, createProviderSchema, UpdateProviderInput, updateProviderSchema, activateProvider() (+28 more)

### Community 5 - "llm/index.ts"
Cohesion: 0.14
Nodes (26): AnthropicAdapter, buildAnthropicMessages(), ContentBlock, parseAnthropicResponse(), AzureOpenAiAdapter, LlmError, redactSecret(), buildOpenAiChatBody() (+18 more)

### Community 6 - "scripts"
Cohesion: 0.05
Nodes (42): dependencies, bcryptjs, cors, express, helmet, jsonwebtoken, morgan, @prisma/client (+34 more)

### Community 7 - "prisma.ts"
Cohesion: 0.07
Nodes (28): boolString, DEV_DEFAULT_SECRETS_KEY, env, parsed, schema, usesUnsafeProductionSecrets(), app, server (+20 more)

### Community 8 - "errMessage"
Cohesion: 0.09
Nodes (32): AddProviderForm(), submit(), ProvidersPage(), activate(), confirmDelete(), test(), InviteForm(), submit() (+24 more)

### Community 9 - "JobConsole.tsx"
Cohesion: 0.10
Nodes (28): api, isNotFound(), ApplyInput, ApplyResponse, BlueprintSection, BlueprintStatusView, DashboardStats, JdDraft (+20 more)

### Community 10 - "src/App.tsx"
Cohesion: 0.11
Nodes (25): TeamPage(), IntakeInput, IntakeResponse, IntakeScreenshot, Job, ADMIN_ONLY, App(), AppHeader() (+17 more)

### Community 11 - "platform.router.ts"
Cohesion: 0.13
Nodes (22): slugify(), createCompany(), deleteCompany(), freeSlug(), listCompanies(), patchCompany(), PlatformCompanyRow, CreateCompanyInput (+14 more)

### Community 12 - "oidc.ts"
Cohesion: 0.12
Nodes (13): isJwksDocument(), Jwk, JwksCache, jwksCaches, JwksDocument, nonEmptyString(), OidcTokenInfo, stringArray() (+5 more)

### Community 13 - "applications.router.ts"
Cohesion: 0.14
Nodes (20): router, getDetail(), VoidItemInput, voidItemSchema, getXray(), router, CreateInterviewInput, createInterviewSchema (+12 more)

### Community 14 - "TestFlow.tsx"
Cohesion: 0.11
Nodes (18): AnswerContent, SessionView, SignalType, TestLinkInfo, mmss(), asMcqSaved(), asSwipeSaved(), asTextSaved() (+10 more)

### Community 15 - "ApplicationDetail.tsx"
Cohesion: 0.12
Nodes (22): asPresented(), Stage, stageTransitionsFrom(), SwipeValuation, Xray, XrayEvaluation, XrayExecution, XrayQuestion (+14 more)

### Community 16 - "auth.service.ts"
Cohesion: 0.16
Nodes (16): hashPassword(), verifyPassword(), hasAnyEnabledAuthConfig(), router, LoginInput, loginSchema, RegisterInput, registerSchema (+8 more)

### Community 17 - "jobs.router.ts"
Cohesion: 0.15
Nodes (19): listForJob(), router, CreateJobInput, createJobSchema, employmentTypeSchema, jobBase, listJobsQuerySchema, roleFamilySchema (+11 more)

### Community 18 - "session.service.ts"
Cohesion: 0.16
Nodes (22): assertClockRunning(), assertNotSubmitted(), buildView(), effectiveTimeLimit(), findLiveStartedSession(), getSessionView(), isPlainObject(), linkExpired() (+14 more)

### Community 19 - "expo"
Cohesion: 0.09
Nodes (22): softwareKeyboardLayoutMode, usesCleartextTraffic, expo, android, assetBundlePatterns, backgroundColor, extra, ios (+14 more)

### Community 20 - "web/src/api/client.ts"
Cohesion: 0.13
Nodes (19): ROLE_BADGE_CLASS, ROLE_EXPLAINERS, ROLES, ApiError, ApiErrorBody, ApiErrorDetail, getToken(), request() (+11 more)

### Community 21 - "applications.service.ts"
Cohesion: 0.19
Nodes (19): changeStatus(), getScopedApplication(), moveStage(), AI_PIPELINE_STAGES, AI_PIPELINE_TRANSITIONS, AiPipelineStage, aiPipelineTransitionsFrom(), canReject() (+11 more)

### Community 22 - "compilerOptions"
Cohesion: 0.09
Nodes (21): DOM, DOM.Iterable, vite.config.ts, compilerOptions, isolatedModules, jsx, lib, module (+13 more)

### Community 23 - "app.ts"
Cohesion: 0.13
Nodes (13): createApp(), errorHandler(), notFoundHandler(), router, router, router, app, app (+5 more)

### Community 24 - "lib/http.ts"
Cohesion: 0.19
Nodes (14): asyncHandler(), requireAuth(), requireRole(), router, PutAuthConfigInput, putAuthConfigSchema, authConfigSelect, AuthConfigView (+6 more)

### Community 25 - "devDependencies"
Cohesion: 0.11
Nodes (19): devDependencies, supertest, tsx, @types/cors, @types/express, @types/jsonwebtoken, @types/morgan, @types/node (+11 more)

### Community 26 - "item.ts"
Cohesion: 0.11
Nodes (18): codeItem, difficultySchema, formatCount, formatsShape, hiddenCaseSchema, itemId, mcqItem, mcqOptionSchema (+10 more)

### Community 27 - "auth.ts"
Cohesion: 0.19
Nodes (17): getJwksCache(), mapRoles(), verifyToken(), Express, extractUnverifiedIssuer(), LoadedUser, loadUserById(), localAuth() (+9 more)

### Community 28 - "public.service.ts"
Cohesion: 0.19
Nodes (16): generateTestToken(), hashTestToken(), isTokenShapeValid(), TEST_TOKEN_LENGTH, applyToJob(), apply(), ApplyResult, getPublicJob() (+8 more)

### Community 29 - "AppError"
Cohesion: 0.18
Nodes (12): AppError, register(), requireSuperAdmin(), hits, NOTE: helmet's default CSP blocks inline <script>, so the page's JS is a, router, WIZARD_HTML, WIZARD_JS (+4 more)

### Community 30 - "jd.service.ts"
Cohesion: 0.20
Nodes (15): getActiveAdapter(), approveJd(), asScreenshotArray(), createIntake(), deepMerge(), editDraft(), getJd(), getScopedJob() (+7 more)

### Community 31 - "public.router.ts"
Cohesion: 0.15
Nodes (14): createRateLimiter(), RateLimiterOptions, applyLimiter, ipRateLimit(), sessionLimiter, testTokenLimiter, AnswerInput, answerSchema (+6 more)

### Community 32 - "SettingsPage.tsx"
Cohesion: 0.15
Nodes (14): imageShapeValid(), issuerShapeValid(), KeycloakConfigCard(), submit(), LANGUAGE_LABEL, SettingsPage(), TemplateRow(), submit() (+6 more)

### Community 33 - "draw.ts"
Cohesion: 0.20
Nodes (14): AssessmentItem, QuestionFormat, DrawInput, DrawnQuestion, drawSession(), hashSeed(), KeyAbsent, mulberry32() (+6 more)

### Community 34 - "blueprint.service.ts"
Cohesion: 0.31
Nodes (14): enqueue(), enqueueEvaluation(), activePoolFor(), assertProvider(), getBlueprint(), getPool(), getSamples(), getScopedJob() (+6 more)

### Community 35 - "session-draw.test.ts"
Cohesion: 0.23
Nodes (12): deadlineFor(), isExpired(), remainingMs(), SUBMIT_GRACE_MS, withinSubmitGrace(), submitSession(), codeItem(), fullMixedPool() (+4 more)

### Community 36 - "session-routes.test.ts"
Cohesion: 0.15
Nodes (10): assessmentItemSchema, app, BLUEPRINT, ENCRYPTED_POOL, POOL_IDS, POOL_ITEMS, PRESENTED_MCQ, sessionRow() (+2 more)

### Community 37 - "blueprint-routes.test.ts"
Cohesion: 0.16
Nodes (11): BlueprintSection, blueprintSectionSchema, QUESTION_FORMATS, PutBlueprintInput, putBlueprintSchema, samplesRequestSchema, ITEM_SYSTEM_PROMPT, app (+3 more)

### Community 38 - "compilerOptions"
Cohesion: 0.14
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, noImplicitOverride, outDir, resolveJsonModule (+6 more)

### Community 39 - "dependencies"
Cohesion: 0.15
Nodes (13): expo, expo-clipboard, expo-constants, expo-status-bar, dependencies, expo, expo-clipboard, expo-constants (+5 more)

### Community 40 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters, strict, types, extends, include (+4 more)

### Community 41 - "urlFetch.ts"
Cohesion: 0.35
Nodes (10): assertPublicHttpUrl(), extractText(), fetchPageText(), isAcceptableContentType(), isPrivateIpv4(), isPrivateIpv6(), parseIpv4(), parseIpv6() (+2 more)

### Community 42 - "runPoolSeal"
Cohesion: 0.31
Nodes (11): countByFormat(), drawSizes(), poolSatisfiesBlueprint(), requiredPoolSizes(), asItemsArray(), formatSummary(), generateItems(), parseSections() (+3 more)

### Community 43 - "jd.schema.ts"
Cohesion: 0.18
Nodes (10): approveSchema, EditDraftInput, editDraftSchema, IntakeInput, intakeSchema, JdDraft, jdDraftBase, jdDraftPartialSchema (+2 more)

### Community 44 - "devDependencies"
Cohesion: 0.20
Nodes (10): typescript, typescript, @babel/core, devDependencies, @babel/core, @types/react, typescript, @types/react (+2 more)

### Community 45 - "newItemId"
Cohesion: 0.29
Nodes (8): newItemId(), ALL_FORMATS, codeItem(), mcqItem(), swipeItem(), writtenItem(), mcqItem(), sixOptionMcq()

### Community 46 - "tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ./tsconfig.json

### Community 47 - "applications.schema.ts"
Cohesion: 0.29
Nodes (6): ApplyInput, applySchema, changeStatusSchema, listApplicationsQuerySchema, moveStageSchema, StatusAction

### Community 48 - "include"
Cohesion: 0.29
Nodes (6): exclude, include, dist, src/**/*.ts, prisma/**/*.ts, tests/**/*.ts

### Community 49 - "mobile/package.json"
Cohesion: 0.29
Nodes (6): description, license, main, name, private, version

### Community 50 - "dependencies"
Cohesion: 0.29
Nodes (7): react-dom, react-router-dom, dependencies, react, react-dom, react-router-dom, react

### Community 51 - "devDependencies"
Cohesion: 0.29
Nodes (7): @types/react-dom, vite, @vitejs/plugin-react, devDependencies, @types/react-dom, vite, @vitejs/plugin-react

### Community 52 - "web/package.json"
Cohesion: 0.29
Nodes (6): description, license, name, private, type, version

### Community 53 - "exclude"
Cohesion: 0.33
Nodes (6): prisma, exclude, dist, node_modules, prisma, tests

### Community 54 - "worker/package.json"
Cohesion: 0.33
Nodes (5): description, license, name, private, version

### Community 55 - "seed.ts"
Cohesion: 0.60
Nodes (4): daysAgo(), daysFromNow(), main(), prisma

### Community 56 - "jobStatus.ts"
Cohesion: 0.60
Nodes (3): canTransitionJob(), isJobStatus(), TRANSITIONS

### Community 57 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, android, ios, start, typecheck

### Community 58 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, preview, typecheck

## Knowledge Gaps
- **374 isolated node(s):** `Route`, `ApiErrorBody`, `EmploymentType`, `QuestionFormat`, `RoleFamily` (+369 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppError` connect `AppError` to `sandbox/index.ts`, `evaluation.service.ts`, `evaluation-routes.test.ts`, `llm/index.ts`, `prisma.ts`, `platform.router.ts`, `oidc.ts`, `applications.router.ts`, `auth.service.ts`, `jobs.router.ts`, `session.service.ts`, `applications.service.ts`, `app.ts`, `lib/http.ts`, `auth.ts`, `public.service.ts`, `jd.service.ts`, `public.router.ts`, `blueprint.service.ts`, `session-draw.test.ts`, `urlFetch.ts`, `runPoolSeal`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `prisma` connect `prisma.ts` to `sandbox/index.ts`, `evaluation.service.ts`, `blueprint.service.ts`, `evaluation-routes.test.ts`, `llm/index.ts`, `platform.router.ts`, `applications.router.ts`, `auth.service.ts`, `jobs.router.ts`, `session.service.ts`, `applications.service.ts`, `lib/http.ts`, `auth.ts`, `public.service.ts`, `AppError`, `jd.service.ts`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `devDependencies`, `exclude`, `scripts`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `Route`, `ApiErrorBody`, `EmploymentType` to the rest of the system?**
  _374 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TestSessionScreen.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.051590483827853514 - nodes in this community are weakly interconnected._
- **Should `sandbox/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07525807525807526 - nodes in this community are weakly interconnected._
- **Should `evaluation.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05576923076923077 - nodes in this community are weakly interconnected._