/**
 * GraphQL schema (SDL).
 *
 * ## Why SDL rather than a builder
 *
 * The schema is the public contract, so it is written as one readable document
 * rather than assembled from constructor calls. `graphql`'s `buildSchema` turns
 * it into a live schema and introspection serves it back verbatim, which is what
 * makes the API self-describing.
 *
 * ## Parity with the UI
 *
 * Every query and mutation here maps to a repository/service call the REST API
 * already makes. This file deliberately contains **no business logic and no date
 * or recurrence arithmetic**: recurring events and tasks are expanded only by
 * `getCalendarItems`, whose `CalendarItem` output is what `calendarItems`
 * returns. A client never re-derives a recurrence.
 *
 * ## Conventions
 *
 *  - epoch milliseconds are `Float` (they exceed a 32-bit `Int`), documented as
 *    such on every field;
 *  - floating calendar days are `String` in `YYYY-MM-DD` form;
 *  - enums use the same lowercase names the database and REST API use, so a
 *    value round-trips through every layer unchanged.
 */
export const typeDefs = /* GraphQL */ `
  """A registered account. Only the fields the app itself shows are exposed."""
  type User {
    id: ID!
    name: String!
    email: String!
    image: String
    isAdmin: Boolean!
    timezone: String!
  }

  """Which kinds of task list entry to include when filtering."""
  enum TaskStatus {
    todo
    completed
    wont_do
  }

  enum Priority {
    none
    low
    medium
    high
  }

  enum RecurrenceMode {
    due
    completion
  }

  enum SyncProvider {
    local
    caldav
    ical
  }

  enum SyncState {
    synced
    dirty
    pending_delete
    conflict
  }

  enum AccentColor {
    blue
    indigo
    purple
    pink
    red
    orange
    yellow
    green
    teal
    cyan
    gray
    brown
  }

  """The accent preference, which is one value wider than a concrete colour."""
  enum AccentPreference {
    default
    blue
    indigo
    purple
    pink
    red
    orange
    yellow
    green
    teal
    cyan
    gray
    brown
  }

  enum HabitGoalType {
    boolean
    count
    duration
  }

  enum HabitFrequency {
    daily
    weekly
    monthly
    custom
  }

  enum CalendarProvider {
    local
    caldav
    ical
  }

  enum EventStatus {
    confirmed
    tentative
    cancelled
  }

  enum EventTransparency {
    opaque
    transparent
  }

  enum SyncDirection {
    auto
    pull
    push
  }

  enum SyncRunKind {
    full
    incremental
    push
    discover
  }

  enum FocusKind {
    focus
    short_break
    long_break
  }

  enum TaskSort {
    smart
    due
    created
    updated
    priority
    title
    manual
  }

  enum DueWindow {
    overdue
    today
    tomorrow
    next7days
    next30days
    all
    noDate
  }

  enum CalendarItemKind {
    event
    task
  }

  enum BulkAction {
    complete
    delete
    move
    priority
    addTag
    removeTag
  }

  """A relative or absolute reminder attached to a task."""
  type Reminder {
    id: ID!
    """Minutes before the due instant. Null when an absolute time is used."""
    offsetMinutes: Int
    """Absolute fire instant in epoch milliseconds, when set."""
    absoluteAtMs: Float
    """Precomputed instant the reminder fires, in epoch milliseconds."""
    fireAtMs: Float!
    sent: Boolean!
  }

  input ReminderInput {
    offsetMinutes: Int
    absoluteAtMs: Float
  }

  type SubTask {
    id: ID!
    title: String!
    status: TaskStatus!
    completedAtMs: Float
    sortOrder: String!
  }

  type Tag {
    id: ID!
    userId: ID!
    name: String!
    color: AccentColor!
    taskCount: Int
  }

  """A task, with its tags, subtasks and reminders hydrated on read."""
  type Task {
    id: ID!
    userId: ID!
    listId: ID
    parentId: ID
    title: String!
    notes: String
    url: String

    status: TaskStatus!
    priority: Priority!

    """Due instant in epoch milliseconds; null for an all-day task."""
    dueAtMs: Float
    """Floating due day, YYYY-MM-DD."""
    dueDate: String
    """Start instant in epoch milliseconds."""
    startAtMs: Float
    """Floating start day, YYYY-MM-DD."""
    startDate: String
    isAllDay: Boolean!
    timezone: String
    completedAtMs: Float

    """RFC 5545 RRULE body, or null. Expanded only by calendarItems."""
    recurrenceRule: String
    recurrenceMode: RecurrenceMode!
    recurrenceId: String

    estimateMinutes: Int
    spentMinutes: Int!
    sortOrder: String!
    isPinned: Boolean!

    calendarId: ID

    syncProvider: SyncProvider!
    syncState: SyncState!
    externalUid: String
    externalHref: String
    externalEtag: String
    lastSyncedAtMs: Float

    createdAt: Float!
    updatedAt: Float!
    deletedAtMs: Float

    tagIds: [ID!]!
    tags: [Tag!]!
    subtasks: [SubTask!]!
    reminders: [Reminder!]!
    """Set on a projected occurrence produced by the recurrence expander."""
    occurrenceAtMs: Float
  }

  """A list (project). The Inbox is flagged and cannot be deleted."""
  type List {
    id: ID!
    userId: ID!
    name: String!
    description: String
    color: AccentColor!
    emoji: String
    sortOrder: String!
    archived: Boolean!
    isInbox: Boolean!
    createdAt: Float!
    updatedAt: Float!
    taskCount: Int
    openTaskCount: Int
  }

  """One day's logged amount for a habit."""
  type HabitEntry {
    date: String!
    count: Float!
  }

  type Habit {
    id: ID!
    userId: ID!
    name: String!
    description: String
    icon: String
    color: AccentColor!
    goalType: HabitGoalType!
    goalTarget: Float!
    unit: String
    frequency: HabitFrequency!
    """Weekdays 0-6, only meaningful when frequency is custom."""
    weekDays: [Int!]
    timesPerPeriod: Int!
    startDate: String!
    """Reminder times as minutes since local midnight (0–1439)."""
    reminders: [Int!]
    archived: Boolean!
    sortOrder: String!
    createdAt: Float!
    updatedAt: Float!

    """Derived for the requested window."""
    streak: Int
    longestStreak: Int
    completionRate: Float
    entries: [HabitEntry!]!
    doneToday: Boolean
    progress: Float
  }

  type Calendar {
    id: ID!
    userId: ID!
    name: String!
    description: String
    color: AccentColor!
    timezone: String!
    provider: CalendarProvider!
    caldavAccountId: ID
    remoteHref: String
    remoteCtag: String
    remoteSyncToken: String
    supportsVtodo: Boolean!
    isVisible: Boolean!
    showInTasks: Boolean!
    isDefault: Boolean!
    readOnly: Boolean!
    sortOrder: String!
    lastSyncedAtMs: Float
    lastSyncError: String
    colorOverride: String
    createdAt: Float!
    updatedAt: Float!
  }

  type Attendee {
    name: String
    email: String!
    status: String
    role: String
  }

  type Organizer {
    name: String
    email: String
  }

  """A calendar event. Recurring events are stored once and expanded on read."""
  type CalendarEvent {
    id: ID!
    userId: ID!
    calendarId: ID!
    uid: String!
    recurrenceId: String
    summary: String!
    description: String
    location: String
    url: String
    startMs: Float
    endMs: Float
    startDate: String
    endDate: String
    isAllDay: Boolean!
    timezone: String!
    rrule: String
    exdates: [String!]
    rdates: [String!]
    status: EventStatus!
    transparency: EventTransparency!
    organizer: Organizer
    attendees: [Attendee!]
    categories: [String!]
    """Minutes-before reminder offsets."""
    reminders: [Int!]
    color: String
    syncProvider: SyncProvider!
    syncState: SyncState!
    externalHref: String
    externalEtag: String
    remoteSequence: Int
    lastSyncedAtMs: Float
    createdAt: Float!
    updatedAt: Float!
  }

  """A rendered calendar block, produced by expanding recurrence server-side."""
  type CalendarItem {
    key: String!
    kind: CalendarItemKind!
    id: ID!
    title: String!
    startMs: Float!
    endMs: Float!
    isAllDay: Boolean!
    color: AccentColor!
    calendarId: ID
    calendarName: String
    location: String
    url: String
    completed: Boolean
    priority: Priority
    listId: ID
    seriesUid: String
    isRecurringInstance: Boolean
    readonly: Boolean
  }

  type LaidOutItem {
    item: CalendarItem!
    column: Int!
    columns: Int!
  }

  type CalendarItemsPayload {
    items: [CalendarItem!]!
    calendars: [Calendar!]!
    """Items bucketed by floating day, keyed YYYY-MM-DD."""
    days: [CalendarDay!]!
    """Present only when layout was requested."""
    layout: [LaidOutItem!]
  }

  type CalendarDay {
    date: String!
    items: [CalendarItem!]!
  }

  type CaldavAccount {
    id: ID!
    userId: ID!
    name: String!
    serverUrl: String!
    username: String!
    enabled: Boolean!
    syncIntervalMinutes: Int!
    direction: SyncDirection!
    lastSyncAtMs: Float
    lastSyncStatus: String!
    lastError: String
    consecutiveFailures: Int!
    """Whether a password is stored. The password itself is never returned."""
    hasPassword: Boolean!
  }

  type DiscoveredCalendar {
    href: String!
    displayName: String!
    color: String
    supportsVtodo: Boolean!
    readOnly: Boolean!
  }

  type SyncResult {
    kind: String!
    status: String!
    pulled: Int!
    pushed: Int!
    deletedRemote: Int!
    deletedLocal: Int!
    conflicts: Int!
    error: String
    calendars: [DiscoveredCalendar!]
  }

  type IcalSyncResult {
    calendarId: ID!
    created: Int!
    updated: Int!
    deleted: Int!
    unchanged: Int!
    notModified: Boolean!
    error: String
  }

  type SubscribeIcalPayload {
    calendar: Calendar!
    sync: IcalSyncResult!
  }

  type UpdateIcalSubscriptionPayload {
    calendar: Calendar!
    """Present only when the URL changed and the feed was re-fetched."""
    sync: IcalSyncResult
  }

  """A read-only webcal/ICS feed URL. The URL is a credential — treat it so."""
  type IcalFeedToken {
    id: ID!
    name: String!
    url: String!
    includeTasks: Boolean!
    includeEvents: Boolean!
    lastUsedAtMs: Float
    createdAt: Float!
  }

  type UserSettings {
    timezone: String!
    weekStartsOn: Int!
    theme: String!
    accent: AccentPreference!
    timeFormat: String!
    defaultListId: ID
    smartListOrder: [String!]
    pomodoroFocus: Int!
    pomodoroShortBreak: Int!
    pomodoroLongBreak: Int!
    pomodoroLongBreakEvery: Int!
    pomodoroAutoStartBreaks: Boolean!
    notificationsEnabled: Boolean!
    dailyDigestAt: String
    defaultReminders: [Int!]
    reducedMotion: String!
    reduceMotionLowPower: Boolean!
    appriseUrl: String
    """Whether an Apprise key is stored. The key itself is never returned."""
    appriseKeyConfigured: Boolean!
    appriseTags: [String!]
  }

  type DayCount {
    date: String!
    count: Int!
  }

  type DayMinutes {
    date: String!
    minutes: Int!
  }

  type ProductivityStats {
    completedByDay: [DayCount!]!
    totalCompleted: Int!
    totalCreated: Int!
    focusByDay: [DayMinutes!]!
    currentStreakDays: Int!
  }

  type FocusSession {
    id: ID!
    userId: ID!
    taskId: ID
    kind: FocusKind!
    startedAtMs: Float!
    endedAtMs: Float
    plannedSeconds: Int!
    actualSeconds: Int!
    completed: Boolean!
    note: String
  }

  type AgendaBuckets {
    overdue: [Task!]!
    today: [Task!]!
    tomorrow: [Task!]!
    thisWeek: [Task!]!
    later: [Task!]!
    noDate: [Task!]!
    completedToday: [Task!]!
  }

  type Matrix {
    q1: [Task!]!
    q2: [Task!]!
    q3: [Task!]!
    q4: [Task!]!
  }

  type SearchResults {
    tasks: [Task!]!
    events: [CalendarEvent!]!
    habits: [Habit!]!
  }

  type Capabilities {
    push: Boolean!
    oidc: Boolean!
    vapidPublicKey: String
  }

  """Metadata about the account's API token. The token itself is never here."""
  type ApiToken {
    prefix: String!
    createdAt: Float!
    lastUsedAtMs: Float
  }

  """The one-time reveal of a freshly created or cycled token."""
  type IssuedApiToken {
    plaintext: String!
    prefix: String!
    createdAt: Float!
    lastUsedAtMs: Float
  }

  type DeleteResult {
    deleted: Boolean!
  }

  type ReorderResult {
    reordered: Int!
  }

  type BulkResult {
    affected: Int!
  }

  type MergeResult {
    merged: Boolean!
  }

  type CompleteTaskPayload {
    task: Task
    """True when a recurring task rolled forward instead of completing."""
    recurred: Boolean!
  }

  type CheckInPayload {
    habit: Habit
    doneToday: Boolean!
  }

  type PushSubscriptionResult {
    saved: Boolean!
  }

  type AppriseTestResult {
    configured: Boolean!
    delivered: Boolean!
    status: Int
    error: String
  }

  input TaskFilterInput {
    text: String
    listIds: [ID!]
    tagIds: [ID!]
    priorities: [Priority!]
    statuses: [TaskStatus!]
    dueFrom: String
    dueTo: String
    dueWindow: DueWindow
    hasRecurrence: Boolean
    isPinned: Boolean
    includeCompleted: Boolean
  }

  input CreateTaskInput {
    title: String!
    notes: String
    url: String
    listId: ID
    parentId: ID
    priority: Priority
    status: TaskStatus
    dueDate: String
    dueTime: String
    dueAtMs: Float
    startDate: String
    startTime: String
    startAtMs: Float
    timezone: String
    recurrenceRule: String
    recurrenceMode: RecurrenceMode
    estimateMinutes: Int
    tagIds: [ID!]
    tagNames: [String!]
    reminders: [ReminderInput!]
    calendarId: ID
    sortOrder: String
    isPinned: Boolean
  }

  input UpdateTaskInput {
    title: String
    notes: String
    url: String
    listId: ID
    priority: Priority
    status: TaskStatus
    dueDate: String
    dueTime: String
    dueAtMs: Float
    startDate: String
    startTime: String
    startAtMs: Float
    timezone: String
    clearDue: Boolean
    recurrenceRule: String
    recurrenceMode: RecurrenceMode
    clearRecurrence: Boolean
    estimateMinutes: Int
    tagIds: [ID!]
    tagNames: [String!]
    reminders: [ReminderInput!]
    clearReminders: Boolean
    calendarId: ID
    sortOrder: String
    isPinned: Boolean
  }

  input BulkUpdateInput {
    ids: [ID!]!
    action: BulkAction!
    listId: ID
    priority: Priority
    tagId: ID
  }

  input CreateListInput {
    name: String!
    description: String
    color: AccentColor
    emoji: String
  }

  input UpdateListInput {
    name: String
    description: String
    color: AccentColor
    emoji: String
    archived: Boolean
  }

  input CreateTagInput {
    name: String!
    color: AccentColor
  }

  input UpdateTagInput {
    name: String
    color: AccentColor
  }

  input CreateHabitInput {
    name: String!
    description: String
    icon: String
    color: AccentColor
    goalType: HabitGoalType
    goalTarget: Float
    unit: String
    frequency: HabitFrequency
    weekDays: [Int!]
    timesPerPeriod: Int
    startDate: String
    """Reminder times as minutes since local midnight (0–1439)."""
    reminders: [Int!]
  }

  input UpdateHabitInput {
    name: String
    description: String
    icon: String
    color: AccentColor
    goalType: HabitGoalType
    goalTarget: Float
    unit: String
    frequency: HabitFrequency
    weekDays: [Int!]
    timesPerPeriod: Int
    startDate: String
    """Reminder times as minutes since local midnight (0–1439)."""
    reminders: [Int!]
    archived: Boolean
  }

  input CheckInInput {
    date: String
    """Null or 0 clears the entry."""
    count: Float
    value: Float
    note: String
    """Adds to the existing count instead of replacing it."""
    delta: Float
  }

  input CreateCalendarInput {
    name: String!
    description: String
    color: AccentColor
    timezone: String
    isVisible: Boolean
    showInTasks: Boolean
    isDefault: Boolean
  }

  input UpdateCalendarInput {
    name: String
    description: String
    color: AccentColor
    timezone: String
    isVisible: Boolean
    showInTasks: Boolean
    isDefault: Boolean
    readOnly: Boolean
    colorOverride: String
  }

  input AttendeeInput {
    name: String
    email: String!
    status: String
    role: String
  }

  input CreateEventInput {
    calendarId: ID!
    summary: String!
    description: String
    location: String
    url: String
    startMs: Float
    endMs: Float
    startDate: String
    endDate: String
    startTime: String
    endTime: String
    isAllDay: Boolean
    timezone: String
    rrule: String
    exdates: [String!]
    status: EventStatus
    transparency: EventTransparency
    attendees: [AttendeeInput!]
    reminders: [Int!]
    color: String
  }

  input UpdateEventInput {
    calendarId: ID
    summary: String
    description: String
    location: String
    url: String
    startMs: Float
    endMs: Float
    startDate: String
    endDate: String
    startTime: String
    endTime: String
    isAllDay: Boolean
    timezone: String
    rrule: String
    clearRecurrence: Boolean
    exdates: [String!]
    status: EventStatus
    transparency: EventTransparency
    attendees: [AttendeeInput!]
    reminders: [Int!]
    color: String
  }

  input CreateCaldavAccountInput {
    name: String!
    serverUrl: String!
    username: String!
    password: String!
    syncIntervalMinutes: Int
    direction: SyncDirection
  }

  input UpdateCaldavAccountInput {
    name: String
    serverUrl: String
    username: String
    password: String
    syncIntervalMinutes: Int
    direction: SyncDirection
    enabled: Boolean
  }

  input SubscribeIcalInput {
    url: String!
    name: String
    color: AccentColor
    colorOverride: String
    timezone: String
  }

  input UpdateIcalSubscriptionInput {
    url: String
    name: String
    color: AccentColor
    colorOverride: String
  }

  input UpdateSettingsInput {
    timezone: String
    weekStartsOn: Int
    theme: String
    accent: AccentPreference
    timeFormat: String
    defaultListId: ID
    smartListOrder: [String!]
    pomodoroFocus: Int
    pomodoroShortBreak: Int
    pomodoroLongBreak: Int
    pomodoroLongBreakEvery: Int
    pomodoroAutoStartBreaks: Boolean
    notificationsEnabled: Boolean
    dailyDigestAt: String
    defaultReminders: [Int!]
    reducedMotion: String
    reduceMotionLowPower: Boolean
    appriseUrl: String
    appriseKey: String
    appriseTags: [String!]
  }

  input StartFocusInput {
    taskId: ID
    kind: FocusKind
    plannedSeconds: Int!
  }

  input FinishFocusInput {
    completed: Boolean!
    actualSeconds: Int
    note: String
  }

  input PushSubscriptionInput {
    endpoint: String!
    keys: PushKeysInput!
    userAgent: String
  }

  input PushKeysInput {
    p256dh: String!
    auth: String!
  }

  input CreateIcalFeedTokenInput {
    name: String
    includeTasks: Boolean
    includeEvents: Boolean
    listIds: [ID!]
  }

  type Query {
    """The authenticated account."""
    me: User!
    """The account's API token metadata, or null when none exists."""
    apiToken: ApiToken
    capabilities: Capabilities!

    tasks(
      filter: TaskFilterInput
      sort: TaskSort
      includeSubtasks: Boolean
      limit: Int
      offset: Int
    ): [Task!]!
    task(id: ID!): Task

    lists(includeArchived: Boolean): [List!]!
    list(id: ID!): List
    tags: [Tag!]!

    habits(from: String, to: String, includeArchived: Boolean): [Habit!]!
    habit(id: ID!): Habit

    calendars: [Calendar!]!
    calendar(id: ID!): Calendar
    event(id: ID!): CalendarEvent
    calendarItems(
      startMs: Float!
      endMs: Float!
      calendarIds: [ID!]
      """Restrict to event and/or task projections; both by default."""
      kinds: [CalendarItemKind!]
      layout: Boolean
    ): CalendarItemsPayload!

    caldavAccounts: [CaldavAccount!]!
    caldavAccount(id: ID!): CaldavAccount
    icalSubscriptions: [Calendar!]!
    icalFeedTokens: [IcalFeedToken!]!

    settings: UserSettings!
    stats(days: Int): ProductivityStats!
    focusSessions(limit: Int): [FocusSession!]!
    focusCountToday: Int!
    search(query: String!): SearchResults!
    agenda: AgendaBuckets!
    matrix: Matrix!
  }

  type Mutation {
    createTask(input: CreateTaskInput!): Task!
    updateTask(id: ID!, input: UpdateTaskInput!): Task!
    deleteTask(id: ID!): DeleteResult!
    completeTask(id: ID!): CompleteTaskPayload!
    uncompleteTask(id: ID!): CompleteTaskPayload!
    moveTask(id: ID!, beforeSortOrder: String, afterSortOrder: String): Task!
    reorderTasks(orderedIds: [ID!]!): ReorderResult!
    bulkUpdateTasks(input: BulkUpdateInput!): BulkResult!

    createList(input: CreateListInput!): List!
    updateList(id: ID!, input: UpdateListInput!): List!
    deleteList(id: ID!): DeleteResult!
    reorderLists(orderedIds: [ID!]!): ReorderResult!

    createTag(input: CreateTagInput!): Tag!
    updateTag(id: ID!, input: UpdateTagInput!): Tag!
    deleteTag(id: ID!): DeleteResult!
    mergeTags(sourceId: ID!, targetId: ID!): MergeResult!

    createHabit(input: CreateHabitInput!): Habit!
    updateHabit(id: ID!, input: UpdateHabitInput!): Habit!
    deleteHabit(id: ID!): DeleteResult!
    reorderHabits(orderedIds: [ID!]!): ReorderResult!
    checkInHabit(id: ID!, input: CheckInInput): CheckInPayload!

    createCalendar(input: CreateCalendarInput!): Calendar!
    updateCalendar(id: ID!, input: UpdateCalendarInput!): Calendar!
    deleteCalendar(id: ID!): DeleteResult!
    reorderCalendars(orderedIds: [ID!]!): ReorderResult!

    createEvent(input: CreateEventInput!): CalendarEvent!
    updateEvent(id: ID!, input: UpdateEventInput!): CalendarEvent!
    deleteEvent(id: ID!): DeleteResult!

    createCaldavAccount(input: CreateCaldavAccountInput!): CaldavAccount!
    updateCaldavAccount(id: ID!, input: UpdateCaldavAccountInput!): CaldavAccount!
    deleteCaldavAccount(id: ID!, purge: Boolean): DeleteResult!
    syncCaldavAccount(id: ID!, kind: SyncRunKind, calendarId: ID): SyncResult!
    discoverCaldavAccount(id: ID!): SyncResult!

    subscribeIcal(input: SubscribeIcalInput!): SubscribeIcalPayload!
    updateIcalSubscription(id: ID!, input: UpdateIcalSubscriptionInput!): UpdateIcalSubscriptionPayload!
    unsubscribeIcal(id: ID!): DeleteResult!
    syncIcalSubscription(id: ID!): IcalSyncResult!

    createIcalFeedToken(input: CreateIcalFeedTokenInput): IcalFeedToken!
    revokeIcalFeedToken(id: ID!): DeleteResult!

    updateSettings(input: UpdateSettingsInput!): UserSettings!

    startFocusSession(input: StartFocusInput!): FocusSession!
    finishFocusSession(id: ID!, input: FinishFocusInput!): FocusSession!

    subscribePush(input: PushSubscriptionInput!): PushSubscriptionResult!
    unsubscribePush(endpoint: String!): DeleteResult!
    """Sends a test notification through the account's own Apprise gateway."""
    testApprise: AppriseTestResult!

    """Creates the account's token. Fails if one already exists; use cycleApiToken."""
    createApiToken: IssuedApiToken!
    """Replaces the account's token. The previous plaintext stops working at once."""
    cycleApiToken: IssuedApiToken!
    """Deletes the account's token. The plaintext stops working at once."""
    revokeApiToken: DeleteResult!
  }
`;
