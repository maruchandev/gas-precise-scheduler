/**
 * Configuration for the daily scheduler.
 *
 * Keep each id unique. functionName must name a top-level function in this
 * Apps Script project.
 */
const PRECISE_SCHEDULER_CONFIG = {
  timeZone: 'Asia/Tokyo',
  schedules: [
    {
      id: 'morning-job',
      functionName: 'exampleMorningTask',
      hour: 9,
      minute: 0
    },
    {
      id: 'night-job',
      functionName: 'exampleNightTask',
      hour: 21,
      minute: 0
    }
  ]
};

const PRECISE_SCHEDULER_HANDLER = 'runDailySchedule';
const PRECISE_SCHEDULER_PROPERTY_PREFIX = 'preciseDailyScheduler:trigger:';
const PRECISE_SCHEDULER_LOCK_TIMEOUT_MS = 30000;

/**
 * Creates the first one-shot trigger for every configured schedule.
 * Run this function manually after installation and after configuration changes.
 */
function setupDailySchedules() {
  validateSchedulerConfig_();

  const lock = LockService.getScriptLock();
  lock.waitLock(PRECISE_SCHEDULER_LOCK_TIMEOUT_MS);

  try {
    cleanupSchedulerState_();

    try {
      PRECISE_SCHEDULER_CONFIG.schedules.forEach(function(schedule) {
        createNextDailySchedule_(schedule, new Date());
      });
    } catch (error) {
      // Avoid leaving a partially configured scheduler behind.
      cleanupSchedulerState_();
      throw error;
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Removes all triggers and Script Properties owned by this scheduler.
 */
function removeDailySchedules() {
  const lock = LockService.getScriptLock();
  lock.waitLock(PRECISE_SCHEDULER_LOCK_TIMEOUT_MS);

  try {
    cleanupSchedulerState_();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Trigger entry point. Do not run this function manually.
 *
 * The next trigger is created before the user task runs, so a failure in the
 * user task does not normally break the following day's schedule.
 *
 * @param {Object} e Apps Script time-driven trigger event.
 */
function runDailySchedule(e) {
  if (!e || !e.triggerUid) {
    console.warn('runDailySchedule must be invoked by an installable trigger.');
    return;
  }

  const triggerUid = String(e.triggerUid);
  const propertyKey = PRECISE_SCHEDULER_PROPERTY_PREFIX + triggerUid;
  const properties = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();

  lock.waitLock(PRECISE_SCHEDULER_LOCK_TIMEOUT_MS);

  let schedule;

  try {
    const scheduleId = properties.getProperty(propertyKey);
    if (!scheduleId) {
      console.warn('No schedule mapping found for trigger: ' + triggerUid);
      return;
    }

    schedule = PRECISE_SCHEDULER_CONFIG.schedules.find(function(item) {
      return item.id === scheduleId;
    });

    if (!schedule) {
      deleteTriggerByUid_(triggerUid);
      properties.deleteProperty(propertyKey);
      throw new Error('Schedule is not configured: ' + scheduleId);
    }

    validateSchedule_(schedule, new Set());

    // Reserve the following run before invoking user code.
    createNextDailySchedule_(schedule, new Date());

    deleteTriggerByUid_(triggerUid);
    properties.deleteProperty(propertyKey);
  } finally {
    lock.releaseLock();
  }

  const targetFunction = globalThis[schedule.functionName];
  if (typeof targetFunction !== 'function') {
    throw new Error('Function not found: ' + schedule.functionName);
  }

  targetFunction();
}

/**
 * Creates one trigger and records trigger UID -> schedule ID.
 * Must be called while holding the script lock.
 *
 * @param {Object} schedule Validated schedule configuration.
 * @param {Date} now Current instant, injected to make date calculation explicit.
 * @return {GoogleAppsScript.Script.Trigger} Created trigger.
 */
function createNextDailySchedule_(schedule, now) {
  const nextRunAt = getNextRunAt_(schedule, now);
  const trigger = ScriptApp.newTrigger(PRECISE_SCHEDULER_HANDLER)
    .timeBased()
    .at(nextRunAt)
    .create();

  try {
    PropertiesService.getScriptProperties().setProperty(
      PRECISE_SCHEDULER_PROPERTY_PREFIX + trigger.getUniqueId(),
      schedule.id
    );
  } catch (error) {
    ScriptApp.deleteTrigger(trigger);
    throw error;
  }

  console.log(
    schedule.id + ': scheduled for ' +
    Utilities.formatDate(
      nextRunAt,
      PRECISE_SCHEDULER_CONFIG.timeZone,
      'yyyy-MM-dd HH:mm:ss z'
    )
  );

  return trigger;
}

/**
 * Returns the next occurrence of a schedule in the configured time zone.
 */
function getNextRunAt_(schedule, now) {
  const timeZone = PRECISE_SCHEDULER_CONFIG.timeZone;
  const localDate = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd')
    .split('-')
    .map(Number);

  let nextRunAt = localDateTimeToDate_(
    localDate[0],
    localDate[1],
    localDate[2],
    schedule.hour,
    schedule.minute,
    timeZone
  );

  if (nextRunAt.getTime() <= now.getTime()) {
    const tomorrow = addLocalDays_(localDate, 1);
    nextRunAt = localDateTimeToDate_(
      tomorrow[0],
      tomorrow[1],
      tomorrow[2],
      schedule.hour,
      schedule.minute,
      timeZone
    );
  }

  return nextRunAt;
}

/**
 * Converts local date/time fields in an IANA time zone into a Date instant.
 * The iterative conversion also supports time zones whose UTC offset changes.
 */
function localDateTimeToDate_(year, month, day, hour, minute, timeZone) {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidateMs = targetAsUtc;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const rendered = Utilities.formatDate(
      new Date(candidateMs),
      timeZone,
      'yyyy,MM,dd,HH,mm,ss'
    ).split(',').map(Number);

    const renderedAsUtc = Date.UTC(
      rendered[0],
      rendered[1] - 1,
      rendered[2],
      rendered[3],
      rendered[4],
      rendered[5]
    );
    const correctionMs = targetAsUtc - renderedAsUtc;

    if (correctionMs === 0) {
      return new Date(candidateMs);
    }

    candidateMs += correctionMs;
  }

  throw new Error(
    'The local time does not exist or is ambiguous in ' + timeZone + ': ' +
    [year, month, day, hour, minute].join('-')
  );
}

function addLocalDays_(dateParts, days) {
  const date = new Date(Date.UTC(
    dateParts[0],
    dateParts[1] - 1,
    dateParts[2] + days
  ));

  return [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate()
  ];
}

function validateSchedulerConfig_() {
  const config = PRECISE_SCHEDULER_CONFIG;

  if (!config || typeof config.timeZone !== 'string' || !config.timeZone.trim()) {
    throw new Error('PRECISE_SCHEDULER_CONFIG.timeZone is required.');
  }

  // Utilities validates the IANA time-zone name for us.
  try {
    Utilities.formatDate(new Date(), config.timeZone, 'yyyy-MM-dd');
  } catch (error) {
    throw new Error('Invalid time zone: ' + config.timeZone);
  }

  if (!Array.isArray(config.schedules) || config.schedules.length === 0) {
    throw new Error('Configure at least one daily schedule.');
  }

  const ids = new Set();
  config.schedules.forEach(function(schedule) {
    validateSchedule_(schedule, ids);
    ids.add(schedule.id);
  });
}

function validateSchedule_(schedule, existingIds) {
  if (!schedule || typeof schedule.id !== 'string' || !schedule.id.trim()) {
    throw new Error('Every schedule requires a non-empty id.');
  }

  if (existingIds.has(schedule.id)) {
    throw new Error('Duplicate schedule id: ' + schedule.id);
  }

  if (
    typeof schedule.functionName !== 'string' ||
    !schedule.functionName.trim() ||
    typeof globalThis[schedule.functionName] !== 'function'
  ) {
    throw new Error('Function not found: ' + schedule.functionName);
  }

  if (
    !Number.isInteger(schedule.hour) ||
    schedule.hour < 0 ||
    schedule.hour > 23 ||
    !Number.isInteger(schedule.minute) ||
    schedule.minute < 0 ||
    schedule.minute > 59
  ) {
    throw new Error('Invalid time for schedule: ' + schedule.id);
  }
}

function cleanupSchedulerState_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === PRECISE_SCHEDULER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const properties = PropertiesService.getScriptProperties();
  const allProperties = properties.getProperties();

  Object.keys(allProperties).forEach(function(key) {
    if (key.indexOf(PRECISE_SCHEDULER_PROPERTY_PREFIX) === 0) {
      properties.deleteProperty(key);
    }
  });
}

function deleteTriggerByUid_(triggerUid) {
  ScriptApp.getProjectTriggers().some(function(trigger) {
    if (String(trigger.getUniqueId()) === triggerUid) {
      ScriptApp.deleteTrigger(trigger);
      return true;
    }
    return false;
  });
}
