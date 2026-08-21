
// ═══════════════════════════════════════════════════════════
// CALENDAR TAB
// ═══════════════════════════════════════════════════════════
function renderCalendar() {
  var date = S.calendarDate;
  var year = date.getFullYear();
  var month = date.getMonth();
  var monthName = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  $('calendarHeader').textContent = monthName;
  $('calendarPrev').onclick = function () { S.calendarDate = new Date(year, month - 1, 1); renderCalendar(); };
  $('calendarNext').onclick = function () { S.calendarDate = new Date(year, month + 1, 1); renderCalendar(); };

  qsa('[data-calendar-view]').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.calendarView === S.calendarView);
    btn.onclick = function () { S.calendarView = btn.dataset.calendarView; renderCalendar(); };
  });

  var issues = getSpaceIssues(S.currentSpace);
  var firstDay = new Date(year, month, 1);
  var lastDay = new Date(year, month + 1, 0);
  var startPad = firstDay.getDay();
  var totalDays = lastDay.getDate();
  var todayStr = fmtDateISO(new Date());

  var weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var html = '<div class="calendar-weekdays">';
  for (var w = 0; w < weekdays.length; w++) {
    html += '<div class="calendar-weekday">' + weekdays[w] + '</div>';
  }
  html += '</div><div class="calendar-days">';

  for (var p = 0; p < startPad; p++) {
    html += '<div class="calendar-day calendar-day-empty"></div>';
  }

  for (var d = 1; d <= totalDays; d++) {
    var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var isToday = dateStr === todayStr;
    var dayIssues = issues.filter(function (i) { return fmtDateISO(i.due_date) === dateStr; });

    html += '<div class="calendar-day' + (isToday ? ' calendar-today' : '') + '">' +
      '<div class="calendar-day-num">' + d + '</div><div class="calendar-day-issues">';

    var showCount = Math.min(dayIssues.length, 3);
    for (var di = 0; di < showCount; di++) {
      var ci = dayIssues[di];
      html += '<div class="calendar-issue" onclick="openIssuePage(\'' + ci.id + '\')" style="border-left:3px solid ' + (STATUS_COLORS[ci.status] || '#6b7280') + '">' +
        '<span class="calendar-issue-key">' + esc(issueKeyStr(ci)) + '</span></div>';
    }
    if (dayIssues.length > 3) {
      html += '<span class="text-muted">+' + (dayIssues.length - 3) + ' more</span>';
    }
    html += '</div></div>';
  }

  var totalCells = startPad + totalDays;
  var remainder = totalCells % 7;
  if (remainder > 0) {
    for (var rr = 0; rr < 7 - remainder; rr++) {
      html += '<div class="calendar-day calendar-day-empty"></div>';
    }
  }
  html += '</div>';
  $('calendarGrid').innerHTML = html;
}
