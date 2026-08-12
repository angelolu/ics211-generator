export const parseTime = (timeStr: string) => {
  const cleanStr = timeStr.trim().toUpperCase();
  let hours = 0;
  let minutes = 0;
  
  const isPM = cleanStr.includes('PM');
  const isAM = cleanStr.includes('AM');
  
  const numMatch = cleanStr.match(/\d+/g);
  if (!numMatch) return null;
  
  const numStr = numMatch.join('');
  
  if (numStr.length === 3 || numStr.length === 4) {
    hours = parseInt(numStr.substring(0, numStr.length - 2), 10);
    minutes = parseInt(numStr.substring(numStr.length - 2), 10);
  } else if (numStr.length <= 2) {
    hours = parseInt(numStr, 10);
    minutes = 0;
  } else {
    return null;
  }
  
  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;
  
  return hours * 60 + minutes;
};

export const calculateMinutesDiff = (timeIn: string, timeOut: string) => {
  if (!timeIn || !timeOut) return null;
  const inMins = parseTime(timeIn);
  const outMins = parseTime(timeOut);

  if (inMins === null || outMins === null) return null;

  let diff = outMins - inMins;
  if (diff < 0) diff += 24 * 60;
  return diff;
};

export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} minutes`;
  if (m === 0) return `${h} hours`;
  return `${h} hours ${m} minutes`;
}

export function calculateHours(timeIn: string, timeOut: string): string {
  const diff = calculateMinutesDiff(timeIn, timeOut);
  if (diff === null) return '';

  const h = Math.floor(diff / 60);
  const m = diff % 60;
  
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
