// バックアップとトリガー管理
// 実装役向けルール: 公開関数は backupMonthly, installTriggers のみ。DriveApp と ScriptApp はこのファイルでのみ使用可能。

function backupMonthly() {
  var props = PropertiesService.getScriptProperties();
  var backupFolderId = props.getProperty('BACKUP_FOLDER_ID');
  if (!backupFolderId) {
    Logger.log('BACKUP_FOLDER_ID is not configured in script properties');
    return;
  }

  var currentYm = util_currentYearMonth_();
  var lastBackupYm = props.getProperty('LAST_BACKUP_YM');
  if (lastBackupYm === currentYm) {
    Logger.log('Backup already performed for: ' + currentYm);
    return;
  }

  var shiftDbId = props.getProperty('SHIFT_DB_ID');
  var auditLogId = props.getProperty('AUDIT_LOG_ID');
  if (!shiftDbId || !auditLogId) {
    Logger.log('Database IDs are not set in script properties');
    return;
  }

  var folder = DriveApp.getFolderById(backupFolderId);
  var shiftDbFile = DriveApp.getFileById(shiftDbId);
  var auditLogFile = DriveApp.getFileById(auditLogId);

  shiftDbFile.makeCopy('ShiftDB_' + currentYm, folder);
  auditLogFile.makeCopy('AuditLog_' + currentYm, folder);

  props.setProperty('LAST_BACKUP_YM', currentYm);
  Logger.log('Backup completed for: ' + currentYm);
}

// 画面からも呼べてしまう関数なので、すでにトリガーがあれば何もしない（消して作り直さない）。
function installTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'backupMonthly') {
      Logger.log('Trigger already installed for backupMonthly');
      return;
    }
  }

  ScriptApp.newTrigger('backupMonthly')
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .create();

  Logger.log('Trigger installed for backupMonthly: 1st of month at 3:00');
}
