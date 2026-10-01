// Google Apps Script - 計算の心臓部
// このファイルは純粋関数のみで構成され、GAS環境・Node.js環境の両方で動作する。

function evaluateMonth(input) {
  var yearMonth = input.yearMonth;
  var mode = input.mode || 'plan';
  var student = input.student || {};
  var rawShifts = input.shifts || {};
  var prevMonthDaily = input.prevMonthDaily || {};
  var prevMonthSource = input.prevMonthSource;
  var nextMonthDaily = input.nextMonthDaily || {};
  var holidays = input.holidays || [];
  var settings = input.settings || {};

  var daysInMonth = core_getDaysInMonth_(yearMonth);
  var daily = {};
  for (var d = 1; d <= daysInMonth; d++) {
    var dateKey = core_buildDateStr_(yearMonth, d);
    daily[dateKey] = 0;
  }

  var inputErrors = [];
  var validShiftsList = [];
  var processedShiftsByDay = {};

  var TIME_REGEX = /^([01]\d|2[0-3]):(00|15|30|45)$/;

  // 1. 各シフトの形式検証および個別計算
  for (var dayStr in rawShifts) {
    if (!Object.prototype.hasOwnProperty.call(rawShifts, dayStr)) continue;
    var dayNum = Number(dayStr);
    var dateStr = core_buildDateStr_(yearMonth, dayNum);
    var dayShifts = rawShifts[dayStr];
    if (!Array.isArray(dayShifts)) continue;

    processedShiftsByDay[dayStr] = [];

    for (var sIdx = 0; sIdx < dayShifts.length; sIdx++) {
      var s = dayShifts[sIdx];
      var hasError = false;

      // 欠落チェック (開始・終了のどちらかが無い)
      if (!s || !s.start || !s.end) {
        inputErrors.push({ code: 'MISSING', date: dateStr, shiftIndex: sIdx });
        hasError = true;
      }

      // 時刻フォーマットチェック
      if (s && s.start && s.end) {
        if (!TIME_REGEX.test(s.start) || !TIME_REGEX.test(s.end)) {
          inputErrors.push({ code: 'INVALID_TIME', date: dateStr, shiftIndex: sIdx });
          hasError = true;
        }
      }

      var bound = 0;
      var startMin = 0;
      var endMin = 0;
      if (!hasError) {
        startMin = core_timeToMinutes_(s.start);
        endMin = core_timeToMinutes_(s.end);
        if (endMin <= startMin) {
          endMin += 1440;
        }
        bound = endMin - startMin;
        if (bound > 960 || bound === 1440) {
          inputErrors.push({ code: 'SHIFT_TOO_LONG', date: dateStr, shiftIndex: sIdx });
          hasError = true;
        }
      }

      if (!hasError) {
        var calc = core_calcShift_(s, startMin, endMin, bound);
        processedShiftsByDay[dayStr].push(calc);

        var absStart = (dayNum - 1) * 1440 + startMin;
        var absEnd = (dayNum - 1) * 1440 + endMin;

        validShiftsList.push({
          dateStr: dateStr,
          dayNum: dayNum,
          shiftIndex: sIdx,
          shift: s,
          calc: calc,
          absStart: absStart,
          absEnd: absEnd,
        });
      }
    }
  }

  // 2. 実時間での重複チェック (SHIFT_OVERLAP)
  var overlapSet = {};
  for (var i = 0; i < validShiftsList.length; i++) {
    for (var j = i + 1; j < validShiftsList.length; j++) {
      var s1 = validShiftsList[i];
      var s2 = validShiftsList[j];
      if (Math.max(s1.absStart, s2.absStart) < Math.min(s1.absEnd, s2.absEnd)) {
        overlapSet[s1.dateStr + '_' + s1.shiftIndex] = { date: s1.dateStr, shiftIndex: s1.shiftIndex };
        overlapSet[s2.dateStr + '_' + s2.shiftIndex] = { date: s2.dateStr, shiftIndex: s2.shiftIndex };
      }
    }
  }

  for (var k in overlapSet) {
    if (Object.prototype.hasOwnProperty.call(overlapSet, k)) {
      inputErrors.push({
        code: 'SHIFT_OVERLAP',
        date: overlapSet[k].date,
        shiftIndex: overlapSet[k].shiftIndex,
      });
    }
  }

  // 3. daily 実働時間・月次集計
  var totalMinutes = 0;

  for (var i = 0; i < validShiftsList.length; i++) {
    var vs = validShiftsList[i];
    // 重複エラーがあるシフトは計算に含めるか？
    // inputErrors がある場合でも daily 計算は進める
    daily[vs.dateStr] = (daily[vs.dateStr] || 0) + vs.calc.workMinutes;
    totalMinutes += vs.calc.workMinutes;
  }

  // 4. 法令等の判定 (codes)
  var codes = [];

  // 4.1 前月未確定
  if (prevMonthSource === 'none') {
    codes.push({ code: 'PREV_MONTH_DRAFT', severity: 'warn' });
  }

  // 4.2 資格外活動許可 (シフトが1件以上ある場合)
  var totalRawShiftCount = 0;
  for (var dStr in rawShifts) {
    if (Array.isArray(rawShifts[dStr])) totalRawShiftCount += rawShifts[dStr].length;
  }

  if (totalRawShiftCount > 0) {
    if (!student.workPermission || !student.permissionExpires) {
      codes.push({ code: 'NO_PERMIT', severity: 'block' });
    }
  }

  // 4.3 シフトごとの判定
  for (var i = 0; i < validShiftsList.length; i++) {
    var vs = validShiftsList[i];
    var sDate = vs.dateStr;
    var sIdx = vs.shiftIndex;
    var calc = vs.calc;

    // 在籍判定 (NOT_ENROLLED)
    var notEnrolled = false;
    if (student.status === '退学' && !student.withdrawalDate) {
      notEnrolled = true;
    } else if (student.status === '卒業' && !student.graduationDate) {
      notEnrolled = true;
    } else if (student.status === '休学' && !settings.allowLeaveOfAbsence) {
      notEnrolled = true;
    } else {
      if (student.enrollmentDate && sDate < student.enrollmentDate) notEnrolled = true;
      if (student.withdrawalDate && sDate > student.withdrawalDate) notEnrolled = true;
      if (student.graduationDate && sDate > student.graduationDate) notEnrolled = true;
    }
    if (notEnrolled) {
      codes.push({ code: 'NOT_ENROLLED', severity: 'block', date: sDate, shiftIndex: sIdx });
    }

    // 資格外活動許可期限 (PERMIT_EXPIRED)
    if (student.workPermission && student.permissionExpires) {
      if (sDate > student.permissionExpires) {
        codes.push({ code: 'PERMIT_EXPIRED', severity: 'block', date: sDate, shiftIndex: sIdx });
      }
    }

    // 18歳未満の深夜勤務
    if (student.birthDate && core_isMinor_(student.birthDate, sDate)) {
      if (calc.nightMinutes > 0) {
        codes.push({ code: 'MINOR_NIGHT', severity: 'block', date: sDate, shiftIndex: sIdx });
      }
    }
  }

  // 4.4 日ごとの判定 (1日8時間・成人の注意)
  for (var d = 1; d <= daysInMonth; d++) {
    var dateKey = core_buildDateStr_(yearMonth, d);
    var dayMinutes = daily[dateKey];
    var isHoliday = core_isHoliday_(holidays, dateKey);
    var isMinor = student.birthDate ? core_isMinor_(student.birthDate, dateKey) : false;

    if (isHoliday && dayMinutes > 480) {
      codes.push({ code: 'OVER_8H_HOLIDAY', severity: 'block', date: dateKey });
    }

    // 1日8時間超: 18歳未満は MINOR_OVER、成人は OVER_8H（どちらも確定を止める。2026-10-01 成人も注意から変更）。
    // 長期休業日は上の OVER_8H_HOLIDAY が出るので重ねない。
    if (dayMinutes > 480) {
      if (isMinor) {
        codes.push({ code: 'MINOR_OVER', severity: 'block', date: dateKey });
      } else if (!isHoliday) {
        codes.push({ code: 'OVER_8H', severity: 'block', date: dateKey });
      }
    }
  }

  // 4.5 ローリング7日間の判定
  // 窓の開始日: 対象月初日の6日前 〜 対象月末日
  var firstDayDate = core_buildDateStr_(yearMonth, 1);
  var lastDayDate = core_buildDateStr_(yearMonth, daysInMonth);
  var windowStart = core_addDays_(firstDayDate, -6);
  var maxRolling7 = 0;

  var curWindow = windowStart;
  while (curWindow <= lastDayDate) {
    var windowTotal = 0;
    var allHolidays = true;
    var hasMinor = false;

    for (var step = 0; step < 7; step++) {
      var dStr = core_addDays_(curWindow, step);
      var mVal = 0;
      if (dStr >= firstDayDate && dStr <= lastDayDate) {
        mVal = daily[dStr] || 0;
      } else if (dStr < firstDayDate) {
        mVal = prevMonthDaily[dStr] || 0;
      } else {
        mVal = nextMonthDaily[dStr] || 0;
      }
      windowTotal += mVal;

      if (!core_isHoliday_(holidays, dStr)) {
        allHolidays = false;
      }
      if (student.birthDate && core_isMinor_(student.birthDate, dStr)) {
        hasMinor = true;
      }
    }

    if (windowTotal > maxRolling7) {
      maxRolling7 = windowTotal;
    }

    if (!allHolidays && windowTotal > 1680) {
      codes.push({ code: 'OVER_28H', severity: 'block', date: curWindow });
    }

    if (windowTotal > 2400) {
      if (hasMinor) {
        codes.push({ code: 'MINOR_OVER', severity: 'block', date: curWindow });
      } else {
        codes.push({ code: 'LABOR_HOURS', severity: 'warn', date: curWindow });
      }
    }

    curWindow = core_addDays_(curWindow, 1);
  }

  // 4.6 実績モード (mode === 'actual') の severity 調整および ACTUAL_OVER 付与
  if (mode === 'actual') {
    var hasActualOver = false;
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i];
      if (c.code === 'OVER_28H' || c.code === 'OVER_8H_HOLIDAY' || c.code === 'OVER_8H' || c.code === 'MINOR_NIGHT' || c.code === 'MINOR_OVER') {
        hasActualOver = true;
      }
      if (c.severity === 'block') {
        c.severity = 'admin';
      }
    }
    if (hasActualOver) {
      codes.push({ code: 'ACTUAL_OVER', severity: 'admin' });
    }
  }

  return {
    shifts: processedShiftsByDay,
    daily: daily,
    totalMinutes: totalMinutes,
    maxRolling7Minutes: maxRolling7,
    codes: codes,
    inputErrors: inputErrors,
  };
}

