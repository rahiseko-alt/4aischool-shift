// バックアップとトリガー管理
// 実装役向けルール: 公開関数は backupMonthly, installTriggers のみ（内部の関数は末尾に _）。DriveApp と ScriptApp はこのファイルでのみ使用可能。

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
  props.setProperty('LAST_BACKUP_AT', util_nowJst_()); // 管理画面の「最後のバックアップ」に出す
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

// 管理画面を開いたときに呼ぶ。保存先のフォルダと毎月の自動実行が無ければ用意し、
// まだ1回もバックアップしていなければその場で取る（手でエディタを触らなくても動くように。2026-10-03）。
function backup_ensureSetup_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('BACKUP_FOLDER_ID') && props.getProperty('BACKUP_TRIGGER_OK') === 'true' && props.getProperty('LAST_BACKUP_AT')) return;
  if (!props.getProperty('BACKUP_FOLDER_ID')) {
    props.setProperty('BACKUP_FOLDER_ID', DriveApp.createFolder('ShiftDB バックアップ').getId());
  }
  if (props.getProperty('BACKUP_TRIGGER_OK') !== 'true') {
    installTriggers();
    props.setProperty('BACKUP_TRIGGER_OK', 'true');
  }
  if (!props.getProperty('LAST_BACKUP_AT')) {
    props.deleteProperty('LAST_BACKUP_YM'); // 古い版で月だけ記録されていても、日時が無ければ取り直す
    backupMonthly();
  }
}
