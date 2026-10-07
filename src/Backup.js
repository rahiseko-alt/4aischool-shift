// バックアップとトリガー管理
// 実装役向けルール: 公開関数は backupMonthly, installTriggers のみ（内部の関数は末尾に _）。DriveApp と ScriptApp はこのファイルでのみ使用可能。

// 写すファイル。done はそのファイルを最後に写した月を残すスクリプト プロパティ（片方だけ失敗しても、
// 写せた方を同じ月にもう一度写さないため。2026-10-07）
var BACKUP_FILES_ = [
  { idProp: 'SHIFT_DB_ID', prefix: 'ShiftDB_', done: 'BACKUP_SHIFTDB_YM' },
  { idProp: 'AUDIT_LOG_ID', prefix: 'AuditLog_', done: 'BACKUP_AUDITLOG_YM' }
];

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

  if (!props.getProperty('SHIFT_DB_ID') || !props.getProperty('AUDIT_LOG_ID')) {
    Logger.log('Database IDs are not set in script properties');
    return;
  }

  // 試した日時を先に残す（管理画面からのやり直しは1日1回まで）
  props.setProperty('LAST_BACKUP_ATTEMPT_AT', util_nowJst_());
  var errors = [];
  var folder = null;
  try {
    folder = DriveApp.getFolderById(backupFolderId);
  } catch (e) {
    errors.push('folder: ' + e.message);
  }
  for (var i = 0; folder && i < BACKUP_FILES_.length; i++) {
    var f = BACKUP_FILES_[i];
    if (props.getProperty(f.done) === currentYm) continue; // 今月はもう写した
    try {
      DriveApp.getFileById(props.getProperty(f.idProp)).makeCopy(f.prefix + currentYm, folder);
      props.setProperty(f.done, currentYm);
    } catch (e) {
      errors.push(f.prefix + currentYm + ': ' + e.message);
    }
  }

  if (errors.length) {
    props.setProperty('LAST_BACKUP_ERROR', util_nowJst_() + ' ' + errors.join(' / '));
    throw new Error('Backup failed: ' + errors.join(' / ')); // 実行数の記録に失敗として残す
  }
  props.setProperty('LAST_BACKUP_YM', currentYm);
  props.setProperty('LAST_BACKUP_AT', util_nowJst_()); // 管理画面の「最後のバックアップ」に出す
  props.deleteProperty('LAST_BACKUP_ERROR');
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
// 取れなかったときのやり直しは1日1回まで（開くたびに写しを作らないため。2026-10-07）。
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
    var attempted = props.getProperty('LAST_BACKUP_ATTEMPT_AT') || '';
    if (attempted.slice(0, 10) === util_todayJst_()) return; // 今日はもう試した
    props.deleteProperty('LAST_BACKUP_YM'); // 古い版で月だけ記録されていても、日時が無ければ取り直す
    backupMonthly();
  }
}