// 内部補助関数 (core_ で始まり _ で終わる)

function core_timeToMinutes_(hhmm) {
  var parts = hhmm.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function core_minutesToTime_(m) {
  var h = Math.floor(m / 60);
  var min = m % 60;
  return (h < 10 ? '0' + h : String(h)) + ':' + (min < 10 ? '0' + min : String(min));
}

function core_calcShift_(shift, startMin, endMin, bound) {
  var breakMinutes = 0;
  if (bound <= 360) {
    breakMinutes = 0;
  } else if (bound <= 480) {
    breakMinutes = 45;
  } else {
    breakMinutes = 60;
  }

  var breakStart = null;
  var breakEnd = null;
  var breakStartMin = 0;
  var breakEndMin = 0;

  if (breakMinutes > 0) {
    var offset = Math.floor(((bound - breakMinutes) / 2) / 15) * 15;
    breakStartMin = startMin + offset;
    breakEndMin = breakStartMin + breakMinutes;
    breakStart = core_minutesToTime_(breakStartMin % 1440);
    breakEnd = core_minutesToTime_(breakEndMin % 1440);
  }

  var workMinutes = bound - breakMinutes;

  // 深夜分の算出 (18歳未満の深夜勤務判定に使う)
  var nightMinutes = 0;

  for (var m = startMin; m < endMin; m++) {
    // 休憩中か
    if (breakMinutes > 0 && m >= breakStartMin && m < breakEndMin) {
      continue;
    }

    // 深夜帯: 開始日 00:00〜05:00 ([0, 300)) または 22:00〜翌05:00 ([1320, 1740))
    if ((m >= 0 && m < 300) || (m >= 1320 && m < 1740)) {
      nightMinutes++;
    }
  }

  return {
    start: shift.start,
    end: shift.end,
    breakMinutes: breakMinutes,
    breakStart: breakStart,
    breakEnd: breakEnd,
    boundMinutes: bound,
    workMinutes: workMinutes,
    nightMinutes: nightMinutes,
  };
}

function core_getDaysInMonth_(yearMonth) {
  var parts = yearMonth.split('-');
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function core_buildDateStr_(yearMonth, dayNum) {
  return yearMonth + '-' + (dayNum < 10 ? '0' + dayNum : String(dayNum));
}

function core_addDays_(dateStr, days) {
  var parts = dateStr.split('-');
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  var d = Number(parts[2]);
  var dt = new Date(Date.UTC(y, m - 1, d + days));
  var ry = dt.getUTCFullYear();
  var rm = dt.getUTCMonth() + 1;
  var rd = dt.getUTCDate();
  return ry + '-' + (rm < 10 ? '0' + rm : String(rm)) + '-' + (rd < 10 ? '0' + rd : String(rd));
}

function core_isMinor_(birthDateStr, targetDateStr) {
  var bParts = birthDateStr.split('-');
  var by = Number(bParts[0]);
  var bm = Number(bParts[1]);
  var bd = Number(bParts[2]);

  var eighteenthYear = by + 18;
  var eighteenthDateStr = '';

  if (bm === 2 && bd === 29) {
    var isLeap = new Date(Date.UTC(eighteenthYear, 2, 0)).getUTCDate() === 29;
    if (isLeap) {
      eighteenthDateStr = eighteenthYear + '-02-29';
    } else {
      eighteenthDateStr = eighteenthYear + '-03-01';
    }
  } else {
    eighteenthDateStr = eighteenthYear + '-' + (bm < 10 ? '0' + bm : String(bm)) + '-' + (bd < 10 ? '0' + bd : String(bd));
  }

  return targetDateStr < eighteenthDateStr;
}

function core_isHoliday_(holidays, dateStr) {
  for (var i = 0; i < holidays.length; i++) {
    var h = holidays[i];
    if (dateStr >= h.startDate && dateStr <= h.endDate) {
      return true;
    }
  }
  return false;
}
