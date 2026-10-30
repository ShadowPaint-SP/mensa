import { cleanMealName } from './meal-filters.js';

const berlinTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function timestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function berlinTimestamp(date, hour, minute) {
  // Evening times are unambiguous even on daylight-saving transition days.
  const nominal = new Date(`${date}T${hour}:${minute}:00Z`);
  const parts = Object.fromEntries(berlinTime.formatToParts(nominal).map(({ type, value }) => [type, value]));
  const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
  return timestamp(new Date(nominal.getTime() * 2 - represented));
}

function escapeText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function foldLine(line) {
  const encoder = new TextEncoder();
  const lines = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const length = encoder.encode(character).length;
    if (bytes + length > 75) {
      lines.push(current);
      current = ' ';
      bytes = 1;
    }
    current += character;
    bytes += length;
  }
  lines.push(current);
  return lines.join('\r\n');
}

export function createMealCalendar({ meal, canteen, date }, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new RangeError('Ungültiges Veranstaltungsdatum');
  }
  const uid = Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16).padStart(8, '0')).join('');
  const location = [canteen.name, canteen.address].filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()).join(', ');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//mensa.//Tom-View//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@mensa`,
    `DTSTAMP:${timestamp(now)}`,
    `DTSTART:${berlinTimestamp(date, '17', '30')}`,
    `DTEND:${berlinTimestamp(date, '19', '00')}`,
    `SUMMARY:${escapeText(cleanMealName(meal) || 'Abendangebot')}`,
    `LOCATION:${escapeText(location)}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].map(foldLine).join('\r\n') + '\r\n';
}

export function downloadMealCalendar(entry) {
  const blob = new Blob([createMealCalendar(entry)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mensa-${entry.date}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  // Allow mobile browsers time to start the download before releasing its data.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
