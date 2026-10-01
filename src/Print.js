// 印刷用 HTML 生成
// 実装役向けルール: 公開関数は api_adminPrintHtml のみ。内部関数は末尾に _ を付ける

function print_escapeHtml_(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function print_getDayOfWeek_(dateStr) {
  var parts = dateStr.split('-');
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  var d = Number(parts[2]);
  var dt = new Date(Date.UTC(y, m - 1, d));
  var days = ['日', '月', '火', '水', '木', '金', '土'];
  return days[dt.getUTCDay()];
}

// 分を「8時間」「45分」「7時間30分」の形にする（紙の予定表と同じ書き方）
function print_formatMinutes_(min) {
  var total = Number(min) || 0;
  if (total <= 0) return '0時間';
  var h = Math.floor(total / 60);
  var m = total % 60;
  if (h === 0) return m + '分';
  return h + '時間' + (m > 0 ? m + '分' : '');
}

// 1日分のシフトを、勤務時間・休憩・実働の3つの欄にする
function print_formatShiftsCell_(shifts) {
  if (!shifts || shifts.length === 0) {
    return {
      times: '-',
      breaks: '-',
      workMinutes: '-',
      totalMinutes: 0
    };
  }

  var timeRanges = [];
  var breakTimes = [];
  var workTimes = [];
  var totalWork = 0;

  for (var i = 0; i < shifts.length; i++) {
    var s = shifts[i];
    var tRange = (s.start || '') + '〜' + (s.end || '');
    timeRanges.push(print_escapeHtml_(tRange));

    var wMin = 0;
    var bMin = 0;
    if (s.workMinutes !== undefined) {
      wMin = Number(s.workMinutes) || 0;
      bMin = Number(s.breakMinutes) || 0;
    } else if (s.start && s.end) {
      var sMin = core_timeToMinutes_(s.start);
      var eMin = core_timeToMinutes_(s.end);
      var bound = eMin <= sMin ? eMin + 1440 - sMin : eMin - sMin;
      bMin = bound <= 360 ? 0 : (bound <= 480 ? 45 : 60);
      wMin = bound - bMin;
    }
    totalWork += wMin;
    breakTimes.push(bMin > 0 ? print_formatMinutes_(bMin) : '0分');
    workTimes.push(print_formatMinutes_(wMin));
  }

  var workHtml = workTimes.join('<br>');
  if (shifts.length > 1) {
    workHtml += '<br><strong>(計 ' + print_formatMinutes_(totalWork) + ')</strong>';
  }

  return {
    times: timeRanges.join('<br>'),
    breaks: breakTimes.join('<br>'),
    workMinutes: workHtml,
    totalMinutes: totalWork
  };
}

function api_adminPrintHtml(token, params) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (!params || typeof params !== 'object') {
      return { ok: false, error: 'BAD_REQUEST' };
    }

    var studentIds = params.studentIds;
    var yearMonths = params.yearMonths;

    if (!Array.isArray(studentIds) || !Array.isArray(yearMonths)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    if (studentIds.length < 1 || studentIds.length > 50) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    if (yearMonths.length < 1 || yearMonths.length > 24) {
      return { ok: false, error: 'BAD_REQUEST' };
    }

    for (var i = 0; i < studentIds.length; i++) {
      if (typeof studentIds[i] !== 'string' || !studentIds[i]) {
        return { ok: false, error: 'BAD_REQUEST' };
      }
    }
    for (var j = 0; j < yearMonths.length; j++) {
      if (typeof yearMonths[j] !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonths[j])) {
        return { ok: false, error: 'BAD_REQUEST' };
      }
    }

    // マスタ・データの取得
    var allStudents = db_readAllRows_('STUDENTS');
    var studentMap = {};
    for (var si = 0; si < allStudents.length; si++) {
      studentMap[allStudents[si].student_id] = allStudents[si];
    }

    var allSubmissions = db_readAllRows_('MONTHLY_SUBMISSIONS');
    var subMap = {};
    for (var mi = 0; mi < allSubmissions.length; mi++) {
      var sRow = allSubmissions[mi];
      subMap[sRow.student_id + '_' + sRow.year_month] = sRow;
    }

    var allHolidays = db_readAllRows_('SCHOOL_HOLIDAYS').map(function(h) {
      return { startDate: h.start_date, endDate: h.end_date };
    });

    var settingsRows = db_readAllRows_('SETTINGS');
    var allowLeaveOfAbsence = false;
    for (var sti = 0; sti < settingsRows.length; sti++) {
      if (settingsRows[sti].key === 'allowLeaveOfAbsence') {
        allowLeaveOfAbsence = (settingsRows[sti].value === 'true');
      }
    }

    var pagesHtml = [];

    // 各学生 × 各月のページ生成
    for (var sIdx = 0; sIdx < studentIds.length; sIdx++) {
      var sId = studentIds[sIdx];
      // 登録の無い学籍番号は、許可ありなどと推測せず「未登録」として印刷する
      var student = studentMap[sId] || {
        student_id: sId,
        name: '（未登録の学籍番号）',
        class: '',
        status: '在籍',
        birth_date: '',
        enrollment_date: '',
        graduation_date: '',
        withdrawal_date: '',
        work_permission: 'false',
        permission_expires: ''
      };

      var studentPayload = {
        birthDate: student.birth_date,
        enrollmentDate: student.enrollment_date,
        withdrawalDate: student.withdrawal_date || null,
        graduationDate: student.graduation_date || null,
        status: student.status,
        workPermission: student.work_permission === 'true',
        permissionExpires: student.permission_expires || null
      };

      for (var yIdx = 0; yIdx < yearMonths.length; yIdx++) {
        var ym = yearMonths[yIdx];
        var sub = subMap[sId + '_' + ym];

        var isOutOfScope = (sub && sub.status === '学校確定');
        var displayStatus = '未提出';
        if (sub) {
          if (sub.status === '確定済') displayStatus = '確定済';
          else if (sub.status === '学校確定') displayStatus = '対象外';
          else if (sub.status === '下書き') displayStatus = '下書き';
        }

        var pShifts = {};
        if (sub && sub.shift_json) {
          try { pShifts = JSON.parse(sub.shift_json); } catch (e) {}
        }

        var aShifts = {};
        if (sub && sub.actual_json) {
          try { aShifts = JSON.parse(sub.actual_json); } catch (e) {}
        } else if (sub && sub.actual_status === '予定どおり') {
          aShifts = pShifts;
        }

        // 検算の実行（心臓部 evaluateMonth）
        var pEval = null;
        if (Object.keys(pShifts).length > 0) {
          try {
            pEval = evaluateMonth({
              yearMonth: ym,
              mode: 'plan',
              student: studentPayload,
              shifts: pShifts,
              prevMonthDaily: {},
              prevMonthSource: 'confirmed',
              nextMonthDaily: {},
              holidays: allHolidays,
              settings: { allowLeaveOfAbsence: allowLeaveOfAbsence }
            });
          } catch (e) {}
        }

        var aEval = null;
        if (Object.keys(aShifts).length > 0) {
          try {
            aEval = evaluateMonth({
              yearMonth: ym,
              mode: 'actual',
              student: studentPayload,
              shifts: aShifts,
              prevMonthDaily: {},
              prevMonthSource: 'confirmed',
              nextMonthDaily: {},
              holidays: allHolidays,
              settings: { allowLeaveOfAbsence: allowLeaveOfAbsence }
            });
          } catch (e) {}
        }

        // 実績の超過日の判定
        var overDays = {};
        if (aEval && aEval.codes) {
          for (var ci = 0; ci < aEval.codes.length; ci++) {
            var cObj = aEval.codes[ci];
            var code = cObj.code;
            if (code === 'OVER_8H_HOLIDAY' || code === 'MINOR_NIGHT' || code === 'MINOR_OVER' || code === 'OVER_28H') {
              if (code === 'OVER_28H' || code === 'MINOR_OVER') {
                if (cObj.date) {
                  for (var step = 0; step < 7; step++) {
                    var wDate = core_addDays_(cObj.date, step);
                    if (aEval.daily && aEval.daily[wDate] > 0) {
                      overDays[wDate] = true;
                    }
                  }
                  overDays[cObj.date] = true;
                }
              } else if (cObj.date) {
                overDays[cObj.date] = true;
              }
            }
          }
        }

        var daysInMonth = core_getDaysInMonth_(ym);
        var planTotalMonth = 0;
        var actualTotalMonth = 0;
        var rowsHtml = [];

        for (var d = 1; d <= daysInMonth; d++) {
          var dayStr = String(d);
          var dateStr = core_buildDateStr_(ym, d);
          var dow = print_getDayOfWeek_(dateStr);
          var isHoliday = core_isHoliday_(allHolidays, dateStr);
          var isOverDay = !!overDays[dateStr];

          var dayPShifts = (pEval && pEval.shifts && pEval.shifts[dayStr]) || pShifts[dayStr] || [];
          var dayAShifts = (aEval && aEval.shifts && aEval.shifts[dayStr]) || aShifts[dayStr] || [];

          var pCell = print_formatShiftsCell_(dayPShifts);
          var aCell = print_formatShiftsCell_(dayAShifts);

          planTotalMonth += pCell.totalMinutes;
          actualTotalMonth += aCell.totalMinutes;

          var trClasses = [];
          if (isOverDay) trClasses.push('exceeded');
          if (isHoliday) trClasses.push('holiday-row');
          var trClassAttr = trClasses.length > 0 ? ' class="' + trClasses.join(' ') + '"' : '';
          var trStyleAttr = isOverDay ? ' style="background-color: #e0e0e0;"' : '';

          var remarks = [];
          if (isOutOfScope) {
            remarks.push('対象外');
          } else {
            if (isOverDay) remarks.push('<span class="warn-badge">超過</span>');
            if (isHoliday) remarks.push('長期休暇');
          }

          rowsHtml.push(
            '<tr' + trClassAttr + trStyleAttr + '>' +
              '<td>' + d + '(' + dow + ')</td>' +
              '<td>' + pCell.times + '</td>' +
              '<td>' + pCell.breaks + '</td>' +
              '<td>' + pCell.workMinutes + '</td>' +
              '<td>' + aCell.times + '</td>' +
              '<td>' + aCell.breaks + '</td>' +
              '<td>' + aCell.workMinutes + '</td>' +
              '<td>' + remarks.join(' ') + '</td>' +
            '</tr>'
          );
        }

        var statusDisplayHtml = isOutOfScope
          ? '<span class="badge out-of-scope">対象外</span>'
          : '<span class="badge">' + print_escapeHtml_(displayStatus) + '</span>';

        var outOfScopeNotice = isOutOfScope
          ? '<div class="out-of-scope-banner">※ この月は学校確定により「対象外」として処理されています。</div>'
          : '';

        var pageHtml =
          '<section class="student-page">' +
            '<div class="page-header">' +
              '<div class="header-main">' +
                '<h1 class="page-title">アルバイト就業予定・実績表</h1>' +
                '<div class="header-ym">' + print_escapeHtml_(ym) + ' 分</div>' +
              '</div>' +
              '<div class="student-card">' +
                '<div class="student-item"><span class="item-label">学籍番号:</span> ' + print_escapeHtml_(student.student_id) + '</div>' +
                '<div class="student-item"><span class="item-label">氏名:</span> ' + print_escapeHtml_(student.name) + '</div>' +
                '<div class="student-item"><span class="item-label">クラス:</span> ' + print_escapeHtml_(student.class) + '</div>' +
                '<div class="student-item"><span class="item-label">状態:</span> ' + statusDisplayHtml + '</div>' +
                '<div class="student-item"><span class="item-label">勤務予定時間合計:</span> ' + print_formatMinutes_(planTotalMonth) + '</div>' +
                '<div class="student-item"><span class="item-label">勤務実績時間合計:</span> ' + print_formatMinutes_(actualTotalMonth) + '</div>' +
              '</div>' +
            '</div>' +
            outOfScopeNotice +
            '<table class="print-table">' +
              '<thead>' +
                '<tr>' +
                  '<th rowspan="2" style="width: 60px;">日付(曜日)</th>' +
                  '<th colspan="3">予定</th>' +
                  '<th colspan="3">実績</th>' +
                  '<th rowspan="2" style="width: 80px;">備考</th>' +
                '</tr>' +
                '<tr>' +
                  '<th style="width: 120px;">勤務予定時間</th>' +
                  '<th style="width: 60px;">休憩時間</th>' +
                  '<th style="width: 75px;">実働(合計)時間</th>' +
                  '<th style="width: 120px;">勤務時間</th>' +
                  '<th style="width: 60px;">休憩時間</th>' +
                  '<th style="width: 75px;">実働(合計)時間</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' +
                rowsHtml.join('\n') +
              '</tbody>' +
              '<tfoot>' +
                '<tr class="total-row">' +
                  '<td style="text-align: right; font-weight: bold;">合計</td>' +
                  '<td colspan="3" style="font-weight: bold;">勤務予定時間合計: ' + print_formatMinutes_(planTotalMonth) + '</td>' +
                  '<td colspan="3" style="font-weight: bold;">勤務実績時間合計: ' + print_formatMinutes_(actualTotalMonth) + '</td>' +
                  '<td>' + (isOutOfScope ? '対象外' : '') + '</td>' +
                '</tr>' +
              '</tfoot>' +
            '</table>' +
          '</section>';

        pagesHtml.push(pageHtml);
      }
    }

    var fullHtml =
      '<!DOCTYPE html>\n' +
      '<html lang="ja">\n' +
      '<head>\n' +
      '<meta charset="utf-8">\n' +
      '<title>アルバイト就業予定・実績表</title>\n' +
      '<style>\n' +
      '@page { size: A4 landscape; }\n' +
      '.student-page { break-after: page; }\n' +
      '* { box-sizing: border-box; }\n' +
      'body {\n' +
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", "BIZ UDPGothic", Meiryo, sans-serif;\n' +
      '  margin: 0;\n' +
      '  padding: 0;\n' +
      '  background-color: #fff;\n' +
      '  color: #222;\n' +
      '}\n' +
      '.student-page {\n' +
      '  width: 297mm;\n' +
      '  min-height: 210mm;\n' +
      '  padding: 8mm 10mm;\n' +
      '  margin: 0 auto;\n' +
      '  page-break-after: always;\n' +
      '  break-after: page;\n' +
      '  background: #fff;\n' +
      '}\n' +
      '.page-header {\n' +
      '  margin-bottom: 6px;\n' +
      '  border-bottom: 2px solid #2b3a4a;\n' +
      '  padding-bottom: 4px;\n' +
      '}\n' +
      '.header-main {\n' +
      '  display: flex;\n' +
      '  justify-content: space-between;\n' +
      '  align-items: baseline;\n' +
      '  margin-bottom: 4px;\n' +
      '}\n' +
      '.page-title {\n' +
      '  font-size: 16px;\n' +
      '  margin: 0;\n' +
      '  font-weight: bold;\n' +
      '  color: #1a252f;\n' +
      '}\n' +
      '.header-ym {\n' +
      '  font-size: 14px;\n' +
      '  font-weight: bold;\n' +
      '  color: #2b3a4a;\n' +
      '}\n' +
      '.student-card {\n' +
      '  display: flex;\n' +
      '  flex-wrap: wrap;\n' +
      '  gap: 12px;\n' +
      '  font-size: 11px;\n' +
      '  background: #f8fafc;\n' +
      '  padding: 4px 8px;\n' +
      '  border: 1px solid #e2e8f0;\n' +
      '  border-radius: 3px;\n' +
      '}\n' +
      '.student-item {\n' +
      '  display: inline-flex;\n' +
      '  align-items: center;\n' +
      '}\n' +
      '.item-label {\n' +
      '  font-weight: bold;\n' +
      '  color: #4a5568;\n' +
      '  margin-right: 4px;\n' +
      '}\n' +
      '.badge {\n' +
      '  display: inline-block;\n' +
      '  padding: 1px 5px;\n' +
      '  border-radius: 3px;\n' +
      '  background: #edf2f7;\n' +
      '  color: #2d3748;\n' +
      '  font-size: 10px;\n' +
      '}\n' +
      '.badge.out-of-scope {\n' +
      '  background: #cbd5e0;\n' +
      '  color: #1a202c;\n' +
      '  font-weight: bold;\n' +
      '}\n' +
      '.out-of-scope-banner {\n' +
      '  margin: 4px 0;\n' +
      '  padding: 4px 8px;\n' +
      '  background: #edf2f7;\n' +
      '  border: 1px solid #cbd5e0;\n' +
      '  border-radius: 3px;\n' +
      '  font-size: 11px;\n' +
      '  font-weight: bold;\n' +
      '  color: #4a5568;\n' +
      '}\n' +
      '.print-table {\n' +
      '  width: 100%;\n' +
      '  border-collapse: collapse;\n' +
      '  font-size: 10px;\n' +
      '  line-height: 1.2;\n' +
      '}\n' +
      '.print-table th, .print-table td {\n' +
      '  border: 1px solid #a0aec0;\n' +
      '  padding: 2px 4px;\n' +
      '  text-align: center;\n' +
      '  vertical-align: middle;\n' +
      '}\n' +
      '.print-table th {\n' +
      '  background: #edf2f7;\n' +
      '  color: #2d3748;\n' +
      '  font-weight: bold;\n' +
      '}\n' +
      '.print-table tr.holiday-row td:nth-child(1) {\n' +
      '  background-color: #fff5f5;\n' +
      '  color: #c53030;\n' +
      '}\n' +
      '.print-table tr.exceeded, .print-table td.exceeded {\n' +
      '  background-color: #e0e0e0 !important;\n' +
      '  background-image: repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0, 0, 0, 0.08) 3px, rgba(0, 0, 0, 0.08) 6px) !important;\n' +
      '  -webkit-print-color-adjust: exact;\n' +
      '  print-color-adjust: exact;\n' +
      '}\n' +
      '.warn-badge {\n' +
      '  color: #c53030;\n' +
      '  font-weight: bold;\n' +
      '}\n' +
      '.total-row td {\n' +
      '  background: #f7fafc;\n' +
      '  font-weight: bold;\n' +
      '}\n' +
      '</style>\n' +
      '</head>\n' +
      '<body>\n' +
      pagesHtml.join('\n') + '\n' +
      '</body>\n' +
      '</html>';

    return {
      ok: true,
      data: {
        html: fullHtml
      }
    };
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}
