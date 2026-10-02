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

        // 1人1か月で A4 縦1枚。紙の予定表と同じく予定だけを載せる（実績は載せない。2026-10-01）
        var daysInMonth = core_getDaysInMonth_(ym);
        var planTotalMonth = 0;
        var rowsHtml = [];
        var publicHolidays = util_jpHolidaysOfMonth_(ym);

        for (var d = 1; d <= daysInMonth; d++) {
          var dayStr = String(d);
          var dateStr = core_buildDateStr_(ym, d);
          var dow = print_getDayOfWeek_(dateStr);
          var isHoliday = core_isHoliday_(allHolidays, dateStr);
          var phName = publicHolidays[dateStr] || '';

          var dayPShifts = (pEval && pEval.shifts && pEval.shifts[dayStr]) || pShifts[dayStr] || [];
          var pCell = print_formatShiftsCell_(dayPShifts);
          planTotalMonth += pCell.totalMinutes;

          var remarks = [];
          if (isOutOfScope) {
            remarks.push('対象外');
          } else {
            if (isHoliday) remarks.push('長期休暇');
            if (phName) remarks.push(phName);
          }
          var red = phName || dow === '日';

          rowsHtml.push(
            '<tr' + (isHoliday ? ' class="holiday-row"' : '') + '>' +
              '<td class="c-date"' + (red ? ' style="color: #c00;"' : (dow === '土' ? ' style="color: #1d4ed8;"' : '')) + '>' + d + '(' + dow + ')</td>' +
              '<td>' + pCell.times + '</td>' +
              '<td>' + pCell.breaks + '</td>' +
              '<td>' + pCell.workMinutes + '</td>' +
              '<td class="c-note">' + remarks.join(' ') + '</td>' +
            '</tr>'
          );
        }

        var statusText = isOutOfScope ? '対象外' : displayStatus;
        var outOfScopeNotice = isOutOfScope
          ? '<div class="out-of-scope-banner">※ この月は学校確定により「対象外」として処理されています。</div>'
          : '';

        var pageHtml =
          '<section class="student-page">' +
            '<div class="page-header">' +
              '<h1 class="page-title">アルバイトシフト予定表</h1>' +
              '<div class="header-ym">' + print_escapeHtml_(ym.slice(0, 4)) + '年' + Number(ym.slice(5, 7)) + '月分</div>' +
            '</div>' +
            '<table class="info-table"><tbody><tr>' +
              '<th>学籍番号</th><td>' + print_escapeHtml_(student.student_id) + '</td>' +
              '<th>氏名</th><td>' + print_escapeHtml_(student.name) + (student.name_kana ? '<br><span style="font-size: 10px;">' + print_escapeHtml_(student.name_kana) + '</span>' : '') + '</td>' +
              '<th>クラス</th><td>' + print_escapeHtml_(student.class) + '</td>' +
              '<th>状態</th><td>' + print_escapeHtml_(statusText) + '</td>' +
            '</tr></tbody></table>' +
            outOfScopeNotice +
            '<table class="print-table">' +
              '<thead><tr>' +
                '<th style="width: 16%;">日付(曜日)</th>' +
                '<th style="width: 30%;">勤務予定時間</th>' +
                '<th style="width: 14%;">休憩時間</th>' +
                '<th style="width: 16%;">実働(合計)時間</th>' +
                '<th>備考</th>' +
              '</tr></thead>' +
              '<tbody>' + rowsHtml.join('\n') + '</tbody>' +
            '</table>' +
            '<div class="page-foot">' +
              '<div class="total">勤務予定時間合計: <strong>' + print_formatMinutes_(planTotalMonth) + '</strong></div>' +
              '<div class="sign">署名 <span class="sign-line"></span></div>' +
            '</div>' +
          '</section>';

        pagesHtml.push(pageHtml);
      }
    }

    var fullHtml =
      '<!DOCTYPE html>\n' +
      '<html lang="ja">\n' +
      '<head>\n' +
      '<meta charset="utf-8">\n' +
      '<title>アルバイトシフト予定表</title>\n' +
      '<style>\n' +
      '@page { size: A4 portrait; margin: 10mm; }\n' +
      '* { box-sizing: border-box; }\n' +
      'body { font-family: "Hiragino Kaku Gothic ProN", "BIZ UDPGothic", Meiryo, sans-serif; margin: 0; color: #222; background: #fff; }\n' +
      '.student-page { width: 190mm; height: 275mm; margin: 0 auto; overflow: hidden; break-after: page; page-break-after: always; }\n' +
      '.student-page:last-child { break-after: auto; page-break-after: auto; }\n' +
      '.page-header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #222; padding-bottom: 2mm; margin-bottom: 3mm; }\n' +
      '.page-title { font-size: 18px; margin: 0; }\n' +
      '.header-ym { font-size: 15px; font-weight: bold; }\n' +
      '.info-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 3mm; }\n' +
      '.info-table th, .info-table td { border: 1px solid #888; padding: 1.5mm 2mm; text-align: left; }\n' +
      '.info-table th { background: #f0f0f0; white-space: nowrap; width: 1%; }\n' +
      '.out-of-scope-banner { margin-bottom: 2mm; padding: 1.5mm 2mm; border: 1px solid #888; font-size: 11px; font-weight: bold; }\n' +
      '.print-table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }\n' +
      '.print-table th, .print-table td { border: 1px solid #888; height: 6.6mm; padding: 0 2mm; text-align: center; vertical-align: middle; }\n' +
      '.print-table th { background: #f0f0f0; font-weight: bold; }\n' +
      '.print-table td.c-date { text-align: left; }\n' +
      '.print-table td.c-note { text-align: left; font-size: 10px; }\n' +
      '.print-table tr.holiday-row td { background: #f6f6f6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n' +
      '.page-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 4mm; font-size: 13px; }\n' +
      '.sign-line { display: inline-block; width: 60mm; border-bottom: 1px solid #222; margin-left: 2mm; }\n' +
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
